use chrono::{DateTime, Duration, Utc};
use rquickjs::{
    function::Opt, CatchResultExt, CaughtError, Context, FromJs, Function, IntoJs, Object,
    Persistent, Runtime, Value as JsValue,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

const PLUGIN_API_VERSION: &str = "1.0.0";
const HOST_APP_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug)]
pub enum PluginError {
    Io(std::io::Error),
    Serde(serde_json::Error),
    Runtime(Box<PluginRuntimeError>),
}

impl From<std::io::Error> for PluginError {
    fn from(err: std::io::Error) -> Self {
        Self::Io(err)
    }
}

impl From<serde_json::Error> for PluginError {
    fn from(err: serde_json::Error) -> Self {
        Self::Serde(err)
    }
}

impl From<rquickjs::Error> for PluginError {
    fn from(err: rquickjs::Error) -> Self {
        Self::Runtime(Box::new(PluginRuntimeError::new(err.to_string())))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PluginRuntimeError {
    pub message: String,
    #[serde(default)]
    pub stack: Option<String>,
    #[serde(default)]
    pub context: Option<PluginErrorContext>,
}

impl PluginRuntimeError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            stack: None,
            context: None,
        }
    }

    pub fn with_context(mut self, context: PluginErrorContext) -> Self {
        self.context = Some(context);
        self
    }

    pub fn with_stack(mut self, stack: Option<String>) -> Self {
        self.stack = stack;
        self
    }
}

impl From<String> for PluginRuntimeError {
    fn from(value: String) -> Self {
        Self::new(value)
    }
}

