use crate::rag::types::{EmbeddingModelId, EmbeddingModelOption, ModelDownloadState};
use directories::ProjectDirs;
use ndarray::{s, Array2, Array3, Axis, Ix2, Ix3};
use ort::{
    session::Session,
    value::{DynValue, Tensor},
};
use reqwest::blocking::Client;
use serde::Deserialize;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;
use tokenizers::{PaddingParams, Tokenizer, TruncationParams};

pub const LOCAL_EMBEDDING_DIM: usize = 256;
const PPLX_MODEL_LABEL: &str = "pplx-embed-v1-0.6b";
const PPLX_CONTEXT_MODEL_LABEL: &str = "pplx-embed-context-v1-0.6b";
const PPLX_TOKENIZER_URL: &str =
    "https://huggingface.co/perplexity-ai/pplx-embed-v1-0.6b/resolve/main/tokenizer.json";
const PPLX_ONNX_URL: &str =
    "https://huggingface.co/perplexity-ai/pplx-embed-v1-0.6b/resolve/main/onnx/model_q4.onnx";
const PPLX_ONNX_DATA_URL: &str =
    "https://huggingface.co/perplexity-ai/pplx-embed-v1-0.6b/resolve/main/onnx/model_q4.onnx_data";
const PPLX_CONTEXT_TOKENIZER_URL: &str =
    "https://huggingface.co/perplexity-ai/pplx-embed-context-v1-0.6b/resolve/main/tokenizer.json";
const PPLX_CONTEXT_SPECIAL_TOKENS_URL: &str = "https://huggingface.co/perplexity-ai/pplx-embed-context-v1-0.6b/resolve/main/special_tokens_map.json";
const PPLX_CONTEXT_ONNX_URL: &str =
    "https://huggingface.co/perplexity-ai/pplx-embed-context-v1-0.6b/resolve/main/onnx/model.onnx";
const PPLX_MAX_TOKENS: usize = 2048;

type DownloadCallback = dyn Fn(ModelDownloadState, f32, String) + Send + Sync;

pub trait EmbeddingProvider {
    fn provider_name(&self) -> &'static str;
    fn model_name(&self) -> &'static str;
    fn embed_query(&self, query: &str) -> Result<Vec<f32>, String>;
    fn embed_document(&self, text: &str) -> Result<Vec<f32>, String>;
    fn embed_documents(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String>;
    fn supports_contextual_documents(&self) -> bool {
        false
    }
    fn embed_document_chunks(
        &self,
        _documents: &[Vec<String>],
    ) -> Result<Vec<Vec<Vec<f32>>>, String> {
        Err("contextual-document-embedding-not-supported".to_string())
    }
}

#[derive(Debug, Default, Clone, Copy)]
pub struct LocalEmbeddingProvider;

#[derive(Debug, Default, Clone, Copy)]
pub struct PplxEmbeddingProvider;

#[derive(Debug, Default, Clone, Copy)]
pub struct PplxContextEmbeddingProvider;

pub enum ResolvedEmbeddingProvider {
    Local(LocalEmbeddingProvider),
    Pplx(PplxEmbeddingProvider),
    PplxContext(PplxContextEmbeddingProvider),
}

struct PplxRuntime {
    tokenizer: Tokenizer,
    session: Session,
}

struct PplxContextRuntime {
    tokenizer: Tokenizer,
    sep_token: String,
    sep_token_id: u32,
    session: Session,
}

#[derive(Debug, Deserialize)]
struct SpecialTokensMap {
    sep_token: Option<String>,
}

static PPLX_RUNTIME: OnceLock<Mutex<Option<PplxRuntime>>> = OnceLock::new();
static PPLX_CONTEXT_RUNTIME: OnceLock<Mutex<Option<PplxContextRuntime>>> = OnceLock::new();
static PROVIDER_LAST_INIT_MS: AtomicU64 = AtomicU64::new(0);
static PROVIDER_INIT_GENERATION: AtomicU64 = AtomicU64::new(0);

impl LocalEmbeddingProvider {
    fn hash_feature(value: &str) -> usize {
        let mut hash: u64 = 1469598103934665603;
        for byte in value.as_bytes() {
            hash ^= *byte as u64;
            hash = hash.wrapping_mul(1099511628211);
        }
        (hash as usize) % LOCAL_EMBEDDING_DIM
    }

    fn normalized_features(text: &str) -> Vec<String> {
        let normalized = text.to_lowercase();
        let mut features = Vec::new();
        for token in normalized
            .split(|ch: char| !ch.is_alphanumeric())
            .filter(|token| !token.is_empty())
        {
            features.push(format!("tok:{token}"));
            let chars: Vec<char> = token.chars().collect();
            if chars.len() >= 3 {
                for window in chars.windows(3) {
                    let trigram: String = window.iter().collect();
                    features.push(format!("tri:{trigram}"));
                }
            }
        }
        features
    }
}

fn normalize_embedding(values: &mut [f32]) {
    let norm = values.iter().map(|value| value * value).sum::<f32>().sqrt();
    if norm > 0.0 {
        for value in values {
            *value /= norm;
        }
    }
}

fn quantize_int8_tanh(values: &[f32]) -> Vec<f32> {
    let mut quantized = values
        .iter()
        .map(|value| (value.tanh() * 127.0).round().clamp(-128.0, 127.0))
        .collect::<Vec<_>>();
    normalize_embedding(&mut quantized);
    quantized
}

impl PplxEmbeddingProvider {
    fn format_query(query: &str) -> String {
        query.trim().to_string()
    }

