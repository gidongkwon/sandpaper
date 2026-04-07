use crate::rag::chunker::chunk_page_blocks;
use crate::rag::hash::hash_page_snapshot;
use crate::rag::provider::{
    model_is_ready, model_requires_download, provider_init_generation, provider_last_init_ms,
    resolve_provider, EmbeddingProvider,
};
use crate::rag::repository::RagRepository;
use crate::rag::types::{IndexedPageRecord, RebuildPageProfile};
use chrono::Utc;
use sandpaper_core::db::Database;
use std::time::Instant;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexPageOutcome {
    pub changed: bool,
    pub chunk_count: usize,
    pub profile: RebuildPageProfile,
}

const EMBEDDING_BATCH_SIZE: usize = 8;

pub fn index_page(
    db: &Database,
    repo: &mut RagRepository,
    page_uid: &str,
) -> Result<IndexPageOutcome, String> {
    let started_at = Instant::now();
    let page_load_started_at = Instant::now();
    let page = db
        .get_page_by_uid(page_uid)
        .map_err(|err| format!("{:?}", err))?
        .ok_or_else(|| format!("page-not-found: {page_uid}"))?;
    let blocks = db
        .load_blocks_for_page(page.id)
        .map_err(|err| format!("{:?}", err))?;
    let page_load_ms = page_load_started_at.elapsed().as_millis() as u64;
    let page_hash = hash_page_snapshot(&page.uid, &page.title, &blocks);

    if let Some(existing) = repo.get_indexed_page(&page.uid)? {
        if existing.page_hash == page_hash && existing.index_state == "ready" {
            let chunk_count = repo.list_chunks_for_page(&page.uid)?.len();
            return Ok(IndexPageOutcome {
                changed: false,
                chunk_count,
                profile: RebuildPageProfile {
                    page_uid: page.uid.clone(),
                    title: page.title.clone(),
                    chunk_count,
                    page_load_ms,
                    chunking_ms: 0,
                    provider_init_ms: 0,
                    first_batch_ms: 0,
                    embedding_ms: 0,
                    write_ms: 0,
                    total_ms: started_at.elapsed().as_millis() as u64,
                },
            });
        }
    }

    let chunking_started_at = Instant::now();
    let chunks = chunk_page_blocks(&page.uid, &page.title, &blocks);
    let chunking_ms = chunking_started_at.elapsed().as_millis() as u64;
    let now = Utc::now().timestamp_millis();
    let selected_model = repo.read_selected_embedding_model()?;
    let embeddings_ready =
        !model_requires_download(&selected_model) || model_is_ready(&selected_model)?;
    let page_record = IndexedPageRecord {
        page_uid: page.uid.clone(),
        title: page.title.clone(),
        page_hash,
        block_count: blocks.len(),
        last_saved_at: Some(now),
        last_indexed_at: embeddings_ready.then_some(now),
        index_state: if embeddings_ready {
            "ready".to_string()
        } else {
            "pending".to_string()
        },
    };

    let write_started_at = Instant::now();
    repo.upsert_indexed_page(&page_record)?;
    repo.replace_chunks_for_page(&page.uid, &page.title, &chunks)?;
    let mut write_ms = write_started_at.elapsed().as_millis() as u64;
    if !embeddings_ready {
        let pending_write_started_at = Instant::now();
        repo.replace_chunk_embeddings_for_page(&page.uid, &[])?;
        write_ms += pending_write_started_at.elapsed().as_millis() as u64;
        return Ok(IndexPageOutcome {
            changed: true,
            chunk_count: chunks.len(),
            profile: RebuildPageProfile {
                page_uid: page.uid.clone(),
                title: page.title.clone(),
                chunk_count: chunks.len(),
                page_load_ms,
                chunking_ms,
                provider_init_ms: 0,
                first_batch_ms: 0,
                embedding_ms: 0,
                write_ms,
                total_ms: started_at.elapsed().as_millis() as u64,
            },
        });
    }

    let init_generation_before = provider_init_generation();
    let provider = resolve_provider(&selected_model);
    let provider_init_ms = if provider_init_generation() != init_generation_before {
        provider_last_init_ms()
    } else {
        0
    };
    let embedding_started_at = Instant::now();
    let mut first_batch_ms = 0u64;
    let mut embeddings = Vec::with_capacity(chunks.len());
    for (batch_index, batch) in chunks.chunks(EMBEDDING_BATCH_SIZE).enumerate() {
        let batch_started_at = Instant::now();
        let texts: Vec<String> = batch.iter().map(|chunk| chunk.content.clone()).collect();
        let batch_embeddings = provider.embed_documents(&texts)?;
        if batch_embeddings.len() != batch.len() {
            return Err(format!(
                "embedding provider returned {} embeddings for {} chunks",
                batch_embeddings.len(),
                batch.len()
            ));
        }
        embeddings.extend(
            batch
                .iter()
                .zip(batch_embeddings.into_iter())
                .map(|(chunk, embedding)| (chunk.chunk_id.clone(), embedding)),
        );
        let batch_ms = batch_started_at.elapsed().as_millis() as u64;
        if batch_index == 0 {
            first_batch_ms = batch_ms;
        }
    }
    let embedding_ms = embedding_started_at.elapsed().as_millis() as u64;
    let vector_write_started_at = Instant::now();
    repo.replace_chunk_embeddings_for_page(&page.uid, &embeddings)?;
    write_ms += vector_write_started_at.elapsed().as_millis() as u64;

    Ok(IndexPageOutcome {
        changed: true,
        chunk_count: chunks.len(),
        profile: RebuildPageProfile {
            page_uid: page.uid.clone(),
            title: page.title.clone(),
            chunk_count: chunks.len(),
            page_load_ms,
            chunking_ms,
            provider_init_ms,
            first_batch_ms,
            embedding_ms,
            write_ms,
            total_ms: started_at.elapsed().as_millis() as u64,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::{index_page, EMBEDDING_BATCH_SIZE};
    use crate::rag::repository::RagRepository;
    use crate::rag::schema::open_or_create_rag_db;
    use crate::rag::types::IndexedPageRecord;
    use sandpaper_core::db::Database;
    use chrono::Utc;
    use tempfile::tempdir;

    fn setup_main_db() -> Database {
        let db = Database::new_in_memory().expect("db init");
        db.run_migrations().expect("migrations");
        db
    }

    #[test]
    fn index_page_writes_chunks_that_are_searchable() {
        let db = setup_main_db();
        let page_id = db.insert_page("page-1", "Inbox").expect("insert page");
        db.insert_block(page_id, "block-1", None, "000001", "semantic alpha", "{}")
            .expect("insert block");

        let dir = tempdir().expect("tempdir");
        let conn = open_or_create_rag_db(dir.path()).expect("open rag db");
        let mut repo = RagRepository::new(conn);

        let outcome = index_page(&db, &mut repo, "page-1").expect("index page");
        assert!(outcome.changed);
        assert_eq!(outcome.chunk_count, 1);

        let hits = repo.search_fts("semantic", 10).expect("fts search");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].page_uid, "page-1");
        assert_eq!(hits[0].block_uid, "block-1");
        let vectors = repo.list_all_chunk_embeddings().expect("vectors");
        assert_eq!(vectors.len(), 1);
    }

    #[test]
    fn index_page_skips_reindex_when_page_hash_is_unchanged() {
        let db = setup_main_db();
        let page_id = db.insert_page("page-1", "Inbox").expect("insert page");
        db.insert_block(page_id, "block-1", None, "000001", "semantic alpha", "{}")
            .expect("insert block");

        let dir = tempdir().expect("tempdir");
        let conn = open_or_create_rag_db(dir.path()).expect("open rag db");
        let mut repo = RagRepository::new(conn);

        let first = index_page(&db, &mut repo, "page-1").expect("first index");
        let second = index_page(&db, &mut repo, "page-1").expect("second index");

        assert!(first.changed);
        assert!(!second.changed);
        assert_eq!(second.chunk_count, 1);
    }

    #[test]
    fn index_page_reindexes_pending_page_even_when_hash_is_unchanged() {
        let db = setup_main_db();
        let page_id = db.insert_page("page-1", "Inbox").expect("insert page");
        db.insert_block(page_id, "block-1", None, "000001", "semantic alpha", "{}")
            .expect("insert block");

        let dir = tempdir().expect("tempdir");
        let conn = open_or_create_rag_db(dir.path()).expect("open rag db");
        let mut repo = RagRepository::new(conn);

        let first = index_page(&db, &mut repo, "page-1").expect("first index");
        assert!(first.changed);

        let existing = repo
            .get_indexed_page("page-1")
            .expect("get indexed page")
            .expect("indexed page exists");
        repo.upsert_indexed_page(&IndexedPageRecord {
            last_indexed_at: None,
            index_state: "pending".to_string(),
            last_saved_at: Some(Utc::now().timestamp_millis()),
            ..existing
        })
        .expect("mark page pending");
        repo.replace_chunk_embeddings_for_page("page-1", &[])
            .expect("clear embeddings");

        let second = index_page(&db, &mut repo, "page-1").expect("second index");
        assert!(second.changed);

        let updated = repo
            .get_indexed_page("page-1")
            .expect("get updated page")
            .expect("updated page exists");
        assert_eq!(updated.index_state, "ready");
        assert!(updated.last_indexed_at.is_some());
        let vectors = repo.list_all_chunk_embeddings().expect("vectors");
        assert_eq!(vectors.len(), 1);
    }

    #[test]
    fn index_page_batches_embeddings_for_large_pages() {
        let db = setup_main_db();
        let page_id = db.insert_page("page-1", "Inbox").expect("insert page");
        for index in 0..(EMBEDDING_BATCH_SIZE + 3) {
            db.insert_block(
                page_id,
                &format!("block-{index}"),
                None,
                &format!("{index:06}"),
                &format!("semantic alpha {index}"),
                "{}",
            )
            .expect("insert block");
        }

        let dir = tempdir().expect("tempdir");
        let conn = open_or_create_rag_db(dir.path()).expect("open rag db");
        let mut repo = RagRepository::new(conn);

        let outcome = index_page(&db, &mut repo, "page-1").expect("index page");

        assert_eq!(outcome.chunk_count, EMBEDDING_BATCH_SIZE + 3);
        let vectors = repo.list_all_chunk_embeddings().expect("vectors");
        assert_eq!(vectors.len(), EMBEDDING_BATCH_SIZE + 3);
    }
}
