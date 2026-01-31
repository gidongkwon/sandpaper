// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
pub mod assets;
pub mod db;
pub mod plugins;
pub mod vaults;

use std::path::PathBuf;
use vaults::{VaultConfig, VaultRecord, VaultStore};
use db::{BlockSearchResult, Database};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn list_vaults() -> Result<VaultConfig, String> {
    let store = VaultStore::default_store().map_err(|err| format!("{:?}", err))?;
    store.load().map_err(|err| format!("{:?}", err))
}

#[tauri::command]
fn create_vault(name: String, path: String) -> Result<VaultRecord, String> {
    let store = VaultStore::default_store().map_err(|err| format!("{:?}", err))?;
    let path = PathBuf::from(path);
    store
        .create_vault(&name, &path)
        .map_err(|err| format!("{:?}", err))
}

#[tauri::command]
fn set_active_vault(vault_id: String) -> Result<VaultConfig, String> {
    let store = VaultStore::default_store().map_err(|err| format!("{:?}", err))?;
    store
        .set_active_vault(&vault_id)
        .map_err(|err| format!("{:?}", err))
}

fn resolve_active_vault_path() -> Result<PathBuf, String> {
    let store = VaultStore::default_store().map_err(|err| format!("{:?}", err))?;
    let config = store.load().map_err(|err| format!("{:?}", err))?;
    let active = config
        .active_id
        .as_ref()
        .and_then(|id| config.vaults.iter().find(|vault| &vault.id == id))
        .or_else(|| config.vaults.first())
        .ok_or_else(|| "No vault configured".to_string())?;
    Ok(PathBuf::from(&active.path))
}

fn open_active_database() -> Result<Database, String> {
    let vault_path = resolve_active_vault_path()?;
    let db_path = vault_path.join("sandpaper.db");
    let db = Database::open(&db_path).map_err(|err| format!("{:?}", err))?;
    db.run_migrations().map_err(|err| format!("{:?}", err))?;
    Ok(db)
}

#[tauri::command]
fn search_blocks(query: String) -> Result<Vec<BlockSearchResult>, String> {
    let db = open_active_database()?;
    db.search_block_summaries(&query, 50)
        .map_err(|err| format!("{:?}", err))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            list_vaults,
            create_vault,
            set_active_vault,
            search_blocks
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