    fn format_document(text: &str) -> String {
        text.trim().to_string()
    }

    fn cache_dir() -> Result<PathBuf, String> {
        let dirs = ProjectDirs::from("io", "sandpaper", "sandpaper")
            .ok_or_else(|| "unable to resolve app cache directory".to_string())?;
        Ok(dirs.cache_dir().join("models").join("pplx-embed-v1-0.6b"))
    }

    fn tokenizer_path() -> Result<PathBuf, String> {
        Ok(Self::cache_dir()?.join("tokenizer.json"))
    }

    fn onnx_path() -> Result<PathBuf, String> {
        Ok(Self::cache_dir()?.join("onnx").join("model_q4.onnx"))
    }

    fn onnx_data_path() -> Result<PathBuf, String> {
        Ok(Self::cache_dir()?.join("onnx").join("model_q4.onnx_data"))
    }

    fn clear_cache() -> Result<(), String> {
        let cache_dir = Self::cache_dir()?;
        if cache_dir.exists() {
            fs::remove_dir_all(&cache_dir)
                .map_err(|err| format!("failed to remove {}: {err}", cache_dir.display()))?;
        }
        if let Some(store) = PPLX_RUNTIME.get() {
            let mut guard = store
                .lock()
                .map_err(|_| "pplx runtime lock poisoned".to_string())?;
            *guard = None;
        }
        Ok(())
    }

    fn required_files_exist() -> Result<bool, String> {
        Ok(Self::tokenizer_path()?.exists()
            && Self::onnx_path()?.exists()
            && Self::onnx_data_path()?.exists())
    }

    fn ensure_loaded() -> Result<(), String> {
        if !Self::required_files_exist()? {
            return Err("pplx-embed-v1-0.6b is not downloaded yet.".to_string());
        }

        let store = PPLX_RUNTIME.get_or_init(|| Mutex::new(None));
        let mut guard = store
            .lock()
            .map_err(|_| "pplx runtime lock poisoned".to_string())?;
        if guard.is_none() {
            let started_at = Instant::now();
            let mut tokenizer = Tokenizer::from_file(Self::tokenizer_path()?)
                .map_err(|err| format!("failed to load pplx tokenizer: {err}"))?;
            tokenizer.with_padding(Some(PaddingParams::default()));
            tokenizer
                .with_truncation(Some(TruncationParams {
                    max_length: PPLX_MAX_TOKENS,
                    ..Default::default()
                }))
                .map_err(|err| format!("failed to configure pplx truncation: {err}"))?;
            let session = Session::builder()
                .map_err(|err| format!("failed to create ort session builder: {err}"))?
                .commit_from_file(Self::onnx_path()?)
                .map_err(|err| format!("failed to load pplx onnx model: {err}"))?;
            *guard = Some(PplxRuntime { tokenizer, session });
            PROVIDER_LAST_INIT_MS.store(started_at.elapsed().as_millis() as u64, Ordering::SeqCst);
            PROVIDER_INIT_GENERATION.fetch_add(1, Ordering::SeqCst);
        }
        Ok(())
    }

    fn read_i8_embeddings(value: &DynValue) -> Result<Vec<Vec<f32>>, String> {
        let array = value
            .try_extract_array::<i8>()
            .map_err(|err| format!("failed to read pplx int8 embeddings: {err}"))?;
        let matrix = array
            .into_dimensionality::<Ix2>()
            .map_err(|err| format!("unexpected pplx int8 embedding shape: {err}"))?;
        Ok(matrix
            .outer_iter()
            .map(|row| {
                let mut embedding = row.iter().map(|value| *value as f32).collect::<Vec<_>>();
                normalize_embedding(&mut embedding);
                embedding
            })
            .collect())
    }

    fn read_f32_embeddings(value: &DynValue) -> Result<Vec<Vec<f32>>, String> {
        let array = value
            .try_extract_array::<f32>()
            .map_err(|err| format!("failed to read pplx float embeddings: {err}"))?;
        let matrix = array
            .into_dimensionality::<Ix2>()
            .map_err(|err| format!("unexpected pplx float embedding shape: {err}"))?;
        Ok(matrix
            .outer_iter()
            .map(|row| {
                let mut embedding = row.to_vec();
                normalize_embedding(&mut embedding);
                embedding
            })
            .collect())
    }

    fn read_embedding_output(
        outputs: &ort::session::SessionOutputs<'_>,
    ) -> Result<Vec<Vec<f32>>, String> {
        let named_candidates = [
            "int8_embeddings",
            "embeddings",
            "float_embeddings",
            "sentence_embedding",
        ];
        for key in named_candidates {
            if let Some(value) = outputs.get(key) {
                if let Ok(embeddings) = Self::read_i8_embeddings(value) {
                    return Ok(embeddings);
                }
                if let Ok(embeddings) = Self::read_f32_embeddings(value) {
                    return Ok(embeddings);
                }
            }
        }

        if outputs.len() > 2 {
            let value = &outputs[2];
            if let Ok(embeddings) = Self::read_i8_embeddings(value) {
                return Ok(embeddings);
            }
            if let Ok(embeddings) = Self::read_f32_embeddings(value) {
                return Ok(embeddings);
            }
        }

        for key in outputs.keys() {
            if let Some(value) = outputs.get(key) {
                if let Ok(embeddings) = Self::read_i8_embeddings(value) {
                    return Ok(embeddings);
                }
                if let Ok(embeddings) = Self::read_f32_embeddings(value) {
                    return Ok(embeddings);
                }
            }
        }

        let output_names = outputs.keys().collect::<Vec<_>>().join(", ");
        Err(format!(
            "pplx model returned no usable embedding outputs (available: [{}])",
            output_names
        ))
    }

