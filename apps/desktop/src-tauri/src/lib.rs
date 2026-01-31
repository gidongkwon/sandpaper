// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
pub mod assets;
pub mod db;
pub mod plugins;
pub mod vaults;

use serde::Serialize;
use std::path::PathBuf;
use vaults::{VaultConfig, VaultRecord, VaultStore};
use db::{BlockSearchResult, BlockSnapshot, Database};

#[derive(Debug, Serialize)]
struct PageBlocksResponse {
    page_uid: String,
    title: String,
    blocks: Vec<BlockSnapshot>,
}

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

fn sanitize_kebab(input: &str) -> String {
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

fn shadow_markdown_path(vault_path: &std::path::Path, page_uid: &str) -> PathBuf {
    let safe_name = sanitize_kebab(page_uid);
    vault_path.join("pages").join(format!("{}.md", safe_name))
}

fn write_shadow_markdown_to_vault(
    vault_path: &std::path::Path,
    page_uid: &str,
    content: &str,
) -> Result<PathBuf, String> {
    let path = shadow_markdown_path(vault_path, page_uid);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| format!("{:?}", err))?;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if path.exists() {
            let permissions = std::fs::Permissions::from_mode(0o600);
            std::fs::set_permissions(&path, permissions)
                .map_err(|err| format!("{:?}", err))?;
        }
    }

    std::fs::write(&path, content).map_err(|err| format!("{:?}", err))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = std::fs::Permissions::from_mode(0o444);
        std::fs::set_permissions(&path, permissions).map_err(|err| format!("{:?}", err))?;
    }

    Ok(path)
}

fn ensure_page(db: &Database, page_uid: &str, title: &str) -> Result<i64, String> {
    if let Some(page) = db
        .get_page_by_uid(page_uid)
        .map_err(|err| format!("{:?}", err))?
    {
        return Ok(page.id);
    }

    db.insert_page(page_uid, title)
        .map_err(|err| format!("{:?}", err))
}

#[tauri::command]
fn search_blocks(query: String) -> Result<Vec<BlockSearchResult>, String> {
    let db = open_active_database()?;
    db.search_block_summaries(&query, 50)
        .map_err(|err| format!("{:?}", err))
}

#[tauri::command]
fn load_page_blocks(page_uid: String) -> Result<PageBlocksResponse, String> {
    let db = open_active_database()?;
    let page_id = ensure_page(&db, &page_uid, "Inbox")?;
    let page = db
        .get_page_by_uid(&page_uid)
        .map_err(|err| format!("{:?}", err))?
        .ok_or_else(|| "Page not found".to_string())?;
    let blocks = db
        .load_blocks_for_page(page_id)
        .map_err(|err| format!("{:?}", err))?;
    Ok(PageBlocksResponse {
        page_uid,
        title: page.title,
        blocks,
    })
}

#[tauri::command]
fn save_page_blocks(page_uid: String, blocks: Vec<BlockSnapshot>) -> Result<(), String> {
    let mut db = open_active_database()?;
    let page_id = ensure_page(&db, &page_uid, "Inbox")?;
    db.replace_blocks_for_page(page_id, &blocks)
        .map_err(|err| format!("{:?}", err))
}

#[tauri::command]
fn write_shadow_markdown(page_uid: String, content: String) -> Result<String, String> {
    let vault_path = resolve_active_vault_path()?;
    let path = write_shadow_markdown_to_vault(&vault_path, &page_uid, &content)?;
    Ok(path.to_string_lossy().to_string())
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
            search_blocks,
            load_page_blocks,
            save_page_blocks,
            write_shadow_markdown
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{sanitize_kebab, shadow_markdown_path, write_shadow_markdown_to_vault};
    use tempfile::tempdir;

    #[test]
    fn sanitize_kebab_strips_unsafe_chars() {
        assert_eq!(sanitize_kebab("Daily Notes"), "daily-notes");
        assert_eq!(sanitize_kebab("  ### "), "page");
        assert_eq!(sanitize_kebab("multi__part--name"), "multi-part-name");
    }

    #[test]
    fn shadow_markdown_path_uses_pages_dir() {
        let dir = tempdir().expect("tempdir");
        let path = shadow_markdown_path(dir.path(), "Daily Notes");
        assert!(path.ends_with(std::path::Path::new("pages/daily-notes.md")));
    }

    #[test]
    fn write_shadow_markdown_creates_file() {
        let dir = tempdir().expect("tempdir");
        let content = "# Inbox\n- hello ^block";
        let path =
            write_shadow_markdown_to_vault(dir.path(), "Inbox", content).expect("write");
        let saved = std::fs::read_to_string(&path).expect("read");
        assert_eq!(saved, content);

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path)
                .expect("metadata")
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o444);
        }
    }
}
