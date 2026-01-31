// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
pub mod assets;
pub mod db;
pub mod plugins;
pub mod vaults;

use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Mutex;
use vaults::{VaultConfig, VaultRecord, VaultStore};
use db::{BlockSearchResult, BlockSnapshot, Database};
use plugins::{
    discover_plugins, list_plugins, runtime_script_path, PluginCommand, PluginDescriptor,
    PluginInfo, PluginPanel, PluginRegistry, PluginRenderer, PluginRuntime, PluginRuntimeLoadResult,
    PluginToolbarAction,
};

#[derive(Debug, Serialize)]
struct PageBlocksResponse {
    page_uid: String,
    title: String,
    blocks: Vec<BlockSnapshot>,
}

#[derive(Debug, Serialize)]
struct PluginPermissionInfo {
    id: String,
    name: String,
    version: String,
    description: Option<String>,
    permissions: Vec<String>,
    enabled: bool,
    path: String,
    granted_permissions: Vec<String>,
    missing_permissions: Vec<String>,
}

#[derive(Debug, Serialize)]
struct PluginBlockInfo {
    id: String,
    reason: String,
    missing_permissions: Vec<String>,
}

#[derive(Debug, Serialize)]
struct PluginRuntimeStatus {
    loaded: Vec<String>,
    blocked: Vec<PluginBlockInfo>,
    commands: Vec<PluginCommand>,
    panels: Vec<PluginPanel>,
    toolbar_actions: Vec<PluginToolbarAction>,
    renderers: Vec<PluginRenderer>,
}

struct RuntimeState {
    script_path: PathBuf,
    runtime: Mutex<Option<PluginRuntime>>,
}

impl RuntimeState {
    fn new(script_path: PathBuf) -> Self {
        Self {
            script_path,
            runtime: Mutex::new(None),
        }
    }

    fn with_runtime<F, R>(&self, f: F) -> Result<R, String>
    where
        F: FnOnce(&mut PluginRuntime) -> Result<R, plugins::PluginError>,
    {
        let mut guard = self
            .runtime
            .lock()
            .map_err(|_| "runtime-lock-poisoned".to_string())?;
        if guard.is_none() {
            *guard = Some(PluginRuntime::new(self.script_path.clone()).map_err(|err| {
                format!("{:?}", err)
            })?);
        }
        match guard.as_mut() {
            Some(runtime) => f(runtime).map_err(|err| format!("{:?}", err)),
            None => Err("runtime-unavailable".to_string()),
        }
    }
}