    fn embed_formatted_batch(texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
        Self::ensure_loaded()?;
        let store = PPLX_RUNTIME.get_or_init(|| Mutex::new(None));
        let mut guard = store
            .lock()
            .map_err(|_| "pplx runtime lock poisoned".to_string())?;
        let runtime = guard
            .as_mut()
            .ok_or_else(|| "pplx runtime was not initialized".to_string())?;
        let encodings = runtime
            .tokenizer
            .encode_batch(texts.to_vec(), true)
            .map_err(|err| format!("failed to tokenize with pplx tokenizer: {err}"))?;
        if encodings.is_empty() {
            return Ok(Vec::new());
        }

        let seq_len = encodings
            .first()
            .map(|encoding| encoding.len())
            .unwrap_or_default();
        let batch_size = encodings.len();
        let mut input_ids = Array2::<i64>::zeros((batch_size, seq_len));
        let mut attention_mask = Array2::<i64>::zeros((batch_size, seq_len));
        for (batch_index, encoding) in encodings.iter().enumerate() {
            for (token_index, token_id) in encoding.get_ids().iter().enumerate() {
                input_ids[(batch_index, token_index)] = *token_id as i64;
            }
            for (token_index, mask) in encoding.get_attention_mask().iter().enumerate() {
                attention_mask[(batch_index, token_index)] = *mask as i64;
            }
        }

        let outputs = runtime
            .session
            .run(ort::inputs! {
                "input_ids" => Tensor::from_array(input_ids).map_err(|err| format!("failed to build pplx input_ids tensor: {err}"))?,
                "attention_mask" => Tensor::from_array(attention_mask).map_err(|err| format!("failed to build pplx attention_mask tensor: {err}"))?,
            })
            .map_err(|err| format!("failed to run pplx onnx session: {err}"))?;
        let embeddings = Self::read_embedding_output(&outputs)?;
        if embeddings.len() != texts.len() {
            return Err(format!(
                "pplx-embed-v1-0.6b returned {} embeddings for {} inputs",
                embeddings.len(),
                texts.len()
            ));
        }
        Ok(embeddings)
    }

    fn embed_formatted(text: String) -> Result<Vec<f32>, String> {
        let mut embeddings = Self::embed_formatted_batch(&[text])?;
        embeddings
            .pop()
            .ok_or_else(|| "pplx-embed-v1-0.6b returned no embedding".to_string())
    }
}

impl PplxContextEmbeddingProvider {
    fn format_query(query: &str) -> String {
        query.trim().to_string()
    }

    fn format_document(text: &str) -> String {
        text.trim().to_string()
    }

    fn cache_dir() -> Result<PathBuf, String> {
        let dirs = ProjectDirs::from("io", "sandpaper", "sandpaper")
            .ok_or_else(|| "unable to resolve app cache directory".to_string())?;
        Ok(dirs
            .cache_dir()
            .join("models")
            .join("pplx-embed-context-v1-0.6b"))
    }

    fn tokenizer_path() -> Result<PathBuf, String> {
        Ok(Self::cache_dir()?.join("tokenizer.json"))
    }

    fn special_tokens_map_path() -> Result<PathBuf, String> {
        Ok(Self::cache_dir()?.join("special_tokens_map.json"))
    }

    fn onnx_path() -> Result<PathBuf, String> {
        Ok(Self::cache_dir()?.join("onnx").join("model.onnx"))
    }

    fn clear_cache() -> Result<(), String> {
        let cache_dir = Self::cache_dir()?;
        if cache_dir.exists() {
            fs::remove_dir_all(&cache_dir)
                .map_err(|err| format!("failed to remove {}: {err}", cache_dir.display()))?;
        }
        if let Some(store) = PPLX_CONTEXT_RUNTIME.get() {
            let mut guard = store
                .lock()
                .map_err(|_| "pplx-context runtime lock poisoned".to_string())?;
            *guard = None;
        }
        Ok(())
    }

    fn required_files_exist() -> Result<bool, String> {
        Ok(Self::tokenizer_path()?.exists()
            && Self::special_tokens_map_path()?.exists()
            && Self::onnx_path()?.exists())
    }

