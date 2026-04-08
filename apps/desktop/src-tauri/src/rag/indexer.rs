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
const CONTEXTUAL_DOCUMENT_TOKEN_BUDGET: usize = 1536;

fn partition_chunks_for_contextual_documents(
    chunks: &[crate::rag::types::ChunkRecord],
) -> Vec<&[crate::rag::types::ChunkRecord]> {
    if chunks.is_empty() {
        return Vec::new();
    }

    let mut partitions = Vec::new();
    let mut start = 0usize;
    let mut budget = 0usize;

    for (index, chunk) in chunks.iter().enumerate() {
        let chunk_budget = chunk.token_count.max(1) + 1;
        let would_overflow =
            index > start && budget + chunk_budget > CONTEXTUAL_DOCUMENT_TOKEN_BUDGET;
        if would_overflow {
            partitions.push(&chunks[start..index]);
            start = index;
            budget = 0;
        }
        budget += chunk_budget;
    }

    if start < chunks.len() {
        partitions.push(&chunks[start..]);
    }

    partitions
}

fn embed_chunks_with_provider(
    provider: &impl EmbeddingProvider,
    chunks: &[crate::rag::types::ChunkRecord],
) -> Result<(Vec<(String, Vec<f32>)>, u64), String> {
    if provider.supports_contextual_documents() {
        let batch_started_at = Instant::now();
        let partitions = partition_chunks_for_contextual_documents(chunks);
        let documents = partitions
            .iter()
            .map(|partition| {
                partition
                    .iter()
                    .map(|chunk| chunk.content.clone())
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();
        let embeddings_by_document = provider.embed_document_chunks(&documents)?;
        let first_batch_ms = batch_started_at.elapsed().as_millis() as u64;
        if embeddings_by_document.len() != partitions.len() {
            return Err(format!(
                "embedding provider returned {} documents for {} page partitions",
                embeddings_by_document.len()
                , partitions.len()
            ));
        }
        let mut embeddings = Vec::with_capacity(chunks.len());
        for (partition, document_embeddings) in partitions.iter().zip(embeddings_by_document) {
            if document_embeddings.len() != partition.len() {
                return Err(format!(
                    "embedding provider returned {} embeddings for {} chunks in a contextual partition",
                    document_embeddings.len(),
                    partition.len()
                ));
            }
            embeddings.extend(
                partition
                    .iter()
                    .zip(document_embeddings.into_iter())
                    .map(|(chunk, embedding)| (chunk.chunk_id.clone(), embedding)),
            );
        }
        return Ok((embeddings, first_batch_ms));
    }

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
    Ok((embeddings, first_batch_ms))
}

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
    let (embeddings, first_batch_ms) = embed_chunks_with_provider(&provider, &chunks)?;
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
    use super::{
        embed_chunks_with_provider, index_page, partition_chunks_for_contextual_documents,
        EMBEDDING_BATCH_SIZE,
    };
    use crate::rag::repository::RagRepository;
    use crate::rag::schema::open_or_create_rag_db;
    use crate::rag::types::{ChunkRecord, IndexedPageRecord};
    use crate::rag::provider::EmbeddingProvider;
    use chrono::Utc;
    use sandpaper_core::db::Database;
    use std::cell::Cell;
    use tempfile::tempdir;

    fn setup_main_db() -> Database {
        let db = Database::new_in_memory().expect("db init");
        db.run_migrations().expect("migrations");
        db
    }

    #[derive(Default)]
    struct FakeContextProvider {
        contextual_calls: Cell<usize>,
        last_document_sizes: std::cell::RefCell<Vec<usize>>,
    }

    impl EmbeddingProvider for FakeContextProvider {
        fn provider_name(&self) -> &'static str {
            "test"
        }

        fn model_name(&self) -> &'static str {
            "fake-context"
        }

        fn embed_query(&self, _query: &str) -> Result<Vec<f32>, String> {
            Ok(vec![1.0, 0.0])
        }

        fn embed_document(&self, _text: &str) -> Result<Vec<f32>, String> {
            Err("unused".to_string())
        }

        fn embed_documents(&self, _texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
            Err("chunk-batch path should not be used".to_string())
        }

        fn supports_contextual_documents(&self) -> bool {
            true
        }

        fn embed_document_chunks(
            &self,
            documents: &[Vec<String>],
        ) -> Result<Vec<Vec<Vec<f32>>>, String> {
            self.contextual_calls.set(self.contextual_calls.get() + 1);
            *self.last_document_sizes.borrow_mut() =
                documents.iter().map(|document| document.len()).collect();
            Ok(documents
                .iter()
                .map(|document| {
                    document
                        .iter()
                        .enumerate()
                        .map(|(index, _)| vec![index as f32 + 1.0, 0.0])
                        .collect()
                })
                .collect())
        }
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

    #[test]
    fn contextual_provider_embeds_page_chunks_in_single_document_batch() {
        let provider = FakeContextProvider::default();
        let chunks = vec![
            ChunkRecord {
                chunk_id: "page-1:block-1".to_string(),
                page_uid: "page-1".to_string(),
                block_uid: "block-1".to_string(),
                ordinal: 0,
                source_kind: "block".to_string(),
                breadcrumb: None,
                content: "alpha".to_string(),
                token_count: 1,
                chunk_hash: "hash-1".to_string(),
            },
            ChunkRecord {
                chunk_id: "page-1:block-2".to_string(),
                page_uid: "page-1".to_string(),
                block_uid: "block-2".to_string(),
                ordinal: 1,
                source_kind: "block".to_string(),
                breadcrumb: None,
                content: "beta".to_string(),
                token_count: 1,
                chunk_hash: "hash-2".to_string(),
            },
        ];

        let (embeddings, _) =
            embed_chunks_with_provider(&provider, &chunks).expect("contextual embeddings");

        assert_eq!(provider.contextual_calls.get(), 1);
        assert_eq!(&*provider.last_document_sizes.borrow(), &[2]);
        assert_eq!(embeddings.len(), 2);
        assert_eq!(embeddings[0].0, "page-1:block-1");
        assert_eq!(embeddings[1].0, "page-1:block-2");
        assert_eq!(embeddings[0].1, vec![1.0, 0.0]);
        assert_eq!(embeddings[1].1, vec![2.0, 0.0]);
    }

    #[test]
    fn contextual_partitioning_splits_large_pages_into_multiple_documents() {
        let chunks = (0..64)
            .map(|index| ChunkRecord {
                chunk_id: format!("page-1:block-{index}"),
                page_uid: "page-1".to_string(),
                block_uid: format!("block-{index}"),
                ordinal: index,
                source_kind: "block".to_string(),
                breadcrumb: None,
                content: format!("chunk {index}"),
                token_count: 48,
                chunk_hash: format!("hash-{index}"),
            })
            .collect::<Vec<_>>();

        let partitions = partition_chunks_for_contextual_documents(&chunks);

        assert!(partitions.len() > 1);
        assert_eq!(partitions.iter().map(|partition| partition.len()).sum::<usize>(), 64);
        assert!(partitions.iter().all(|partition| !partition.is_empty()));
    }

    #[test]
    fn contextual_provider_embeds_large_pages_across_multiple_partitions() {
        let provider = FakeContextProvider::default();
        let chunks = (0..64)
            .map(|index| ChunkRecord {
                chunk_id: format!("page-1:block-{index}"),
                page_uid: "page-1".to_string(),
                block_uid: format!("block-{index}"),
                ordinal: index,
                source_kind: "block".to_string(),
                breadcrumb: None,
                content: format!("chunk {index}"),
                token_count: 48,
                chunk_hash: format!("hash-{index}"),
            })
            .collect::<Vec<_>>();

        let (embeddings, _) =
            embed_chunks_with_provider(&provider, &chunks).expect("contextual embeddings");

        assert_eq!(provider.contextual_calls.get(), 1);
        assert!(provider.last_document_sizes.borrow().len() > 1);
        assert_eq!(embeddings.len(), 64);
    }
}
