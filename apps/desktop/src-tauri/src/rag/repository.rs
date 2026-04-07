use crate::rag::types::{
    ChunkRecord, EmbeddingModelId, IndexStatus, IndexedPageRecord, SearchHit, SearchMode,
};
use rusqlite::{params, Connection, OptionalExtension};

pub struct RagRepository {
    conn: Connection,
}

const SELECTED_EMBEDDING_MODEL_KEY: &str = "selected_embedding_model";

fn encode_embedding(values: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(values.len() * 4);
    for value in values {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes
}

fn decode_embedding(bytes: &[u8]) -> Result<Vec<f32>, String> {
    if bytes.len() % 4 != 0 {
        return Err("invalid-embedding-bytes".to_string());
    }
    Ok(bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect())
}

#[derive(Debug, Clone, PartialEq)]
pub struct VectorCandidate {
    pub page_uid: String,
    pub block_uid: String,
    pub chunk_id: String,
    pub title: String,
    pub breadcrumb: Option<String>,
    pub snippet: String,
    pub embedding: Vec<f32>,
}

impl RagRepository {
    pub fn new(conn: Connection) -> Self {
        Self { conn }
    }

    pub fn read_index_status(&self) -> Result<IndexStatus, String> {
        let indexed_pages = self
            .conn
            .query_row("SELECT COUNT(*) FROM indexed_pages", [], |row| row.get::<_, i64>(0))
            .map_err(|err| format!("{:?}", err))?;
        let indexed_chunks = self
            .conn
            .query_row("SELECT COUNT(*) FROM chunks", [], |row| row.get::<_, i64>(0))
            .map_err(|err| format!("{:?}", err))?;
        let dirty_pages = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM indexed_pages WHERE index_state != 'ready'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|err| format!("{:?}", err))?;

        Ok(IndexStatus {
            index_exists: true,
            indexed_pages: indexed_pages.max(0) as usize,
            indexed_chunks: indexed_chunks.max(0) as usize,
            dirty_pages: dirty_pages.max(0) as usize,
            available_embedding_models: Vec::new(),
            selected_embedding_model: self.read_selected_embedding_model()?,
            selected_embedding_model_ready: true,
            selected_embedding_model_active: true,
            embedding_status_message: None,
            last_full_rebuild_at: None,
            last_incremental_run_at: None,
            embedding_provider: None,
            embedding_model: None,
            model_download: None,
        })
    }

    pub fn read_selected_embedding_model(&self) -> Result<EmbeddingModelId, String> {
        let stored = self
            .conn
            .query_row(
                "SELECT value FROM index_meta WHERE key = ?1",
                [SELECTED_EMBEDDING_MODEL_KEY],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|err| format!("{:?}", err))?;

        match stored {
            Some(value) => EmbeddingModelId::try_from(value.as_str()),
            None => Ok(EmbeddingModelId::default()),
        }
    }

    pub fn set_selected_embedding_model(
        &mut self,
        model: EmbeddingModelId,
    ) -> Result<bool, String> {
        let current = self.read_selected_embedding_model()?;
        if current == model {
            return Ok(false);
        }

        let tx = self.conn.transaction().map_err(|err| format!("{:?}", err))?;
        tx.execute(
            "INSERT INTO index_meta(key, value)
             VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![SELECTED_EMBEDDING_MODEL_KEY, model.as_str()],
        )
        .map_err(|err| format!("{:?}", err))?;
        tx.execute("DELETE FROM chunk_vectors", [])
            .map_err(|err| format!("{:?}", err))?;
        tx.execute(
            "UPDATE indexed_pages
             SET index_state = 'pending',
                 last_indexed_at = NULL",
            [],
        )
        .map_err(|err| format!("{:?}", err))?;
        tx.commit().map_err(|err| format!("{:?}", err))?;
        Ok(true)
    }

    pub fn get_indexed_page(&self, page_uid: &str) -> Result<Option<IndexedPageRecord>, String> {
        self.conn
            .query_row(
                "SELECT page_uid, title, page_hash, block_count, last_saved_at, last_indexed_at, index_state
                 FROM indexed_pages
                 WHERE page_uid = ?1",
                [page_uid],
                |row| {
                    Ok(IndexedPageRecord {
                        page_uid: row.get(0)?,
                        title: row.get(1)?,
                        page_hash: row.get(2)?,
                        block_count: row.get::<_, i64>(3)? as usize,
                        last_saved_at: row.get(4)?,
                        last_indexed_at: row.get(5)?,
                        index_state: row.get(6)?,
                    })
                },
            )
            .optional()
            .map_err(|err| format!("{:?}", err))
    }

    pub fn upsert_indexed_page(&mut self, page: &IndexedPageRecord) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO indexed_pages(
                    page_uid,
                    title,
                    page_hash,
                    block_count,
                    last_saved_at,
                    last_indexed_at,
                    index_state
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(page_uid) DO UPDATE SET
                    title = excluded.title,
                    page_hash = excluded.page_hash,
                    block_count = excluded.block_count,
                    last_saved_at = excluded.last_saved_at,
                    last_indexed_at = excluded.last_indexed_at,
                    index_state = excluded.index_state",
                params![
                    page.page_uid,
                    page.title,
                    page.page_hash,
                    page.block_count as i64,
                    page.last_saved_at,
                    page.last_indexed_at,
                    page.index_state,
                ],
            )
            .map_err(|err| format!("{:?}", err))?;
        Ok(())
    }

    pub fn replace_chunks_for_page(
        &mut self,
        page_uid: &str,
        title: &str,
        chunks: &[ChunkRecord],
    ) -> Result<(), String> {
        let tx = self.conn.transaction().map_err(|err| format!("{:?}", err))?;
        tx.execute("DELETE FROM chunks_fts WHERE chunk_id IN (SELECT chunk_id FROM chunks WHERE page_uid = ?1)", [page_uid])
            .map_err(|err| format!("{:?}", err))?;
        tx.execute("DELETE FROM chunk_vectors WHERE chunk_id IN (SELECT chunk_id FROM chunks WHERE page_uid = ?1)", [page_uid])
            .map_err(|err| format!("{:?}", err))?;
        tx.execute("DELETE FROM chunk_edges WHERE chunk_id IN (SELECT chunk_id FROM chunks WHERE page_uid = ?1)", [page_uid])
            .map_err(|err| format!("{:?}", err))?;
        tx.execute("DELETE FROM chunks WHERE page_uid = ?1", [page_uid])
            .map_err(|err| format!("{:?}", err))?;

        for chunk in chunks {
            tx.execute(
                "INSERT INTO chunks(
                    chunk_id,
                    page_uid,
                    block_uid,
                    ordinal,
                    source_kind,
                    content,
                    token_count,
                    chunk_hash
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    chunk.chunk_id,
                    chunk.page_uid,
                    chunk.block_uid,
                    chunk.ordinal as i64,
                    chunk.source_kind,
                    chunk.content,
                    chunk.token_count as i64,
                    chunk.chunk_hash,
                ],
            )
            .map_err(|err| format!("{:?}", err))?;

            tx.execute(
                "INSERT INTO chunks_fts(chunk_id, title, breadcrumb, content)
                 VALUES (?1, ?2, ?3, ?4)",
                params![chunk.chunk_id, title, chunk.breadcrumb, chunk.content],
            )
            .map_err(|err| format!("{:?}", err))?;
        }

        tx.commit().map_err(|err| format!("{:?}", err))?;
        Ok(())
    }

    pub fn list_chunks_for_page(&self, page_uid: &str) -> Result<Vec<ChunkRecord>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT chunk_id, page_uid, block_uid, ordinal, source_kind, content, token_count, chunk_hash
                 FROM chunks
                 WHERE page_uid = ?1
                 ORDER BY ordinal ASC",
            )
            .map_err(|err| format!("{:?}", err))?;
        let rows = stmt
            .query_map([page_uid], |row| {
                Ok(ChunkRecord {
                    chunk_id: row.get(0)?,
                    page_uid: row.get(1)?,
                    block_uid: row.get(2)?,
                    ordinal: row.get::<_, i64>(3)? as usize,
                    source_kind: row.get(4)?,
                    breadcrumb: None,
                    content: row.get(5)?,
                    token_count: row.get::<_, i64>(6)? as usize,
                    chunk_hash: row.get(7)?,
                })
            })
            .map_err(|err| format!("{:?}", err))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|err| format!("{:?}", err))
    }

    pub fn search_fts(&self, query: &str, limit: usize) -> Result<Vec<SearchHit>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT c.page_uid, c.block_uid, c.chunk_id, f.title, f.breadcrumb, c.content
                 FROM chunks_fts f
                 JOIN chunks c ON c.chunk_id = f.chunk_id
                 WHERE chunks_fts MATCH ?1
                 ORDER BY bm25(chunks_fts)
                 LIMIT ?2",
            )
            .map_err(|err| format!("{:?}", err))?;
        let rows = stmt
            .query_map(params![query, limit as i64], |row| {
                let snippet: String = row.get(5)?;
                Ok(SearchHit {
                    page_uid: row.get(0)?,
                    block_uid: row.get(1)?,
                    chunk_id: row.get(2)?,
                    title: row.get(3)?,
                    breadcrumb: row.get(4)?,
                    snippet,
                    score: 0.0,
                    lex_score: Some(0.0),
                    vector_score: None,
                    rerank_score: None,
                    rank: 0,
                    source: SearchMode::Lexical,
                    matched_terms: vec![query.to_string()],
                })
            })
            .map_err(|err| format!("{:?}", err))?;

        rows.enumerate()
            .map(|(index, row)| {
                row.map(|mut hit| {
                    hit.rank = index + 1;
                    hit
                })
            })
            .collect::<Result<Vec<_>, _>>()
            .map_err(|err| format!("{:?}", err))
            .and_then(|hits| {
                if hits.is_empty() {
                    self.search_substring(query, limit)
                } else {
                    Ok(hits)
                }
            })
    }

    fn search_substring(&self, query: &str, limit: usize) -> Result<Vec<SearchHit>, String> {
        let pattern = format!("%{}%", query.trim());
        let mut stmt = self
            .conn
            .prepare(
                "SELECT c.page_uid, c.block_uid, c.chunk_id, f.title, f.breadcrumb, c.content
                 FROM chunks c
                 LEFT JOIN chunks_fts f ON f.chunk_id = c.chunk_id
                 WHERE c.content LIKE ?1
                    OR f.title LIKE ?1
                    OR IFNULL(f.breadcrumb, '') LIKE ?1
                 ORDER BY c.ordinal ASC
                 LIMIT ?2",
            )
            .map_err(|err| format!("{:?}", err))?;
        let rows = stmt
            .query_map(params![pattern, limit as i64], |row| {
                let snippet: String = row.get(5)?;
                Ok(SearchHit {
                    page_uid: row.get(0)?,
                    block_uid: row.get(1)?,
                    chunk_id: row.get(2)?,
                    title: row.get(3)?,
                    breadcrumb: row.get(4)?,
                    snippet,
                    score: 0.0,
                    lex_score: Some(0.0),
                    vector_score: None,
                    rerank_score: None,
                    rank: 0,
                    source: SearchMode::Lexical,
                    matched_terms: vec![query.to_string()],
                })
            })
            .map_err(|err| format!("{:?}", err))?;

        rows.enumerate()
            .map(|(index, row)| {
                row.map(|mut hit| {
                    hit.rank = index + 1;
                    hit
                })
            })
            .collect::<Result<Vec<_>, _>>()
            .map_err(|err| format!("{:?}", err))
    }

    pub fn replace_chunk_embeddings_for_page(
        &mut self,
        page_uid: &str,
        embeddings: &[(String, Vec<f32>)],
    ) -> Result<(), String> {
        let tx = self.conn.transaction().map_err(|err| format!("{:?}", err))?;
        tx.execute(
            "DELETE FROM chunk_vectors
             WHERE chunk_id IN (SELECT chunk_id FROM chunks WHERE page_uid = ?1)",
            [page_uid],
        )
        .map_err(|err| format!("{:?}", err))?;

        for (chunk_id, embedding) in embeddings {
            tx.execute(
                "INSERT INTO chunk_vectors(chunk_id, embedding) VALUES (?1, ?2)",
                params![chunk_id, encode_embedding(embedding)],
            )
            .map_err(|err| format!("{:?}", err))?;
        }

        tx.commit().map_err(|err| format!("{:?}", err))?;
        Ok(())
    }

    pub fn list_all_chunk_embeddings(&self) -> Result<Vec<(String, Vec<f32>)>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT chunk_id, embedding FROM chunk_vectors ORDER BY chunk_id ASC")
            .map_err(|err| format!("{:?}", err))?;
        let rows = stmt
            .query_map([], |row| {
                let chunk_id: String = row.get(0)?;
                let embedding: Vec<u8> = row.get(1)?;
                Ok((chunk_id, embedding))
            })
            .map_err(|err| format!("{:?}", err))?;

        rows.map(|row| {
            row.map_err(|err| format!("{:?}", err))
                .and_then(|(chunk_id, bytes)| decode_embedding(&bytes).map(|values| (chunk_id, values)))
        })
        .collect()
    }

    pub fn list_vector_candidates(&self) -> Result<Vec<VectorCandidate>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT c.page_uid, c.block_uid, c.chunk_id, f.title, f.breadcrumb, c.content, v.embedding
                 FROM chunk_vectors v
                 JOIN chunks c ON c.chunk_id = v.chunk_id
                 LEFT JOIN chunks_fts f ON f.chunk_id = c.chunk_id
                 ORDER BY c.chunk_id ASC",
            )
            .map_err(|err| format!("{:?}", err))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, Vec<u8>>(6)?,
                ))
            })
            .map_err(|err| format!("{:?}", err))?;

        rows.map(|row| {
            row.map_err(|err| format!("{:?}", err)).and_then(
                |(page_uid, block_uid, chunk_id, title, breadcrumb, snippet, bytes)| {
                    decode_embedding(&bytes).map(|embedding| VectorCandidate {
                        page_uid,
                        block_uid,
                        chunk_id,
                        title,
                        breadcrumb,
                        snippet,
                        embedding,
                    })
                },
            )
        })
        .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::RagRepository;
    use crate::rag::schema::open_or_create_rag_db;
    use crate::rag::types::{ChunkRecord, EmbeddingModelId, IndexedPageRecord, SearchMode};
    use tempfile::tempdir;

    fn sample_page(page_uid: &str, title: &str, page_hash: &str) -> IndexedPageRecord {
        IndexedPageRecord {
            page_uid: page_uid.to_string(),
            title: title.to_string(),
            page_hash: page_hash.to_string(),
            block_count: 2,
            last_saved_at: Some(100),
            last_indexed_at: Some(200),
            index_state: "ready".to_string(),
        }
    }

    fn sample_chunk(
        chunk_id: &str,
        page_uid: &str,
        block_uid: &str,
        ordinal: usize,
        content: &str,
    ) -> ChunkRecord {
        ChunkRecord {
            chunk_id: chunk_id.to_string(),
            page_uid: page_uid.to_string(),
            block_uid: block_uid.to_string(),
            ordinal,
            source_kind: "block".to_string(),
            breadcrumb: None,
            content: content.to_string(),
            token_count: 4,
            chunk_hash: format!("hash-{chunk_id}"),
        }
    }

    #[test]
    fn read_index_status_reports_empty_index() {
        let dir = tempdir().expect("tempdir");
        let conn = open_or_create_rag_db(dir.path()).expect("open rag db");
        let repo = RagRepository::new(conn);

        let status = repo.read_index_status().expect("read status");
        assert!(status.index_exists);
        assert_eq!(status.indexed_pages, 0);
        assert_eq!(status.indexed_chunks, 0);
        assert_eq!(status.dirty_pages, 0);
        assert_eq!(status.selected_embedding_model, EmbeddingModelId::local());
    }

    #[test]
    fn set_selected_embedding_model_persists_generic_choice() {
        let dir = tempdir().expect("tempdir");
        let conn = open_or_create_rag_db(dir.path()).expect("open rag db");
        let mut repo = RagRepository::new(conn);
        let pplx = EmbeddingModelId::new("pplx").expect("pplx id");

        let changed = repo
            .set_selected_embedding_model(pplx.clone())
            .expect("set embedding model");

        assert!(changed);
        assert_eq!(
            repo.read_selected_embedding_model()
                .expect("read selected embedding model"),
            pplx
        );
    }

    #[test]
    fn set_selected_embedding_model_marks_existing_pages_dirty_and_clears_vectors() {
        let dir = tempdir().expect("tempdir");
        let conn = open_or_create_rag_db(dir.path()).expect("open rag db");
        let mut repo = RagRepository::new(conn);

        repo.upsert_indexed_page(&sample_page("page-1", "Inbox", "hash-1"))
            .expect("upsert page");
        repo.replace_chunks_for_page(
            "page-1",
            "Inbox",
            &[sample_chunk("chunk-1", "page-1", "block-1", 0, "alpha beta")],
        )
        .expect("replace chunks");
        repo.replace_chunk_embeddings_for_page("page-1", &[("chunk-1".to_string(), vec![1.0, 0.0])])
            .expect("replace vectors");

        repo.set_selected_embedding_model(EmbeddingModelId::local())
            .expect("set embedding model");

        let status = repo.read_index_status().expect("read status");
        assert_eq!(status.dirty_pages, 0);
        assert_eq!(repo.list_all_chunk_embeddings().expect("list vectors").len(), 1);
    }

    #[test]
    fn replace_chunks_for_page_overwrites_previous_page_chunks() {
        let dir = tempdir().expect("tempdir");
        let conn = open_or_create_rag_db(dir.path()).expect("open rag db");
        let mut repo = RagRepository::new(conn);

        repo.upsert_indexed_page(&sample_page("page-1", "Inbox", "hash-1"))
            .expect("upsert page");
        repo.replace_chunks_for_page(
            "page-1",
            "Inbox",
            &[
                sample_chunk("chunk-1", "page-1", "block-1", 0, "alpha beta"),
                sample_chunk("chunk-2", "page-1", "block-2", 1, "gamma delta"),
            ],
        )
        .expect("replace chunks");

        repo.replace_chunks_for_page(
            "page-1",
            "Inbox",
            &[sample_chunk("chunk-3", "page-1", "block-3", 0, "omega")],
        )
        .expect("replace chunks again");

        let stored = repo.list_chunks_for_page("page-1").expect("list chunks");
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].chunk_id, "chunk-3");
    }

    #[test]
    fn search_fts_returns_ranked_hits_for_chunk_content() {
        let dir = tempdir().expect("tempdir");
        let conn = open_or_create_rag_db(dir.path()).expect("open rag db");
        let mut repo = RagRepository::new(conn);

        repo.upsert_indexed_page(&sample_page("page-1", "Inbox", "hash-1"))
            .expect("upsert page");
        repo.replace_chunks_for_page(
            "page-1",
            "Inbox",
            &[
                sample_chunk("chunk-1", "page-1", "block-1", 0, "semantic search alpha"),
                sample_chunk("chunk-2", "page-1", "block-2", 1, "completely unrelated"),
            ],
        )
        .expect("replace chunks");

        let hits = repo.search_fts("semantic", 10).expect("fts search");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].chunk_id, "chunk-1");
        assert_eq!(hits[0].source, SearchMode::Lexical);
    }

    #[test]
    fn search_fts_supports_korean_substring_matches() {
        let dir = tempdir().expect("tempdir");
        let conn = open_or_create_rag_db(dir.path()).expect("open rag db");
        let mut repo = RagRepository::new(conn);

        repo.upsert_indexed_page(&sample_page("page-1", "Inbox", "hash-1"))
            .expect("upsert page");
        repo.replace_chunks_for_page(
            "page-1",
            "Inbox",
            &[sample_chunk("chunk-1", "page-1", "block-1", 0, "한국어검색품질")],
        )
        .expect("replace chunks");

        let hits = repo.search_fts("검색", 10).expect("fts search");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].chunk_id, "chunk-1");
    }

    #[test]
    fn replace_chunk_embeddings_for_page_overwrites_previous_vectors() {
        let dir = tempdir().expect("tempdir");
        let conn = open_or_create_rag_db(dir.path()).expect("open rag db");
        let mut repo = RagRepository::new(conn);

        repo.upsert_indexed_page(&sample_page("page-1", "Inbox", "hash-1"))
            .expect("upsert page");
        repo.replace_chunks_for_page(
            "page-1",
            "Inbox",
            &[sample_chunk("chunk-1", "page-1", "block-1", 0, "alpha beta")],
        )
        .expect("replace chunks");
        repo.replace_chunk_embeddings_for_page("page-1", &[("chunk-1".to_string(), vec![1.0, 0.0])])
            .expect("replace vectors");

        repo.replace_chunks_for_page(
            "page-1",
            "Inbox",
            &[sample_chunk("chunk-2", "page-1", "block-2", 0, "gamma delta")],
        )
        .expect("replace chunks again");
        repo.replace_chunk_embeddings_for_page("page-1", &[("chunk-2".to_string(), vec![0.0, 1.0])])
            .expect("replace vectors again");

        let stored = repo.list_all_chunk_embeddings().expect("list vectors");
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].0, "chunk-2");
        assert_eq!(stored[0].1, vec![0.0, 1.0]);
    }
}