    fn load_sep_token(tokenizer: &Tokenizer) -> Result<(String, u32), String> {
        let raw = fs::read_to_string(Self::special_tokens_map_path()?)
            .map_err(|err| format!("failed to read pplx-context special tokens map: {err}"))?;
        let parsed: SpecialTokensMap = serde_json::from_str(&raw)
            .map_err(|err| format!("failed to parse pplx-context special tokens map: {err}"))?;
        let sep_token = parsed
            .sep_token
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                "pplx-context special_tokens_map.json did not contain sep_token".to_string()
            })?;
        let sep_token_id = tokenizer
            .token_to_id(&sep_token)
            .ok_or_else(|| format!("failed to resolve pplx-context sep token id for {sep_token}"))?;
        Ok((sep_token, sep_token_id))
    }

    fn ensure_loaded() -> Result<(), String> {
        if !Self::required_files_exist()? {
            return Err("pplx-embed-context-v1-0.6b is not downloaded yet.".to_string());
        }

        let store = PPLX_CONTEXT_RUNTIME.get_or_init(|| Mutex::new(None));
        let mut guard = store
            .lock()
            .map_err(|_| "pplx-context runtime lock poisoned".to_string())?;
        if guard.is_none() {
            let started_at = Instant::now();
            let mut tokenizer = Tokenizer::from_file(Self::tokenizer_path()?)
                .map_err(|err| format!("failed to load pplx-context tokenizer: {err}"))?;
            tokenizer.with_padding(Some(PaddingParams::default()));
            tokenizer
                .with_truncation(Some(TruncationParams {
                    max_length: PPLX_MAX_TOKENS,
                    ..Default::default()
                }))
                .map_err(|err| format!("failed to configure pplx-context truncation: {err}"))?;
            let (sep_token, sep_token_id) = Self::load_sep_token(&tokenizer)?;
            let session = Session::builder()
                .map_err(|err| format!("failed to create ort session builder: {err}"))?
                .commit_from_file(Self::onnx_path()?)
                .map_err(|err| format!("failed to load pplx-context onnx model: {err}"))?;
            *guard = Some(PplxContextRuntime {
                tokenizer,
                sep_token,
                sep_token_id,
                session,
            });
            PROVIDER_LAST_INIT_MS.store(started_at.elapsed().as_millis() as u64, Ordering::SeqCst);
            PROVIDER_INIT_GENERATION.fetch_add(1, Ordering::SeqCst);
        }
        Ok(())
    }

    fn read_last_hidden_state(value: &DynValue) -> Result<Array3<f32>, String> {
        let view = value
            .try_extract_array::<f32>()
            .map_err(|err| format!("failed to read pplx-context hidden state: {err}"))?
            .into_dimensionality::<Ix3>()
            .map_err(|err| format!("unexpected pplx-context hidden state shape: {err}"))?;
        Ok(view.to_owned())
    }

    fn pool_chunk_embeddings(
        hidden_state: &Array3<f32>,
        attention_mask: &Array2<i64>,
        input_ids: &Array2<i64>,
        sep_token_id: u32,
    ) -> Result<Vec<Vec<Vec<f32>>>, String> {
        let mut documents = Vec::with_capacity(hidden_state.shape()[0]);
        for batch_index in 0..hidden_state.shape()[0] {
            let doc_hidden = hidden_state.slice(s![batch_index, .., ..]);
            let doc_attention = attention_mask.slice(s![batch_index, ..]);
            let doc_input_ids = input_ids.slice(s![batch_index, ..]);
            let valid_len = doc_attention
                .iter()
                .rposition(|value| *value != 0)
                .map(|index| index + 1)
                .unwrap_or(0);
            if valid_len == 0 {
                documents.push(Vec::new());
                continue;
            }

            let mut chunk_embeddings = Vec::new();
            let mut start = 0usize;
            for position in 0..valid_len {
                if doc_input_ids[position] as u32 != sep_token_id {
                    continue;
                }
                if start < position {
                    let slice = doc_hidden.slice(s![start..position, ..]);
                    let mean = slice.mean_axis(Axis(0)).ok_or_else(|| {
                        "failed to mean-pool pplx-context chunk".to_string()
                    })?;
                    chunk_embeddings.push(quantize_int8_tanh(
                        mean.as_slice().ok_or_else(|| {
                            "failed to access pooled pplx-context chunk".to_string()
                        })?,
                    ));
                }
                start = position + 1;
            }

            if start < valid_len {
                let slice = doc_hidden.slice(s![start..valid_len, ..]);
                let mean = slice.mean_axis(Axis(0)).ok_or_else(|| {
                    "failed to mean-pool trailing pplx-context chunk".to_string()
                })?;
                chunk_embeddings.push(quantize_int8_tanh(mean.as_slice().ok_or_else(
                    || "failed to access pooled trailing pplx-context chunk".to_string(),
                )?));
            }

            documents.push(chunk_embeddings);
        }
        Ok(documents)
    }

    fn embed_document_chunk_batch(
        documents: &[Vec<String>],
    ) -> Result<Vec<Vec<Vec<f32>>>, String> {
        Self::ensure_loaded()?;
        let store = PPLX_CONTEXT_RUNTIME.get_or_init(|| Mutex::new(None));
        let mut guard = store
            .lock()
            .map_err(|_| "pplx-context runtime lock poisoned".to_string())?;
        let runtime = guard
            .as_mut()
            .ok_or_else(|| "pplx-context runtime was not initialized".to_string())?;

        let joined_documents = documents
            .iter()
            .map(|chunks| {
                chunks
                    .iter()
                    .map(|chunk| Self::format_document(chunk))
                    .collect::<Vec<_>>()
                    .join(&format!(" {} ", runtime.sep_token))
            })
            .collect::<Vec<_>>();
        let encodings = runtime
            .tokenizer
            .encode_batch(joined_documents, true)
            .map_err(|err| format!("failed to tokenize with pplx-context tokenizer: {err}"))?;
        if encodings.is_empty() {
            return Ok(Vec::new());
        }

        let seq_len = encodings
            .first()
            .map(|encoding| encoding.len())
            .unwrap_or_default();
        let batch_size = encodings.len();
        let mut input_ids = Array2::<i64>::zeros((batch_size, seq_len));
        let mut attention_mask = Array2::<i64>::zeros((batch_size, seq_len));
        for (batch_index, encoding) in encodings.iter().enumerate() {
            for (token_index, token_id) in encoding.get_ids().iter().enumerate() {
                input_ids[(batch_index, token_index)] = *token_id as i64;
            }
            for (token_index, mask) in encoding.get_attention_mask().iter().enumerate() {
                attention_mask[(batch_index, token_index)] = *mask as i64;
            }
        }

        let outputs = runtime
            .session
            .run(ort::inputs! {
                "input_ids" => Tensor::from_array(input_ids.clone()).map_err(|err| format!("failed to build pplx-context input_ids tensor: {err}"))?,
                "attention_mask" => Tensor::from_array(attention_mask.clone()).map_err(|err| format!("failed to build pplx-context attention_mask tensor: {err}"))?,
            })
            .map_err(|err| format!("failed to run pplx-context onnx session: {err}"))?;
        let hidden_state_value = if let Some(value) = outputs.get("last_hidden_state") {
            value
        } else if outputs.len() == 0 {
            return Err("pplx-context model returned no outputs".to_string());
        } else {
            &outputs[0]
        };
        let hidden_state = Self::read_last_hidden_state(hidden_state_value)?;
        let chunk_embeddings = Self::pool_chunk_embeddings(
            &hidden_state,
            &attention_mask,
            &input_ids,
            runtime.sep_token_id,
        )?;
        if chunk_embeddings.len() != documents.len() {
            return Err(format!(
                "pplx-embed-context-v1-0.6b returned {} documents for {} inputs",
                chunk_embeddings.len(),
                documents.len()
            ));
        }
        for (document_index, (chunks, embeddings)) in documents
            .iter()
            .zip(chunk_embeddings.iter())
            .enumerate()
        {
            if chunks.len() != embeddings.len() {
                return Err(format!(
                    "pplx-embed-context-v1-0.6b returned {} embeddings for {} chunks in document {}",
                    embeddings.len(),
                    chunks.len(),
                    document_index
                ));
            }
        }
        Ok(chunk_embeddings)
    }
}