#[derive(Debug, Serialize)]
struct MarkdownExportStatus {
    path: String,
    pages: usize,
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

fn plugin_registry_for_vault(vault_path: &std::path::Path) -> PluginRegistry {
    PluginRegistry::new(vault_path.join("plugins/state.json"))
}

fn compute_missing_permissions(required: &[String], granted: &[String]) -> Vec<String> {
    use std::collections::HashSet;
    let granted_set: HashSet<&str> = granted.iter().map(|value| value.as_str()).collect();
    required
        .iter()
        .filter(|perm| !granted_set.contains(perm.as_str()))
        .cloned()
        .collect()
}

fn ensure_plugin_permission(
    db: &Database,
    plugin_id: &str,
    permission: &str,
) -> Result<(), String> {
    let granted = db
        .list_plugin_permissions(plugin_id)
        .map_err(|err| format!("{:?}", err))?;
    if granted.iter().any(|perm| perm == permission) {
        Ok(())
    } else {
        Err(format!("missing-permission:{permission}"))
    }
}

fn list_permissions_for_plugins(
    db: &Database,
    plugins: Vec<PluginInfo>,
) -> Result<Vec<PluginPermissionInfo>, String> {
    let mut result = Vec::with_capacity(plugins.len());
    for plugin in plugins {
        let granted = db
            .list_plugin_permissions(&plugin.id)
            .map_err(|err| format!("{:?}", err))?;
        let missing = compute_missing_permissions(&plugin.permissions, &granted);
        result.push(PluginPermissionInfo {
            id: plugin.id,
            name: plugin.name,
            version: plugin.version,
            description: plugin.description,
            permissions: plugin.permissions,
            enabled: plugin.enabled,
            path: plugin.path,
            granted_permissions: granted,
            missing_permissions: missing,
        });
    }
    Ok(result)
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

struct PendingSyncOp {
    op_id: String,
    op_type: String,
    payload: Vec<u8>,
}

fn get_or_create_device_id(db: &Database) -> Result<String, String> {
    if let Some(existing) = db
        .get_kv("device.id")
        .map_err(|err| format!("{:?}", err))?
    {
        return Ok(existing);
    }
    let id = uuid::Uuid::new_v4().to_string();
    db.set_kv("device.id", &id)
        .map_err(|err| format!("{:?}", err))?;
    Ok(id)
}

fn load_device_clock(db: &Database) -> Result<i64, String> {
    let value = db
        .get_kv("device.clock")
        .map_err(|err| format!("{:?}", err))?;
    Ok(value
        .as_deref()
        .and_then(|raw| raw.parse::<i64>().ok())
        .unwrap_or(0))
}

fn store_device_clock(db: &Database, clock: i64) -> Result<(), String> {
    db.set_kv("device.clock", &clock.to_string())
        .map_err(|err| format!("{:?}", err))
}

fn build_sync_ops(
    page_uid: &str,
    device_id: &str,
    previous: &[BlockSnapshot],
    next: &[BlockSnapshot],
    mut clock: i64,
) -> Result<(Vec<PendingSyncOp>, i64), String> {
    let mut ops = Vec::new();
    let mut previous_by_id = std::collections::HashMap::new();
    for (index, block) in previous.iter().enumerate() {
        previous_by_id.insert(block.uid.clone(), (block, index));
    }
    let mut next_ids = std::collections::HashSet::new();

    for (index, block) in next.iter().enumerate() {
        next_ids.insert(block.uid.as_str());
        let sort_key = format!("{:06}", index);
        let timestamp = chrono::Utc::now().timestamp_millis();

        if let Some((prev, prev_index)) = previous_by_id.get(&block.uid) {
            if block.text != prev.text {
                clock += 1;
                let op_id = uuid::Uuid::new_v4().to_string();
                let payload = serde_json::json!({
                    "opId": op_id,
                    "pageId": page_uid,
                    "blockId": block.uid,
                    "deviceId": device_id,
                    "clock": clock,
                    "timestamp": timestamp,
                    "kind": "edit",
                    "text": block.text
                });
                ops.push(PendingSyncOp {
                    op_id,
                    op_type: "edit".to_string(),
                    payload: serde_json::to_vec(&payload)
                        .map_err(|err| format!("{:?}", err))?,
                });
            }

            if block.indent != prev.indent || *prev_index != index {
                clock += 1;
                let op_id = uuid::Uuid::new_v4().to_string();
                let payload = serde_json::json!({
                    "opId": op_id,
                    "pageId": page_uid,
                    "blockId": block.uid,
                    "deviceId": device_id,
                    "clock": clock,
                    "timestamp": timestamp,
                    "kind": "move",
                    "parentId": serde_json::Value::Null,
                    "sortKey": sort_key,
                    "indent": block.indent
                });
                ops.push(PendingSyncOp {
                    op_id,
                    op_type: "move".to_string(),
                    payload: serde_json::to_vec(&payload)
                        .map_err(|err| format!("{:?}", err))?,
                });
            }
        } else {
            clock += 1;
            let op_id = uuid::Uuid::new_v4().to_string();
            let payload = serde_json::json!({
                "opId": op_id,
                "pageId": page_uid,
                "blockId": block.uid,
                "deviceId": device_id,
                "clock": clock,
                "timestamp": timestamp,
                "kind": "add",
                "parentId": serde_json::Value::Null,
                "sortKey": sort_key,
                "indent": block.indent,
                "text": block.text
            });
            ops.push(PendingSyncOp {
                op_id,
                op_type: "add".to_string(),
                payload: serde_json::to_vec(&payload)
                    .map_err(|err| format!("{:?}", err))?,
            });
        }
    }

    for (uid, _) in previous_by_id.iter() {
        if next_ids.contains(uid.as_str()) {
            continue;
        }
        clock += 1;
        let op_id = uuid::Uuid::new_v4().to_string();
        let payload = serde_json::json!({
            "opId": op_id,
            "pageId": page_uid,
            "blockId": uid,
            "deviceId": device_id,
            "clock": clock,
            "timestamp": chrono::Utc::now().timestamp_millis(),
            "kind": "delete"
        });
        ops.push(PendingSyncOp {
            op_id,
            op_type: "delete".to_string(),
            payload: serde_json::to_vec(&payload)
                .map_err(|err| format!("{:?}", err))?,
        });
    }

    Ok((ops, clock))
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
    let previous = db
        .load_blocks_for_page(page_id)
        .map_err(|err| format!("{:?}", err))?;
    let device_id = get_or_create_device_id(&db)?;
    let clock = load_device_clock(&db)?;
    let (ops, next_clock) = build_sync_ops(&page_uid, &device_id, &previous, &blocks, clock)?;

    db.replace_blocks_for_page(page_id, &blocks)
        .map_err(|err| format!("{:?}", err))?;

    if !ops.is_empty() {
        for op in ops {
            db.insert_sync_op(page_id, &op.op_id, &device_id, &op.op_type, &op.payload)
                .map_err(|err| format!("{:?}", err))?;
        }
        store_device_clock(&db, next_clock)?;
    }

    Ok(())
}

#[tauri::command]
fn write_shadow_markdown(page_uid: String, content: String) -> Result<String, String> {
    let vault_path = resolve_active_vault_path()?;
    let path = write_shadow_markdown_to_vault(&vault_path, &page_uid, &content)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn export_markdown() -> Result<MarkdownExportStatus, String> {
    let vault_path = resolve_active_vault_path()?;
    let db = open_active_database()?;
    let pages = db
        .list_pages()
        .map_err(|err| format!("{:?}", err))?;
    let mut exported = 0;

    for page in pages {
        let page_id = page.id;
        let blocks = db
            .load_blocks_for_page(page_id)
            .map_err(|err| format!("{:?}", err))?;
        let payload = PageBlocksResponse {
            page_uid: page.uid.clone(),
            title: page.title.clone(),
            blocks: blocks
                .iter()
                .map(|block| BlockSnapshot {
                    uid: block.uid.clone(),
                    text: block.text.clone(),
                    indent: block.indent,
                })
                .collect(),
        };
        let markdown = build_markdown_export(&payload);
        write_shadow_markdown_to_vault(&vault_path, &payload.page_uid, &markdown)?;
        exported += 1;
    }

    let stamp = format!("{}", chrono::Utc::now().date_naive());
    db.set_kv("export.last", &stamp)
        .map_err(|err| format!("{:?}", err))?;

    Ok(MarkdownExportStatus {
        path: vault_path.join("pages").to_string_lossy().to_string(),
        pages: exported,
    })
}

fn build_markdown_export(page: &PageBlocksResponse) -> String {
    let mut lines = Vec::new();
    lines.push(format!("# {} ^{}", page.title, page.page_uid));
    for block in &page.blocks {
        let indent = "  ".repeat(std::cmp::max(0, block.indent) as usize);
        let text = block.text.trim_end();
        let spacer = if text.is_empty() { "" } else { " " };
        lines.push(format!("{indent}- {text}{spacer}^{}", block.uid));
    }
    format!("{}\n", lines.join("\n"))
}

#[tauri::command]
fn list_plugins_command() -> Result<Vec<PluginPermissionInfo>, String> {
    let vault_path = resolve_active_vault_path()?;
    let registry = plugin_registry_for_vault(&vault_path);
    let db = open_active_database()?;
    let plugins = list_plugins(&vault_path, &registry).map_err(|err| format!("{:?}", err))?;
    list_permissions_for_plugins(&db, plugins)
}

#[tauri::command]
fn load_plugins_command(state: tauri::State<RuntimeState>) -> Result<PluginRuntimeStatus, String> {
    let vault_path = resolve_active_vault_path()?;
    let registry = plugin_registry_for_vault(&vault_path);
    let db = open_active_database()?;
    let plugins = discover_plugins(&vault_path, &registry).map_err(|err| format!("{:?}", err))?;

    let mut allowed: Vec<PluginDescriptor> = Vec::new();
    let mut blocked: Vec<PluginBlockInfo> = Vec::new();

    for plugin in plugins {
        if !plugin.enabled {
            blocked.push(PluginBlockInfo {
                id: plugin.manifest.id,
                reason: "disabled".to_string(),
                missing_permissions: Vec::new(),
            });
            continue;
        }

        let granted = db
            .list_plugin_permissions(&plugin.manifest.id)
            .map_err(|err| format!("{:?}", err))?;
        let missing = compute_missing_permissions(&plugin.manifest.permissions, &granted);
        if missing.is_empty() {
            allowed.push(plugin);
        } else {
            blocked.push(PluginBlockInfo {
                id: plugin.manifest.id,
                reason: "missing-permissions".to_string(),
                missing_permissions: missing,
            });
        }
    }

    let loaded = if allowed.is_empty() {
        PluginRuntimeLoadResult {
            loaded: Vec::new(),
            commands: Vec::new(),
            panels: Vec::new(),
            toolbar_actions: Vec::new(),
            renderers: Vec::new(),
        }
    } else {
        state.with_runtime(|runtime| runtime.load_plugins(&allowed))?
    };

    Ok(PluginRuntimeStatus {
        loaded: loaded.loaded,
        blocked,
        commands: loaded.commands,
        panels: loaded.panels,
        toolbar_actions: loaded.toolbar_actions,
        renderers: loaded.renderers,
    })
}

#[tauri::command]
fn grant_plugin_permission(plugin_id: String, permission: String) -> Result<(), String> {
    let db = open_active_database()?;
    db.grant_plugin_permission(&plugin_id, &permission)
        .map_err(|err| format!("{:?}", err))
}

#[tauri::command]
fn revoke_plugin_permission(plugin_id: String, permission: String) -> Result<(), String> {
    let db = open_active_database()?;
    db.revoke_plugin_permission(&plugin_id, &permission)
        .map_err(|err| format!("{:?}", err))
}

#[tauri::command]
fn plugin_read_page(plugin_id: String, page_uid: String) -> Result<PageBlocksResponse, String> {
    let db = open_active_database()?;
    ensure_plugin_permission(&db, &plugin_id, "data.read")?;
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
fn plugin_write_page(
    plugin_id: String,
    page_uid: String,
    blocks: Vec<BlockSnapshot>,
) -> Result<(), String> {
    let mut db = open_active_database()?;
    ensure_plugin_permission(&db, &plugin_id, "data.write")?;
    let page_id = ensure_page(&db, &page_uid, "Inbox")?;
    db.replace_blocks_for_page(page_id, &blocks)
        .map_err(|err| format!("{:?}", err))
}

#[tauri::command]
fn emit_plugin_event(
    plugin_id: String,
    event: String,
    payload: Value,
    state: tauri::State<RuntimeState>,
) -> Result<Value, String> {
    state.with_runtime(|runtime| runtime.emit_event(&plugin_id, &event, payload))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(RuntimeState::new(runtime_script_path()))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            list_vaults,
            create_vault,
            set_active_vault,
            search_blocks,
            load_page_blocks,
            save_page_blocks,
            write_shadow_markdown,
            export_markdown,
            list_plugins_command,
            load_plugins_command,
            grant_plugin_permission,
            revoke_plugin_permission,
            plugin_read_page,
            plugin_write_page,
            emit_plugin_event
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{
        compute_missing_permissions, ensure_plugin_permission, list_permissions_for_plugins,
        build_markdown_export, sanitize_kebab, shadow_markdown_path, write_shadow_markdown_to_vault,
        BlockSnapshot, Database, PageBlocksResponse, PluginInfo,
    };
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

    #[test]
    fn shadow_markdown_matches_db_state() {
        let dir = tempdir().expect("tempdir");
        let mut db = Database::new_in_memory().expect("db init");
        db.run_migrations().expect("migrations");

        let page_id = db
            .insert_page("page-uid", "Inbox")
            .expect("insert page");
        let blocks = vec![
            BlockSnapshot {
                uid: "block-1".to_string(),
                text: "First line".to_string(),
                indent: 0,
            },
            BlockSnapshot {
                uid: "block-2".to_string(),
                text: "Child line".to_string(),
                indent: 1,
            },
        ];
        db.replace_blocks_for_page(page_id, &blocks)
            .expect("replace blocks");

        let loaded = db
            .load_blocks_for_page(page_id)
            .expect("load blocks");
        let payload = PageBlocksResponse {
            page_uid: "page-uid".to_string(),
            title: "Inbox".to_string(),
            blocks: loaded,
        };
        let markdown = build_markdown_export(&payload);
        let path =
            write_shadow_markdown_to_vault(dir.path(), &payload.page_uid, &markdown)
                .expect("write shadow");
        let saved = std::fs::read_to_string(&path).expect("read shadow");
        assert_eq!(saved, markdown);

        let updated_blocks = vec![
            BlockSnapshot {
                uid: "block-1".to_string(),
                text: "First line updated".to_string(),
                indent: 0,
            },
            BlockSnapshot {
                uid: "block-2".to_string(),
                text: "Child line".to_string(),
                indent: 2,
            },
        ];
        db.replace_blocks_for_page(page_id, &updated_blocks)
            .expect("replace updated");
        let updated = db
            .load_blocks_for_page(page_id)
            .expect("load updated");
        let updated_payload = PageBlocksResponse {
            page_uid: "page-uid".to_string(),
            title: "Inbox".to_string(),
            blocks: updated,
        };
        let updated_markdown = build_markdown_export(&updated_payload);
        write_shadow_markdown_to_vault(
            dir.path(),
            &updated_payload.page_uid,
            &updated_markdown,
        )
        .expect("write updated");
        let saved_updated = std::fs::read_to_string(&path).expect("read updated");
        assert_eq!(saved_updated, updated_markdown);
        assert_ne!(saved_updated, markdown);
    }

    #[test]
    fn compute_missing_permissions_respects_required_order() {
        let required = vec!["fs".to_string(), "network".to_string(), "ui".to_string()];
        let granted = vec!["fs".to_string(), "ui".to_string()];
        let missing = compute_missing_permissions(&required, &granted);
        assert_eq!(missing, vec!["network".to_string()]);
    }

    #[test]
    fn list_permissions_for_plugins_returns_grants() {
        let db = Database::new_in_memory().expect("db init");
        db.run_migrations().expect("migrations");

        db.grant_plugin_permission("alpha", "fs")
            .expect("grant fs");

        let plugins = vec![PluginInfo {
            id: "alpha".to_string(),
            name: "Alpha".to_string(),
            version: "0.1.0".to_string(),
            description: None,
            permissions: vec!["fs".to_string(), "network".to_string()],
            enabled: true,
            path: "/tmp/alpha".to_string(),
        }];

        let result = list_permissions_for_plugins(&db, plugins).expect("list permissions");
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].granted_permissions, vec!["fs".to_string()]);
        assert_eq!(result[0].missing_permissions, vec!["network".to_string()]);
    }

    #[test]
    fn ensure_plugin_permission_requires_grant() {
        let db = Database::new_in_memory().expect("db init");
        db.run_migrations().expect("migrations");

        let denied = ensure_plugin_permission(&db, "alpha", "data.read");
        assert!(denied.is_err());

        db.grant_plugin_permission("alpha", "data.read")
            .expect("grant permission");
        let allowed = ensure_plugin_permission(&db, "alpha", "data.read");
        assert!(allowed.is_ok());
    }

    #[test]
    fn build_markdown_export_serializes_blocks() {
        let page = PageBlocksResponse {
            page_uid: "page-1".to_string(),
            title: "Inbox".to_string(),
            blocks: vec![
                BlockSnapshot {
                    uid: "b1".to_string(),
                    text: "First".to_string(),
                    indent: 0,
                },
                BlockSnapshot {
                    uid: "b2".to_string(),
                    text: "Child".to_string(),
                    indent: 1,
                },
            ],
        };

        let markdown = build_markdown_export(&page);
        assert!(markdown.contains("# Inbox ^page-1"));
        assert!(markdown.contains("- First ^b1"));
        assert!(markdown.contains("  - Child ^b2"));
    }

    #[test]
    fn build_sync_ops_emits_add_edit_move_delete() {
        let previous = vec![
            BlockSnapshot {
                uid: "b1".to_string(),
                text: "First".to_string(),
                indent: 0,
            },
            BlockSnapshot {
                uid: "b2".to_string(),
                text: "Second".to_string(),
                indent: 0,
            },
        ];
        let next = vec![
            BlockSnapshot {
                uid: "b1".to_string(),
                text: "First updated".to_string(),
                indent: 1,
            },
            BlockSnapshot {
                uid: "b3".to_string(),
                text: "Third".to_string(),
                indent: 0,
            },
        ];

        let (ops, next_clock) =
            build_sync_ops("page-1", "device-1", &previous, &next, 10)
                .expect("build ops");
        assert_eq!(ops.len(), 4);
        assert_eq!(next_clock, 14);

        let mut kinds = std::collections::HashSet::new();
        let mut blocks_by_kind = std::collections::HashMap::new();
        for op in ops {
            kinds.insert(op.op_type.clone());
            let payload: Value =
                serde_json::from_slice(&op.payload).expect("payload json");
            assert_eq!(payload["pageId"], "page-1");
            assert_eq!(payload["deviceId"], "device-1");
            let kind = payload["kind"].as_str().expect("kind");
            let block_id = payload["blockId"].as_str().expect("block id");
            blocks_by_kind.insert(kind.to_string(), block_id.to_string());
            assert!(payload["clock"].as_i64().unwrap_or(0) > 10);
        }

        assert!(kinds.contains("add"));
        assert!(kinds.contains("edit"));
        assert!(kinds.contains("move"));
        assert!(kinds.contains("delete"));
        assert_eq!(blocks_by_kind.get("add").map(String::as_str), Some("b3"));
        assert_eq!(blocks_by_kind.get("delete").map(String::as_str), Some("b2"));
    }
}
