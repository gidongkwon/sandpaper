#![allow(dead_code)]

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct EmbeddingModelId(String);

impl EmbeddingModelId {
    pub fn new(value: impl Into<String>) -> Result<Self, String> {
        let normalized = value.into().trim().to_lowercase();
        if normalized.is_empty() {
            return Err("embedding-model-id-empty".to_string());
        }
        Ok(Self(normalized))
    }

    pub fn local() -> Self {
        Self("local".to_string())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Default for EmbeddingModelId {
    fn default() -> Self {
        Self::local()
    }
}

impl TryFrom<&str> for EmbeddingModelId {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EmbeddingModelOption {
    pub id: EmbeddingModelId,
    pub label: String,
    pub requires_download: bool,
    pub experimental: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelDownloadState {
    Downloading,
    Verifying,
    CancelRequested,
    Completed,
    Failed,
    Canceled,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ModelDownloadStatus {
    pub model: EmbeddingModelId,
    pub state: ModelDownloadState,
    pub progress: f32,
    pub message: String,
    pub can_cancel: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchMode {
    Lexical,
    Vector,
    Hybrid,
    Answer,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SearchHit {
    pub page_uid: String,
    pub block_uid: String,
    pub chunk_id: String,
    pub title: String,
    pub breadcrumb: Option<String>,
    pub snippet: String,
    pub score: f64,
    pub lex_score: Option<f64>,
    pub vector_score: Option<f64>,
    pub rerank_score: Option<f64>,
    pub rank: usize,
    pub source: SearchMode,
    pub matched_terms: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AnswerCitation {
    pub page_uid: String,
    pub block_uid: String,
    pub chunk_id: String,
    pub title: String,
    pub breadcrumb: Option<String>,
    pub snippet: String,
    pub rank: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AnswerResult {
    pub answer: String,
    pub citations: Vec<AnswerCitation>,
    pub used_chunks: Vec<String>,
    pub latency_ms: u64,
    pub provider: String,
    pub model: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IndexStatus {
    pub index_exists: bool,
    pub indexed_pages: usize,
    pub indexed_chunks: usize,
    pub dirty_pages: usize,
    pub available_embedding_models: Vec<EmbeddingModelOption>,
    pub selected_embedding_model: EmbeddingModelId,
    pub selected_embedding_model_ready: bool,
    pub selected_embedding_model_active: bool,
    pub embedding_status_message: Option<String>,
    pub last_full_rebuild_at: Option<i64>,
    pub last_incremental_run_at: Option<i64>,
    pub embedding_provider: Option<String>,
    pub embedding_model: Option<String>,
    pub model_download: Option<ModelDownloadStatus>,
    pub rebuild_status: Option<IndexBuildStatus>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RebuildPageProfile {
    pub page_uid: String,
    pub title: String,
    pub chunk_count: usize,
    pub page_load_ms: u64,
    pub chunking_ms: u64,
    pub provider_init_ms: u64,
    pub first_batch_ms: u64,
    pub embedding_ms: u64,
    pub write_ms: u64,
    pub total_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IndexBuildSummary {
    pub pages_indexed: usize,
    pub changed_pages: usize,
    pub chunks_written: usize,
    pub elapsed_ms: u64,
    pub page_load_ms: u64,
    pub chunking_ms: u64,
    pub provider_init_ms: u64,
    pub first_batch_ms: u64,
    pub embedding_ms: u64,
    pub write_ms: u64,
    pub slow_pages: Vec<RebuildPageProfile>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IndexBuildState {
    Queued,
    Running,
    Completed,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IndexBuildStatus {
    pub state: IndexBuildState,
    pub progress: f32,
    pub processed_pages: usize,
    pub total_pages: usize,
    pub current_page_title: Option<String>,
    pub message: String,
    pub can_cancel: bool,
    pub summary: Option<IndexBuildSummary>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IndexedPageRecord {
    pub page_uid: String,
    pub title: String,
    pub page_hash: String,
    pub block_count: usize,
    pub last_saved_at: Option<i64>,
    pub last_indexed_at: Option<i64>,
    pub index_state: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChunkRecord {
    pub chunk_id: String,
    pub page_uid: String,
    pub block_uid: String,
    pub ordinal: usize,
    pub source_kind: String,
    pub breadcrumb: Option<String>,
    pub content: String,
    pub token_count: usize,
    pub chunk_hash: String,
}