fn local_model_option() -> EmbeddingModelOption {
    EmbeddingModelOption {
        id: EmbeddingModelId::local(),
        label: "Local substring/trigram".to_string(),
        requires_download: false,
        experimental: false,
    }
}

fn pplx_model_option() -> EmbeddingModelOption {
    EmbeddingModelOption {
        id: EmbeddingModelId::new("pplx").expect("pplx model id"),
        label: PPLX_MODEL_LABEL.to_string(),
        requires_download: true,
        experimental: true,
    }
}

fn pplx_context_model_option() -> EmbeddingModelOption {
    EmbeddingModelOption {
        id: EmbeddingModelId::new("pplx-embed-context")
            .expect("pplx-embed-context model id"),
        label: PPLX_CONTEXT_MODEL_LABEL.to_string(),
        requires_download: true,
        experimental: true,
    }
}

pub fn available_embedding_models() -> Vec<EmbeddingModelOption> {
    vec![
        local_model_option(),
        pplx_model_option(),
        pplx_context_model_option(),
    ]
}

pub fn embedding_model_option(model: &EmbeddingModelId) -> Option<EmbeddingModelOption> {
    available_embedding_models()
        .into_iter()
        .find(|option| &option.id == model)
}

pub fn embedding_model_label(model: &EmbeddingModelId) -> String {
    embedding_model_option(model)
        .map(|option| option.label)
        .unwrap_or_else(|| model.as_str().to_string())
}

pub fn model_is_supported(model: &EmbeddingModelId) -> bool {
    embedding_model_option(model).is_some()
}

pub fn model_requires_download(model: &EmbeddingModelId) -> bool {
    embedding_model_option(model)
        .map(|option| option.requires_download)
        .unwrap_or(false)
}

pub fn selected_model_matches_provider(
    model: &EmbeddingModelId,
    provider: &impl EmbeddingProvider,
) -> bool {
    match model.as_str() {
        "local" => {
            provider.provider_name() == "local" && provider.model_name() == "hashed-trigram-v1"
        }
        "pplx" => {
            provider.provider_name() == "onnx-runtime" && provider.model_name() == PPLX_MODEL_LABEL
        }
        "pplx-embed-context" => {
            provider.provider_name() == "onnx-runtime"
                && provider.model_name() == PPLX_CONTEXT_MODEL_LABEL
        }
        _ => false,
    }
}

pub fn provider_init_generation() -> u64 {
    PROVIDER_INIT_GENERATION.load(Ordering::SeqCst)
}

pub fn provider_last_init_ms() -> u64 {
    PROVIDER_LAST_INIT_MS.load(Ordering::SeqCst)
}

pub fn model_is_ready(model: &EmbeddingModelId) -> Result<bool, String> {
    if model.as_str() == "pplx" {
        PplxEmbeddingProvider::required_files_exist()
    } else if model.as_str() == "pplx-embed-context" {
        PplxContextEmbeddingProvider::required_files_exist()
    } else {
        Ok(!model_requires_download(model))
    }
}