impl From<&str> for PluginRuntimeError {
    fn from(value: &str) -> Self {
        Self::new(value)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PluginErrorContext {
    pub phase: String,
    #[serde(default)]
    pub plugin_id: Option<String>,
    #[serde(default)]
    pub renderer_id: Option<String>,
    #[serde(default)]
    pub block_uid: Option<String>,
    #[serde(default)]
    pub action_id: Option<String>,
}

impl PluginErrorContext {
    pub fn new(phase: &str) -> Self {
        Self {
            phase: phase.to_string(),
            plugin_id: None,
            renderer_id: None,
            block_uid: None,
            action_id: None,
        }
    }

    pub fn with_plugin(mut self, plugin_id: &str) -> Self {
        self.plugin_id = Some(plugin_id.to_string());
        self
    }

    pub fn with_renderer(mut self, renderer_id: &str) -> Self {
        self.renderer_id = Some(renderer_id.to_string());
        self
    }

    pub fn with_block(mut self, block_uid: &str) -> Self {
        self.block_uid = Some(block_uid.to_string());
        self
    }

    pub fn with_action(mut self, action_id: &str) -> Self {
        self.action_id = Some(action_id.to_string());
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default, rename = "apiVersion")]
    pub api_version: Option<VersionRange>,
    #[serde(default, rename = "appVersion")]
    pub app_version: Option<VersionRange>,
    #[serde(default)]
    pub main: Option<String>,
    #[serde(default)]
    pub settings: Vec<PluginSetting>,
    #[serde(default, rename = "settingsSchema")]
    pub settings_schema: Option<PluginSettingsSchema>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct VersionRange {
    #[serde(default)]
    pub min: Option<String>,
    #[serde(default)]
    pub max: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PluginSetting {
    pub key: String,
    pub label: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub options: Vec<PluginSettingOption>,
    #[serde(default)]
    pub default: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PluginSettingOption {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginSettingsSchema {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub r#type: Option<String>,
    #[serde(default)]
    pub properties: HashMap<String, PluginSettingSchema>,
    #[serde(default)]
    pub required: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginSettingSchema {
    #[serde(rename = "type")]
    pub kind: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub default: Option<Value>,
    #[serde(default, rename = "enum")]
    pub enum_values: Vec<Value>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PluginDescriptor {
    pub manifest: PluginManifest,
    pub path: PathBuf,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub permissions: Vec<String>,
    #[serde(default)]
    pub settings_schema: Option<PluginSettingsSchema>,
    pub enabled: bool,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct PluginState {
    #[serde(default)]
    pub enabled: HashMap<String, bool>,
    #[serde(default)]
    pub install_sources: HashMap<String, String>,
}

pub struct PluginRegistry {
    state_path: PathBuf,
}

impl PluginRegistry {
    pub fn new(state_path: PathBuf) -> Self {
        Self { state_path }
    }

    pub fn load_state(&self) -> Result<PluginState, PluginError> {
        if !self.state_path.exists() {
            return Ok(PluginState::default());
        }
        let raw = fs::read_to_string(&self.state_path)?;
        Ok(serde_json::from_str(&raw)?)
    }

    pub fn save_state(&self, state: &PluginState) -> Result<(), PluginError> {
        if let Some(parent) = self.state_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let data = serde_json::to_string_pretty(state)?;
        fs::write(&self.state_path, data)?;
        Ok(())
    }

    pub fn set_enabled(&self, plugin_id: &str, enabled: bool) -> Result<PluginState, PluginError> {
        let mut state = self.load_state()?;
        state.enabled.insert(plugin_id.to_string(), enabled);
        self.save_state(&state)?;
        Ok(state)
    }

    pub fn set_install_source(
        &self,
        plugin_id: &str,
        source: &str,
    ) -> Result<PluginState, PluginError> {
        let mut state = self.load_state()?;
        state
            .install_sources
            .insert(plugin_id.to_string(), source.to_string());
        self.save_state(&state)?;
        Ok(state)
    }

    pub fn get_install_source(&self, plugin_id: &str) -> Result<Option<String>, PluginError> {
        let state = self.load_state()?;
        Ok(state.install_sources.get(plugin_id).cloned())
    }

    pub fn clear_install_source(&self, plugin_id: &str) -> Result<PluginState, PluginError> {
        let mut state = self.load_state()?;
        state.install_sources.remove(plugin_id);
        self.save_state(&state)?;
        Ok(state)
    }

    pub fn remove_plugin_state(&self, plugin_id: &str) -> Result<PluginState, PluginError> {
        let mut state = self.load_state()?;
        state.enabled.remove(plugin_id);
        state.install_sources.remove(plugin_id);
        self.save_state(&state)?;
        Ok(state)
    }

    pub fn is_enabled(&self, plugin_id: &str) -> Result<bool, PluginError> {
        let state = self.load_state()?;
        Ok(state.enabled.get(plugin_id).copied().unwrap_or(false))
    }
}

pub fn discover_plugins(
    root: &Path,
    registry: &PluginRegistry,
) -> Result<Vec<PluginDescriptor>, PluginError> {
    let plugins_dir = root.join("plugins");
    if !plugins_dir.exists() {
        return Ok(Vec::new());
    }

    let mut plugins = Vec::new();
    for entry in fs::read_dir(&plugins_dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let path = entry.path();
        let manifest_path = path.join("plugin.json");
        if !manifest_path.exists() {
            continue;
        }
        let raw = fs::read_to_string(&manifest_path)?;
        let manifest = match parse_plugin_manifest(&raw) {
            Ok(manifest) => manifest,
            Err(_) => {
                continue;
            }
        };
        let enabled = registry.is_enabled(&manifest.id)?;
        plugins.push(PluginDescriptor {
            manifest,
            path,
            enabled,
        });
    }

    plugins.sort_by(|a, b| a.manifest.name.cmp(&b.manifest.name));
    Ok(plugins)
}

pub fn list_plugins(
    root: &Path,
    registry: &PluginRegistry,
) -> Result<Vec<PluginInfo>, PluginError> {
    let plugins = discover_plugins(root, registry)?;
    Ok(plugins
        .into_iter()
        .map(|plugin| {
            let settings_schema = resolve_settings_schema(&plugin.manifest);
            PluginInfo {
                id: plugin.manifest.id,
                name: plugin.manifest.name,
                version: plugin.manifest.version,
                description: plugin.manifest.description,
                permissions: plugin.manifest.permissions,
                settings_schema,
                enabled: plugin.enabled,
                path: plugin.path.to_string_lossy().to_string(),
            }
        })
        .collect())
}

fn copy_dir_recursive(source: &Path, dest: &Path) -> Result<(), PluginError> {
    fs::create_dir_all(dest)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let path = entry.path();
        let target = dest.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&path, &target)?;
        } else {
            fs::copy(&path, &target)?;
        }
    }
    Ok(())
}

pub fn install_plugin(
    root: &Path,
    registry: &PluginRegistry,
    source_dir: &Path,
) -> Result<PluginInfo, PluginError> {
    if !source_dir.exists() {
        return Err(PluginError::Runtime(Box::new(
            "plugin-source-missing".into(),
        )));
    }
    if !source_dir.is_dir() {
        return Err(PluginError::Runtime(Box::new(
            "plugin-source-not-directory".into(),
        )));
    }
    let manifest_path = source_dir.join("plugin.json");
    if !manifest_path.exists() {
        return Err(PluginError::Runtime(Box::new(
            "plugin-manifest-missing".into(),
        )));
    }
    let raw = fs::read_to_string(&manifest_path)?;
    let manifest = parse_plugin_manifest(&raw)?;
    check_manifest_compatibility(&manifest)?;
    if manifest.id.contains('/') || manifest.id.contains('\\') {
        return Err(PluginError::Runtime(Box::new("plugin-id-invalid".into())));
    }

    let source_path = source_dir
        .canonicalize()
        .unwrap_or_else(|_| source_dir.to_path_buf())
        .to_string_lossy()
        .to_string();
    let plugins_dir = root.join("plugins");
    fs::create_dir_all(&plugins_dir)?;
    let dest_dir = plugins_dir.join(&manifest.id);
    if dest_dir.exists() {
        let same_dir = dest_dir
            .canonicalize()
            .ok()
            .zip(source_dir.canonicalize().ok())
            .map(|(dest, source)| dest == source)
            .unwrap_or(false);
        if same_dir {
            registry.set_enabled(&manifest.id, true)?;
        } else {
            return Err(PluginError::Runtime(Box::new(
                "plugin-already-installed".into(),
            )));
        }
    } else {
        copy_dir_recursive(source_dir, &dest_dir)?;
        registry.set_enabled(&manifest.id, true)?;
    }
    registry.set_install_source(&manifest.id, source_path.as_str())?;

    let settings_schema = resolve_settings_schema(&manifest);
    Ok(PluginInfo {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        permissions: manifest.permissions,
        settings_schema,
        enabled: true,
        path: dest_dir.to_string_lossy().to_string(),
    })
}

pub fn update_plugin(
    root: &Path,
    registry: &PluginRegistry,
    plugin_id: &str,
) -> Result<PluginInfo, PluginError> {
    let source = registry
        .get_install_source(plugin_id)?
        .ok_or_else(|| PluginError::Runtime(Box::new("plugin-update-source-missing".into())))?;
    let source_dir = PathBuf::from(source);
    if !source_dir.exists() {
        return Err(PluginError::Runtime(Box::new(
            "plugin-update-source-missing".into(),
        )));
    }
    if !source_dir.is_dir() {
        return Err(PluginError::Runtime(Box::new(
            "plugin-update-source-not-directory".into(),
        )));
    }

    let manifest_path = source_dir.join("plugin.json");
    if !manifest_path.exists() {
        return Err(PluginError::Runtime(Box::new(
            "plugin-manifest-missing".into(),
        )));
    }
    let raw = fs::read_to_string(&manifest_path)?;
    let manifest = parse_plugin_manifest(&raw)?;
    if manifest.id != plugin_id {
        return Err(PluginError::Runtime(Box::new(
            "plugin-update-id-mismatch".into(),
        )));
    }
    check_manifest_compatibility(&manifest)?;

    let plugins_dir = root.join("plugins");
    fs::create_dir_all(&plugins_dir)?;
    let dest_dir = plugins_dir.join(plugin_id);
    let same_dir = dest_dir
        .canonicalize()
        .ok()
        .zip(source_dir.canonicalize().ok())
        .map(|(dest, source)| dest == source)
        .unwrap_or(false);
    if !same_dir {
        if dest_dir.exists() {
            fs::remove_dir_all(&dest_dir)?;
        }
        copy_dir_recursive(&source_dir, &dest_dir)?;
    }

    let enabled = registry.is_enabled(plugin_id)?;
    let source_path = source_dir
        .canonicalize()
        .unwrap_or_else(|_| source_dir.clone())
        .to_string_lossy()
        .to_string();
    registry.set_install_source(plugin_id, source_path.as_str())?;
    if enabled {
        registry.set_enabled(plugin_id, true)?;
    }

    let settings_schema = resolve_settings_schema(&manifest);
    Ok(PluginInfo {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        permissions: manifest.permissions,
        settings_schema,
        enabled,
        path: dest_dir.to_string_lossy().to_string(),
    })
}

pub fn remove_plugin(
    root: &Path,
    registry: &PluginRegistry,
    plugin_id: &str,
) -> Result<(), PluginError> {
    let plugins_dir = root.join("plugins");
    let dest_dir = plugins_dir.join(plugin_id);
    if dest_dir.exists() {
        fs::remove_dir_all(&dest_dir)?;
    }
    registry.remove_plugin_state(plugin_id)?;
    Ok(())
}

pub fn parse_plugin_manifest(raw: &str) -> Result<PluginManifest, PluginError> {
    let value: Value = serde_json::from_str(raw)?;
    validate_manifest_schema(&value)?;
    let manifest: PluginManifest = serde_json::from_value(value)?;
    validate_manifest_semantics(&manifest)?;
    Ok(manifest)
}

fn validate_manifest_schema(value: &Value) -> Result<(), PluginError> {
    let obj = value
        .as_object()
        .ok_or_else(|| PluginError::Runtime(Box::new("manifest-root-invalid".into())))?;
    let id = obj.get("id").and_then(Value::as_str).unwrap_or_default();
    if id.trim().is_empty() {
        return Err(PluginError::Runtime(Box::new("manifest-id-missing".into())));
    }
    let name = obj.get("name").and_then(Value::as_str).unwrap_or_default();
    if name.trim().is_empty() {
        return Err(PluginError::Runtime(Box::new(
            "manifest-name-missing".into(),
        )));
    }
    let version = obj
        .get("version")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if version.trim().is_empty() {
        return Err(PluginError::Runtime(Box::new(
            "manifest-version-missing".into(),
        )));
    }
    if let Some(permissions) = obj.get("permissions") {
        if !permissions.is_array() {
            return Err(PluginError::Runtime(Box::new(
                "manifest-permissions-invalid".into(),
            )));
        }
    }
    if let Some(schema) = obj.get("settingsSchema") {
        if !schema.is_object() {
            return Err(PluginError::Runtime(Box::new(
                "manifest-settings-schema-invalid".into(),
            )));
        }
    }
    if let Some(range) = obj.get("apiVersion") {
        if !range.is_object() {
            return Err(PluginError::Runtime(Box::new(
                "manifest-api-version-invalid".into(),
            )));
        }
    }
    if let Some(range) = obj.get("appVersion") {
        if !range.is_object() {
            return Err(PluginError::Runtime(Box::new(
                "manifest-host-version-invalid".into(),
            )));
        }
    }
    Ok(())
}

fn validate_manifest_semantics(manifest: &PluginManifest) -> Result<(), PluginError> {
    if !manifest
        .id
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '.' || ch == '-' || ch == '_')
    {
        return Err(PluginError::Runtime(Box::new("plugin-id-invalid".into())));
    }
    if parse_semver(&manifest.version).is_none() {
        return Err(PluginError::Runtime(Box::new(
            "manifest-version-invalid".into(),
        )));
    }
    if let Some(main) = manifest.main.as_ref() {
        if main.contains("..") || Path::new(main).is_absolute() {
            return Err(PluginError::Runtime(Box::new(
                "manifest-main-invalid".into(),
            )));
        }
    }
    for permission in &manifest.permissions {
        if !is_known_permission(permission) {
            return Err(PluginError::Runtime(Box::new(
                format!("manifest-permission-unknown:{permission}").into(),
            )));
        }
    }
    if let Some(schema) = manifest.settings_schema.as_ref() {
        if let Some(kind) = schema.r#type.as_ref() {
            if kind != "object" {
                return Err(PluginError::Runtime(Box::new(
                    "manifest-settings-schema-invalid".into(),
                )));
            }
        }
    }
    Ok(())
}

pub fn check_manifest_compatibility(manifest: &PluginManifest) -> Result<(), PluginError> {
    if let Some(range) = manifest.api_version.as_ref() {
        if !version_in_range(PLUGIN_API_VERSION, range)? {
            return Err(PluginError::Runtime(Box::new(
                "manifest-api-version-incompatible".into(),
            )));
        }
    }
    if let Some(range) = manifest.app_version.as_ref() {
        if !version_in_range(HOST_APP_VERSION, range)? {
            return Err(PluginError::Runtime(Box::new(
                "manifest-host-version-incompatible".into(),
            )));
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct SemVer {
    major: u64,
    minor: u64,
    patch: u64,
}

fn parse_semver(value: &str) -> Option<SemVer> {
    let mut parts = value.split('.');
    let major = parts.next()?.parse::<u64>().ok()?;
    let minor = parts.next()?.parse::<u64>().ok()?;
    let patch = parts.next()?.parse::<u64>().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some(SemVer {
        major,
        minor,
        patch,
    })
}

fn version_in_range(version: &str, range: &VersionRange) -> Result<bool, PluginError> {
    let current = parse_semver(version)
        .ok_or_else(|| PluginError::Runtime(Box::new("manifest-version-invalid".into())))?;
    if let Some(min) = range.min.as_deref() {
        let min_version = parse_semver(min)
            .ok_or_else(|| PluginError::Runtime(Box::new("manifest-version-min-invalid".into())))?;
        if current < min_version {
            return Ok(false);
        }
    }
    if let Some(max) = range.max.as_deref() {
        let max_version = parse_semver(max)
            .ok_or_else(|| PluginError::Runtime(Box::new("manifest-version-max-invalid".into())))?;
        if current > max_version {
            return Ok(false);
        }
    }
    Ok(true)
}

fn is_known_permission(value: &str) -> bool {
    matches!(
        value,
        "network" | "clipboard" | "data.read" | "data.write" | "ui" | "fs" | "system"
    )
}

fn resolve_settings_schema(manifest: &PluginManifest) -> Option<PluginSettingsSchema> {
    if let Some(schema) = manifest.settings_schema.clone() {
        return Some(schema);
    }
    legacy_settings_to_schema(&manifest.settings)
}

fn legacy_settings_to_schema(settings: &[PluginSetting]) -> Option<PluginSettingsSchema> {
    if settings.is_empty() {
        return None;
    }
    let mut properties = HashMap::new();
    for setting in settings {
        let kind = normalize_setting_kind(&setting.kind);
        let enum_values = if setting.options.is_empty() {
            Vec::new()
        } else {
            setting
                .options
                .iter()
                .map(|option| Value::String(option.value.clone()))
                .collect()
        };
        properties.insert(
            setting.key.clone(),
            PluginSettingSchema {
                kind: Some(kind.to_string()),
                title: Some(setting.label.clone()),
                description: None,
                default: setting.default.clone(),
                enum_values,
            },
        );
    }
    Some(PluginSettingsSchema {
        title: None,
        description: None,
        r#type: Some("object".to_string()),
        properties,
        required: Vec::new(),
    })
}

fn normalize_setting_kind(kind: &str) -> &str {
    match kind {
        "text" | "string" | "select" => "string",
        "bool" | "boolean" => "boolean",
        "integer" | "int" => "integer",
        "number" | "float" => "number",
        _ => "string",
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PluginRuntimeLoadResult {
    pub loaded: Vec<String>,
    #[serde(default)]
    pub commands: Vec<PluginCommand>,
    #[serde(default)]
    pub panels: Vec<PluginPanel>,
    #[serde(default)]
    pub toolbar_actions: Vec<PluginToolbarAction>,
    #[serde(default)]
    pub renderers: Vec<PluginRenderer>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PluginCommand {
    pub plugin_id: String,
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PluginPanel {
    pub plugin_id: String,
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub location: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PluginToolbarAction {
    pub plugin_id: String,
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub tooltip: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PluginRenderer {
    pub plugin_id: String,
    pub id: String,
    pub title: String,
    pub kind: String,
    #[serde(default)]
    pub languages: Vec<String>,
    #[serde(default)]
    pub permissions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PluginBlockView {
    #[serde(default)]
    pub plugin_id: String,
    #[serde(default)]
    pub renderer_id: String,
    #[serde(default)]
    pub block_uid: String,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub next_text: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub body: Option<Value>,
    #[serde(default)]
    pub controls: Vec<Value>,
    #[serde(default)]
    pub cache: Option<PluginBlockCache>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginBlockCache {
    #[serde(default)]
    pub ttl_seconds: Option<u64>,
    #[serde(default)]
    pub timestamp: Option<String>,
}

struct RendererHandlers {
    render: Option<Persistent<Function<'static>>>,
    on_action: Option<Persistent<Function<'static>>>,
}

#[derive(Default)]
struct PluginRuntimeRegistry {
    commands: Vec<PluginCommand>,
    panels: Vec<PluginPanel>,
    toolbar_actions: Vec<PluginToolbarAction>,
    renderers: Vec<PluginRenderer>,
    renderer_handlers: HashMap<(String, String), RendererHandlers>,
    toolbar_action_handlers: HashMap<(String, String), Persistent<Function<'static>>>,
}

struct PluginFence {
    lang: String,
    config_text: String,
    summary: Option<String>,
}

const CACHE_TTL_KEY: &str = "cache_ttl";
const CACHE_TS_KEY: &str = "cache_ts";

struct CacheMeta {
    ttl_seconds: Option<u64>,
    timestamp: Option<String>,
    stale: bool,
}

pub struct PluginRuntime {
    registry: std::rc::Rc<std::cell::RefCell<PluginRuntimeRegistry>>,
    load_plugin_fn: Persistent<Function<'static>>,
    to_json_fn: Persistent<Function<'static>>,
    settings: HashMap<String, Value>,
    permissions: HashMap<String, Vec<String>>,
    settings_schema: HashMap<String, PluginSettingsSchema>,
    context: Context,
    _runtime: Runtime,
}

impl PluginRuntime {
    pub fn new() -> Result<Self, PluginError> {
        let runtime = Runtime::new()?;
        let context = Context::full(&runtime)?;
        let (load_plugin_fn, to_json_fn) = context.with(|ctx| {
            ctx.eval::<(), _>(
                r#"globalThis.__sandpaperLoadPlugin = (source, api) => {
  const module = { exports: {} };
  const exports = module.exports;
  const fn = new Function("module", "exports", "api", source);
  fn(module, exports, api);
  return module.exports;
};
globalThis.__sandpaperToJson = (value) => JSON.stringify(value);"#,
            )?;
            let load_fn: Function = ctx.globals().get("__sandpaperLoadPlugin")?;
            let to_json: Function = ctx.globals().get("__sandpaperToJson")?;
            Ok::<_, PluginError>((
                Persistent::save(&ctx, load_fn),
                Persistent::save(&ctx, to_json),
            ))
        })?;

        Ok(Self {
            _runtime: runtime,
            context,
            registry: std::rc::Rc::new(std::cell::RefCell::new(PluginRuntimeRegistry::default())),
            load_plugin_fn,
            to_json_fn,
            settings: HashMap::new(),
            permissions: HashMap::new(),
            settings_schema: HashMap::new(),
        })
    }

    pub fn load_plugins(
        &mut self,
        plugins: &[PluginDescriptor],
        settings: HashMap<String, Value>,
    ) -> Result<PluginRuntimeLoadResult, PluginError> {
        self.settings = settings;
        self.permissions = plugins
            .iter()
            .map(|plugin| {
                (
                    plugin.manifest.id.clone(),
                    plugin.manifest.permissions.clone(),
                )
            })
            .collect();
        self.settings_schema = plugins
            .iter()
            .filter_map(|plugin| {
                resolve_settings_schema(&plugin.manifest)
                    .map(|schema| (plugin.manifest.id.clone(), schema))
            })
            .collect();
        let registry = std::rc::Rc::new(std::cell::RefCell::new(PluginRuntimeRegistry::default()));
        self.registry = registry.clone();
        let loaded_ids = plugins
            .iter()
            .map(|plugin| plugin.manifest.id.clone())
            .collect::<Vec<_>>();

        let load_plugin_fn = self.load_plugin_fn.clone();
        self.context.with(|ctx| {
            for plugin in plugins {
                let api = Self::build_api(ctx.clone(), registry.clone(), &plugin.manifest.id)?;
                let entry = plugin
                    .manifest
                    .main
                    .clone()
                    .unwrap_or_else(|| "index.js".to_string());
                let entry_path = plugin.path.join(entry);
                let source = fs::read_to_string(&entry_path)?;
                let load_fn = load_plugin_fn.clone().restore(&ctx)?;
                let load_context = PluginErrorContext::new("load").with_plugin(&plugin.manifest.id);
                let exports: JsValue =
                    load_fn
                        .call((source, api.clone()))
                        .catch(&ctx)
                        .map_err(|err| {
                            PluginError::Runtime(Box::new(runtime_error_from_caught(
                                err,
                                load_context.clone(),
                            )))
                        })?;
                if let Ok(register_fn) = Function::from_value(exports.clone()) {
                    let register_context =
                        PluginErrorContext::new("register").with_plugin(&plugin.manifest.id);
                    let _ = register_fn
                        .call::<_, JsValue>((api.clone(),))
                        .catch(&ctx)
                        .map_err(|err| {
                            PluginError::Runtime(Box::new(runtime_error_from_caught(
                                err,
                                register_context.clone(),
                            )))
                        })?;
                } else if let Ok(exports_obj) = Object::from_value(exports.clone()) {
                    if let Ok(default_fn) = exports_obj.get::<_, Function>("default") {
                        let register_context =
                            PluginErrorContext::new("register").with_plugin(&plugin.manifest.id);
                        let _ = default_fn
                            .call::<_, JsValue>((api.clone(),))
                            .catch(&ctx)
                            .map_err(|err| {
                                PluginError::Runtime(Box::new(runtime_error_from_caught(
                                    err,
                                    register_context.clone(),
                                )))
                            })?;
                    }
                }
            }
            Ok::<_, PluginError>(())
        })?;

        let registry = self.registry.borrow();
        Ok(PluginRuntimeLoadResult {
            loaded: loaded_ids,
            commands: registry.commands.clone(),
            panels: registry.panels.clone(),
            toolbar_actions: registry.toolbar_actions.clone(),
            renderers: registry.renderers.clone(),
        })
    }

    pub fn render_block(
        &mut self,
        plugin_id: &str,
        renderer_id: &str,
        block_uid: &str,
        text: &str,
    ) -> Result<PluginBlockView, PluginError> {
        self.call_block_handler(plugin_id, renderer_id, block_uid, text, None, None)
    }

    pub fn handle_block_action(
        &mut self,
        plugin_id: &str,
        renderer_id: &str,
        block_uid: &str,
        text: &str,
        action_id: &str,
        value: Option<Value>,
    ) -> Result<PluginBlockView, PluginError> {
        self.call_block_handler(
            plugin_id,
            renderer_id,
            block_uid,
            text,
            Some(action_id),
            value,
        )
    }

    pub fn emit_event(
        &mut self,
        _plugin_id: &str,
        _event: &str,
        _payload: Value,
    ) -> Result<Value, PluginError> {
        Ok(Value::Null)
    }

    fn build_api<'js>(
        ctx: rquickjs::Ctx<'js>,
        registry: std::rc::Rc<std::cell::RefCell<PluginRuntimeRegistry>>,
        plugin_id: &str,
    ) -> Result<Object<'js>, PluginError> {
        let api = Object::new(ctx.clone())?;
        let plugin_id = plugin_id.to_string();

        let register_renderer = Function::new(ctx.clone(), {
            let registry = registry.clone();
            let plugin_id = plugin_id.clone();
            move |def: Object, handlers: Object| -> rquickjs::Result<()> {
                let id: String = def.get("id")?;
                let title: String = def.get("title")?;
                let kind: String = def.get("kind")?;
                let languages: Vec<String> = def.get("languages").unwrap_or_default();
                let permissions: Vec<String> = def.get("permissions").unwrap_or_default();

                let render_fn = handlers.get::<_, Function>("render").ok();
                let on_action_fn = handlers.get::<_, Function>("onAction").ok();
                let handlers = RendererHandlers {
                    render: render_fn.map(|func| {
                        let ctx = func.ctx().clone();
                        Persistent::save(&ctx, func)
                    }),
                    on_action: on_action_fn.map(|func| {
                        let ctx = func.ctx().clone();
                        Persistent::save(&ctx, func)
                    }),
                };

                let mut registry = registry.borrow_mut();
                registry.renderers.push(PluginRenderer {
                    plugin_id: plugin_id.clone(),
                    id: id.clone(),
                    title,
                    kind,
                    languages,
                    permissions,
                });
                registry
                    .renderer_handlers
                    .insert((plugin_id.clone(), id), handlers);
                Ok(())
            }
        });
        api.set("registerRenderer", register_renderer)?;

        let register_command = Function::new(ctx.clone(), {
            let registry = registry.clone();
            let plugin_id = plugin_id.clone();
            move |def: Object, _handler: Option<Function>| -> rquickjs::Result<()> {
                let id: String = def.get("id")?;
                let title: String = def.get("title")?;
                let description: Option<String> = def.get("description").ok();
                registry.borrow_mut().commands.push(PluginCommand {
                    plugin_id: plugin_id.clone(),
                    id,
                    title,
                    description,
                });
                Ok(())
            }
        });
        api.set("registerCommand", register_command)?;

        let register_panel = Function::new(ctx.clone(), {
            let registry = registry.clone();
            let plugin_id = plugin_id.clone();
            move |def: Object, _handler: Option<Function>| -> rquickjs::Result<()> {
                let id: String = def.get("id")?;
                let title: String = def.get("title")?;
                let location: Option<String> = def.get("location").ok();
                registry.borrow_mut().panels.push(PluginPanel {
                    plugin_id: plugin_id.clone(),
                    id,
                    title,
                    location,
                });
                Ok(())
            }
        });
        api.set("registerPanel", register_panel)?;

        let register_toolbar_action = Function::new(ctx.clone(), {
            let registry = registry.clone();
            let plugin_id = plugin_id.clone();
            move |def: Object, handler: Option<Function>| -> rquickjs::Result<()> {
                let id: String = def.get("id")?;
                let title: String = def.get("title")?;
                let tooltip: Option<String> = def.get("tooltip").ok();

                registry
                    .borrow_mut()
                    .toolbar_actions
                    .push(PluginToolbarAction {
                        plugin_id: plugin_id.clone(),
                        id: id.clone(),
                        title,
                        tooltip,
                    });

                if let Some(handler) = handler {
                    let ctx = handler.ctx().clone();
                    registry
                        .borrow_mut()
                        .toolbar_action_handlers
                        .insert((plugin_id.clone(), id), Persistent::save(&ctx, handler));
                }

                Ok(())
            }
        });
        api.set("registerToolbarAction", register_toolbar_action)?;

        Ok(api)
    }

    fn call_block_handler(
        &mut self,
        plugin_id: &str,
        renderer_id: &str,
        block_uid: &str,
        text: &str,
        action_id: Option<&str>,
        action_value: Option<Value>,
    ) -> Result<PluginBlockView, PluginError> {
        let handler = {
            let registry = self.registry.borrow();
            let handlers = registry
                .renderer_handlers
                .get(&(plugin_id.to_string(), renderer_id.to_string()))
                .ok_or_else(|| PluginError::Runtime(Box::new("renderer-not-found".into())))?;
            if action_id.is_some() {
                handlers.on_action.clone()
            } else {
                handlers.render.clone()
            }
        }
        .ok_or_else(|| PluginError::Runtime(Box::new("render-handler-missing".into())))?;

        let renderer_permissions = {
            let registry = self.registry.borrow();
            registry
                .renderers
                .iter()
                .find(|renderer| renderer.plugin_id == plugin_id && renderer.id == renderer_id)
                .map(|renderer| renderer.permissions.clone())
                .unwrap_or_default()
        };
        let allowed_permissions = self.permissions.get(plugin_id).cloned().unwrap_or_default();
        let missing_permissions = renderer_permissions
            .iter()
            .filter(|perm| !allowed_permissions.contains(perm))
            .cloned()
            .collect::<Vec<_>>();
        if !missing_permissions.is_empty() {
            return Ok(permission_blocked_view(
                plugin_id,
                renderer_id,
                block_uid,
                &missing_permissions,
            ));
        }

        let fence = parse_plugin_fence(text);
        let mut config = fence
            .as_ref()
            .map(|f| parse_plugin_config(&f.config_text))
            .unwrap_or_default();
        let config_text = fence
            .as_ref()
            .map(|f| f.config_text.clone())
            .unwrap_or_default();
        let summary = fence.as_ref().and_then(|f| f.summary.clone());
        let cache_meta = read_cache_meta(&config);

        let base_settings = self
            .settings
            .get(plugin_id)
            .cloned()
            .unwrap_or(Value::Object(serde_json::Map::new()));
        let settings = merge_settings_with_overrides(
            &base_settings,
            self.settings_schema.get(plugin_id),
            &config,
        );

        self.context.with(|ctx| {
            let ctx_obj = Object::new(ctx.clone())?;
            let block_obj = Object::new(ctx.clone())?;
            block_obj.set("uid", block_uid)?;
            block_obj.set("text", text)?;
            ctx_obj.set("block", block_obj)?;
            if let Some(summary) = summary.clone() {
                ctx_obj.set("summary", summary)?;
            }
            ctx_obj.set("config", config_to_js(ctx.clone(), &config)?)?;
            ctx_obj.set("settings", json_to_js(ctx.clone(), &settings)?)?;
            ctx_obj.set("cache", cache_meta_to_js(ctx.clone(), &cache_meta)?)?;
            if renderer_permissions.iter().any(|perm| perm == "network") {
                let network_obj = Object::new(ctx.clone())?;
                let fetch_ctx = ctx.clone();
                let fetch_fn = Function::new(
                    ctx.clone(),
                    move |url: String, options: Opt<Object>| -> rquickjs::Result<Object> {
                        let mut method = "GET".to_string();
                        let mut body: Option<String> = None;
                        if let Some(opts) = options.0 {
                            if let Ok(value) = opts.get::<_, String>("method") {
                                method = value;
                            }
                            if let Ok(value) = opts.get::<_, String>("body") {
                                body = Some(value);
                            }
                        }
                        let request = ureq::request(method.as_str(), url.as_str());
                        let result = if let Some(body) = body {
                            request.send_string(&body)
                        } else {
                            request.call()
                        };
                        let response = Object::new(fetch_ctx.clone())?;
                        match result {
                            Ok(resp) => {
                                let status = resp.status();
                                let text = resp.into_string().unwrap_or_default();
                                response.set("ok", (200..300).contains(&status))?;
                                response.set("status", status)?;
                                response.set("text", text)?;
                            }
                            Err(err) => {
                                response.set("ok", false)?;
                                response.set("status", 0)?;
                                response.set("text", err.to_string())?;
                            }
                        }
                        Ok(response)
                    },
                );
                network_obj.set("fetch", fetch_fn)?;
                ctx_obj.set("network", network_obj)?;
            }

            if let Some(action_id) = action_id {
                let action_obj = Object::new(ctx.clone())?;
                action_obj.set("id", action_id)?;
                if let Some(value) = action_value {
                    action_obj.set("value", json_to_js(ctx.clone(), &value)?)?;
                }
                ctx_obj.set("action", action_obj)?;
            }

            let handler_fn = handler.restore(&ctx)?;
            let mut error_context = if action_id.is_some() {
                PluginErrorContext::new("block-action")
            } else {
                PluginErrorContext::new("block-render")
            };
            error_context = error_context
                .with_plugin(plugin_id)
                .with_renderer(renderer_id)
                .with_block(block_uid);
            if let Some(action_id) = action_id {
                error_context = error_context.with_action(action_id);
            }
            let value: JsValue = handler_fn.call((ctx_obj,)).catch(&ctx).map_err(|err| {
                PluginError::Runtime(Box::new(runtime_error_from_caught(err, error_context)))
            })?;
            let mut view = self.parse_block_view(ctx, value, plugin_id, renderer_id, block_uid)?;
            let has_clipboard_control = view.controls.iter().any(|control| {
                control
                    .get("type")
                    .and_then(Value::as_str)
                    .map(|kind| kind == "clipboard")
                    .unwrap_or(false)
            });
            if has_clipboard_control && !renderer_permissions.iter().any(|perm| perm == "clipboard")
            {
                return Ok(permission_blocked_view(
                    plugin_id,
                    renderer_id,
                    block_uid,
                    &["clipboard".to_string()],
                ));
            }
            let mut config_updated = false;
            let mut cache_ttl = cache_meta.ttl_seconds;
            if let Some(cache) = view.cache.as_ref() {
                if let Some(ttl) = cache.ttl_seconds {
                    cache_ttl = Some(ttl);
                    let ttl_string = ttl.to_string();
                    if config.get(CACHE_TTL_KEY).map(|value| value.as_str())
                        != Some(ttl_string.as_str())
                    {
                        config.insert(CACHE_TTL_KEY.to_string(), ttl_string);
                        config_updated = true;
                    }
                }
                if let Some(timestamp) = cache.timestamp.clone() {
                    if config.get(CACHE_TS_KEY).map(|value| value.as_str())
                        != Some(timestamp.as_str())
                    {
                        config.insert(CACHE_TS_KEY.to_string(), timestamp);
                        config_updated = true;
                    }
                }
            }
            if cache_ttl.is_some()
                && view.status.as_deref() != Some("error")
                && view.cache.is_some()
                && view
                    .cache
                    .as_ref()
                    .and_then(|cache| cache.timestamp.as_ref())
                    .is_none()
            {
                let now = Utc::now().to_rfc3339();
                if config.get(CACHE_TS_KEY).map(|value| value.as_str()) != Some(now.as_str()) {
                    config.insert(CACHE_TS_KEY.to_string(), now);
                    config_updated = true;
                }
            }
            if view.next_text.is_none() {
                let next_summary = if view.status.as_deref() == Some("error") {
                    summary.clone()
                } else {
                    view.summary.clone().or(summary.clone())
                };
                if let Some(next_summary) = next_summary {
                    if let Some(lang) = fence
                        .as_ref()
                        .map(|item| item.lang.clone())
                        .or_else(|| renderer_id.split('.').next().map(str::to_string))
                    {
                        let next_config_text = if config_updated {
                            serialize_plugin_config(&config)
                        } else {
                            config_text.clone()
                        };
                        view.next_text = Some(format_plugin_fence(
                            &lang,
                            next_config_text.as_str(),
                            &next_summary,
                        ));
                    }
                }
            }
            Ok(view)
        })
    }

    fn parse_block_view<'js>(
        &self,
        ctx: rquickjs::Ctx<'js>,
        value: JsValue<'js>,
        plugin_id: &str,
        renderer_id: &str,
        block_uid: &str,
    ) -> Result<PluginBlockView, PluginError> {
        let json_value = js_to_json(ctx, self.to_json_fn.clone(), value)?;
        let mut view: PluginBlockView =
            serde_json::from_value(json_value).map_err(PluginError::Serde)?;
        view.plugin_id = plugin_id.to_string();
        view.renderer_id = renderer_id.to_string();
        view.block_uid = block_uid.to_string();
        Ok(view)
    }
}

fn parse_plugin_fence(text: &str) -> Option<PluginFence> {
    let trimmed = text.trim();
    if !trimmed.starts_with("```") {
        return None;
    }
    let rest = trimmed.trim_start_matches("```").trim();
    let mut parts = rest.splitn(2, char::is_whitespace);
    let lang = parts.next()?.trim();
    let content = parts.next()?.trim();
    if lang.is_empty() || content.is_empty() {
        return None;
    }
    let (config_text, summary) = match content.split_once("::") {
        Some((left, right)) => (left.trim().to_string(), Some(right.trim().to_string())),
        None => (content.to_string(), None),
    };
    Some(PluginFence {
        lang: lang.to_lowercase(),
        config_text,
        summary,
    })
}

fn parse_plugin_config(text: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.peek() {
        if ch.is_whitespace() {
            chars.next();
            continue;
        }
        let mut key = String::new();
        while let Some(ch) = chars.peek() {
            if ch.is_whitespace() || *ch == '=' {
                break;
            }
            key.push(*ch);
            chars.next();
        }
        while let Some(ch) = chars.peek() {
            if *ch == '=' {
                chars.next();
                break;
            }
            if ch.is_whitespace() {
                chars.next();
            } else {
                break;
            }
        }
        if key.is_empty() {
            break;
        }
        let value = if let Some(quote) = chars.peek().copied() {
            if quote == '"' || quote == '\'' {
                chars.next();
                let mut val = String::new();
                for ch in chars.by_ref() {
                    if ch == quote {
                        break;
                    }
                    val.push(ch);
                }
                val
            } else {
                let mut val = String::new();
                while let Some(ch) = chars.peek() {
                    if ch.is_whitespace() {
                        break;
                    }
                    val.push(*ch);
                    chars.next();
                }
                val
            }
        } else {
            String::new()
        };
        map.insert(key, value);
    }
    map
}

fn read_cache_meta(config: &HashMap<String, String>) -> CacheMeta {
    let ttl_seconds = config
        .get(CACHE_TTL_KEY)
        .and_then(|value| value.parse::<u64>().ok());
    let timestamp = config.get(CACHE_TS_KEY).cloned();
    let stale = match (ttl_seconds, timestamp.as_deref()) {
        (Some(ttl), Some(stamp)) => parse_cache_timestamp(stamp)
            .map(|parsed| Utc::now() > parsed + Duration::seconds(ttl as i64))
            .unwrap_or(false),
        _ => false,
    };
    CacheMeta {
        ttl_seconds,
        timestamp,
        stale,
    }
}

fn parse_cache_timestamp(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|parsed| parsed.with_timezone(&Utc))
}

fn cache_meta_to_js<'js>(
    ctx: rquickjs::Ctx<'js>,
    meta: &CacheMeta,
) -> Result<JsValue<'js>, PluginError> {
    let obj = Object::new(ctx.clone())?;
    if let Some(ttl) = meta.ttl_seconds {
        obj.set("ttlSeconds", ttl)?;
    }
    if let Some(timestamp) = meta.timestamp.as_ref() {
        obj.set("timestamp", timestamp.as_str())?;
    }
    obj.set("stale", meta.stale)?;
    Ok(obj.into())
}

fn serialize_plugin_config(config: &HashMap<String, String>) -> String {
    if config.is_empty() {
        return String::new();
    }
    let mut entries = config.iter().collect::<Vec<_>>();
    entries.sort_by(|a, b| a.0.cmp(b.0));
    entries
        .into_iter()
        .map(|(key, value)| format_config_entry(key, value))
        .collect::<Vec<_>>()
        .join(" ")
}

fn format_config_entry(key: &str, value: &str) -> String {
    if value.is_empty() {
        return key.to_string();
    }
    let needs_quotes = value.chars().any(char::is_whitespace) || value.contains('"');
    if needs_quotes {
        let escaped = value.replace('"', "\\\"");
        format!("{key}=\"{escaped}\"")
    } else {
        format!("{key}={value}")
    }
}

fn config_to_js<'js>(
    ctx: rquickjs::Ctx<'js>,
    config: &HashMap<String, String>,
) -> Result<JsValue<'js>, PluginError> {
    let obj = Object::new(ctx.clone())?;
    for (key, value) in config {
        obj.set(key.as_str(), value.as_str())?;
    }
    Ok(obj.into())
}

fn merge_settings_with_overrides(
    stored: &Value,
    schema: Option<&PluginSettingsSchema>,
    config: &HashMap<String, String>,
) -> Value {
    let mut map = match stored {
        Value::Object(values) => values.clone(),
        _ => serde_json::Map::new(),
    };
    let schema = match schema {
        Some(schema) => schema,
        None => return Value::Object(map),
    };
    for (key, field) in &schema.properties {
        if let Some(raw) = config.get(key) {
            if let Some(value) = coerce_config_value(raw, field) {
                map.insert(key.clone(), value);
                continue;
            }
        }
        if !map.contains_key(key) {
            if let Some(default) = field.default.clone() {
                map.insert(key.clone(), default);
            }
        }
    }
    Value::Object(map)
}

fn coerce_config_value(raw: &str, field: &PluginSettingSchema) -> Option<Value> {
    match field.kind.as_deref().unwrap_or("string") {
        "boolean" => match raw.to_lowercase().as_str() {
            "true" | "1" => Some(Value::Bool(true)),
            "false" | "0" => Some(Value::Bool(false)),
            _ => None,
        },
        "integer" => raw
            .parse::<i64>()
            .ok()
            .map(|value| Value::Number(value.into())),
        "number" => raw
            .parse::<f64>()
            .ok()
            .and_then(|value| serde_json::Number::from_f64(value).map(Value::Number)),
        _ => Some(Value::String(raw.to_string())),
    }
}

fn json_to_js<'js>(ctx: rquickjs::Ctx<'js>, value: &Value) -> Result<JsValue<'js>, PluginError> {
    match value {
        Value::Null => Ok(JsValue::new_null(ctx.clone())),
        Value::Bool(val) => Ok(val.into_js(&ctx)?),
        Value::Number(val) => {
            if let Some(int) = val.as_i64() {
                Ok(int.into_js(&ctx)?)
            } else if let Some(float) = val.as_f64() {
                Ok(float.into_js(&ctx)?)
            } else {
                Ok(JsValue::new_null(ctx.clone()))
            }
        }
        Value::String(val) => Ok(val.as_str().into_js(&ctx)?),
        Value::Array(items) => {
            let array = rquickjs::Array::new(ctx.clone())?;
            for (index, item) in items.iter().enumerate() {
                array.set(index, json_to_js(ctx.clone(), item)?)?;
            }
            Ok(array.into())
        }
        Value::Object(map) => {
            let obj = Object::new(ctx.clone())?;
            for (key, item) in map {
                obj.set(key.as_str(), json_to_js(ctx.clone(), item)?)?;
            }
            Ok(obj.into())
        }
    }
}

fn js_to_json<'js>(
    ctx: rquickjs::Ctx<'js>,
    to_json_fn: Persistent<Function<'static>>,
    value: JsValue<'js>,
) -> Result<Value, PluginError> {
    let to_json = to_json_fn.restore(&ctx)?;
    let json_value: JsValue = to_json.call((value,))?;
    if json_value.is_undefined() {
        return Ok(Value::Null);
    }
    let json_string: String = FromJs::from_js(&ctx, json_value)?;
    serde_json::from_str(&json_string).map_err(PluginError::Serde)
}

fn format_plugin_fence(lang: &str, config: &str, summary: &str) -> String {
    if config.trim().is_empty() {
        format!("```{} :: {}", lang, summary)
    } else {
        format!("```{} {} :: {}", lang, config.trim(), summary)
    }
}

fn permission_blocked_view(
    plugin_id: &str,
    renderer_id: &str,
    block_uid: &str,
    missing: &[String],
) -> PluginBlockView {
    PluginBlockView {
        plugin_id: plugin_id.to_string(),
        renderer_id: renderer_id.to_string(),
        block_uid: block_uid.to_string(),
        summary: None,
        next_text: None,
        status: Some("error".to_string()),
        message: Some(format!("Missing permission: {}", missing.join(", "))),
        body: None,
        controls: Vec::new(),
        cache: None,
    }
}

fn runtime_error_from_caught(
    err: CaughtError<'_>,
    context: PluginErrorContext,
) -> PluginRuntimeError {
    match err {
        CaughtError::Exception(ex) => {
            PluginRuntimeError::new(ex.message().unwrap_or_else(|| "js-exception".to_string()))
                .with_stack(ex.stack())
                .with_context(context)
        }
        CaughtError::Value(value) => {
            PluginRuntimeError::new(format!("js-exception: {value:?}")).with_context(context)
        }
        CaughtError::Error(error) => {
            PluginRuntimeError::new(error.to_string()).with_context(context)
        }
    }
}

pub fn load_plugins_into_runtime(
    root: &Path,
    registry: &PluginRegistry,
) -> Result<PluginRuntimeLoadResult, PluginError> {
    let plugins = discover_plugins(root, registry)?;
    let mut runtime = PluginRuntime::new()?;
    runtime.load_plugins(&plugins, HashMap::new())
}

#[cfg(test)]
mod tests {
    use super::{
        check_manifest_compatibility, discover_plugins, install_plugin, list_plugins,
        parse_plugin_manifest, remove_plugin, update_plugin, PluginRegistry, PluginRuntime,
        PluginState,
    };
    use std::collections::HashMap;
    use std::fs;
    use std::path::PathBuf;
    use tempfile::tempdir;

    #[test]
    fn registry_persists_enabled_state() {
        let dir = tempdir().expect("tempdir");
        let registry = PluginRegistry::new(dir.path().join("plugins/state.json"));

        let state = registry.set_enabled("alpha", true).expect("set enabled");
        assert_eq!(state.enabled.get("alpha"), Some(&true));

        let loaded = registry.load_state().expect("load state");
        assert_eq!(loaded.enabled.get("alpha"), Some(&true));
    }

    #[test]
    fn discover_plugins_reads_manifests_and_state() {
        let dir = tempdir().expect("tempdir");
        let plugins_dir = dir.path().join("plugins");
        fs::create_dir_all(&plugins_dir).expect("plugins dir");

        let alpha_dir = plugins_dir.join("alpha");
        fs::create_dir_all(&alpha_dir).expect("alpha dir");
        fs::write(
            alpha_dir.join("plugin.json"),
            r#"{"id":"alpha","name":"Alpha","version":"0.1.0","permissions":["fs"]}"#,
        )
        .expect("write alpha manifest");

        let beta_dir = plugins_dir.join("beta");
        fs::create_dir_all(&beta_dir).expect("beta dir");
        fs::write(
            beta_dir.join("plugin.json"),
            r#"{"id":"beta","name":"Beta","version":"0.1.0"}"#,
        )
        .expect("write beta manifest");

        let registry = PluginRegistry::new(plugins_dir.join("state.json"));
        registry.set_enabled("beta", true).expect("enable beta");

        let plugins = discover_plugins(dir.path(), &registry).expect("discover");

        assert_eq!(plugins.len(), 2);
        assert_eq!(plugins[0].manifest.id, "alpha");
        assert!(!plugins[0].enabled);
        assert_eq!(plugins[1].manifest.id, "beta");
        assert!(plugins[1].enabled);
    }

    #[test]
    fn registry_loads_default_state() {
        let dir = tempdir().expect("tempdir");
        let registry = PluginRegistry::new(dir.path().join("plugins/state.json"));
        let state = registry.load_state().expect("load state");
        assert_eq!(state, PluginState::default());
    }

    fn write_test_plugin(root: &std::path::Path) -> (PathBuf, PathBuf) {
        let plugins_dir = root.join("plugins");
        fs::create_dir_all(&plugins_dir).expect("plugins dir");
        let plugin_dir = plugins_dir.join("weather");
        fs::create_dir_all(&plugin_dir).expect("plugin dir");
        let manifest_path = plugin_dir.join("plugin.json");
        fs::write(
            &manifest_path,
            r#"{
  "id": "weather",
  "name": "Weather",
  "version": "0.1.0",
  "main": "index.js",
  "permissions": ["network", "clipboard"]
}"#,
        )
        .expect("write manifest");
        let entry_path = plugin_dir.join("index.js");
        fs::write(
            &entry_path,
            r#"module.exports = (api) => {
  api.registerRenderer(
    {
      id: "weather.block",
      title: "Weather",
      kind: "block",
      languages: ["weather"],
      permissions: ["network"]
    },
    {
      render: (ctx) => {
        const city = ctx.config.city ?? "Unknown";
        return {
          summary: `Weather ${city}`,
          body: { kind: "text", text: `Forecast for ${city}` },
          controls: [
            { id: "refresh", type: "button", label: "Refresh" },
            {
              id: "units",
              type: "select",
              label: "Units",
              options: [
                { label: "C", value: "c" },
                { label: "F", value: "f" }
              ],
              value: ctx.config.units ?? "c"
            }
          ]
        };
      },
      onAction: () => ({
        summary: "Refreshed",
        body: { kind: "text", text: "Updated forecast" }
      })
    }
  );
};"#,
        )
        .expect("write plugin entry");
        (plugins_dir, entry_path)
    }

