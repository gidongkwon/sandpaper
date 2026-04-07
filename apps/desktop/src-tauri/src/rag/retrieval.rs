use crate::rag::indexer::index_page;
use crate::rag::provider::{
    available_embedding_models, embedding_model_option, model_is_ready, resolve_provider,
    selected_model_matches_provider, EmbeddingProvider,
};
use crate::rag::repository::RagRepository;
use crate::rag::schema::open_or_create_rag_db;
use crate::rag::types::{
    EmbeddingModelId, IndexBuildState, IndexBuildStatus, IndexBuildSummary, IndexStatus, SearchHit,
    SearchMode,
};
use sandpaper_core::db::Database;
use std::cmp::Ordering;
use std::collections::HashMap;
use std::path::Path;
use std::time::Instant;

fn embedding_status_message(
    selected_model: &EmbeddingModelId,
    _selected_model_ready: bool,
    selected_model_active: bool,
) -> Option<String> {
    if selected_model_active {
        return None;
    }

    let Some(selected_model_option) = embedding_model_option(selected_model) else {
        return Some(format!(
            "{} is selected but not supported by the current build.",
            selected_model.as_str()
        ));
    };

    if selected_model_option.id.as_str() == "local" {
        Some(
            "Local substring/trigram search is selected but the local provider is not active."
                .to_string(),
        )
    } else if !selected_model_option.requires_download {
        Some(format!(
            "{} is selected but the active provider does not match.",
            selected_model_option.label
        ))
    } else if !_selected_model_ready {
        Some(format!(
            "{} is selected but not downloaded yet. Download the model before rebuilding the index.",
            selected_model_option.label
        ))
    } else {
        Some(format!(
            "{} is selected but the app fell back to the local provider. Repair the model to retry loading.",
            selected_model_option.label
        ))
    }
}

pub fn read_status(vault_path: &Path) -> Result<IndexStatus, String> {
    let conn = open_or_create_rag_db(vault_path)?;
    let repo = RagRepository::new(conn);
    let mut status = repo.read_index_status()?;
    status.available_embedding_models = available_embedding_models();
    status.selected_embedding_model_ready = model_is_ready(&status.selected_embedding_model)?;
    let provider = resolve_provider(&status.selected_embedding_model);
    status.selected_embedding_model_active =
        selected_model_matches_provider(&status.selected_embedding_model, &provider);
    status.embedding_status_message = embedding_status_message(
        &status.selected_embedding_model,
        status.selected_embedding_model_ready,
        status.selected_embedding_model_active,
    );
    status.embedding_provider = Some(provider.provider_name().to_string());
    status.embedding_model = Some(provider.model_name().to_string());
    status.rebuild_status = None;
    Ok(status)
}

pub fn rebuild_index(db: &Database, vault_path: &Path) -> Result<IndexBuildSummary, String> {
    rebuild_index_with_progress(db, vault_path, |_| {})
}