fn download_file(
    client: &Client,
    url: &str,
    destination: &Path,
    callback: &Arc<DownloadCallback>,
    cancel_requested: &Arc<AtomicBool>,
    progress_start: f32,
    progress_span: f32,
    label: &str,
) -> Result<(), String> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("{err:?}"))?;
    }
    if destination.exists() {
        callback(
            ModelDownloadState::Verifying,
            progress_start + progress_span,
            format!("{label} already present."),
        );
        return Ok(());
    }

    callback(
        ModelDownloadState::Downloading,
        progress_start,
        format!("Downloading {label}"),
    );
    let mut response = client
        .get(url)
        .header("user-agent", "sandpaper-rag/0.1")
        .send()
        .and_then(|response| response.error_for_status())
        .map_err(|err| format!("failed to download {label}: {err}"))?;
    let total_bytes = response.content_length();
    let partial_path = destination.with_extension("part");
    let mut file = fs::File::create(&partial_path)
        .map_err(|err| format!("failed to create {}: {err}", partial_path.display()))?;
    let mut downloaded = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        if cancel_requested.load(Ordering::SeqCst) {
            let _ = fs::remove_file(&partial_path);
            return Err("download-canceled".to_string());
        }
        let read = response
            .read(&mut buffer)
            .map_err(|err| format!("failed to read {label}: {err}"))?;
        if read == 0 {
            break;
        }
        file.write_all(&buffer[..read])
            .map_err(|err| format!("failed to write {}: {err}", partial_path.display()))?;
        downloaded += read as u64;
        if let Some(total_bytes) = total_bytes {
            let progress =
                progress_start + progress_span * (downloaded as f32 / total_bytes.max(1) as f32);
            callback(
                ModelDownloadState::Downloading,
                progress.clamp(progress_start, progress_start + progress_span),
                format!("Downloading {label}"),
            );
        }
    }
    file.flush()
        .map_err(|err| format!("failed to flush {}: {err}", partial_path.display()))?;
    fs::rename(&partial_path, destination)
        .map_err(|err| format!("failed to finalize {}: {err}", destination.display()))?;
    Ok(())
}

pub fn prepare_model_download(
    model: EmbeddingModelId,
    callback: Arc<DownloadCallback>,
    cancel_requested: Arc<AtomicBool>,
) -> Result<(), String> {
    if model.as_str() == "local" {
        callback(
            ModelDownloadState::Completed,
            1.0,
            "Local substring/trigram search is already available.".to_string(),
        );
        return Ok(());
    }

    if model.as_str() == "pplx-embed-context" {
        let client = Client::builder()
            .build()
            .map_err(|err| format!("failed to create model download client: {err}"))?;
        download_file(
            &client,
            PPLX_CONTEXT_TOKENIZER_URL,
            &PplxContextEmbeddingProvider::tokenizer_path()?,
            &callback,
            &cancel_requested,
            0.0,
            0.25,
            "tokenizer.json",
        )?;
        download_file(
            &client,
            PPLX_CONTEXT_SPECIAL_TOKENS_URL,
            &PplxContextEmbeddingProvider::special_tokens_map_path()?,
            &callback,
            &cancel_requested,
            0.25,
            0.2,
            "special_tokens_map.json",
        )?;
        download_file(
            &client,
            PPLX_CONTEXT_ONNX_URL,
            &PplxContextEmbeddingProvider::onnx_path()?,
            &callback,
            &cancel_requested,
            0.45,
            0.5,
            "onnx/model.onnx",
        )?;
        callback(
            ModelDownloadState::Verifying,
            0.95,
            "Validating pplx-embed-context-v1-0.6b model".to_string(),
        );
        if let Err(error) = PplxContextEmbeddingProvider::ensure_loaded() {
            PplxContextEmbeddingProvider::clear_cache()?;
            return Err(error);
        }
        callback(
            ModelDownloadState::Completed,
            1.0,
            "pplx-embed-context-v1-0.6b is ready.".to_string(),
        );
        return Ok(());
    }

    if model.as_str() != "pplx" {
        return Err(format!("unsupported-embedding-model: {}", model.as_str()));
    }

    let client = Client::builder()
        .build()
        .map_err(|err| format!("failed to create model download client: {err}"))?;
    download_file(
        &client,
        PPLX_TOKENIZER_URL,
        &PplxEmbeddingProvider::tokenizer_path()?,
        &callback,
        &cancel_requested,
        0.0,
        0.2,
        "tokenizer.json",
    )?;
    download_file(
        &client,
        PPLX_ONNX_URL,
        &PplxEmbeddingProvider::onnx_path()?,
        &callback,
        &cancel_requested,
        0.2,
        0.2,
        "onnx/model_q4.onnx",
    )?;
    download_file(
        &client,
        PPLX_ONNX_DATA_URL,
        &PplxEmbeddingProvider::onnx_data_path()?,
        &callback,
        &cancel_requested,
        0.4,
        0.5,
        "onnx/model_q4.onnx_data",
    )?;
    callback(
        ModelDownloadState::Verifying,
        0.95,
        "Validating pplx-embed-v1-0.6b model".to_string(),
    );
    if let Err(error) = PplxEmbeddingProvider::ensure_loaded() {
        PplxEmbeddingProvider::clear_cache()?;
        return Err(error);
    }
    callback(
        ModelDownloadState::Completed,
        1.0,
        "pplx-embed-v1-0.6b is ready.".to_string(),
    );
    Ok(())
}

