use rusqlite::{params, Connection};

pub struct Database {
    conn: Connection,
}

pub struct Migration {
    pub version: i64,
    pub name: &'static str,
    pub up: &'static str,
}

const MIGRATIONS: &[Migration] = &[Migration {
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
}];

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

    pub fn search_pages(&self, query: &str) -> rusqlite::Result<Vec<i64>> {
        let mut stmt = self.conn.prepare(
            "SELECT rowid FROM pages_fts WHERE pages_fts MATCH ?1 ORDER BY rowid",
        )?;
        let rows = stmt.query_map([query], |row| row.get(0))?;
        rows.collect()
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