    fn write_permission_probe_plugin(
        root: &std::path::Path,
        renderer_permissions: &[&str],
        include_clipboard: bool,
    ) -> PathBuf {
        let plugins_dir = root.join("plugins");
        fs::create_dir_all(&plugins_dir).expect("plugins dir");
        let plugin_dir = plugins_dir.join("probe");
        fs::create_dir_all(&plugin_dir).expect("plugin dir");
        let manifest_path = plugin_dir.join("plugin.json");
        fs::write(
            &manifest_path,
            r#"{
  "id": "probe",
  "name": "Probe",
  "version": "0.1.0",
  "main": "index.js",
  "permissions": ["network", "clipboard"]
}"#,
        )
        .expect("write manifest");
        let entry_path = plugin_dir.join("index.js");
        let permissions = renderer_permissions
            .iter()
            .map(|item| format!("\"{}\"", item))
            .collect::<Vec<_>>()
            .join(", ");
        let clipboard_control = if include_clipboard {
            r#",
          controls: [
            {
              id: "copy",
              type: "clipboard",
              label: "Copy",
              text: "payload"
            }
          ]"#
        } else {
            ""
        };
        let source = format!(
            r#"module.exports = (api) => {{
  api.registerRenderer(
    {{
      id: "probe.block",
      title: "Probe",
      kind: "block",
      languages: ["probe"],
      permissions: [{permissions}]
    }},
    {{
      render: (ctx) => {{
        return {{
          summary: ctx.network ? "has-network" : "no-network"{clipboard_control}
        }};
      }}
    }}
  );
}};"#,
            permissions = permissions,
            clipboard_control = clipboard_control
        );
        fs::write(&entry_path, source).expect("write plugin entry");
        plugins_dir
    }

    fn write_cache_plugin(root: &std::path::Path, body: &str) -> PathBuf {
        let plugins_dir = root.join("plugins");
        fs::create_dir_all(&plugins_dir).expect("plugins dir");
        let plugin_dir = plugins_dir.join("cache");
        fs::create_dir_all(&plugin_dir).expect("plugin dir");
        let manifest_path = plugin_dir.join("plugin.json");
        fs::write(
            &manifest_path,
            r#"{
  "id": "cache",
  "name": "Cache",
  "version": "0.1.0",
  "main": "index.js"
}"#,
        )
        .expect("write manifest");
        let entry_path = plugin_dir.join("index.js");
        let source = format!(
            r#"module.exports = (api) => {{
  api.registerRenderer(
    {{
      id: "cache.block",
      title: "Cache",
      kind: "block",
      languages: ["cache"]
    }},
    {{
      render: (ctx) => {{
        {body}
      }}
    }}
  );
}};"#,
            body = body
        );
        fs::write(&entry_path, source).expect("write plugin entry");
        plugins_dir
    }

    fn write_source_plugin(root: &std::path::Path, id: &str, entry: &str) -> PathBuf {
        let source_root = root.join("source");
        fs::create_dir_all(&source_root).expect("source root");
        let plugin_dir = source_root.join(id);
        fs::create_dir_all(&plugin_dir).expect("plugin dir");
        let manifest_path = plugin_dir.join("plugin.json");
        fs::write(
            &manifest_path,
            format!(
                r#"{{
  "id": "{id}",
  "name": "Source {id}",
  "version": "0.1.0",
  "main": "index.js"
}}"#
            ),
        )
        .expect("write manifest");
        let entry_path = plugin_dir.join("index.js");
        fs::write(&entry_path, entry).expect("write entry");
        plugin_dir
    }

    #[test]
    fn list_plugins_maps_manifest_fields() {
        let dir = tempdir().expect("tempdir");
        let plugins_dir = dir.path().join("plugins");
        fs::create_dir_all(&plugins_dir).expect("plugins dir");

        let alpha_dir = plugins_dir.join("alpha");
        fs::create_dir_all(&alpha_dir).expect("alpha dir");
        fs::write(
            alpha_dir.join("plugin.json"),
            r#"{"id":"alpha","name":"Alpha","version":"0.1.0","description":"Alpha plugin","permissions":["fs"]}"#,
        )
        .expect("write alpha manifest");

        let registry = PluginRegistry::new(plugins_dir.join("state.json"));
        registry.set_enabled("alpha", true).expect("enable alpha");

        let plugins = list_plugins(dir.path(), &registry).expect("list plugins");
        assert_eq!(plugins.len(), 1);
        assert_eq!(plugins[0].id, "alpha");
        assert!(plugins[0].enabled);
        assert_eq!(plugins[0].permissions, vec!["fs".to_string()]);
    }

    #[test]
    fn install_plugin_copies_folder_and_enables() {
        let dir = tempdir().expect("tempdir");
        let source_dir = dir.path().join("source");
        fs::create_dir_all(&source_dir).expect("source dir");
        fs::write(
            source_dir.join("plugin.json"),
            r#"{"id":"alpha","name":"Alpha","version":"0.1.0"}"#,
        )
        .expect("write manifest");
        fs::write(source_dir.join("index.js"), "module.exports = () => {};").expect("write entry");

        let registry = PluginRegistry::new(dir.path().join("plugins/state.json"));
        let info = install_plugin(dir.path(), &registry, &source_dir).expect("install");

        let dest_dir = dir.path().join("plugins").join("alpha");
        assert!(dest_dir.join("plugin.json").exists());
        assert!(dest_dir.join("index.js").exists());
        assert_eq!(info.id, "alpha");
        assert!(registry.is_enabled("alpha").expect("enabled"));
    }

    #[test]
    fn registry_tracks_install_source() {
        let dir = tempdir().expect("tempdir");
        let registry = PluginRegistry::new(dir.path().join("plugins/state.json"));

        registry
            .set_install_source("alpha", "/tmp/alpha")
            .expect("set source");
        let stored = registry.get_install_source("alpha").expect("get source");
        assert_eq!(stored.as_deref(), Some("/tmp/alpha"));

        registry
            .clear_install_source("alpha")
            .expect("clear source");
        let stored = registry
            .get_install_source("alpha")
            .expect("get source after clear");
        assert!(stored.is_none());
    }

    #[test]
    fn update_plugin_reinstalls_from_source() {
        let dir = tempdir().expect("tempdir");
        let source_dir = write_source_plugin(dir.path(), "alpha", "// v1\n");
        let registry = PluginRegistry::new(dir.path().join("plugins/state.json"));
        install_plugin(dir.path(), &registry, &source_dir).expect("install");

        fs::write(source_dir.join("index.js"), "// v2\n").expect("update source");

        update_plugin(dir.path(), &registry, "alpha").expect("update");
        let dest_path = dir.path().join("plugins").join("alpha").join("index.js");
        let dest_contents = fs::read_to_string(dest_path).expect("read dest");
        assert!(dest_contents.contains("v2"));
    }

    #[test]
    fn remove_plugin_deletes_folder_and_state() {
        let dir = tempdir().expect("tempdir");
        let source_dir = write_source_plugin(dir.path(), "alpha", "// v1\n");
        let registry = PluginRegistry::new(dir.path().join("plugins/state.json"));
        install_plugin(dir.path(), &registry, &source_dir).expect("install");

        let dest_path = dir.path().join("plugins").join("alpha");
        assert!(dest_path.exists());

        remove_plugin(dir.path(), &registry, "alpha").expect("remove");

        assert!(!dest_path.exists());
        assert!(!registry.is_enabled("alpha").expect("enabled"));
        assert!(registry
            .get_install_source("alpha")
            .expect("get source")
            .is_none());
    }

    #[test]
    fn manifest_validation_rejects_unknown_permissions() {
        let raw = r#"{"id":"alpha","name":"Alpha","version":"0.1.0","permissions":["network","telepathy"]}"#;
        let err = parse_plugin_manifest(raw).expect_err("invalid manifest");
        match err {
            super::PluginError::Runtime(err) => {
                assert!(err.message.contains("permission-unknown"));
            }
            _ => panic!("unexpected error"),
        }
    }

    #[test]
    fn manifest_validation_rejects_invalid_version() {
        let raw = r#"{"id":"alpha","name":"Alpha","version":"not-a-version"}"#;
        let err = parse_plugin_manifest(raw).expect_err("invalid manifest");
        match err {
            super::PluginError::Runtime(err) => {
                assert!(err.message.contains("version-invalid"));
            }
            _ => panic!("unexpected error"),
        }
    }

    #[test]
    fn manifest_compatibility_blocks_incompatible_api() {
        let raw = r#"{
  "id": "alpha",
  "name": "Alpha",
  "version": "0.1.0",
  "apiVersion": { "min": "99.0.0" }
}"#;
        let manifest = parse_plugin_manifest(raw).expect("manifest");
        let err = check_manifest_compatibility(&manifest).expect_err("compat");
        match err {
            super::PluginError::Runtime(err) => {
                assert!(err.message.contains("api-version"));
            }
            _ => panic!("unexpected error"),
        }
    }

    #[test]
    fn manifest_compatibility_blocks_incompatible_host() {
        let raw = r#"{
  "id": "alpha",
  "name": "Alpha",
  "version": "0.1.0",
  "appVersion": { "min": "99.0.0" }
}"#;
        let manifest = parse_plugin_manifest(raw).expect("manifest");
        let err = check_manifest_compatibility(&manifest).expect_err("compat");
        match err {
            super::PluginError::Runtime(err) => {
                assert!(err.message.contains("host-version"));
            }
            _ => panic!("unexpected error"),
        }
    }

    #[test]
    fn load_plugins_into_runtime_roundtrip() {
        let dir = tempdir().expect("tempdir");
        let (plugins_dir, _entry_path) = write_test_plugin(dir.path());
        let registry = PluginRegistry::new(plugins_dir.join("state.json"));
        let mut runtime = PluginRuntime::new().expect("runtime");
        let plugins = discover_plugins(dir.path(), &registry).expect("discover");
        let result = runtime
            .load_plugins(&plugins, HashMap::new())
            .expect("load");
        assert_eq!(result.loaded, vec!["weather".to_string()]);
        assert_eq!(result.renderers.len(), 1);
        assert_eq!(result.renderers[0].kind, "block");
    }

    #[test]
    fn runtime_renders_block_with_summary() {
        let dir = tempdir().expect("tempdir");
        let (plugins_dir, _entry_path) = write_test_plugin(dir.path());
        let registry = PluginRegistry::new(plugins_dir.join("state.json"));
        let mut runtime = PluginRuntime::new().expect("runtime");
        let plugins = discover_plugins(dir.path(), &registry).expect("discover");
        runtime
            .load_plugins(&plugins, HashMap::new())
            .expect("load");

        let view = runtime
            .render_block(
                "weather",
                "weather.block",
                "b1",
                "```weather city=Seattle units=c",
            )
            .expect("render block");
        assert_eq!(view.summary.as_deref(), Some("Weather Seattle"));
        assert!(view
            .next_text
            .as_deref()
            .unwrap_or_default()
            .contains("Weather Seattle"));
        assert_eq!(view.controls.len(), 2);
    }

    #[test]
    fn runtime_block_action_updates_view() {
        let dir = tempdir().expect("tempdir");
        let (plugins_dir, _entry_path) = write_test_plugin(dir.path());
        let registry = PluginRegistry::new(plugins_dir.join("state.json"));
        let mut runtime = PluginRuntime::new().expect("runtime");
        let plugins = discover_plugins(dir.path(), &registry).expect("discover");
        runtime
            .load_plugins(&plugins, HashMap::new())
            .expect("load");

        let view = runtime
            .handle_block_action(
                "weather",
                "weather.block",
                "b1",
                "```weather city=Seattle units=c",
                "refresh",
                None,
            )
            .expect("action");
        assert_eq!(view.summary.as_deref(), Some("Refreshed"));
    }

    #[test]
    fn runtime_denies_network_without_renderer_permission() {
        let dir = tempdir().expect("tempdir");
        let plugins_dir = write_permission_probe_plugin(dir.path(), &[], false);
        let registry = PluginRegistry::new(plugins_dir.join("state.json"));
        let mut runtime = PluginRuntime::new().expect("runtime");
        let plugins = discover_plugins(dir.path(), &registry).expect("discover");
        runtime
            .load_plugins(&plugins, HashMap::new())
            .expect("load");

        let view = runtime
            .render_block("probe", "probe.block", "b1", "```probe")
            .expect("render");
        assert_eq!(view.summary.as_deref(), Some("no-network"));
    }

    #[test]
    fn runtime_allows_network_with_renderer_permission() {
        let dir = tempdir().expect("tempdir");
        let plugins_dir = write_permission_probe_plugin(dir.path(), &["network"], false);
        let registry = PluginRegistry::new(plugins_dir.join("state.json"));
        let mut runtime = PluginRuntime::new().expect("runtime");
        let plugins = discover_plugins(dir.path(), &registry).expect("discover");
        runtime
            .load_plugins(&plugins, HashMap::new())
            .expect("load");

        let view = runtime
            .render_block("probe", "probe.block", "b1", "```probe")
            .expect("render");
        assert_eq!(view.summary.as_deref(), Some("has-network"));
    }

    #[test]
    fn runtime_blocks_clipboard_control_without_permission() {
        let dir = tempdir().expect("tempdir");
        let plugins_dir = write_permission_probe_plugin(dir.path(), &[], true);
        let registry = PluginRegistry::new(plugins_dir.join("state.json"));
        let mut runtime = PluginRuntime::new().expect("runtime");
        let plugins = discover_plugins(dir.path(), &registry).expect("discover");
        runtime
            .load_plugins(&plugins, HashMap::new())
            .expect("load");

        let view = runtime
            .render_block("probe", "probe.block", "b1", "```probe")
            .expect("render");
        assert_eq!(view.status.as_deref(), Some("error"));
        assert!(view
            .message
            .as_deref()
            .unwrap_or_default()
            .contains("clipboard"));
    }

    #[test]
    fn runtime_preserves_cached_summary_on_error() {
        let dir = tempdir().expect("tempdir");
        let plugins_dir = write_cache_plugin(
            dir.path(),
            r#"return { status: "error", summary: "Error summary" };"#,
        );
        let registry = PluginRegistry::new(plugins_dir.join("state.json"));
        let mut runtime = PluginRuntime::new().expect("runtime");
        let plugins = discover_plugins(dir.path(), &registry).expect("discover");
        runtime
            .load_plugins(&plugins, HashMap::new())
            .expect("load");

        let view = runtime
            .render_block(
                "cache",
                "cache.block",
                "b1",
                "```cache region=us :: Cached summary",
            )
            .expect("render");
        assert!(view
            .next_text
            .as_deref()
            .unwrap_or_default()
            .contains("Cached summary"));
    }

    #[test]
    fn runtime_writes_cache_metadata_to_next_text() {
        let dir = tempdir().expect("tempdir");
        let plugins_dir = write_cache_plugin(
            dir.path(),
            r#"return { summary: "Updated", cache: { ttlSeconds: 60 } };"#,
        );
        let registry = PluginRegistry::new(plugins_dir.join("state.json"));
        let mut runtime = PluginRuntime::new().expect("runtime");
        let plugins = discover_plugins(dir.path(), &registry).expect("discover");
        runtime
            .load_plugins(&plugins, HashMap::new())
            .expect("load");

        let view = runtime
            .render_block("cache", "cache.block", "b1", "```cache")
            .expect("render");
        let next_text = view.next_text.as_deref().unwrap_or_default();
        assert!(next_text.contains("cache_ttl=60"));
        assert!(next_text.contains("cache_ts="));
    }

    #[test]
    fn runtime_exposes_cache_stale_flag() {
        let dir = tempdir().expect("tempdir");
        let plugins_dir = write_cache_plugin(
            dir.path(),
            r#"return { summary: ctx.cache.stale ? "stale" : "fresh" };"#,
        );
        let registry = PluginRegistry::new(plugins_dir.join("state.json"));
        let mut runtime = PluginRuntime::new().expect("runtime");
        let plugins = discover_plugins(dir.path(), &registry).expect("discover");
        runtime
            .load_plugins(&plugins, HashMap::new())
            .expect("load");

        let view = runtime
            .render_block(
                "cache",
                "cache.block",
                "b1",
                "```cache cache_ttl=60 cache_ts=2000-01-01T00:00:00Z",
            )
            .expect("render");
        assert_eq!(view.summary.as_deref(), Some("stale"));
    }

    #[test]
    fn runtime_registers_toolbar_actions() {
        let dir = tempdir().expect("tempdir");
        let plugins_dir = write_toolbar_action_plugin(dir.path());
        let registry = PluginRegistry::new(plugins_dir.join("state.json"));
        let mut runtime = PluginRuntime::new().expect("runtime");
        let plugins = discover_plugins(dir.path(), &registry).expect("discover");

        let result = runtime
            .load_plugins(&plugins, HashMap::new())
            .expect("load");

        assert_eq!(result.toolbar_actions.len(), 1);
        let action = &result.toolbar_actions[0];
        assert_eq!(action.plugin_id, "toolbar");
        assert_eq!(action.id, "toolbar.action");
        assert_eq!(action.title, "Do action");
        assert_eq!(action.tooltip.as_deref(), Some("Do it"));
    }

    fn write_toolbar_action_plugin(root: &std::path::Path) -> PathBuf {
        let plugins_dir = root.join("plugins");
        fs::create_dir_all(&plugins_dir).expect("plugins dir");
        let plugin_dir = plugins_dir.join("toolbar");
        fs::create_dir_all(&plugin_dir).expect("plugin dir");
        fs::write(
            plugin_dir.join("plugin.json"),
            r#"{
  "id": "toolbar",
  "name": "Toolbar Test",
  "version": "0.1.0",
  "main": "index.js"
}"#,
        )
        .expect("write manifest");
        fs::write(
            plugin_dir.join("index.js"),
            r#"module.exports = (api) => {
  api.registerToolbarAction(
    { id: "toolbar.action", title: "Do action", tooltip: "Do it" },
    () => {}
  );
};"#,
        )
        .expect("write plugin entry");
        plugins_dir
    }

    fn write_settings_plugin(root: &std::path::Path) -> PathBuf {
        let plugins_dir = root.join("plugins");
        fs::create_dir_all(&plugins_dir).expect("plugins dir");
        let plugin_dir = plugins_dir.join("settings");
        fs::create_dir_all(&plugin_dir).expect("plugin dir");
        let manifest_path = plugin_dir.join("plugin.json");
        fs::write(
            &manifest_path,
            r#"{
  "id": "settings",
  "name": "Settings",
  "version": "0.1.0",
  "main": "index.js",
  "settingsSchema": {
    "type": "object",
    "properties": {
      "units": { "type": "string", "default": "c" }
    }
  }
}"#,
        )
        .expect("write manifest");
        let entry_path = plugin_dir.join("index.js");
        fs::write(
            &entry_path,
            r#"module.exports = (api) => {
  api.registerRenderer(
    {
      id: "settings.block",
      title: "Settings",
      kind: "block",
      languages: ["settings"]
    },
    {
      render: (ctx) => {
        return { summary: ctx.settings.units };
      }
    }
  );
};"#,
        )
        .expect("write plugin entry");
        plugins_dir
    }

    #[test]
    fn runtime_applies_settings_defaults() {
        let dir = tempdir().expect("tempdir");
        let plugins_dir = write_settings_plugin(dir.path());
        let registry = PluginRegistry::new(plugins_dir.join("state.json"));
        let mut runtime = PluginRuntime::new().expect("runtime");
        let plugins = discover_plugins(dir.path(), &registry).expect("discover");
        runtime
            .load_plugins(&plugins, HashMap::new())
            .expect("load");

        let view = runtime
            .render_block("settings", "settings.block", "b1", "```settings")
            .expect("render");
        assert_eq!(view.summary.as_deref(), Some("c"));
    }

    #[test]
    fn runtime_overrides_settings_with_block_config() {
        let dir = tempdir().expect("tempdir");
        let plugins_dir = write_settings_plugin(dir.path());
        let registry = PluginRegistry::new(plugins_dir.join("state.json"));
        let mut runtime = PluginRuntime::new().expect("runtime");
        let plugins = discover_plugins(dir.path(), &registry).expect("discover");
        let mut settings = HashMap::new();
        settings.insert("settings".to_string(), serde_json::json!({ "units": "f" }));
        runtime.load_plugins(&plugins, settings).expect("load");

        let view = runtime
            .render_block("settings", "settings.block", "b1", "```settings units=c")
            .expect("render");
        assert_eq!(view.summary.as_deref(), Some("c"));
    }
}
