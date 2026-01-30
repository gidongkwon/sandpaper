use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

#[derive(Debug)]
pub enum VaultError {
    Io(std::io::Error),
    Serde(serde_json::Error),
    NotFound,
    ProjectDir,
}

impl From<std::io::Error> for VaultError {
    fn from(err: std::io::Error) -> Self {
        Self::Io(err)
    }
}

impl From<serde_json::Error> for VaultError {
    fn from(err: serde_json::Error) -> Self {
        Self::Serde(err)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VaultRecord {
    pub id: String,
    pub name: String,
    pub path: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct VaultConfig {
    pub active_id: Option<String>,
    pub vaults: Vec<VaultRecord>,
}

pub struct VaultStore {
    config_path: PathBuf,
}

impl VaultStore {
    pub fn new(config_path: PathBuf) -> Self {
        Self { config_path }
    }

    pub fn default_store() -> Result<Self, VaultError> {
        let project_dirs = ProjectDirs::from("app", "sandpaper", "Sandpaper")
            .ok_or(VaultError::ProjectDir)?;
        let config_dir = project_dirs.config_dir();
        Ok(Self::new(config_dir.join("vaults.json")))
    }

    pub fn load(&self) -> Result<VaultConfig, VaultError> {
        if !self.config_path.exists() {
            return Ok(VaultConfig::default());
        }
        let raw = fs::read_to_string(&self.config_path)?;
        Ok(serde_json::from_str(&raw)?)
    }

    pub fn save(&self, config: &VaultConfig) -> Result<(), VaultError> {
        if let Some(parent) = self.config_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let data = serde_json::to_string_pretty(config)?;
        fs::write(&self.config_path, data)?;
        Ok(())
    }

    pub fn create_vault(&self, name: &str, path: &Path) -> Result<VaultRecord, VaultError> {
        fs::create_dir_all(path)?;
        let record = VaultRecord {
            id: Uuid::new_v4().to_string(),
            name: name.to_string(),
            path: path.to_string_lossy().to_string(),
            created_at: now_epoch(),
        };

        let mut config = self.load()?;
        config.vaults.push(record.clone());
        if config.active_id.is_none() {
            config.active_id = Some(record.id.clone());
        }
        self.save(&config)?;
        Ok(record)
    }

    pub fn set_active_vault(&self, vault_id: &str) -> Result<VaultConfig, VaultError> {
        let mut config = self.load()?;
        let exists = config.vaults.iter().any(|vault| vault.id == vault_id);
        if !exists {
            return Err(VaultError::NotFound);
        }
        config.active_id = Some(vault_id.to_string());
        self.save(&config)?;
        Ok(config)
    }
}

fn now_epoch() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::VaultStore;
    use std::path::PathBuf;
    use tempfile::tempdir;

    #[test]
    fn create_vault_persists_and_sets_active() {
        let dir = tempdir().expect("tempdir");
        let config_path = dir.path().join("vaults.json");
        let store = VaultStore::new(config_path);

        let vault_path = dir.path().join("vault-a");
        let record = store
            .create_vault("Inbox", &vault_path)
            .expect("create vault");

        let config = store.load().expect("load config");
        assert_eq!(config.vaults.len(), 1);
        assert_eq!(config.active_id.as_deref(), Some(record.id.as_str()));
        assert_eq!(config.vaults[0].name, "Inbox");
    }

    #[test]
    fn set_active_vault_updates_config() {
        let dir = tempdir().expect("tempdir");
        let config_path = dir.path().join("vaults.json");
        let store = VaultStore::new(config_path);

        let vault_a = store
            .create_vault("Inbox", &dir.path().join("vault-a"))
            .expect("create vault");
        let vault_b = store
            .create_vault("Projects", &dir.path().join("vault-b"))
            .expect("create vault");

        let vault_b_id = vault_b.id.clone();
        let config = store
            .set_active_vault(&vault_b_id)
            .expect("set active");
        assert_eq!(config.active_id.as_deref(), Some(vault_b_id.as_str()));
        assert_eq!(config.vaults.len(), 2);
        assert_ne!(vault_a.id, vault_b_id);
    }

    #[test]
    fn set_active_vault_rejects_unknown_id() {
        let dir = tempdir().expect("tempdir");
        let config_path = dir.path().join("vaults.json");
        let store = VaultStore::new(config_path);

        let error = store.set_active_vault("missing").err();
        assert!(error.is_some());
    }

    #[test]
    fn load_defaults_when_missing_file() {
        let dir = tempdir().expect("tempdir");
        let config_path = PathBuf::from(dir.path().join("vaults.json"));
        let store = VaultStore::new(config_path);

        let config = store.load().expect("load config");
        assert!(config.vaults.is_empty());
        assert!(config.active_id.is_none());
    }
}
