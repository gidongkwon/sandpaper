use crate::db::Database;
use crate::vaults::{VaultConfig, VaultError, VaultRecord, VaultStore};
use chrono::{DateTime, Utc};
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub enum AppError {
    Vault(VaultError),
    Db(rusqlite::Error),
    Io(std::io::Error),
    NoVaultConfigured,
}

impl From<VaultError> for AppError {
    fn from(err: VaultError) -> Self {
        Self::Vault(err)
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(err: rusqlite::Error) -> Self {
        Self::Db(err)
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        Self::Io(err)
    }
}

#[derive(Debug, Clone)]
pub struct ActiveVault {
    pub record: VaultRecord,
    pub root: PathBuf,
}

pub fn sanitize_kebab(input: &str) -> String {
    let mut output = String::new();
    let mut was_dash = false;
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            output.push(ch.to_ascii_lowercase());
            was_dash = false;
        } else if !was_dash {
            output.push('-');
            was_dash = true;
        }
    }
    let trimmed = output.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "page".to_string()
    } else {
        trimmed
    }
}

pub fn resolve_active_vault(config: &VaultConfig) -> Option<&VaultRecord> {
    config
        .active_id
        .as_ref()
        .and_then(|id| config.vaults.iter().find(|vault| &vault.id == id))
        .or_else(|| config.vaults.first())
}

pub fn load_active_vault() -> Result<ActiveVault, AppError> {
    let store = VaultStore::default_store()?;
    let config = store.load()?;
    let active = resolve_active_vault(&config).ok_or(AppError::NoVaultConfigured)?;
    Ok(ActiveVault {
        record: active.clone(),
        root: PathBuf::from(&active.path),
    })
}

pub fn open_active_database() -> Result<(ActiveVault, Database), AppError> {
    let vault = load_active_vault()?;
    let db = open_vault_database(&vault.root)?;
    Ok((vault, db))
}

pub fn ensure_page(db: &Database, page_uid: &str, title: &str) -> Result<i64, AppError> {
    if let Some(page) = db.get_page_by_uid(page_uid)? {
        return Ok(page.id);
    }
    Ok(db.insert_page(page_uid, title)?)
}

pub fn resolve_unique_page_uid(db: &Database, title: &str) -> Result<String, AppError> {
    let base = sanitize_kebab(title);
    let mut candidate = base.clone();
    let mut suffix = 2;
    while db.get_page_by_uid(&candidate)?.is_some() {
        candidate = format!("{base}-{suffix}");
        suffix += 1;
    }
    Ok(candidate)
}

pub fn open_vault_database(vault_root: &Path) -> Result<Database, AppError> {
    let db_path = vault_root.join("sandpaper.db");
    let db = Database::open(&db_path)?;
    backup_before_migration(vault_root, &db_path, &db)?;
    db.run_migrations()?;
    Ok(db)
}

pub fn backup_before_migration(
    vault_root: &Path,
    db_path: &Path,
    db: &Database,
) -> Result<Option<PathBuf>, AppError> {
    backup_before_migration_at(vault_root, db_path, db, Utc::now())
}

pub fn backup_before_migration_at(
    vault_root: &Path,
    db_path: &Path,
    db: &Database,
    now: DateTime<Utc>,
) -> Result<Option<PathBuf>, AppError> {
    let current_version = db.current_schema_version()?;
    let latest_version = Database::latest_migration_version();
    if current_version >= latest_version {
        return Ok(None);
    }

    let backup_dir = vault_root.join("backups");
    std::fs::create_dir_all(&backup_dir)?;
    let stamp = now.format("%Y%m%d%H%M%S").to_string();
    let backup_path = backup_dir.join(format!("sandpaper-{stamp}.db"));
    std::fs::copy(db_path, &backup_path)?;
    rotate_backups(&backup_dir, 3)?;
    Ok(Some(backup_path))
}

pub fn rotate_backups(backup_dir: &Path, keep: usize) -> Result<(), AppError> {
    let mut backups: Vec<PathBuf> = std::fs::read_dir(backup_dir)?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let path = entry.path();
            let name = path.file_name()?.to_string_lossy();
            if name.starts_with("sandpaper-") && name.ends_with(".db") {
                Some(path)
            } else {
                None
            }
        })
        .collect();

    backups.sort_by(|a, b| {
        let a_name = a.file_name().map(|name| name.to_string_lossy());
        let b_name = b.file_name().map(|name| name.to_string_lossy());
        a_name.cmp(&b_name)
    });

    if backups.len() <= keep {
        return Ok(());
    }

    for path in backups.iter().take(backups.len() - keep) {
        std::fs::remove_file(path)?;
    }

    Ok(())
}
