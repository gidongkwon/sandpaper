use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::path::Path;

pub struct Database {
    conn: Connection,
}

pub struct Migration {
    pub version: i64,
    pub name: &'static str,
    pub up: &'static str,
}

const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "init",
        up: "CREATE TABLE IF NOT EXISTS pages (
            id INTEGER PRIMARY KEY,
            uid TEXT UNIQUE NOT NULL,
            title TEXT NOT NULL,
            created_at INTEGER DEFAULT (strftime('%s','now')),
            updated_at INTEGER DEFAULT (strftime('%s','now'))
        );

        CREATE TABLE IF NOT EXISTS blocks (
            id INTEGER PRIMARY KEY,
            uid TEXT UNIQUE NOT NULL,
            page_id INTEGER NOT NULL,
            parent_id INTEGER,
            sort_key TEXT NOT NULL,
            text TEXT NOT NULL,
            props TEXT NOT NULL DEFAULT '{}',
            created_at INTEGER DEFAULT (strftime('%s','now')),
            updated_at INTEGER DEFAULT (strftime('%s','now')),
            FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE,
            FOREIGN KEY (parent_id) REFERENCES blocks(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS edges (
            id INTEGER PRIMARY KEY,
            from_block_id INTEGER NOT NULL,
            to_block_uid TEXT NOT NULL,
            kind TEXT NOT NULL,
            created_at INTEGER DEFAULT (strftime('%s','now')),
            FOREIGN KEY (from_block_id) REFERENCES blocks(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY,
            name TEXT UNIQUE NOT NULL
        );

        CREATE TABLE IF NOT EXISTS block_tags (
            block_id INTEGER NOT NULL,
            tag_id INTEGER NOT NULL,
            PRIMARY KEY (block_id, tag_id),
            FOREIGN KEY (block_id) REFERENCES blocks(id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS assets (
            id INTEGER PRIMARY KEY,
            hash TEXT UNIQUE NOT NULL,
            path TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            size INTEGER NOT NULL,
            created_at INTEGER DEFAULT (strftime('%s','now'))
        );

        CREATE TABLE IF NOT EXISTS kv (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS plugin_perms (
            plugin_id TEXT NOT NULL,
            permission TEXT NOT NULL,
            granted_at INTEGER DEFAULT (strftime('%s','now')),
            PRIMARY KEY (plugin_id, permission)
        );

        CREATE TABLE IF NOT EXISTS sync_ops (
            id INTEGER PRIMARY KEY,
            op_id TEXT NOT NULL UNIQUE,
            page_id INTEGER NOT NULL,
            device_id TEXT NOT NULL,
            op_type TEXT NOT NULL,
            payload BLOB NOT NULL,
            created_at INTEGER DEFAULT (strftime('%s','now')),
            FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS blocks_page_sort
          ON blocks(page_id, sort_key);
        CREATE INDEX IF NOT EXISTS blocks_parent_sort
          ON blocks(parent_id, sort_key);
        CREATE INDEX IF NOT EXISTS edges_from
          ON edges(from_block_id);
        CREATE INDEX IF NOT EXISTS edges_to
          ON edges(to_block_uid);
        CREATE INDEX IF NOT EXISTS block_tags_tag
          ON block_tags(tag_id);
        CREATE INDEX IF NOT EXISTS sync_ops_page_created_at
          ON sync_ops(page_id, created_at);

        CREATE VIRTUAL TABLE IF NOT EXISTS blocks_fts USING fts5(
            text,
            content='blocks',
            content_rowid='id'
        );

        CREATE TRIGGER IF NOT EXISTS blocks_fts_insert AFTER INSERT ON blocks BEGIN
            INSERT INTO blocks_fts(rowid, text)
            VALUES (new.id, new.text);
        END;

        CREATE TRIGGER IF NOT EXISTS blocks_fts_delete AFTER DELETE ON blocks BEGIN
            INSERT INTO blocks_fts(blocks_fts, rowid, text)
            VALUES ('delete', old.id, old.text);
        END;

        CREATE TRIGGER IF NOT EXISTS blocks_fts_update AFTER UPDATE ON blocks BEGIN
            INSERT INTO blocks_fts(blocks_fts, rowid, text)
            VALUES ('delete', old.id, old.text);
            INSERT INTO blocks_fts(rowid, text)
            VALUES (new.id, new.text);
        END;

        CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
            title,
            content='pages',
            content_rowid='id'
        );

        CREATE TRIGGER IF NOT EXISTS pages_fts_insert AFTER INSERT ON pages BEGIN
            INSERT INTO pages_fts(rowid, title)
            VALUES (new.id, new.title);
        END;

        CREATE TRIGGER IF NOT EXISTS pages_fts_delete AFTER DELETE ON pages BEGIN
            INSERT INTO pages_fts(pages_fts, rowid, title)
            VALUES ('delete', old.id, old.title);
        END;

        CREATE TRIGGER IF NOT EXISTS pages_fts_update AFTER UPDATE ON pages BEGIN
            INSERT INTO pages_fts(pages_fts, rowid, title)
            VALUES ('delete', old.id, old.title);
            INSERT INTO pages_fts(rowid, title)
            VALUES (new.id, new.title);
        END;",
    },
    Migration {
        version: 2,
        name: "assets-original-name",
        up: "ALTER TABLE assets ADD COLUMN original_name TEXT;",
    },
];

#[derive(Debug, PartialEq)]
pub struct PageRecord {
    pub id: i64,
    pub uid: String,
    pub title: String,
}

#[derive(Debug, PartialEq)]
pub struct BlockRecord {
    pub id: i64,
    pub uid: String,
    pub page_id: i64,
    pub parent_id: Option<i64>,
    pub sort_key: String,
    pub text: String,
    pub props: String,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct BlockSearchResult {
    pub id: i64,
    pub uid: String,
    pub text: String,
}

#[derive(Debug, PartialEq)]
pub struct TagRecord {
    pub id: i64,
    pub name: String,
}

#[derive(Debug, PartialEq)]
pub struct EdgeRecord {
    pub id: i64,
    pub from_block_id: i64,
    pub to_block_uid: String,
    pub kind: String,
}

#[derive(Debug, PartialEq)]
pub struct AssetRecord {
    pub id: i64,
    pub hash: String,
    pub path: String,
    pub mime_type: String,
    pub size: i64,
    pub original_name: Option<String>,
}

#[derive(Debug, PartialEq)]
pub struct SyncOp {
    pub id: i64,
    pub op_id: String,
    pub page_id: i64,
    pub device_id: String,
    pub op_type: String,
    pub payload: Vec<u8>,
    pub created_at: i64,
}

impl Database {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA temp_store = MEMORY;
             PRAGMA busy_timeout = 5000;
             PRAGMA cache_size = -64000;",
        )?;
        Ok(Self { conn })
    }

    pub fn new_in_memory() -> rusqlite::Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA temp_store = MEMORY;
             PRAGMA busy_timeout = 5000;
             PRAGMA cache_size = -64000;",
        )?;
        Ok(Self { conn })
    }

    pub fn run_migrations(&self) -> rusqlite::Result<()> {
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at TEXT DEFAULT CURRENT_TIMESTAMP
            );",
        )?;

        let current_version: i64 = self
            .conn
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        for migration in MIGRATIONS {
            if migration.version > current_version {
                let tx = self.conn.unchecked_transaction()?;
                tx.execute_batch(migration.up)?;
                tx.execute(
                    "INSERT INTO schema_migrations (version, name) VALUES (?1, ?2)",
                    params![migration.version, migration.name],
                )?;
                tx.commit()?;
            }
        }

        Ok(())
    }

    pub fn insert_page(&self, uid: &str, title: &str) -> rusqlite::Result<i64> {
        self.conn.execute(
            "INSERT INTO pages (uid, title) VALUES (?1, ?2)",
            params![uid, title],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn update_page_title(&self, page_id: i64, title: &str) -> rusqlite::Result<()> {
        self.conn.execute(
            "UPDATE pages SET title = ?1, updated_at = strftime('%s','now') WHERE id = ?2",
            params![title, page_id],
        )?;
        Ok(())
    }

    pub fn get_page_by_uid(&self, uid: &str) -> rusqlite::Result<Option<PageRecord>> {
        self.conn
            .query_row(
                "SELECT id, uid, title FROM pages WHERE uid = ?1",
                [uid],
                |row| {
                    Ok(PageRecord {
                        id: row.get(0)?,
                        uid: row.get(1)?,
                        title: row.get(2)?,
                    })
                },
            )
            .optional()
    }

    pub fn delete_page(&self, page_id: i64) -> rusqlite::Result<()> {
        self.conn
            .execute("DELETE FROM pages WHERE id = ?1", [page_id])?;
        Ok(())
    }

    pub fn insert_block(
        &self,
        page_id: i64,
        uid: &str,
        parent_id: Option<i64>,
        sort_key: &str,
        text: &str,
        props: &str,
    ) -> rusqlite::Result<i64> {
        self.conn.execute(
            "INSERT INTO blocks (uid, page_id, parent_id, sort_key, text, props)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![uid, page_id, parent_id, sort_key, text, props],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn update_block_text(&self, block_id: i64, text: &str) -> rusqlite::Result<()> {
        self.conn.execute(
            "UPDATE blocks SET text = ?1, updated_at = strftime('%s','now') WHERE id = ?2",
            params![text, block_id],
        )?;
        Ok(())
    }

    pub fn update_block_position(
        &self,
        block_id: i64,
        parent_id: Option<i64>,
        sort_key: &str,
    ) -> rusqlite::Result<()> {
        self.conn.execute(
            "UPDATE blocks SET parent_id = ?1, sort_key = ?2, updated_at = strftime('%s','now')
             WHERE id = ?3",
            params![parent_id, sort_key, block_id],
        )?;
        Ok(())
    }

    pub fn get_block(&self, block_id: i64) -> rusqlite::Result<Option<BlockRecord>> {
        self.conn
            .query_row(
                "SELECT id, uid, page_id, parent_id, sort_key, text, props FROM blocks WHERE id = ?1",
                [block_id],
                |row| {
                    Ok(BlockRecord {
                        id: row.get(0)?,
                        uid: row.get(1)?,
                        page_id: row.get(2)?,
                        parent_id: row.get(3)?,
                        sort_key: row.get(4)?,
                        text: row.get(5)?,
                        props: row.get(6)?,
                    })
                },
            )
            .optional()
    }

    pub fn delete_block(&self, block_id: i64) -> rusqlite::Result<()> {
        self.conn
            .execute("DELETE FROM blocks WHERE id = ?1", [block_id])?;
        Ok(())
    }

    pub fn search_blocks(&self, query: &str) -> rusqlite::Result<Vec<i64>> {
        let mut stmt = self.conn.prepare(
            "SELECT rowid FROM blocks_fts WHERE blocks_fts MATCH ?1 ORDER BY rowid",
        )?;
        let rows = stmt.query_map([query], |row| row.get(0))?;
        rows.collect()
    }

    pub fn search_block_summaries(
        &self,
        query: &str,
        limit: i64,
    ) -> rusqlite::Result<Vec<BlockSearchResult>> {
        let mut stmt = self.conn.prepare(
            "SELECT b.id, b.uid, b.text
             FROM blocks b
             JOIN blocks_fts fts ON b.id = fts.rowid
             WHERE blocks_fts MATCH ?1
             ORDER BY bm25(blocks_fts)
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![query, limit], |row| {
            Ok(BlockSearchResult {
                id: row.get(0)?,
                uid: row.get(1)?,
                text: row.get(2)?,
            })
        })?;
        rows.collect()
    }

    pub fn search_pages(&self, query: &str) -> rusqlite::Result<Vec<i64>> {
        let mut stmt = self.conn.prepare(
            "SELECT rowid FROM pages_fts WHERE pages_fts MATCH ?1 ORDER BY rowid",
        )?;
        let rows = stmt.query_map([query], |row| row.get(0))?;
        rows.collect()
    }

    pub fn upsert_asset(
        &self,
        hash: &str,
        path: &str,
        mime_type: &str,
        size: i64,
        original_name: Option<&str>,
    ) -> rusqlite::Result<AssetRecord> {
        self.conn.execute(
            "INSERT OR IGNORE INTO assets (hash, path, mime_type, size, original_name)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![hash, path, mime_type, size, original_name],
        )?;

        self.conn.query_row(
            "SELECT id, hash, path, mime_type, size, original_name FROM assets WHERE hash = ?1",
            [hash],
            |row| {
                Ok(AssetRecord {
                    id: row.get(0)?,
                    hash: row.get(1)?,
                    path: row.get(2)?,
                    mime_type: row.get(3)?,
                    size: row.get(4)?,
                    original_name: row.get(5)?,
                })
            },
        )
    }

    pub fn get_asset_by_hash(&self, hash: &str) -> rusqlite::Result<Option<AssetRecord>> {
        self.conn
            .query_row(
                "SELECT id, hash, path, mime_type, size, original_name FROM assets WHERE hash = ?1",
                [hash],
                |row| {
                    Ok(AssetRecord {
                        id: row.get(0)?,
                        hash: row.get(1)?,
                        path: row.get(2)?,
                        mime_type: row.get(3)?,
                        size: row.get(4)?,
                        original_name: row.get(5)?,
                    })
                },
            )
            .optional()
    }

    pub fn upsert_tag(&self, name: &str) -> rusqlite::Result<TagRecord> {
        self.conn.execute(
            "INSERT OR IGNORE INTO tags (name) VALUES (?1)",
            [name],
        )?;

        self.conn.query_row(
            "SELECT id, name FROM tags WHERE name = ?1",
            [name],
            |row| {
                Ok(TagRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                })
            },
        )
    }

    pub fn attach_tag(&self, block_id: i64, tag_id: i64) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO block_tags (block_id, tag_id) VALUES (?1, ?2)",
            params![block_id, tag_id],
        )?;
        Ok(())
    }

    pub fn detach_tag(&self, block_id: i64, tag_id: i64) -> rusqlite::Result<()> {
        self.conn.execute(
            "DELETE FROM block_tags WHERE block_id = ?1 AND tag_id = ?2",
            params![block_id, tag_id],
        )?;
        Ok(())
    }

    pub fn list_tags_for_block(&self, block_id: i64) -> rusqlite::Result<Vec<TagRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT t.id, t.name
             FROM tags t
             INNER JOIN block_tags bt ON bt.tag_id = t.id
             WHERE bt.block_id = ?1
             ORDER BY t.name ASC",
        )?;
        let rows = stmt.query_map([block_id], |row| {
            Ok(TagRecord {
                id: row.get(0)?,
                name: row.get(1)?,
            })
        })?;
        rows.collect()
    }

    pub fn insert_edge(
        &self,
        from_block_id: i64,
        to_block_uid: &str,
        kind: &str,
    ) -> rusqlite::Result<i64> {
        self.conn.execute(
            "INSERT INTO edges (from_block_id, to_block_uid, kind) VALUES (?1, ?2, ?3)",
            params![from_block_id, to_block_uid, kind],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn list_edges_from_block(&self, from_block_id: i64) -> rusqlite::Result<Vec<EdgeRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, from_block_id, to_block_uid, kind
             FROM edges
             WHERE from_block_id = ?1
             ORDER BY id ASC",
        )?;
        let rows = stmt.query_map([from_block_id], |row| {
            Ok(EdgeRecord {
                id: row.get(0)?,
                from_block_id: row.get(1)?,
                to_block_uid: row.get(2)?,
                kind: row.get(3)?,
            })
        })?;
        rows.collect()
    }

    pub fn delete_edge(&self, edge_id: i64) -> rusqlite::Result<()> {
        self.conn
            .execute("DELETE FROM edges WHERE id = ?1", [edge_id])?;
        Ok(())
    }

    pub fn insert_sync_op(
        &self,
        page_id: i64,
        op_id: &str,
        device_id: &str,
        op_type: &str,
        payload: &[u8],
    ) -> rusqlite::Result<i64> {
        self.conn.execute(
            "INSERT INTO sync_ops (op_id, page_id, device_id, op_type, payload)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![op_id, page_id, device_id, op_type, payload],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn list_sync_ops_for_page(&self, page_id: i64) -> rusqlite::Result<Vec<SyncOp>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, op_id, page_id, device_id, op_type, payload, created_at
             FROM sync_ops
             WHERE page_id = ?1
             ORDER BY created_at ASC, id ASC",
        )?;

        let rows = stmt.query_map([page_id], |row| {
            Ok(SyncOp {
                id: row.get(0)?,
                op_id: row.get(1)?,
                page_id: row.get(2)?,
                device_id: row.get(3)?,
                op_type: row.get(4)?,
                payload: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?;

        rows.collect()
    }
}

#[cfg(test)]
mod tests {
    use super::Database;

    fn table_exists(db: &Database, name: &str) -> bool {
        db.conn
            .query_row(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1",
                [name],
                |_row| Ok(1),
            )
            .is_ok()
    }

    fn table_columns(db: &Database, name: &str) -> Vec<String> {
        let allowed = match name {
            "blocks" | "pages" | "edges" | "tags" | "block_tags" | "assets" | "kv"
            | "plugin_perms" | "sync_ops" => name,
            _ => panic!("unsupported table name"),
        };
        let query = format!("PRAGMA table_info({})", allowed);
        let mut stmt = db.conn.prepare(&query).expect("table info");
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .expect("table info rows");
        rows.collect::<rusqlite::Result<Vec<String>>>()
            .expect("table info collect")
    }

    #[test]
    fn migrations_create_schema() {
        let db = Database::new_in_memory().expect("db init");
        db.run_migrations().expect("migrations");

        let expected_tables = [
            "pages",
            "blocks",
            "edges",
            "tags",
            "block_tags",
            "assets",
            "kv",
            "plugin_perms",
            "sync_ops",
            "blocks_fts",
            "pages_fts",
        ];

        for table in expected_tables {
            assert!(table_exists(&db, table), "missing table {table}");
        }
    }

    #[test]
    fn blocks_table_has_columns() {
        let db = Database::new_in_memory().expect("db init");
        db.run_migrations().expect("migrations");

        let columns = table_columns(&db, "blocks");
        let expected = [
            "id",
            "uid",
            "page_id",
            "parent_id",
            "sort_key",
            "text",
            "props",
            "created_at",
            "updated_at",
        ];

        for column in expected {
            assert!(columns.contains(&column.to_string()), "missing {column}");
        }
    }

    #[test]
    fn fts_updates_on_insert_update_delete() {
        let db = Database::new_in_memory().expect("db init");
        db.run_migrations().expect("migrations");

        let page_id = db.insert_page("page-uid", "Test page").expect("insert page");
        let block_id = db
            .insert_block(page_id, "block-uid", None, "a", "hello world", "{}")
            .expect("insert block");

        let results = db.search_blocks("hello").expect("search");
        assert_eq!(results, vec![block_id]);

        db.update_block_text(block_id, "goodbye world")
            .expect("update block");
        let results = db.search_blocks("hello").expect("search after update");
        assert!(results.is_empty());

        let results = db.search_blocks("goodbye").expect("search after update");
        assert_eq!(results, vec![block_id]);

        db.delete_block(block_id).expect("delete block");
        let results = db.search_blocks("goodbye").expect("search after delete");
        assert!(results.is_empty());
    }

    #[test]
    fn search_block_summaries_returns_text() {
        let db = Database::new_in_memory().expect("db init");
        db.run_migrations().expect("migrations");

        let page_id = db.insert_page("page-uid", "Search page").expect("insert page");
        db.insert_block(page_id, "block-uid", None, "a", "alpha note", "{}")
            .expect("insert block");
        db.insert_block(page_id, "block-uid-2", None, "b", "beta note", "{}")
            .expect("insert block");

        let results = db
            .search_block_summaries("alpha", 10)
            .expect("search summaries");

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].uid, "block-uid");
        assert_eq!(results[0].text, "alpha note");
    }

    #[test]
    fn pages_fts_updates_on_update() {
        let db = Database::new_in_memory().expect("db init");
        db.run_migrations().expect("migrations");

        let page_id = db.insert_page("page-uid", "Daily Notes").expect("insert page");
        let results = db.search_pages("Daily").expect("search");
        assert_eq!(results, vec![page_id]);

        db.update_page_title(page_id, "Archive")
            .expect("update page");
        let results = db.search_pages("Daily").expect("search after update");
        assert!(results.is_empty());

        let results = db.search_pages("Archive").expect("search after update");
        assert_eq!(results, vec![page_id]);
    }

    #[test]
    fn crud_pages_blocks_tags_edges() {
        let db = Database::new_in_memory().expect("db init");
        db.run_migrations().expect("migrations");

        let page_id = db
            .insert_page("page-uid", "Inbox")
            .expect("insert page");
        let page = db
            .get_page_by_uid("page-uid")
            .expect("get page")
            .expect("page exists");
        assert_eq!(page.title, "Inbox");

        db.update_page_title(page_id, "Archive")
            .expect("update page");
        let page = db
            .get_page_by_uid("page-uid")
            .expect("get page")
            .expect("page exists");
        assert_eq!(page.title, "Archive");

        let parent_id = db
            .insert_block(page_id, "parent-uid", None, "a", "Parent", "{}")
            .expect("insert parent");
        let child_id = db
            .insert_block(page_id, "child-uid", Some(parent_id), "a", "Child", "{}")
            .expect("insert child");

        let child = db.get_block(child_id).expect("get child").expect("child");
        assert_eq!(child.parent_id, Some(parent_id));
        assert_eq!(child.sort_key, "a");

        db.update_block_text(child_id, "Child updated")
            .expect("update block");
        db.update_block_position(child_id, None, "b")
            .expect("move block");

        let child = db.get_block(child_id).expect("get child").expect("child");
        assert_eq!(child.parent_id, None);
        assert_eq!(child.sort_key, "b");
        assert_eq!(child.text, "Child updated");

        let tag = db.upsert_tag("todo").expect("upsert tag");
        db.attach_tag(child_id, tag.id).expect("attach tag");
        let tags = db.list_tags_for_block(child_id).expect("list tags");
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].id, tag.id);
        assert_eq!(tags[0].name, tag.name);

        db.detach_tag(child_id, tag.id).expect("detach tag");
        let tags = db.list_tags_for_block(child_id).expect("list tags");
        assert!(tags.is_empty());

        let edge_id = db
            .insert_edge(child_id, "target-uid", "ref")
            .expect("insert edge");
        let edges = db.list_edges_from_block(child_id).expect("list edges");
        assert_eq!(edges.len(), 1);
        assert_eq!(edges[0].to_block_uid, "target-uid");

        db.delete_edge(edge_id).expect("delete edge");
        let edges = db.list_edges_from_block(child_id).expect("list edges");
        assert!(edges.is_empty());

        db.delete_page(page_id).expect("delete page");
        let page = db.get_page_by_uid("page-uid").expect("get page");
        assert!(page.is_none());
        let child = db.get_block(child_id).expect("get child");
        assert!(child.is_none());
    }

    #[test]
    fn sync_ops_persisted_per_page() {
        let db = Database::new_in_memory().expect("db init");
        db.run_migrations().expect("migrations");

        let page_id = db.insert_page("page-uid", "Sync page").expect("insert page");

        let payload = br#"{\"kind\":\"add\",\"block\":\"b1\"}"#;
        db.insert_sync_op(page_id, "op-1", "device-1", "add", payload)
            .expect("insert op");

        let ops = db
            .list_sync_ops_for_page(page_id)
            .expect("list ops");

        assert_eq!(ops.len(), 1);
        assert_eq!(ops[0].op_id, "op-1");
        assert_eq!(ops[0].op_type, "add");
        assert_eq!(ops[0].payload, payload);
    }

    #[test]
    fn sync_ops_enforce_unique_ids() {
        let db = Database::new_in_memory().expect("db init");
        db.run_migrations().expect("migrations");

        let page_id = db.insert_page("page-uid", "Sync page").expect("insert page");
        let payload = br#"{\"kind\":\"edit\",\"block\":\"b1\"}"#;

        db.insert_sync_op(page_id, "op-1", "device-1", "edit", payload)
            .expect("insert op");
        let result = db.insert_sync_op(page_id, "op-1", "device-1", "edit", payload);

        assert!(result.is_err());
    }
}