pub fn rebuild_index_with_progress<F>(
    db: &Database,
    vault_path: &Path,
    mut progress: F,
) -> Result<IndexBuildSummary, String>
where
    F: FnMut(&IndexBuildStatus),
{
    let started_at = Instant::now();
    let conn = open_or_create_rag_db(vault_path)?;
    let mut repo = RagRepository::new(conn);
    let pages = db.list_pages().map_err(|err| format!("{:?}", err))?;
    let total_pages = pages.len();

    let mut pages_indexed = 0usize;
    let mut changed_pages = 0usize;
    let mut chunks_written = 0usize;
    let mut page_load_ms = 0u64;
    let mut chunking_ms = 0u64;
    let mut provider_init_ms = 0u64;
    let mut first_batch_ms = 0u64;
    let mut embedding_ms = 0u64;
    let mut write_ms = 0u64;
    let mut slow_pages = Vec::new();

    let queued = IndexBuildStatus {
        state: IndexBuildState::Queued,
        progress: if total_pages == 0 { 1.0 } else { 0.0 },
        processed_pages: 0,
        total_pages,
        current_page_title: None,
        message: if total_pages == 0 {
            "RAG index is already up to date.".to_string()
        } else {
            format!("Queued rebuild for {total_pages} page(s).")
        },
        can_cancel: false,
        summary: None,
        error: None,
    };
    progress(&queued);

    for page in pages {
        let running = IndexBuildStatus {
            state: IndexBuildState::Running,
            progress: if total_pages == 0 {
                1.0
            } else {
                pages_indexed as f32 / total_pages as f32
            },
            processed_pages: pages_indexed,
            total_pages,
            current_page_title: Some(page.title.clone()),
            message: format!("Indexing {}", page.title),
            can_cancel: false,
            summary: None,
            error: None,
        };
        progress(&running);

        let outcome = index_page(db, &mut repo, &page.uid)?;
        pages_indexed += 1;
        if outcome.changed {
            changed_pages += 1;
        }
        chunks_written += outcome.chunk_count;
        page_load_ms += outcome.profile.page_load_ms;
        chunking_ms += outcome.profile.chunking_ms;
        provider_init_ms += outcome.profile.provider_init_ms;
        first_batch_ms += outcome.profile.first_batch_ms;
        embedding_ms += outcome.profile.embedding_ms;
        write_ms += outcome.profile.write_ms;
        slow_pages.push(outcome.profile);
    }
    slow_pages.sort_by(|left, right| right.total_ms.cmp(&left.total_ms));
    slow_pages.truncate(5);

    let summary = IndexBuildSummary {
        pages_indexed,
        changed_pages,
        chunks_written,
        elapsed_ms: started_at.elapsed().as_millis() as u64,
        page_load_ms,
        chunking_ms,
        provider_init_ms,
        first_batch_ms,
        embedding_ms,
        write_ms,
        slow_pages,
    };

    let completed = IndexBuildStatus {
        state: IndexBuildState::Completed,
        progress: 1.0,
        processed_pages: summary.pages_indexed,
        total_pages,
        current_page_title: None,
        message: format!("Indexed {} page(s).", summary.pages_indexed),
        can_cancel: false,
        summary: Some(summary.clone()),
        error: None,
    };
    progress(&completed);

    Ok(summary)
}

pub fn search_lexical(
    vault_path: &Path,
    query: &str,
    limit: usize,
) -> Result<Vec<SearchHit>, String> {
    let conn = open_or_create_rag_db(vault_path)?;
    let repo = RagRepository::new(conn);
    repo.search_fts(query, limit)
}

fn cosine_similarity(left: &[f32], right: &[f32]) -> f32 {
    if left.len() != right.len() || left.is_empty() {
        return 0.0;
    }
    left.iter().zip(right).map(|(a, b)| a * b).sum()
}

fn cmp_desc_f64(left: f64, right: f64) -> Ordering {
    right.partial_cmp(&left).unwrap_or(Ordering::Equal)
}

#[derive(Debug, Clone, Copy)]
struct RetrievalTuning {
    min_vector_score: f64,
    lexical_rrf_weight: f64,
    vector_rrf_weight: f64,
}

fn retrieval_tuning(model: EmbeddingModelId) -> RetrievalTuning {
    match model.as_str() {
        "local" => RetrievalTuning {
            min_vector_score: 0.2,
            lexical_rrf_weight: 1.0,
            vector_rrf_weight: 0.6,
        },
        _ => RetrievalTuning {
            min_vector_score: 0.18,
            lexical_rrf_weight: 1.0,
            vector_rrf_weight: 1.0,
        },
    }
}

fn normalize_query_terms(query: &str) -> Vec<String> {
    query
        .split(|ch: char| !ch.is_alphanumeric())
        .map(|term| term.trim().to_lowercase())
        .filter(|term| term.len() >= 2)
        .collect()
}

fn query_match_bonus(hit: &SearchHit, query: &str, query_terms: &[String]) -> f64 {
    let normalized_query = query.trim().to_lowercase();
    if normalized_query.is_empty() {
        return 0.0;
    }

    let title = hit.title.to_lowercase();
    let breadcrumb = hit.breadcrumb.as_deref().unwrap_or_default().to_lowercase();
    let snippet = hit.snippet.to_lowercase();

    let mut bonus = 0.0;
    if title.contains(&normalized_query) {
        bonus += 0.03;
    }
    if breadcrumb.contains(&normalized_query) {
        bonus += 0.02;
    }
    if snippet.contains(&normalized_query) {
        bonus += 0.015;
    }

    let title_term_hits = query_terms
        .iter()
        .filter(|term| title.contains(term.as_str()))
        .count();
    if title_term_hits == query_terms.len() && !query_terms.is_empty() {
        bonus += 0.025;
    }

    bonus
}

