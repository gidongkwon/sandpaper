use rusqlite::{params, Connection};

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn new_in_memory() -> rusqlite::Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA temp_store = MEMORY;",
        )?;
        Ok(Self { conn })
    }

    pub fn run_migrations(&self) -> rusqlite::Result<()> {
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS pages (
                id INTEGER PRIMARY KEY,
                title TEXT NOT NULL,
                created_at INTEGER DEFAULT (strftime('%s','now')),
                updated_at INTEGER DEFAULT (strftime('%s','now'))
            );

            CREATE TABLE IF NOT EXISTS blocks (
                id INTEGER PRIMARY KEY,
                uid TEXT UNIQUE NOT NULL,
                page_id INTEGER NOT NULL,
                content TEXT NOT NULL,
                created_at INTEGER DEFAULT (strftime('%s','now')),
                updated_at INTEGER DEFAULT (strftime('%s','now')),
                FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS blocks_fts USING fts5(
                content,
                content='blocks',
                content_rowid='id'
            );

            CREATE TRIGGER IF NOT EXISTS blocks_fts_insert AFTER INSERT ON blocks BEGIN
                INSERT INTO blocks_fts(rowid, content)
                VALUES (new.id, new.content);
            END;

            CREATE TRIGGER IF NOT EXISTS blocks_fts_delete AFTER DELETE ON blocks BEGIN
                INSERT INTO blocks_fts(blocks_fts, rowid, content)
                VALUES ('delete', old.id, old.content);
            END;

            CREATE TRIGGER IF NOT EXISTS blocks_fts_update AFTER UPDATE ON blocks BEGIN
                INSERT INTO blocks_fts(blocks_fts, rowid, content)
                VALUES ('delete', old.id, old.content);
                INSERT INTO blocks_fts(rowid, content)
                VALUES (new.id, new.content);
            END;",
        )?;

        let applied: i64 = self
            .conn
            .query_row(
                "SELECT COUNT(1) FROM schema_migrations WHERE version = ?1",
                [1],
                |row| row.get(0),
            )?;

        if applied == 0 {
            self.conn.execute(
                "INSERT INTO schema_migrations (version, name) VALUES (?1, ?2)",
                params![1, "init"],
            )?;
        }

        Ok(())
    }

    pub fn insert_page(&self, title: &str) -> rusqlite::Result<i64> {
        self.conn
            .execute("INSERT INTO pages (title) VALUES (?1)", [title])?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn insert_block(&self, page_id: i64, uid: &str, content: &str) -> rusqlite::Result<i64> {
        self.conn.execute(
            "INSERT INTO blocks (uid, page_id, content) VALUES (?1, ?2, ?3)",
            params![uid, page_id, content],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn update_block_content(&self, block_id: i64, content: &str) -> rusqlite::Result<()> {
        self.conn.execute(
            "UPDATE blocks SET content = ?1, updated_at = strftime('%s','now') WHERE id = ?2",
            params![content, block_id],
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
}

#[cfg(test)]
mod tests {
    use super::Database;

    #[test]
    fn migrations_create_schema() {
        let db = Database::new_in_memory().expect("db init");
        db.run_migrations().expect("migrations");

        let tables = db
            .conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('pages', 'blocks')")
            .and_then(|mut stmt| {
                let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
                rows.collect::<rusqlite::Result<Vec<String>>>()
            })
            .expect("table query");

        assert!(tables.contains(&"pages".to_string()));
        assert!(tables.contains(&"blocks".to_string()));
    }

    #[test]
    fn fts_updates_on_insert_update_delete() {
        let db = Database::new_in_memory().expect("db init");
        db.run_migrations().expect("migrations");

        let page_id = db.insert_page("Test page").expect("insert page");
        let block_id = db
            .insert_block(page_id, "b-1", "hello world")
            .expect("insert block");

        let results = db.search_blocks("hello").expect("search");
        assert_eq!(results, vec![block_id]);

        db.update_block_content(block_id, "goodbye world")
            .expect("update block");
        let results = db.search_blocks("hello").expect("search after update");
        assert!(results.is_empty());

        let results = db.search_blocks("goodbye").expect("search after update");
        assert_eq!(results, vec![block_id]);

        db.delete_block(block_id).expect("delete block");
        let results = db.search_blocks("goodbye").expect("search after delete");
        assert!(results.is_empty());
    }
}