impl EmbeddingProvider for ResolvedEmbeddingProvider {
    fn provider_name(&self) -> &'static str {
        match self {
            Self::Local(provider) => provider.provider_name(),
            Self::Pplx(provider) => provider.provider_name(),
            Self::PplxContext(provider) => provider.provider_name(),
        }
    }

    fn model_name(&self) -> &'static str {
        match self {
            Self::Local(provider) => provider.model_name(),
            Self::Pplx(provider) => provider.model_name(),
            Self::PplxContext(provider) => provider.model_name(),
        }
    }

    fn embed_query(&self, query: &str) -> Result<Vec<f32>, String> {
        match self {
            Self::Local(provider) => provider.embed_query(query),
            Self::Pplx(provider) => provider.embed_query(query),
            Self::PplxContext(provider) => provider.embed_query(query),
        }
    }

    fn embed_document(&self, text: &str) -> Result<Vec<f32>, String> {
        match self {
            Self::Local(provider) => provider.embed_document(text),
            Self::Pplx(provider) => provider.embed_document(text),
            Self::PplxContext(provider) => provider.embed_document(text),
        }
    }

    fn embed_documents(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
        match self {
            Self::Local(provider) => provider.embed_documents(texts),
            Self::Pplx(provider) => provider.embed_documents(texts),
            Self::PplxContext(provider) => provider.embed_documents(texts),
        }
    }

    fn supports_contextual_documents(&self) -> bool {
        match self {
            Self::Local(provider) => provider.supports_contextual_documents(),
            Self::Pplx(provider) => provider.supports_contextual_documents(),
            Self::PplxContext(provider) => provider.supports_contextual_documents(),
        }
    }

    fn embed_document_chunks(
        &self,
        documents: &[Vec<String>],
    ) -> Result<Vec<Vec<Vec<f32>>>, String> {
        match self {
            Self::Local(provider) => provider.embed_document_chunks(documents),
            Self::Pplx(provider) => provider.embed_document_chunks(documents),
            Self::PplxContext(provider) => provider.embed_document_chunks(documents),
        }
    }
}

impl EmbeddingProvider for PplxEmbeddingProvider {
    fn provider_name(&self) -> &'static str {
        "onnx-runtime"
    }

    fn model_name(&self) -> &'static str {
        PPLX_MODEL_LABEL
    }

    fn embed_query(&self, query: &str) -> Result<Vec<f32>, String> {
        Self::embed_formatted(Self::format_query(query))
    }

    fn embed_document(&self, text: &str) -> Result<Vec<f32>, String> {
        Self::embed_formatted(Self::format_document(text))
    }

    fn embed_documents(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
        let formatted: Vec<String> = texts
            .iter()
            .map(|text| Self::format_document(text))
            .collect();
        Self::embed_formatted_batch(&formatted)
    }
}

impl EmbeddingProvider for PplxContextEmbeddingProvider {
    fn provider_name(&self) -> &'static str {
        "onnx-runtime"
    }

    fn model_name(&self) -> &'static str {
        PPLX_CONTEXT_MODEL_LABEL
    }

    fn embed_query(&self, query: &str) -> Result<Vec<f32>, String> {
        let mut documents = Self::embed_document_chunk_batch(&[vec![Self::format_query(query)]])?;
        documents
            .pop()
            .and_then(|mut chunks| chunks.pop())
            .ok_or_else(|| "pplx-embed-context-v1-0.6b returned no embedding".to_string())
    }

    fn embed_document(&self, text: &str) -> Result<Vec<f32>, String> {
        let mut documents =
            Self::embed_document_chunk_batch(&[vec![Self::format_document(text)]])?;
        documents
            .pop()
            .and_then(|mut chunks| chunks.pop())
            .ok_or_else(|| "pplx-embed-context-v1-0.6b returned no embedding".to_string())
    }

    fn embed_documents(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
        let documents = texts
            .iter()
            .map(|text| vec![Self::format_document(text)])
            .collect::<Vec<_>>();
        Ok(Self::embed_document_chunk_batch(&documents)?
            .into_iter()
            .map(|mut chunks| chunks.pop().unwrap_or_default())
            .collect())
    }

    fn supports_contextual_documents(&self) -> bool {
        true
    }

    fn embed_document_chunks(
        &self,
        documents: &[Vec<String>],
    ) -> Result<Vec<Vec<Vec<f32>>>, String> {
        Self::embed_document_chunk_batch(documents)
    }
}

impl EmbeddingProvider for LocalEmbeddingProvider {
    fn provider_name(&self) -> &'static str {
        "local"
    }

    fn model_name(&self) -> &'static str {
        "hashed-trigram-v1"
    }

    fn embed_query(&self, query: &str) -> Result<Vec<f32>, String> {
        self.embed_document(query)
    }

    fn embed_document(&self, text: &str) -> Result<Vec<f32>, String> {
        let mut vector = vec![0.0f32; LOCAL_EMBEDDING_DIM];
        for feature in Self::normalized_features(text) {
            let index = Self::hash_feature(&feature);
            vector[index] += 1.0;
        }

        let norm = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
        if norm > 0.0 {
            for value in &mut vector {
                *value /= norm;
            }
        }
        Ok(vector)
    }

    fn embed_documents(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
        texts.iter().map(|text| self.embed_document(text)).collect()
    }
}