pub fn search_vector(
    vault_path: &Path,
    query: &str,
    limit: usize,
) -> Result<Vec<SearchHit>, String> {
    let conn = open_or_create_rag_db(vault_path)?;
    let repo = RagRepository::new(conn);
    let selected_model = repo.read_selected_embedding_model()?;
    let tuning = retrieval_tuning(selected_model.clone());
    let provider = resolve_provider(&selected_model);
    let query_embedding = provider.embed_query(query)?;
    let mut hits: Vec<SearchHit> = repo
        .list_vector_candidates()?
        .into_iter()
        .map(|candidate| {
            let vector_score = cosine_similarity(&query_embedding, &candidate.embedding) as f64;
            SearchHit {
                page_uid: candidate.page_uid,
                block_uid: candidate.block_uid,
                chunk_id: candidate.chunk_id,
                title: candidate.title,
                breadcrumb: candidate.breadcrumb,
                snippet: candidate.snippet,
                score: vector_score,
                lex_score: None,
                vector_score: Some(vector_score),
                rerank_score: None,
                rank: 0,
                source: SearchMode::Vector,
                matched_terms: vec![query.to_string()],
            }
        })
        .filter(|hit| hit.vector_score.unwrap_or_default() >= tuning.min_vector_score)
        .collect();

    hits.sort_by(|left, right| cmp_desc_f64(left.score, right.score));
    hits.truncate(limit);
    for (index, hit) in hits.iter_mut().enumerate() {
        hit.rank = index + 1;
    }
    Ok(hits)
}

pub fn search_hybrid(
    vault_path: &Path,
    query: &str,
    limit: usize,
) -> Result<Vec<SearchHit>, String> {
    let conn = open_or_create_rag_db(vault_path)?;
    let repo = RagRepository::new(conn);
    let tuning = retrieval_tuning(repo.read_selected_embedding_model()?);
    let lexical = search_lexical(vault_path, query, limit.saturating_mul(2).max(10))?;
    let vector = search_vector(vault_path, query, limit.saturating_mul(2).max(10))?;
    let query_terms = normalize_query_terms(query);

    #[derive(Default)]
    struct Accumulator {
        hit: Option<SearchHit>,
        score: f64,
        lex_score: Option<f64>,
        vector_score: Option<f64>,
    }

    let mut by_chunk: HashMap<String, Accumulator> = HashMap::new();
    for (index, hit) in lexical.into_iter().enumerate() {
        let key = hit.chunk_id.clone();
        let entry = by_chunk.entry(key).or_default();
        entry.score += tuning.lexical_rrf_weight / (60.0 + index as f64 + 1.0);
        entry.score += query_match_bonus(&hit, query, &query_terms);
        entry.lex_score = hit.lex_score;
        if entry.hit.is_none() {
            entry.hit = Some(hit);
        }
    }
    for (index, hit) in vector.into_iter().enumerate() {
        let key = hit.chunk_id.clone();
        let entry = by_chunk.entry(key).or_default();
        entry.score += tuning.vector_rrf_weight / (60.0 + index as f64 + 1.0);
        entry.score += query_match_bonus(&hit, query, &query_terms);
        entry.vector_score = hit.vector_score;
        if entry.hit.is_none() {
            entry.hit = Some(hit);
        }
    }

    let mut hits: Vec<SearchHit> = by_chunk
        .into_values()
        .filter_map(|acc| {
            acc.hit.map(|mut hit| {
                hit.score = acc.score;
                hit.lex_score = acc.lex_score;
                hit.vector_score = acc.vector_score;
                hit.source = SearchMode::Hybrid;
                hit
            })
        })
        .collect();

    hits.sort_by(|left, right| cmp_desc_f64(left.score, right.score));
    hits.truncate(limit);
    for (index, hit) in hits.iter_mut().enumerate() {
        hit.rank = index + 1;
    }
    Ok(hits)
}

