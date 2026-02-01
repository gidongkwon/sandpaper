// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
pub mod assets;
pub mod db;
pub mod plugins;
pub mod vaults;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use aes_gcm::aead::{Aead, KeyInit};
use base64::Engine;
use rand_core::RngCore;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{mpsc, Arc, Mutex};
use vaults::{VaultConfig, VaultRecord, VaultStore};
use db::{BlockPageRecord, BlockSearchResult, BlockSnapshot, Database};
use plugins::{
    discover_plugins, list_plugins, PluginBlockView, PluginCommand, PluginDescriptor, PluginInfo,
    PluginPanel, PluginRegistry, PluginRenderer, PluginRuntime, PluginRuntimeLoadResult,
    PluginToolbarAction,
};

#[derive(Debug, Serialize)]
struct PageBlocksResponse {
    page_uid: String,
    title: String,
    blocks: Vec<BlockSnapshot>,
}

#[derive(Debug, Serialize)]
struct PageBacklinkEntry {
    block_uid: String,
    text: String,
    page_uid: String,
    page_title: String,
}

#[derive(Debug, Serialize)]
struct PageSummary {
    uid: String,
    title: String,
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
struct SyncConfig {
    server_url: Option<String>,
    vault_id: Option<String>,
    device_id: Option<String>,
    key_fingerprint: Option<String>,
    last_push_cursor: i64,
    last_pull_cursor: i64,
}

#[derive(Debug, Serialize, Deserialize)]
struct SyncOpEnvelope {
    cursor: i64,
    op_id: String,
    payload: String,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncEnvelope {
    version: Option<i64>,
    algo: Option<String>,
    iv_b64: String,
    ciphertext_b64: String,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncOpPayload {
    op_id: String,
    page_id: String,
    block_id: String,
    device_id: String,
    clock: i64,
    timestamp: i64,
    kind: String,
    text: Option<String>,
    sort_key: Option<String>,
    indent: Option<i64>,
    parent_id: Option<String>,
}

#[derive(Debug, Serialize)]
struct SyncConflict {
    op_id: String,
    page_uid: String,
    block_uid: String,
    local_text: String,
    remote_text: String,
}

#[derive(Debug, Serialize)]
struct SyncApplyResult {
    pages: Vec<String>,
    applied: i64,
    conflicts: Vec<SyncConflict>,
}

#[derive(Debug, Serialize)]
struct ReviewQueueSummary {
    due_count: i64,
    next_due_at: Option<i64>,
}

#[derive(Debug, Serialize)]
struct ReviewQueueItemResponse {
    id: i64,
    page_uid: String,
    block_uid: String,
    added_at: i64,
    due_at: i64,
    template: Option<String>,
    status: String,
    last_reviewed_at: Option<i64>,
    text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReviewActionPayload {
    id: i64,
    action: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReviewTemplatePayload {
    page_uid: String,
    template: String,
    title: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatePagePayload {
    title: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenamePagePayload {
    page_uid: String,
    title: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PageTitlePayload {
    page_uid: String,
    title: String,
}

#[derive(Debug, Clone)]
struct BlockState {
    id: String,
    text: String,
    sort_key: String,
    indent: i64,
    deleted: bool,
}

#[derive(Debug, Serialize)]
struct VaultKeyStatus {
    configured: bool,
    kdf: Option<String>,
    iterations: Option<i64>,
    salt_b64: Option<String>,
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

enum PluginRuntimeRequest {
    LoadPlugins {
        plugins: Vec<PluginDescriptor>,
        settings: HashMap<String, Value>,
        reply: mpsc::Sender<Result<PluginRuntimeLoadResult, plugins::PluginError>>,
    },
    RenderBlock {
        plugin_id: String,
        renderer_id: String,
        block_uid: String,
        text: String,
        reply: mpsc::Sender<Result<PluginBlockView, plugins::PluginError>>,
    },
    BlockAction {
        plugin_id: String,
        renderer_id: String,
        block_uid: String,
        text: String,
        action_id: String,
        value: Option<Value>,
        reply: mpsc::Sender<Result<PluginBlockView, plugins::PluginError>>,
    },
    EmitEvent {
        plugin_id: String,
        event: String,
        payload: Value,
        reply: mpsc::Sender<Result<Value, plugins::PluginError>>,
    },
    Shutdown,
}

fn set_shared_error(target: &Arc<Mutex<Option<String>>>, message: String) {
    let mut guard = target.lock().unwrap_or_else(|err| err.into_inner());
    *guard = Some(message);
}

fn panic_message(payload: Box<dyn std::any::Any + Send>) -> String {
    if let Some(text) = payload.downcast_ref::<&str>() {
        text.to_string()
    } else if let Some(text) = payload.downcast_ref::<String>() {
        text.clone()
    } else {
        "unknown panic".to_string()
    }
}

struct RuntimeState {
    sender: mpsc::Sender<PluginRuntimeRequest>,
    thread: Mutex<Option<std::thread::JoinHandle<()>>>,
    last_error: Arc<Mutex<Option<String>>>,
}

impl RuntimeState {
    fn new() -> Self {
        let (sender, receiver) = mpsc::channel::<PluginRuntimeRequest>();
        let last_error = Arc::new(Mutex::new(None));
        let thread_errors = Arc::clone(&last_error);
        let handle = std::thread::spawn(move || {
            enum ThreadControl {
                Continue,
                Shutdown,
            }
            let mut runtime: Option<PluginRuntime> = None;
            loop {
                let request = match receiver.recv() {
                    Ok(request) => request,
                    Err(_) => break,
                };
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    match request {
                        PluginRuntimeRequest::LoadPlugins {
                            plugins,
                            settings,
                            reply,
                        } => {
                            let result = Self::with_runtime(&mut runtime, |runtime| {
                                runtime.load_plugins(&plugins, settings)
                            });
                            let _ = reply.send(result);
                            ThreadControl::Continue
                        }
                        PluginRuntimeRequest::RenderBlock {
                            plugin_id,
                            renderer_id,
                            block_uid,
                            text,
                            reply,
                        } => {
                            let result = Self::with_runtime(&mut runtime, |runtime| {
                                runtime.render_block(&plugin_id, &renderer_id, &block_uid, &text)
                            });
                            let _ = reply.send(result);
                            ThreadControl::Continue
                        }
                        PluginRuntimeRequest::BlockAction {
                            plugin_id,
                            renderer_id,
                            block_uid,
                            text,
                            action_id,
                            value,
                            reply,
                        } => {
                            let result = Self::with_runtime(&mut runtime, |runtime| {
                                runtime.handle_block_action(
                                    &plugin_id,
                                    &renderer_id,
                                    &block_uid,
                                    &text,
                                    &action_id,
                                    value,
                                )
                            });
                            let _ = reply.send(result);
                            ThreadControl::Continue
                        }
                        PluginRuntimeRequest::EmitEvent {
                            plugin_id,
                            event,
                            payload,
                            reply,
                        } => {
                            let result = Self::with_runtime(&mut runtime, |runtime| {
                                runtime.emit_event(&plugin_id, &event, payload)
                            });
                            let _ = reply.send(result);
                            ThreadControl::Continue
                        }
                        PluginRuntimeRequest::Shutdown => ThreadControl::Shutdown,
                    }
                }));

                match result {
                    Ok(ThreadControl::Continue) => {}
                    Ok(ThreadControl::Shutdown) => break,
                    Err(panic) => {
                        set_shared_error(
                            &thread_errors,
                            format!("runtime-panicked: {}", panic_message(panic)),
                        );
                        break;
                    }
                }
            }
        });
        Self {
            sender,
            thread: Mutex::new(Some(handle)),
            last_error,
        }
    }

    fn shutdown(&self) {
        let mut handle = self.thread.lock().unwrap_or_else(|err| err.into_inner());
        if handle.is_none() {
            return;
        }
        let _ = self.sender.send(PluginRuntimeRequest::Shutdown);
        if let Some(handle) = handle.take() {
            let _ = handle.join();
        }
    }

    fn record_error(&self, message: String) {
        let mut guard = self.last_error.lock().unwrap_or_else(|err| err.into_inner());
        *guard = Some(message);
    }

    fn clear_error(&self) {
        let mut guard = self.last_error.lock().unwrap_or_else(|err| err.into_inner());
        *guard = None;
    }

    fn last_error(&self) -> Option<String> {
        let guard = self.last_error.lock().unwrap_or_else(|err| err.into_inner());
        guard.clone()
    }

    fn runtime_error(&self, code: &str) -> String {
        match self.last_error() {
            Some(last_error) => format!("{code}: {last_error}"),
            None => code.to_string(),
        }
    }

    fn describe_plugin_error(err: &plugins::PluginError) -> String {
        match err {
            plugins::PluginError::Io(inner) => format!("plugin-error: io: {inner}"),
            plugins::PluginError::Serde(inner) => format!("plugin-error: serde: {inner}"),
            plugins::PluginError::Runtime(inner) => format!("plugin-error: {inner}"),
        }
    }

    fn request<T>(
        &self,
        request: PluginRuntimeRequest,
        recv: mpsc::Receiver<Result<T, plugins::PluginError>>,
    ) -> Result<T, String> {
        self.sender
            .send(request)
            .map_err(|_| self.runtime_error("runtime-unavailable"))?;
        let result = recv
            .recv()
            .map_err(|_| self.runtime_error("runtime-disconnected"))?;
        match result {
            Ok(value) => {
                self.clear_error();
                Ok(value)
            }
            Err(err) => {
                let message = Self::describe_plugin_error(&err);
                self.record_error(message.clone());
                Err(message)
            }
        }
    }

    fn with_runtime<F, R>(
        runtime: &mut Option<PluginRuntime>,
        f: F,
    ) -> Result<R, plugins::PluginError>
    where
        F: FnOnce(&mut PluginRuntime) -> Result<R, plugins::PluginError>,
    {
        if runtime.is_none() {
            *runtime = Some(PluginRuntime::new()?);
        }
        match runtime.as_mut() {
            Some(runtime) => f(runtime),
            None => Err(plugins::PluginError::Runtime("runtime-unavailable".to_string())),
        }
    }

    fn load_plugins(
        &self,
        plugins: Vec<PluginDescriptor>,
        settings: HashMap<String, Value>,
    ) -> Result<PluginRuntimeLoadResult, String> {
        let (reply, recv) = mpsc::channel();
        self.request(
            PluginRuntimeRequest::LoadPlugins {
                plugins,
                settings,
                reply,
            },
            recv,
        )
    }

    fn render_block(
        &self,
        plugin_id: String,
        renderer_id: String,
        block_uid: String,
        text: String,
    ) -> Result<PluginBlockView, String> {
        let (reply, recv) = mpsc::channel();
        self.request(
            PluginRuntimeRequest::RenderBlock {
                plugin_id,
                renderer_id,
                block_uid,
                text,
                reply,
            },
            recv,
        )
    }

    fn handle_block_action(
        &self,
        plugin_id: String,
        renderer_id: String,
        block_uid: String,
        text: String,
        action_id: String,
        value: Option<Value>,
    ) -> Result<PluginBlockView, String> {
        let (reply, recv) = mpsc::channel();
        self.request(
            PluginRuntimeRequest::BlockAction {
                plugin_id,
                renderer_id,
                block_uid,
                text,
                action_id,
                value,
                reply,
            },
            recv,
        )
    }

    fn emit_event(
        &self,
        plugin_id: String,
        event: String,
        payload: Value,
    ) -> Result<Value, String> {
        let (reply, recv) = mpsc::channel();
        self.request(
            PluginRuntimeRequest::EmitEvent {
                plugin_id,
                event,
                payload,
                reply,
            },
            recv,
        )
    }
}

impl Drop for RuntimeState {
    fn drop(&mut self) {
        self.shutdown();
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
    backup_before_migration(&vault_path, &db_path, &db)?;
    db.run_migrations().map_err(|err| format!("{:?}", err))?;
    Ok(db)
}

fn backup_before_migration(
    vault_path: &std::path::Path,
    db_path: &std::path::Path,
    db: &Database,
) -> Result<Option<PathBuf>, String> {
    backup_before_migration_at(vault_path, db_path, db, chrono::Utc::now())
}

fn backup_before_migration_at(
    vault_path: &std::path::Path,
    db_path: &std::path::Path,
    db: &Database,
    now: chrono::DateTime<chrono::Utc>,
) -> Result<Option<PathBuf>, String> {
    let current_version = db
        .current_schema_version()
        .map_err(|err| format!("{:?}", err))?;
    let latest_version = Database::latest_migration_version();
    if current_version >= latest_version {
        return Ok(None);
    }

    let backup_dir = vault_path.join("backups");
    std::fs::create_dir_all(&backup_dir).map_err(|err| format!("{:?}", err))?;
    let stamp = now.format("%Y%m%d%H%M%S").to_string();
    let backup_path = backup_dir.join(format!("sandpaper-{stamp}.db"));
    std::fs::copy(db_path, &backup_path).map_err(|err| format!("{:?}", err))?;
    rotate_backups(&backup_dir)?;
    Ok(Some(backup_path))
}

fn rotate_backups(backup_dir: &std::path::Path) -> Result<(), String> {
    let mut backups: Vec<PathBuf> = std::fs::read_dir(backup_dir)
        .map_err(|err| format!("{:?}", err))?
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

    if backups.len() <= 3 {
        return Ok(());
    }

    for path in backups.iter().take(backups.len() - 3) {
        std::fs::remove_file(path).map_err(|err| format!("{:?}", err))?;
    }
    Ok(())
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

fn normalize_wiki_target(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let before_alias = trimmed.split('|').next().unwrap_or(trimmed);
    let before_heading = before_alias.split('#').next().unwrap_or(before_alias);
    let title = before_heading.trim();
    if title.is_empty() {
        None
    } else {
        Some(title.to_string())
    }
}

fn extract_wikilinks(text: &str) -> Vec<String> {
    let mut links = Vec::new();
    let mut index = 0;
    while let Some(open) = text[index..].find("[[") {
        let start = index + open + 2;
        let remainder = &text[start..];
        let close = match remainder.find("]]") {
            Some(value) => value,
            None => break,
        };
        let raw = &remainder[..close];
        if let Some(target) = normalize_wiki_target(raw) {
            if !links.contains(&target) {
                links.push(target);
            }
        }
        index = start + close + 2;
    }
    links
}

fn fallback_page_title(page_uid: &str) -> &str {
    if page_uid == "inbox" {
        "Inbox"
    } else {
        "Untitled"
    }
}

fn resolve_unique_page_uid(db: &Database, base_uid: &str) -> Result<String, String> {
    let base = sanitize_kebab(base_uid);
    let mut candidate = base.clone();
    let mut counter = 2;
    while db
        .get_page_by_uid(&candidate)
        .map_err(|err| format!("{:?}", err))?
        .is_some()
    {
        candidate = format!("{}-{}", base, counter);
        counter += 1;
    }
    Ok(candidate)
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

fn get_vault_key_b64(db: &Database) -> Result<Option<String>, String> {
    db.get_kv("vault.key.b64")
        .map_err(|err| format!("{:?}", err))
}

fn encrypt_sync_payload(key_b64: &str, payload: &[u8]) -> Result<Vec<u8>, String> {
    let key_bytes = base64::engine::general_purpose::STANDARD
        .decode(key_b64)
        .map_err(|err| format!("{:?}", err))?;
    let key = aes_gcm::Key::<aes_gcm::Aes256Gcm>::from_slice(&key_bytes);
    let cipher = aes_gcm::Aes256Gcm::new(key);
    let mut iv = [0u8; 12];
    rand_core::OsRng.fill_bytes(&mut iv);
    let nonce = aes_gcm::Nonce::from_slice(&iv);
    let ciphertext = cipher
        .encrypt(nonce, payload)
        .map_err(|err| format!("{:?}", err))?;

    let envelope = serde_json::json!({
        "version": 1,
        "algo": "aes-256-gcm",
        "ivB64": base64::engine::general_purpose::STANDARD.encode(iv),
        "ciphertextB64": base64::engine::general_purpose::STANDARD.encode(ciphertext)
    });

    serde_json::to_vec(&envelope).map_err(|err| format!("{:?}", err))
}

fn decrypt_sync_payload(key_b64: &str, payload: &[u8]) -> Result<Vec<u8>, String> {
    let envelope: SyncEnvelope =
        serde_json::from_slice(payload).map_err(|err| format!("{:?}", err))?;
    if let Some(algo) = &envelope.algo {
        if algo != "aes-256-gcm" {
            return Err("sync-unsupported-algo".to_string());
        }
    }
    let key_bytes = base64::engine::general_purpose::STANDARD
        .decode(key_b64)
        .map_err(|err| format!("{:?}", err))?;
    let iv = base64::engine::general_purpose::STANDARD
        .decode(envelope.iv_b64)
        .map_err(|err| format!("{:?}", err))?;
    let ciphertext = base64::engine::general_purpose::STANDARD
        .decode(envelope.ciphertext_b64)
        .map_err(|err| format!("{:?}", err))?;

    if iv.len() != 12 {
        return Err("sync-invalid-iv".to_string());
    }

    let key = aes_gcm::Key::<aes_gcm::Aes256Gcm>::from_slice(&key_bytes);
    let cipher = aes_gcm::Aes256Gcm::new(key);
    let nonce = aes_gcm::Nonce::from_slice(&iv);
    cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|_| "sync-decrypt-failed".to_string())
}

fn encrypt_plugin_settings(key_b64: &str, settings: &Value) -> Result<String, String> {
    let payload =
        serde_json::to_vec(settings).map_err(|err| format!("{:?}", err))?;
    let encrypted = encrypt_sync_payload(key_b64, &payload)?;
    String::from_utf8(encrypted).map_err(|err| format!("{:?}", err))
}

fn decrypt_plugin_settings(key_b64: &str, payload: &str) -> Result<Value, String> {
    let decrypted = decrypt_sync_payload(key_b64, payload.as_bytes())?;
    serde_json::from_slice(&decrypted).map_err(|err| format!("{:?}", err))
}

fn plugin_settings_key(plugin_id: &str) -> String {
    format!("plugin.settings.{plugin_id}")
}

fn set_plugin_settings(
    db: &Database,
    plugin_id: &str,
    settings: &Value,
) -> Result<(), String> {
    let key = get_vault_key_b64(db)?
        .ok_or_else(|| "vault-key-missing".to_string())?;
    let encrypted = encrypt_plugin_settings(&key, settings)?;
    db.set_kv(&plugin_settings_key(plugin_id), &encrypted)
        .map_err(|err| format!("{:?}", err))
}

fn get_plugin_settings(
    db: &Database,
    plugin_id: &str,
) -> Result<Option<Value>, String> {
    let stored = db
        .get_kv(&plugin_settings_key(plugin_id))
        .map_err(|err| format!("{:?}", err))?;
    let Some(stored) = stored else {
        return Ok(None);
    };
    let key = get_vault_key_b64(db)?
        .ok_or_else(|| "vault-key-missing".to_string())?;
    let decrypted = decrypt_plugin_settings(&key, &stored)?;
    Ok(Some(decrypted))
}

fn decode_sync_payload(db: &Database, payload: &[u8]) -> Result<Vec<u8>, String> {
    let value: serde_json::Value = match serde_json::from_slice(payload) {
        Ok(value) => value,
        Err(_) => return Ok(payload.to_vec()),
    };
    if value.get("ciphertextB64").is_none() {
        return Ok(payload.to_vec());
    }
    let key = get_vault_key_b64(db)?
        .ok_or_else(|| "vault-key-missing".to_string())?;
    decrypt_sync_payload(&key, payload)
}

fn sort_sync_ops(ops: &mut Vec<SyncOpPayload>) {
    ops.sort_by(|a, b| {
        if a.clock != b.clock {
            return a.clock.cmp(&b.clock);
        }
        a.op_id.cmp(&b.op_id)
    });
}

fn apply_sync_ops_to_blocks(
    blocks: &[BlockSnapshot],
    mut ops: Vec<SyncOpPayload>,
) -> Vec<BlockSnapshot> {
    let mut state = std::collections::HashMap::new();
    for (index, block) in blocks.iter().enumerate() {
        state.insert(
            block.uid.clone(),
            BlockState {
                id: block.uid.clone(),
                text: block.text.clone(),
                sort_key: format!("{:06}", index),
                indent: block.indent,
                deleted: false,
            },
        );
    }

    sort_sync_ops(&mut ops);
    let mut seen = std::collections::HashSet::new();

    for op in ops {
        if !seen.insert(op.op_id.clone()) {
            continue;
        }
        let entry = state.get(&op.block_id).cloned();
        match op.kind.as_str() {
            "add" => {
                if let Some(existing) = &entry {
                    if !existing.deleted {
                        continue;
                    }
                }
                if let (Some(text), Some(sort_key), Some(indent)) =
                    (op.text, op.sort_key, op.indent)
                {
                    state.insert(
                        op.block_id.clone(),
                        BlockState {
                            id: op.block_id,
                            text,
                            sort_key,
                            indent,
                            deleted: false,
                        },
                    );
                }
            }
            "edit" => {
                if let Some(mut existing) = entry {
                    if existing.deleted {
                        continue;
                    }
                    if let Some(text) = op.text {
                        existing.text = text;
                        state.insert(op.block_id, existing);
                    }
                }
            }
            "move" => {
                if let Some(mut existing) = entry {
                    if existing.deleted {
                        continue;
                    }
                    if let Some(sort_key) = op.sort_key {
                        existing.sort_key = sort_key;
                    }
                    if let Some(indent) = op.indent {
                        existing.indent = indent;
                    }
                    state.insert(op.block_id, existing);
                }
            }
            "delete" => {
                if let Some(mut existing) = entry {
                    existing.deleted = true;
                    state.insert(op.block_id, existing);
                }
            }
            _ => {}
        }
    }

    let mut blocks: Vec<BlockState> = state
        .into_values()
        .filter(|block| !block.deleted)
        .collect();
    blocks.sort_by(|a, b| {
        let order = a.sort_key.cmp(&b.sort_key);
        if order == std::cmp::Ordering::Equal {
            return a.id.cmp(&b.id);
        }
        order
    });
    blocks
        .into_iter()
        .map(|block| BlockSnapshot {
            uid: block.id,
            text: block.text,
            indent: block.indent,
        })
        .collect()
}

fn detect_sync_conflicts(
    blocks: &[BlockSnapshot],
    ops: &[SyncOpPayload],
) -> Vec<SyncConflict> {
    let mut by_id = std::collections::HashMap::new();
    for block in blocks.iter() {
        by_id.insert(block.uid.clone(), block.text.clone());
    }
    let mut conflicts = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for op in ops.iter() {
        if op.kind != "edit" {
            continue;
        }
        let Some(remote_text) = op.text.as_ref() else { continue };
        let Some(local_text) = by_id.get(&op.block_id) else { continue };
        if local_text == remote_text {
            continue;
        }
        if !seen.insert(op.block_id.clone()) {
            continue;
        }
        conflicts.push(SyncConflict {
            op_id: op.op_id.clone(),
            page_uid: op.page_id.clone(),
            block_uid: op.block_id.clone(),
            local_text: local_text.clone(),
            remote_text: remote_text.clone(),
        });
    }
    conflicts
}

fn next_review_due(interval_days: i64) -> i64 {
    let millis = interval_days * 24 * 60 * 60 * 1000;
    chrono::Utc::now().timestamp_millis() + millis
}

fn resolve_review_interval(action: &str, last_interval: i64) -> i64 {
    match action {
        "snooze" => 1,
        "later" => std::cmp::min(14, std::cmp::max(1, last_interval * 2)),
        "done" => 30,
        _ => std::cmp::min(7, std::cmp::max(1, last_interval)),
    }
}

fn load_sync_config(db: &Database) -> Result<SyncConfig, String> {
    let server_url = db.get_kv("sync.server_url").map_err(|err| format!("{:?}", err))?;
    let vault_id = db.get_kv("sync.vault_id").map_err(|err| format!("{:?}", err))?;
    let device_id = db.get_kv("sync.device_id").map_err(|err| format!("{:?}", err))?;
    let key_fingerprint =
        db.get_kv("sync.key_fingerprint").map_err(|err| format!("{:?}", err))?;
    let last_push_cursor = db
        .get_kv("sync.last_push_cursor")
        .map_err(|err| format!("{:?}", err))?
        .and_then(|raw| raw.parse::<i64>().ok())
        .unwrap_or(0);
    let last_pull_cursor = db
        .get_kv("sync.last_pull_cursor")
        .map_err(|err| format!("{:?}", err))?
        .and_then(|raw| raw.parse::<i64>().ok())
        .unwrap_or(0);

    Ok(SyncConfig {
        server_url,
        vault_id,
        device_id,
        key_fingerprint,
        last_push_cursor,
        last_pull_cursor,
    })
}

#[tauri::command]
fn set_vault_key(key_b64: String, salt_b64: String, iterations: i64) -> Result<(), String> {
    let db = open_active_database()?;
    db.set_kv("vault.key.b64", &key_b64)
        .map_err(|err| format!("{:?}", err))?;
    db.set_kv("vault.key.salt", &salt_b64)
        .map_err(|err| format!("{:?}", err))?;
    db.set_kv("vault.key.iterations", &iterations.to_string())
        .map_err(|err| format!("{:?}", err))?;
    db.set_kv("vault.key.kdf", "pbkdf2-sha256")
        .map_err(|err| format!("{:?}", err))?;
    Ok(())
}

#[tauri::command]
fn vault_key_status() -> Result<VaultKeyStatus, String> {
    let db = open_active_database()?;
    let key = db.get_kv("vault.key.b64").map_err(|err| format!("{:?}", err))?;
    if key.is_none() {
        return Ok(VaultKeyStatus {
            configured: false,
            kdf: None,
            iterations: None,
            salt_b64: None,
        });
    }
    let kdf = db.get_kv("vault.key.kdf").map_err(|err| format!("{:?}", err))?;
    let iterations = db
        .get_kv("vault.key.iterations")
        .map_err(|err| format!("{:?}", err))?
        .and_then(|raw| raw.parse::<i64>().ok());
    let salt_b64 = db.get_kv("vault.key.salt").map_err(|err| format!("{:?}", err))?;
    Ok(VaultKeyStatus {
        configured: true,
        kdf,
        iterations,
        salt_b64,
    })
}

#[tauri::command]
fn vault_key_fingerprint() -> Result<String, String> {
    let db = open_active_database()?;
    let key = db
        .get_kv("vault.key.b64")
        .map_err(|err| format!("{:?}", err))?
        .ok_or_else(|| "vault-key-missing".to_string())?;
    let key_bytes = base64::engine::general_purpose::STANDARD
        .decode(key)
        .map_err(|err| format!("{:?}", err))?;
    let mut hasher = Sha256::new();
    hasher.update(key_bytes);
    let digest = hasher.finalize();
    Ok(hex::encode(digest))
}

#[tauri::command]
fn get_sync_config() -> Result<SyncConfig, String> {
    let db = open_active_database()?;
    load_sync_config(&db)
}

#[tauri::command]
fn set_sync_config(
    server_url: String,
    vault_id: String,
    device_id: String,
    key_fingerprint: String,
) -> Result<SyncConfig, String> {
    let db = open_active_database()?;
    db.set_kv("sync.server_url", &server_url)
        .map_err(|err| format!("{:?}", err))?;
    db.set_kv("sync.vault_id", &vault_id)
        .map_err(|err| format!("{:?}", err))?;
    db.set_kv("sync.device_id", &device_id)
        .map_err(|err| format!("{:?}", err))?;
    db.set_kv("sync.key_fingerprint", &key_fingerprint)
        .map_err(|err| format!("{:?}", err))?;
    load_sync_config(&db)
}

#[tauri::command]
fn set_sync_cursors(
    last_push_cursor: Option<i64>,
    last_pull_cursor: Option<i64>,
) -> Result<SyncConfig, String> {
    let db = open_active_database()?;
    if let Some(cursor) = last_push_cursor {
        db.set_kv("sync.last_push_cursor", &cursor.to_string())
            .map_err(|err| format!("{:?}", err))?;
    }
    if let Some(cursor) = last_pull_cursor {
        db.set_kv("sync.last_pull_cursor", &cursor.to_string())
            .map_err(|err| format!("{:?}", err))?;
    }
    load_sync_config(&db)
}

#[tauri::command]
fn list_sync_ops_since(cursor: i64, limit: i64) -> Result<Vec<SyncOpEnvelope>, String> {
    let db = open_active_database()?;
    let ops = db
        .list_sync_ops_since(cursor, limit)
        .map_err(|err| format!("{:?}", err))?;
    ops.into_iter()
        .map(|op| {
            let payload = String::from_utf8(op.payload)
                .map_err(|_| "sync-op-payload-invalid".to_string())?;
            Ok(SyncOpEnvelope {
                cursor: op.id,
                op_id: op.op_id,
                payload,
            })
        })
        .collect()
}

#[tauri::command]
fn store_sync_inbox_ops(ops: Vec<SyncOpEnvelope>) -> Result<(), String> {
    let db = open_active_database()?;
    for op in ops {
        db.insert_sync_inbox_op(op.cursor, &op.op_id, op.payload.as_bytes())
            .map_err(|err| format!("{:?}", err))?;
    }
    Ok(())
}

#[tauri::command]
fn apply_sync_inbox() -> Result<SyncApplyResult, String> {
    let mut db = open_active_database()?;
    let inbox_ops = db
        .list_sync_inbox_ops(2000)
        .map_err(|err| format!("{:?}", err))?;
    if inbox_ops.is_empty() {
        return Ok(SyncApplyResult {
            pages: Vec::new(),
            applied: 0,
            conflicts: Vec::new(),
        });
    }

    let mut by_page: std::collections::HashMap<String, Vec<SyncOpPayload>> =
        std::collections::HashMap::new();
    for op in inbox_ops.iter() {
        let decoded = decode_sync_payload(&db, &op.payload)?;
        let payload: SyncOpPayload =
            serde_json::from_slice(&decoded).map_err(|err| format!("{:?}", err))?;
        by_page
            .entry(payload.page_id.clone())
            .or_default()
            .push(payload);
    }

    let mut pages = Vec::new();
    let mut conflicts = Vec::new();
    for (page_uid, ops) in by_page {
        let page_id = ensure_page(&db, &page_uid, &page_uid)?;
        let current = db
            .load_blocks_for_page(page_id)
            .map_err(|err| format!("{:?}", err))?;
        conflicts.extend(detect_sync_conflicts(&current, &ops));
        let next = apply_sync_ops_to_blocks(&current, ops);
        db.replace_blocks_for_page(page_id, &next)
            .map_err(|err| format!("{:?}", err))?;
        pages.push(page_uid);
    }

    db.clear_sync_inbox().map_err(|err| format!("{:?}", err))?;

    Ok(SyncApplyResult {
        pages,
        applied: inbox_ops.len() as i64,
        conflicts,
    })
}

#[tauri::command]
fn review_queue_summary() -> Result<ReviewQueueSummary, String> {
    let db = open_active_database()?;
    let now = chrono::Utc::now().timestamp_millis();
    let due = db
        .list_review_queue_due(now, 200)
        .map_err(|err| format!("{:?}", err))?;
    let next_due_at = due.iter().map(|item| item.due_at).min();
    Ok(ReviewQueueSummary {
        due_count: due.len() as i64,
        next_due_at,
    })
}

#[tauri::command]
fn add_review_queue_item(page_uid: String, block_uid: String, due_at: Option<i64>) -> Result<(), String> {
    let db = open_active_database()?;
    let due = due_at.unwrap_or_else(|| next_review_due(1));
    db.upsert_review_queue_item(&page_uid, &block_uid, due, None)
        .map_err(|err| format!("{:?}", err))?;
    Ok(())
}

#[tauri::command]
fn list_review_queue_due(limit: i64) -> Result<Vec<ReviewQueueItemResponse>, String> {
    let db = open_active_database()?;
    let now = chrono::Utc::now().timestamp_millis();
    let items = db
        .list_review_queue_due(now, limit)
        .map_err(|err| format!("{:?}", err))?;
    let mut responses = Vec::with_capacity(items.len());
    for item in items {
        let page_id = ensure_page(&db, &item.page_uid, &item.page_uid)?;
        let blocks = db
            .load_blocks_for_page(page_id)
            .map_err(|err| format!("{:?}", err))?;
        let text = blocks
            .iter()
            .find(|block| block.uid == item.block_uid)
            .map(|block| block.text.clone())
            .unwrap_or_else(|| "Missing block".to_string());
        responses.push(ReviewQueueItemResponse {
            id: item.id,
            page_uid: item.page_uid,
            block_uid: item.block_uid,
            added_at: item.added_at,
            due_at: item.due_at,
            template: item.template,
            status: item.status,
            last_reviewed_at: item.last_reviewed_at,
            text,
        });
    }
    Ok(responses)
}

#[tauri::command]
fn update_review_queue_item(payload: ReviewActionPayload) -> Result<(), String> {
    let db = open_active_database()?;
    let now = chrono::Utc::now().timestamp_millis();
    let interval = resolve_review_interval(&payload.action, 3);
    let next_due = if payload.action == "done" {
        None
    } else {
        Some(next_review_due(interval))
    };
    let status = if payload.action == "done" { "done" } else { "pending" };
    db.mark_review_queue_item(payload.id, status, now, next_due)
        .map_err(|err| format!("{:?}", err))?;
    Ok(())
}

#[tauri::command]
fn create_review_template(payload: ReviewTemplatePayload) -> Result<(), String> {
    let mut db = open_active_database()?;
    let page_uid = sanitize_kebab(&payload.page_uid);
    let page_id = ensure_page(&db, &page_uid, &payload.title)?;
    let blocks = vec![
        BlockSnapshot {
            uid: uuid::Uuid::new_v4().to_string(),
            text: "Summary".to_string(),
            indent: 0,
        },
        BlockSnapshot {
            uid: uuid::Uuid::new_v4().to_string(),
            text: "What moved forward?".to_string(),
            indent: 1,
        },
        BlockSnapshot {
            uid: uuid::Uuid::new_v4().to_string(),
            text: "Loose threads".to_string(),
            indent: 1,
        },
        BlockSnapshot {
            uid: uuid::Uuid::new_v4().to_string(),
            text: "Next steps".to_string(),
            indent: 1,
        },
    ];
    db.replace_blocks_for_page(page_id, &blocks)
        .map_err(|err| format!("{:?}", err))?;
    let due_at = next_review_due(1);
    db.upsert_review_queue_item(&page_uid, &blocks[0].uid, due_at, Some(&payload.template))
        .map_err(|err| format!("{:?}", err))?;
    Ok(())
}

#[tauri::command]
fn get_active_page() -> Result<Option<String>, String> {
    let db = open_active_database()?;
    db.get_kv("active.page")
        .map_err(|err| format!("{:?}", err))
}

#[tauri::command]
fn set_active_page(page_uid: String) -> Result<(), String> {
    let db = open_active_database()?;
    let normalized = sanitize_kebab(&page_uid);
    let title = fallback_page_title(&normalized);
    ensure_page(&db, &normalized, title)?;
    db.set_kv("active.page", &normalized)
        .map_err(|err| format!("{:?}", err))
}

#[tauri::command]
fn create_page(payload: CreatePagePayload) -> Result<PageSummary, String> {
    let title = payload.title.trim();
    if title.is_empty() {
        return Err("Title is required".to_string());
    }
    let db = open_active_database()?;
    let uid = resolve_unique_page_uid(&db, title)?;
    db.insert_page(&uid, title)
        .map_err(|err| format!("{:?}", err))?;
    Ok(PageSummary {
        uid,
        title: title.to_string(),
    })
}

#[tauri::command]
fn rename_page(payload: RenamePagePayload) -> Result<PageSummary, String> {
    let title = payload.title.trim();
    if title.is_empty() {
        return Err("Title is required".to_string());
    }
    let db = open_active_database()?;
    let page_uid = sanitize_kebab(&payload.page_uid);
    let page = db
        .get_page_by_uid(&page_uid)
        .map_err(|err| format!("{:?}", err))?
        .ok_or_else(|| "Page not found".to_string())?;
    db.update_page_title(page.id, title)
        .map_err(|err| format!("{:?}", err))?;
    Ok(PageSummary {
        uid: page_uid,
        title: title.to_string(),
    })
}

#[tauri::command]
fn list_pages() -> Result<Vec<PageSummary>, String> {
    let db = open_active_database()?;
    let pages = db
        .list_pages()
        .map_err(|err| format!("{:?}", err))?;
    Ok(pages
        .into_iter()
        .map(|page| PageSummary {
            uid: page.uid,
            title: page.title,
        })
        .collect())
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
    let title = fallback_page_title(&page_uid);
    let page_id = ensure_page(&db, &page_uid, title)?;
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
fn list_page_wikilink_backlinks(page_uid: String) -> Result<Vec<PageBacklinkEntry>, String> {
    let db = open_active_database()?;
    let target_uid = sanitize_kebab(&page_uid);
    let records = db
        .list_blocks_with_wikilinks()
        .map_err(|err| format!("{:?}", err))?;
    let mut results = Vec::new();
    for record in records {
        if link_matches_target(&record, &target_uid) {
            results.push(PageBacklinkEntry {
                block_uid: record.block_uid,
                text: record.text,
                page_uid: record.page_uid,
                page_title: record.page_title,
            });
        }
    }
    Ok(results)
}

fn link_matches_target(record: &BlockPageRecord, target_uid: &str) -> bool {
    for link in extract_wikilinks(&record.text) {
        if sanitize_kebab(&link) == target_uid {
            return true;
        }
    }
    false
}

#[tauri::command]
fn save_page_blocks(page_uid: String, blocks: Vec<BlockSnapshot>) -> Result<(), String> {
    let mut db = open_active_database()?;
    let title = fallback_page_title(&page_uid);
    let page_id = ensure_page(&db, &page_uid, title)?;
    let previous = db
        .load_blocks_for_page(page_id)
        .map_err(|err| format!("{:?}", err))?;
    let device_id = get_or_create_device_id(&db)?;
    let clock = load_device_clock(&db)?;
    let (ops, next_clock) = build_sync_ops(&page_uid, &device_id, &previous, &blocks, clock)?;
    let vault_key = get_vault_key_b64(&db)?;

    db.replace_blocks_for_page(page_id, &blocks)
        .map_err(|err| format!("{:?}", err))?;

    if !ops.is_empty() {
        for op in ops {
            if let Some(ref key) = vault_key {
                let encrypted = encrypt_sync_payload(key, &op.payload)?;
                db.insert_sync_op(page_id, &op.op_id, "sealed", "sealed", &encrypted)
                    .map_err(|err| format!("{:?}", err))?;
            } else {
                db.insert_sync_op(page_id, &op.op_id, &device_id, &op.op_type, &op.payload)
                    .map_err(|err| format!("{:?}", err))?;
            }
        }
        store_device_clock(&db, next_clock)?;
    }

    Ok(())
}

#[tauri::command]
fn set_page_title(payload: PageTitlePayload) -> Result<(), String> {
    let db = open_active_database()?;
    let page_uid = sanitize_kebab(&payload.page_uid);
    let page_id = ensure_page(&db, &page_uid, &payload.title)?;
    db.update_page_title(page_id, &payload.title)
        .map_err(|err| format!("{:?}", err))?;
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

    let mut settings_by_plugin: HashMap<String, Value> = HashMap::new();
    for plugin in &allowed {
        if let Ok(Some(settings)) = get_plugin_settings(&db, &plugin.manifest.id) {
            settings_by_plugin.insert(plugin.manifest.id.clone(), settings);
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
        state.load_plugins(allowed, settings_by_plugin)?
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
    let title = fallback_page_title(&page_uid);
    let page_id = ensure_page(&db, &page_uid, title)?;
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
    let title = fallback_page_title(&page_uid);
    let page_id = ensure_page(&db, &page_uid, title)?;
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
    state.emit_event(plugin_id, event, payload)
}

#[tauri::command]
fn plugin_render_block(
    plugin_id: String,
    renderer_id: String,
    block_uid: String,
    text: String,
    state: tauri::State<RuntimeState>,
) -> Result<PluginBlockView, String> {
    state.render_block(plugin_id, renderer_id, block_uid, text)
}

#[tauri::command]
fn plugin_block_action(
    plugin_id: String,
    renderer_id: String,
    block_uid: String,
    text: String,
    action_id: String,
    value: Option<Value>,
    state: tauri::State<RuntimeState>,
) -> Result<PluginBlockView, String> {
    state.handle_block_action(plugin_id, renderer_id, block_uid, text, action_id, value)
}

#[tauri::command]
fn get_plugin_settings_command(plugin_id: String) -> Result<Option<Value>, String> {
    let db = open_active_database()?;
    get_plugin_settings(&db, &plugin_id)
}

#[tauri::command]
fn set_plugin_settings_command(plugin_id: String, settings: Value) -> Result<(), String> {
    let db = open_active_database()?;
    set_plugin_settings(&db, &plugin_id, &settings)
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|err| format!("{:?}", err))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(RuntimeState::new())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            list_vaults,
            create_vault,
            set_active_vault,
            get_active_page,
            set_active_page,
            create_page,
            rename_page,
            list_pages,
            search_blocks,
            load_page_blocks,
            list_page_wikilink_backlinks,
            save_page_blocks,
            set_page_title,
            set_vault_key,
            vault_key_status,
            vault_key_fingerprint,
            get_sync_config,
            set_sync_config,
            set_sync_cursors,
            list_sync_ops_since,
            store_sync_inbox_ops,
            apply_sync_inbox,
            review_queue_summary,
            add_review_queue_item,
            list_review_queue_due,
            update_review_queue_item,
            create_review_template,
            write_shadow_markdown,
            export_markdown,
            list_plugins_command,
            load_plugins_command,
            grant_plugin_permission,
            revoke_plugin_permission,
            plugin_read_page,
            plugin_write_page,
            emit_plugin_event,
            plugin_render_block,
            plugin_block_action,
            get_plugin_settings_command,
            set_plugin_settings_command,
            read_text_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{
        apply_sync_ops_to_blocks, backup_before_migration_at, build_markdown_export, build_sync_ops,
        compute_missing_permissions, detect_sync_conflicts, encrypt_sync_payload,
        ensure_plugin_permission, get_plugin_settings, list_permissions_for_plugins,
        load_sync_config, next_review_due, resolve_review_interval, set_plugin_settings,
        sanitize_kebab, shadow_markdown_path, write_shadow_markdown_to_vault, BlockSnapshot,
        Database, PageBlocksResponse, PluginInfo, RuntimeState, SyncOpPayload,
    };
    use super::plugins::{PluginDescriptor, PluginManifest};
    use aes_gcm::aead::KeyInit;
    use aes_gcm::aead::Aead;
    use base64::Engine;
    use serde_json::Value;
    use std::collections::HashMap;
    use tempfile::tempdir;
    use chrono::TimeZone;

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
    fn backup_before_migration_creates_file() {
        let dir = tempdir().expect("tempdir");
        let vault_path = dir.path();
        let db_path = vault_path.join("sandpaper.db");
        let db = Database::open(&db_path).expect("db open");

        let now = chrono::Utc
            .with_ymd_and_hms(2026, 1, 31, 12, 0, 0)
            .single()
            .expect("time");
        let backup =
            backup_before_migration_at(vault_path, &db_path, &db, now).expect("backup");

        let backup_path = backup.expect("backup path");
        assert!(backup_path.exists());
        assert!(backup_path.starts_with(vault_path.join("backups")));
    }

    #[test]
    fn backup_before_migration_rotates_oldest() {
        let dir = tempdir().expect("tempdir");
        let vault_path = dir.path();
        let db_path = vault_path.join("sandpaper.db");
        let db = Database::open(&db_path).expect("db open");

        let backup_dir = vault_path.join("backups");
        std::fs::create_dir_all(&backup_dir).expect("backup dir");
        for stamp in ["20250101000000", "20250102000000", "20250103000000"] {
            let path = backup_dir.join(format!("sandpaper-{stamp}.db"));
            std::fs::write(path, "backup").expect("write backup");
        }

        let now = chrono::Utc
            .with_ymd_and_hms(2025, 1, 4, 0, 0, 0)
            .single()
            .expect("time");
        backup_before_migration_at(vault_path, &db_path, &db, now).expect("backup");

        let mut names: Vec<String> = std::fs::read_dir(&backup_dir)
            .expect("read dir")
            .filter_map(|entry| entry.ok())
            .filter_map(|entry| entry.file_name().into_string().ok())
            .collect();
        names.sort();
        assert_eq!(
            names,
            vec![
                "sandpaper-20250102000000.db",
                "sandpaper-20250103000000.db",
                "sandpaper-20250104000000.db"
            ]
        );
    }

    fn build_missing_entry_plugin(root: &std::path::Path) -> PluginDescriptor {
        let plugin_dir = root.join("plugins").join("broken");
        std::fs::create_dir_all(&plugin_dir).expect("plugin dir");
        let manifest = PluginManifest {
            id: "broken".to_string(),
            name: "Broken".to_string(),
            version: "0.0.1".to_string(),
            description: None,
            permissions: Vec::new(),
            main: Some("index.js".to_string()),
            settings: Vec::new(),
        };
        PluginDescriptor {
            manifest,
            path: plugin_dir,
            enabled: true,
        }
    }

    #[test]
    fn runtime_state_surfaces_last_error_when_unavailable() {
        let dir = tempdir().expect("tempdir");
        let plugin = build_missing_entry_plugin(dir.path());
        let state = RuntimeState::new();

        let error = state
            .load_plugins(vec![plugin], HashMap::new())
            .expect_err("load plugins");
        assert!(error.contains("plugin-error: io"), "error was {error}");

        state.shutdown();

        let error = state
            .load_plugins(Vec::new(), HashMap::new())
            .expect_err("runtime unavailable");
        assert!(error.contains("runtime-unavailable"), "error was {error}");
        assert!(error.contains("plugin-error"), "error was {error}");
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
    fn load_sync_config_defaults_to_zero() {
        let db = Database::new_in_memory().expect("db init");
        db.run_migrations().expect("migrations");

        let config = load_sync_config(&db).expect("sync config");
        assert_eq!(config.last_push_cursor, 0);
        assert_eq!(config.last_pull_cursor, 0);
        assert!(config.server_url.is_none());
    }

    #[test]
    fn apply_sync_ops_updates_blocks() {
        let current = vec![
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

        let ops = vec![
            SyncOpPayload {
                op_id: "op-1".to_string(),
                page_id: "page-1".to_string(),
                block_id: "b1".to_string(),
                device_id: "dev-2".to_string(),
                clock: 1,
                timestamp: 0,
                kind: "edit".to_string(),
                text: Some("First updated".to_string()),
                sort_key: None,
                indent: None,
                parent_id: None,
            },
            SyncOpPayload {
                op_id: "op-2".to_string(),
                page_id: "page-1".to_string(),
                block_id: "b2".to_string(),
                device_id: "dev-2".to_string(),
                clock: 2,
                timestamp: 0,
                kind: "move".to_string(),
                text: None,
                sort_key: Some("000010".to_string()),
                indent: Some(1),
                parent_id: None,
            },
            SyncOpPayload {
                op_id: "op-3".to_string(),
                page_id: "page-1".to_string(),
                block_id: "b3".to_string(),
                device_id: "dev-2".to_string(),
                clock: 3,
                timestamp: 0,
                kind: "add".to_string(),
                text: Some("Third".to_string()),
                sort_key: Some("000020".to_string()),
                indent: Some(0),
                parent_id: None,
            },
            SyncOpPayload {
                op_id: "op-4".to_string(),
                page_id: "page-1".to_string(),
                block_id: "b1".to_string(),
                device_id: "dev-2".to_string(),
                clock: 4,
                timestamp: 0,
                kind: "delete".to_string(),
                text: None,
                sort_key: None,
                indent: None,
                parent_id: None,
            },
        ];

        let next = apply_sync_ops_to_blocks(&current, ops);
        assert_eq!(next.len(), 2);
        assert_eq!(next[0].uid, "b2");
        assert_eq!(next[0].indent, 1);
        assert_eq!(next[1].uid, "b3");
        assert_eq!(next[1].text, "Third");
    }

    #[test]
    fn detect_sync_conflicts_flags_remote_edits() {
        let current = vec![BlockSnapshot {
            uid: "b1".to_string(),
            text: "Local text".to_string(),
            indent: 0,
        }];

        let ops = vec![SyncOpPayload {
            op_id: "op-remote".to_string(),
            page_id: "page-1".to_string(),
            block_id: "b1".to_string(),
            device_id: "dev-2".to_string(),
            clock: 1,
            timestamp: 0,
            kind: "edit".to_string(),
            text: Some("Remote text".to_string()),
            sort_key: None,
            indent: None,
            parent_id: None,
        }];

        let conflicts = detect_sync_conflicts(&current, &ops);
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].block_uid, "b1");
        assert_eq!(conflicts[0].local_text, "Local text");
        assert_eq!(conflicts[0].remote_text, "Remote text");
    }

    #[test]
    fn resolve_review_interval_behaves_for_actions() {
        assert_eq!(resolve_review_interval("snooze", 3), 1);
        assert_eq!(resolve_review_interval("later", 2), 4);
        assert_eq!(resolve_review_interval("later", 10), 14);
        assert_eq!(resolve_review_interval("done", 3), 30);
    }

    #[test]
    fn next_review_due_returns_future_timestamp() {
        let now = chrono::Utc::now().timestamp_millis();
        let due = next_review_due(1);
        assert!(due > now);
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

    #[test]
    fn encrypt_sync_payload_roundtrips() {
        let key_bytes = [7u8; 32];
        let key_b64 = base64::engine::general_purpose::STANDARD.encode(key_bytes);
        let payload = br#"{"kind":"edit","text":"hello"}"#;

        let encrypted = encrypt_sync_payload(&key_b64, payload).expect("encrypt");
        let envelope: Value = serde_json::from_slice(&encrypted).expect("envelope");
        assert_eq!(envelope["algo"], "aes-256-gcm");

        let iv_b64 = envelope["ivB64"].as_str().expect("iv");
        let ct_b64 = envelope["ciphertextB64"].as_str().expect("ciphertext");
        let iv = base64::engine::general_purpose::STANDARD
            .decode(iv_b64)
            .expect("decode iv");
        let ciphertext = base64::engine::general_purpose::STANDARD
            .decode(ct_b64)
            .expect("decode ciphertext");
        let key = aes_gcm::Key::<aes_gcm::Aes256Gcm>::from_slice(&key_bytes);
        let cipher = aes_gcm::Aes256Gcm::new(key);
        let nonce = aes_gcm::Nonce::from_slice(&iv);
        let decrypted = cipher
            .decrypt(nonce, ciphertext.as_ref())
            .expect("decrypt");
        assert_eq!(decrypted, payload);
    }

    #[test]
    fn plugin_settings_encrypts_and_roundtrips() {
        let db = Database::new_in_memory().expect("db");
        db.run_migrations().expect("migrations");
        let key_bytes = [9u8; 32];
        let key_b64 = base64::engine::general_purpose::STANDARD.encode(key_bytes);
        db.set_kv("vault.key.b64", &key_b64).expect("store key");

        let settings = serde_json::json!({
            "apiKey": "secret-key",
            "units": "c"
        });
        set_plugin_settings(&db, "weather", &settings).expect("set settings");
        let loaded = get_plugin_settings(&db, "weather")
            .expect("get settings")
            .expect("settings");
        assert_eq!(loaded, settings);

        let stored = db
            .get_kv("plugin.settings.weather")
            .expect("raw settings")
            .unwrap_or_default();
        assert!(
            !stored.contains("secret-key"),
            "settings should not be stored in plain text"
        );
    }
}