pub fn resolve_provider(model: &EmbeddingModelId) -> ResolvedEmbeddingProvider {
    match model.as_str() {
        "pplx"
            if model_is_ready(model).unwrap_or(false)
                && PplxEmbeddingProvider::ensure_loaded().is_ok() =>
        {
            ResolvedEmbeddingProvider::Pplx(PplxEmbeddingProvider)
        }
        "pplx-embed-context"
            if model_is_ready(model).unwrap_or(false)
                && PplxContextEmbeddingProvider::ensure_loaded().is_ok() =>
        {
            ResolvedEmbeddingProvider::PplxContext(PplxContextEmbeddingProvider)
        }
        _ => {
            ResolvedEmbeddingProvider::Local(LocalEmbeddingProvider)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        available_embedding_models, embedding_model_label, embedding_model_option, model_is_ready,
        model_is_supported, model_requires_download, selected_model_matches_provider,
        EmbeddingProvider, LocalEmbeddingProvider, PplxContextEmbeddingProvider,
        PplxEmbeddingProvider, LOCAL_EMBEDDING_DIM, PPLX_MODEL_LABEL,
    };
    use crate::rag::types::EmbeddingModelId;

    #[test]
    fn local_model_is_always_ready() {
        assert!(model_is_ready(&EmbeddingModelId::local()).expect("local model ready"));
    }

    #[test]
    fn pplx_requires_download() {
        let pplx = EmbeddingModelId::new("pplx").expect("pplx id");
        assert!(model_requires_download(&pplx));
    }

    #[test]
    fn pplx_context_requires_download() {
        let pplx_context =
            EmbeddingModelId::new("pplx-embed-context").expect("pplx-embed-context id");
        assert!(model_requires_download(&pplx_context));
    }

    #[test]
    fn available_models_are_generic_metadata() {
        let models = available_embedding_models();
        assert_eq!(models.len(), 3);
        assert_eq!(models[0].id, EmbeddingModelId::local());
        assert_eq!(
            models[1].id,
            EmbeddingModelId::new("pplx").expect("pplx id")
        );
        assert!(models[1].requires_download);
        assert!(models[1].experimental);
        assert_eq!(
            models[2].id,
            EmbeddingModelId::new("pplx-embed-context").expect("pplx-embed-context id")
        );
        assert!(models[2].requires_download);
        assert!(models[2].experimental);
    }

    #[test]
    fn known_model_option_is_resolved_by_id() {
        let option = embedding_model_option(&EmbeddingModelId::local()).expect("known model");
        assert_eq!(option.label, "Local substring/trigram");
        assert!(model_is_supported(&option.id));
    }

    #[test]
    fn pplx_label_is_resolved_from_registry() {
        let pplx = EmbeddingModelId::new("pplx").expect("pplx id");
        assert_eq!(embedding_model_label(&pplx), PPLX_MODEL_LABEL);
    }

    #[test]
    fn pplx_context_label_is_resolved_from_registry() {
        let pplx_context =
            EmbeddingModelId::new("pplx-embed-context").expect("pplx-embed-context id");
        assert_eq!(
            embedding_model_label(&pplx_context),
            "pplx-embed-context-v1-0.6b"
        );
    }

    #[test]
    fn unknown_model_label_falls_back_to_raw_id() {
        let unknown = EmbeddingModelId::new("future-model").expect("unknown id");
        assert_eq!(embedding_model_label(&unknown), "future-model");
        assert!(!model_is_supported(&unknown));
    }

    #[test]
    fn local_provider_returns_stable_query_dimension() {
        let provider = LocalEmbeddingProvider;
        let embedding = provider
            .embed_query("Semantic indexing")
            .expect("query embedding");
        assert_eq!(embedding.len(), LOCAL_EMBEDDING_DIM);
    }

    #[test]
    fn local_provider_returns_stable_document_dimension() {
        let provider = LocalEmbeddingProvider;
        let embedding = provider
            .embed_document("Semantic indexing")
            .expect("document embedding");
        assert_eq!(embedding.len(), LOCAL_EMBEDDING_DIM);
    }

    #[test]
    fn local_provider_is_deterministic_for_queries() {
        let provider = LocalEmbeddingProvider;
        let left = provider.embed_query("Semantic indexing").expect("left");
        let right = provider.embed_query("Semantic indexing").expect("right");
        assert_eq!(left, right);
    }

    #[test]
    fn local_provider_is_deterministic_for_documents() {
        let provider = LocalEmbeddingProvider;
        let left = provider.embed_document("Semantic indexing").expect("left");
        let right = provider.embed_document("Semantic indexing").expect("right");
        assert_eq!(left, right);
    }

    #[test]
    fn local_provider_normalizes_query_vectors() {
        let provider = LocalEmbeddingProvider;
        let embedding = provider
            .embed_query("Semantic indexing")
            .expect("query embedding");
        let norm = embedding
            .iter()
            .map(|value| value * value)
            .sum::<f32>()
            .sqrt();
        assert!((norm - 1.0).abs() < 0.0001, "norm was {norm}");
    }

    #[test]
    fn local_provider_normalizes_document_vectors() {
        let provider = LocalEmbeddingProvider;
        let embedding = provider
            .embed_document("Semantic indexing")
            .expect("document embedding");
        let norm = embedding
            .iter()
            .map(|value| value * value)
            .sum::<f32>()
            .sqrt();
        assert!((norm - 1.0).abs() < 0.0001, "norm was {norm}");
    }

    #[test]
    fn local_provider_batches_documents() {
        let provider = LocalEmbeddingProvider;
        let embeddings = provider
            .embed_documents(&["alpha".to_string(), "beta".to_string()])
            .expect("batched embeddings");
        assert_eq!(embeddings.len(), 2);
        assert_eq!(embeddings[0].len(), LOCAL_EMBEDDING_DIM);
        assert_eq!(embeddings[1].len(), LOCAL_EMBEDDING_DIM);
    }

    #[test]
    fn local_model_matches_local_provider() {
        let provider = LocalEmbeddingProvider;
        assert!(selected_model_matches_provider(
            &EmbeddingModelId::local(),
            &provider
        ));
    }

    #[test]
    fn pplx_model_matches_pplx_provider() {
        let provider = PplxEmbeddingProvider;
        assert!(selected_model_matches_provider(
            &EmbeddingModelId::new("pplx").expect("pplx id"),
            &provider
        ));
    }

    #[test]
    fn pplx_context_model_matches_context_provider() {
        let provider = PplxContextEmbeddingProvider;
        assert!(selected_model_matches_provider(
            &EmbeddingModelId::new("pplx-embed-context").expect("pplx-embed-context id"),
            &provider
        ));
    }
}
