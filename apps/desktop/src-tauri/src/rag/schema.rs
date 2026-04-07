use rusqlite::{params, Connection, OptionalExtension};
use std::fs;
use std::path::{Path, PathBuf};

pub const RAG_SCHEMA_VERSION: i64 = 2;

const RAG_SCHEMA_SQL: &str = "
CREATE TABLE IF NOT EXISTS index_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS indexed_pages (
    page_uid TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    page_hash TEXT NOT NULL,
    block_count INTEGER NOT NULL DEFAULT 0,
    last_saved_at INTEGER,
    last_indexed_at INTEGER,
    index_state TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS indexed_blocks (
    block_uid TEXT PRIMARY KEY,
    page_uid TEXT NOT NULL,
    indent INTEGER NOT NULL,
    block_type TEXT NOT NULL,
    text TEXT NOT NULL,
    breadcrumb TEXT,
    block_hash TEXT NOT NULL,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS chunks (
    chunk_id TEXT PRIMARY KEY,
    page_uid TEXT NOT NULL,
    block_uid TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    source_kind TEXT NOT NULL,
    content TEXT NOT NULL,
    token_count INTEGER NOT NULL DEFAULT 0,
    chunk_hash TEXT NOT NULL,
    created_at INTEGER,
    updated_at INTEGER
);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    chunk_id UNINDEXED,
    title,
    breadcrumb,
    content,
    tokenize='trigram'
);

CREATE TABLE IF NOT EXISTS chunk_vectors (
    chunk_id TEXT PRIMARY KEY,
    embedding BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS chunk_edges (
    chunk_id TEXT PRIMARY KEY,
    prev_chunk_id TEXT,
    next_chunk_id TEXT
);

CREATE TABLE IF NOT EXISTS query_cache (
    query_hash TEXT PRIMARY KEY,
    normalized_query TEXT NOT NULL,
    embedding BLOB NOT NULL,
    cached_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS retrieval_log (
    id INTEGER PRIMARY KEY,
    query TEXT NOT NULL,
    mode TEXT NOT NULL,
    chunk_id TEXT NOT NULL,
    score REAL NOT NULL,
    rank INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS indexed_blocks_page_uid
  ON indexed_blocks(page_uid);
CREATE INDEX IF NOT EXISTS chunks_page_uid
  ON chunks(page_uid, ordinal);
CREATE INDEX IF NOT EXISTS retrieval_log_query_created_at
  ON retrieval_log(query, created_at);
";

pub fn rag_index_path(vault_path: &Path) -> PathBuf {
    vault_path.join(".sandpaper").join("rag-index.sqlite")
}

pub fn current_schema_version(conn: &Connection) -> Result<i64, String> {
    conn.query_row(
        "SELECT value FROM index_meta WHERE key = 'schema_version'",
        [],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(|err| format!("{:?}", err))?
    .map(|value| value.parse::<i64>().map_err(|err| err.to_string()))
    .transpose()
    .map_err(|err| format!("invalid-schema-version: {err}"))?
    .ok_or_else(|| "missing-schema-version".to_string())
}

fn stored_schema_version(conn: &Connection) -> Result<Option<i64>, String> {
    let has_index_meta = conn
        .query_row(
            "SELECT EXISTS(
                SELECT 1
                FROM sqlite_master
                WHERE type = 'table'
                  AND name = 'index_meta'
            )",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|err| format!("{:?}", err))?
        == 1;
    if !has_index_meta {
        return Ok(None);
    }

    conn.query_row(
        "SELECT value FROM index_meta WHERE key = 'schema_version'",
        [],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(|err| format!("{:?}", err))?
    .map(|value| value.parse::<i64>().map_err(|err| err.to_string()))
    .transpose()
    .map_err(|err| format!("invalid-schema-version: {err}"))
}

pub fn open_or_create_rag_db(vault_path: &Path) -> Result<Connection, String> {
    let path = rag_index_path(vault_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("{:?}", err))?;
    }

    let mut conn = Connection::open(path).map_err(|err| format!("{:?}", err))?;
    bootstrap_schema(&mut conn)?;
    Ok(conn)
}

fn bootstrap_schema(conn: &mut Connection) -> Result<(), String> {
    let existing_version = stored_schema_version(conn)?.unwrap_or_default();
    let tx = conn.transaction().map_err(|err| format!("{:?}", err))?;
    if existing_version > 0 && existing_version < RAG_SCHEMA_VERSION {
        tx.execute_batch(
            "
DROP TABLE IF EXISTS retrieval_log;
DROP TABLE IF EXISTS query_cache;
DROP TABLE IF EXISTS chunk_edges;
DROP TABLE IF EXISTS chunk_vectors;
DROP TABLE IF EXISTS chunks_fts;
DROP TABLE IF EXISTS chunks;
DROP TABLE IF EXISTS indexed_blocks;
DROP TABLE IF EXISTS indexed_pages;
",
        )
        .map_err(|err| format!("{:?}", err))?;
    }
    tx.execute_batch(RAG_SCHEMA_SQL)
        .map_err(|err| format!("{:?}", err))?;
    tx.execute(
        "INSERT INTO index_meta(key, value)
         VALUES ('schema_version', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![RAG_SCHEMA_VERSION.to_string()],
    )
    .map_err(|err| format!("{:?}", err))?;
    tx.commit().map_err(|err| format!("{:?}", err))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        current_schema_version, open_or_create_rag_db, rag_index_path, RAG_SCHEMA_VERSION,
    };
    use rusqlite::{Connection, OptionalExtension};
    use std::path::Path;
    use tempfile::tempdir;

    fn table_exists(conn: &Connection, name: &str) -> bool {
        conn.query_row(
            "SELECT EXISTS(
                SELECT 1
                FROM sqlite_master
                WHERE type IN ('table', 'virtual table')
                  AND name = ?1
            )",
            [name],
            |row| row.get::<_, i64>(0),
        )
        .map(|value| value == 1)
        .expect("table exists query")
    }

    fn object_sql(conn: &Connection, name: &str) -> Option<String> {
        conn.query_row(
            "SELECT sql
             FROM sqlite_master
             WHERE name = ?1",
            [name],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .expect("object sql query")
    }

    #[test]
    fn rag_index_path_uses_hidden_sandpaper_dir() {
        let path = rag_index_path(Path::new("C:/vault"));
        assert_eq!(path, Path::new("C:/vault/.sandpaper/rag-index.sqlite"));
    }

    #[test]
    fn open_or_create_rag_db_bootstraps_schema() {
        let dir = tempdir().expect("tempdir");
        let conn = open_or_create_rag_db(dir.path()).expect("open rag db");

        assert_eq!(
            current_schema_version(&conn).expect("schema version"),
            RAG_SCHEMA_VERSION
        );
        assert!(table_exists(&conn, "index_meta"));
        assert!(table_exists(&conn, "indexed_pages"));
        assert!(table_exists(&conn, "indexed_blocks"));
        assert!(table_exists(&conn, "chunks"));
        assert!(table_exists(&conn, "chunks_fts"));
        assert!(table_exists(&conn, "chunk_vectors"));
        assert!(table_exists(&conn, "chunk_edges"));
        assert!(table_exists(&conn, "query_cache"));
        assert!(table_exists(&conn, "retrieval_log"));
        assert!(object_sql(&conn, "chunks_fts")
            .expect("chunks_fts sql")
            .contains("tokenize='trigram'"));
    }

    #[test]
    fn open_or_create_rag_db_reopens_existing_schema() {
        let dir = tempdir().expect("tempdir");
        let first = open_or_create_rag_db(dir.path()).expect("first open");
        drop(first);

        let second = open_or_create_rag_db(dir.path()).expect("second open");
        assert_eq!(
            current_schema_version(&second).expect("schema version"),
            RAG_SCHEMA_VERSION
        );
    }
}
