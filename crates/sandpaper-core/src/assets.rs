use crate::db::{AssetRecord, Database};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub enum AssetError {
    Io(std::io::Error),
    Db(rusqlite::Error),
}

impl From<std::io::Error> for AssetError {
    fn from(err: std::io::Error) -> Self {
        Self::Io(err)
    }
}

impl From<rusqlite::Error> for AssetError {
    fn from(err: rusqlite::Error) -> Self {
        Self::Db(err)
    }
}

pub struct AssetStore<'a> {
    db: &'a Database,
    vault_root: PathBuf,
}

impl<'a> AssetStore<'a> {
    pub fn new(db: &'a Database, vault_root: impl AsRef<Path>) -> Self {
        Self {
            db,
            vault_root: vault_root.as_ref().to_path_buf(),
        }
    }

    pub fn store_bytes(
        &self,
        filename: &str,
        mime_type: &str,
        bytes: &[u8],
    ) -> Result<AssetRecord, AssetError> {
        let hash = hash_bytes(bytes);
        let relative_path = PathBuf::from("assets").join(&hash);
        let full_path = self.vault_root.join(&relative_path);

        if !full_path.exists() {
            if let Some(parent) = full_path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(&full_path, bytes)?;
        }

        let record = self.db.upsert_asset(
            &hash,
            relative_path.to_string_lossy().as_ref(),
            mime_type,
            bytes.len() as i64,
            Some(filename),
        )?;

        Ok(record)
    }
}

fn hash_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    hex::encode(digest)
}

#[cfg(test)]
mod tests {
    use super::AssetStore;
    use crate::db::Database;
    use tempfile::tempdir;

    #[test]
    fn stores_asset_and_reuses_hash() {
        let db = Database::new_in_memory().expect("db init");
        db.run_migrations().expect("migrations");

        let dir = tempdir().expect("tempdir");
        let store = AssetStore::new(&db, dir.path());

        let first = store
            .store_bytes("note.txt", "text/plain", b"hello")
            .expect("store asset");
        let second = store
            .store_bytes("note.txt", "text/plain", b"hello")
            .expect("store asset");

        assert_eq!(first.hash, second.hash);
        assert_eq!(first.id, second.id);
        assert_eq!(first.original_name.as_deref(), Some("note.txt"));

        let asset_path = dir.path().join("assets").join(&first.hash);
        assert!(asset_path.exists());
    }

    #[test]
    fn stores_unique_assets_for_different_content() {
        let db = Database::new_in_memory().expect("db init");
        db.run_migrations().expect("migrations");

        let dir = tempdir().expect("tempdir");
        let store = AssetStore::new(&db, dir.path());

        let first = store
            .store_bytes("note.txt", "text/plain", b"hello")
            .expect("store asset");
        let second = store
            .store_bytes("note.txt", "text/plain", b"hello world")
            .expect("store asset");

        assert_ne!(first.hash, second.hash);
    }
}