pub fn search_lexical_with_fallback(
    db: &Database,
    vault_path: &Path,
    query: &str,
    limit: usize,
) -> Result<Vec<SearchHit>, String> {
    let hits = search_lexical(vault_path, query, limit)?;
    if !hits.is_empty() {
        return Ok(hits);
    }

    let fallback = db
        .search_block_page_summaries(query, limit as i64)
        .map_err(|err| format!("{:?}", err))?;
    Ok(fallback
        .into_iter()
        .enumerate()
        .map(|(index, item)| SearchHit {
            page_uid: item.page_uid,
            block_uid: item.block_uid.clone(),
            chunk_id: format!("fallback:{}", item.block_uid),
            title: item.page_title,
            breadcrumb: None,
            snippet: item.text,
            score: 0.0,
            lex_score: Some(0.0),
            vector_score: None,
            rerank_score: None,
            rank: index + 1,
            source: crate::rag::types::SearchMode::Lexical,
            matched_terms: vec![query.to_string()],
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::{
        read_status, rebuild_index, rebuild_index_with_progress, retrieval_tuning, search_hybrid,
        search_lexical, search_lexical_with_fallback, search_vector,
    };
    use crate::rag::provider::{
        selected_model_matches_provider, LocalEmbeddingProvider, PplxEmbeddingProvider,
    };
    use crate::rag::types::{EmbeddingModelId, IndexBuildState, SearchMode};
    use sandpaper_core::db::Database;
    use std::sync::{Arc, Mutex};
    use tempfile::tempdir;

    fn setup_db() -> Database {
        let db = Database::new_in_memory().expect("db init");
        db.run_migrations().expect("migrations");
        db
    }

    #[test]
    fn rebuild_index_reports_indexed_page_and_chunk_counts() {
        let db = setup_db();
        let page_id = db.insert_page("page-1", "Inbox").expect("insert page");
        db.insert_block(page_id, "block-1", None, "000001", "semantic alpha", "{}")
            .expect("insert block");
        db.insert_block(page_id, "block-2", None, "000002", "", "{}")
            .expect("insert empty block");

        let dir = tempdir().expect("tempdir");
        let summary = rebuild_index(&db, dir.path()).expect("rebuild index");

        assert_eq!(summary.pages_indexed, 1);
        assert_eq!(summary.changed_pages, 1);
        assert_eq!(summary.chunks_written, 1);
    }

    #[test]
    fn rebuild_index_with_progress_reports_running_updates_and_completion() {
        let db = setup_db();
        let page_id = db.insert_page("page-1", "Inbox").expect("insert page");
        db.insert_block(page_id, "block-1", None, "000001", "semantic alpha", "{}")
            .expect("insert block");
        let page_id = db.insert_page("page-2", "Archive").expect("insert page");
        db.insert_block(page_id, "block-2", None, "000001", "semantic beta", "{}")
            .expect("insert block");

        let dir = tempdir().expect("tempdir");
        let updates = Arc::new(Mutex::new(Vec::new()));
        let updates_for_callback = Arc::clone(&updates);
        let summary = rebuild_index_with_progress(&db, dir.path(), |status| {
            updates_for_callback
                .lock()
                .expect("lock updates")
                .push(status.clone());
        })
        .expect("rebuild index");

        let updates = updates.lock().expect("lock updates");
        assert!(updates
            .iter()
            .any(|status| status.state == IndexBuildState::Running));
        assert_eq!(
            updates.last().map(|status| status.state),
            Some(IndexBuildState::Completed)
        );
        assert_eq!(updates.last().map(|status| status.total_pages), Some(2));
        assert_eq!(
            updates
                .last()
                .and_then(|status| status.summary.as_ref())
                .map(|summary| summary.pages_indexed),
            Some(summary.pages_indexed)
        );
    }

    #[test]
    fn search_lexical_reads_hits_from_rebuilt_index() {
        let db = setup_db();
        let page_id = db.insert_page("page-1", "Inbox").expect("insert page");
        db.insert_block(page_id, "block-1", None, "000001", "semantic alpha", "{}")
            .expect("insert block");

        let dir = tempdir().expect("tempdir");
        rebuild_index(&db, dir.path()).expect("rebuild index");

        let hits = search_lexical(dir.path(), "semantic", 10).expect("search");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].title, "Inbox");
    }

    #[test]
    fn read_status_reports_populated_index_after_rebuild() {
        let db = setup_db();
        let page_id = db.insert_page("page-1", "Inbox").expect("insert page");
        db.insert_block(page_id, "block-1", None, "000001", "semantic alpha", "{}")
            .expect("insert block");

        let dir = tempdir().expect("tempdir");
        rebuild_index(&db, dir.path()).expect("rebuild index");

        let status = read_status(dir.path()).expect("status");
        assert_eq!(status.indexed_pages, 1);
        assert_eq!(status.indexed_chunks, 1);
    }

    #[test]
    fn search_lexical_with_fallback_reads_from_main_db_when_index_is_empty() {
        let db = setup_db();
        let page_id = db.insert_page("page-1", "Inbox").expect("insert page");
        db.insert_block(page_id, "block-1", None, "000001", "semantic alpha", "{}")
            .expect("insert block");

        let dir = tempdir().expect("tempdir");
        let hits = search_lexical_with_fallback(&db, dir.path(), "semantic", 10)
            .expect("search with fallback");

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].title, "Inbox");
        assert_eq!(hits[0].block_uid, "block-1");
    }

    #[test]
    fn search_vector_matches_trigram_similar_terms() {
        let db = setup_db();
        let page_id = db.insert_page("page-1", "Inbox").expect("insert page");
        db.insert_block(page_id, "block-1", None, "000001", "semantics alpha", "{}")
            .expect("insert block");

        let dir = tempdir().expect("tempdir");
        rebuild_index(&db, dir.path()).expect("rebuild index");

        let hits = search_vector(dir.path(), "semantic", 10).expect("vector search");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].source, SearchMode::Vector);
        assert_eq!(hits[0].block_uid, "block-1");
    }

    #[test]
    fn search_hybrid_combines_lexical_and_vector_candidates() {
        let db = setup_db();
        let page_id = db.insert_page("page-1", "Inbox").expect("insert page");
        db.insert_block(page_id, "block-1", None, "000001", "semantic alpha", "{}")
            .expect("insert lexical block");
        db.insert_block(page_id, "block-2", None, "000002", "semantics beta", "{}")
            .expect("insert vector block");

        let dir = tempdir().expect("tempdir");
        rebuild_index(&db, dir.path()).expect("rebuild index");

        let hits = search_hybrid(dir.path(), "semantic", 10).expect("hybrid search");
        assert_eq!(hits.len(), 2);
        assert!(hits.iter().any(|hit| hit.block_uid == "block-1"));
        assert!(hits.iter().any(|hit| hit.block_uid == "block-2"));
        assert!(hits.iter().all(|hit| hit.source == SearchMode::Hybrid));
    }

    #[test]
    fn search_hybrid_boosts_title_matches_for_exact_query() {
        let db = setup_db();
        let alpha_page_id = db
            .insert_page("page-1", "한국어 검색")
            .expect("insert alpha page");
        db.insert_block(
            alpha_page_id,
            "block-1",
            None,
            "000001",
            "이 블록은 짧지만 제목과 정확히 맞습니다.",
            "{}",
        )
        .expect("insert alpha block");
        let beta_page_id = db.insert_page("page-2", "메모").expect("insert beta page");
        db.insert_block(
            beta_page_id,
            "block-2",
            None,
            "000001",
            "한국어 검색 품질을 높이는 방법과 chunking 문맥 확장을 설명합니다.",
            "{}",
        )
        .expect("insert beta block");

        let dir = tempdir().expect("tempdir");
        rebuild_index(&db, dir.path()).expect("rebuild index");

        let hits = search_hybrid(dir.path(), "한국어 검색", 10).expect("hybrid search");
        assert_eq!(
            hits.first().map(|hit| hit.page_uid.as_str()),
            Some("page-1")
        );
    }

    #[test]
    fn retrieval_tuning_downweights_local_vector_signal() {
        let tuning = retrieval_tuning(EmbeddingModelId::local());
        assert_eq!(tuning.min_vector_score, 0.2);
        assert!(tuning.vector_rrf_weight < tuning.lexical_rrf_weight);
    }

    #[test]
    fn read_status_reports_available_models_for_generic_settings_ui() {
        let dir = tempdir().expect("tempdir");
        let status = read_status(dir.path()).expect("status");
        assert_eq!(status.selected_embedding_model, EmbeddingModelId::local());
        assert!(status.selected_embedding_model_active);
        assert_eq!(status.embedding_provider.as_deref(), Some("local"));
        assert_eq!(status.available_embedding_models.len(), 2);
        assert!(status.embedding_status_message.is_none());
    }

    #[test]
    fn embedding_status_message_reports_not_ready_downloadable_model() {
        assert_eq!(
            super::embedding_status_message(
                &EmbeddingModelId::new("pplx").expect("pplx id"),
                false,
                false,
            )
            .as_deref(),
            Some(
                "pplx-embed-v1-0.6b is selected but not downloaded yet. Download the model before rebuilding the index."
            )
        );
    }

    #[test]
    fn generic_model_status_check_recognizes_local_provider() {
        let provider = LocalEmbeddingProvider;
        assert!(selected_model_matches_provider(
            &EmbeddingModelId::local(),
            &provider
        ));
    }

    #[test]
    fn generic_model_status_check_recognizes_pplx_provider() {
        let provider = PplxEmbeddingProvider;
        assert!(selected_model_matches_provider(
            &EmbeddingModelId::new("pplx").expect("pplx id"),
            &provider
        ));
    }
}
