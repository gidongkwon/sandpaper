use rquickjs::{
    function::Opt, Context, FromJs, Function, IntoJs, Object, Persistent, Runtime,
    Value as JsValue,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub enum PluginError {
    Io(std::io::Error),
    Serde(serde_json::Error),
    Runtime(String),
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
        Self::Runtime(err.to_string())
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
    #[serde(default)]
    pub main: Option<String>,
    #[serde(default)]
    pub settings: Vec<PluginSetting>,
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
    pub enabled: bool,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct PluginState {
    #[serde(default)]
    pub enabled: HashMap<String, bool>,
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

    pub fn is_enabled(&self, plugin_id: &str) -> Result<bool, PluginError> {
        let state = self.load_state()?;
        Ok(state.enabled.get(plugin_id).copied().unwrap_or(false))
    }
}

pub fn discover_plugins(root: &Path, registry: &PluginRegistry) -> Result<Vec<PluginDescriptor>, PluginError> {
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
        let manifest: PluginManifest = serde_json::from_str(&raw)?;
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

pub fn list_plugins(root: &Path, registry: &PluginRegistry) -> Result<Vec<PluginInfo>, PluginError> {
    let plugins = discover_plugins(root, registry)?;
    Ok(plugins
        .into_iter()
        .map(|plugin| PluginInfo {
            id: plugin.manifest.id,
            name: plugin.manifest.name,
            version: plugin.manifest.version,
            description: plugin.manifest.description,
            permissions: plugin.manifest.permissions,
            enabled: plugin.enabled,
            path: plugin.path.to_string_lossy().to_string(),
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
        return Err(PluginError::Runtime("plugin-source-missing".to_string()));
    }
    if !source_dir.is_dir() {
        return Err(PluginError::Runtime("plugin-source-not-directory".to_string()));
    }
    let manifest_path = source_dir.join("plugin.json");
    if !manifest_path.exists() {
        return Err(PluginError::Runtime("plugin-manifest-missing".to_string()));
    }
    let raw = fs::read_to_string(&manifest_path)?;
    let manifest: PluginManifest = serde_json::from_str(&raw)?;
    if manifest.id.contains('/') || manifest.id.contains('\\') {
        return Err(PluginError::Runtime("plugin-id-invalid".to_string()));
    }

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
            return Err(PluginError::Runtime("plugin-already-installed".to_string()));
        }
    } else {
        copy_dir_recursive(source_dir, &dest_dir)?;
        registry.set_enabled(&manifest.id, true)?;
    }

    Ok(PluginInfo {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        permissions: manifest.permissions,
        enabled: true,
        path: dest_dir.to_string_lossy().to_string(),
    })
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
}

struct PluginFence {
    lang: String,
    config_text: String,
    summary: Option<String>,
}

pub struct PluginRuntime {
    registry: std::rc::Rc<std::cell::RefCell<PluginRuntimeRegistry>>,
    load_plugin_fn: Persistent<Function<'static>>,
    to_json_fn: Persistent<Function<'static>>,
    settings: HashMap<String, Value>,
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
            registry: std::rc::Rc::new(std::cell::RefCell::new(
                PluginRuntimeRegistry::default(),
            )),
            load_plugin_fn,
            to_json_fn,
            settings: HashMap::new(),
        })
    }

    pub fn load_plugins(
        &mut self,
        plugins: &[PluginDescriptor],
        settings: HashMap<String, Value>,
    ) -> Result<PluginRuntimeLoadResult, PluginError> {
        self.settings = settings;
        let registry = std::rc::Rc::new(std::cell::RefCell::new(PluginRuntimeRegistry::default()));
        self.registry = registry.clone();
        let loaded_ids = plugins
            .iter()
            .map(|plugin| plugin.manifest.id.clone())
            .collect::<Vec<_>>();

        let load_plugin_fn = self.load_plugin_fn.clone();
        self.context.with(|ctx| {
            for plugin in plugins {
                let api =
                    Self::build_api(ctx.clone(), registry.clone(), &plugin.manifest.id)?;
                let entry = plugin
                    .manifest
                    .main
                    .clone()
                    .unwrap_or_else(|| "index.js".to_string());
                let entry_path = plugin.path.join(entry);
                let source = fs::read_to_string(&entry_path)?;
                let load_fn = load_plugin_fn.clone().restore(&ctx)?;
                let exports: JsValue = load_fn.call((source, api.clone()))?;
                if let Ok(register_fn) = Function::from_value(exports.clone()) {
                    let _ = register_fn.call::<_, JsValue>((api,))?;
                } else if let Ok(exports_obj) = Object::from_value(exports.clone()) {
                    if let Ok(default_fn) = exports_obj.get::<_, Function>("default") {
                        let _ = default_fn.call::<_, JsValue>((api,))?;
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
        self.call_block_handler(
            plugin_id,
            renderer_id,
            block_uid,
            text,
            None,
            None,
        )
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
                .ok_or_else(|| PluginError::Runtime("renderer-not-found".to_string()))?;
            if action_id.is_some() {
                handlers.on_action.clone()
            } else {
                handlers.render.clone()
            }
        }
        .ok_or_else(|| PluginError::Runtime("render-handler-missing".to_string()))?;

        let fence = parse_plugin_fence(text);
        let config = fence
            .as_ref()
            .map(|f| parse_plugin_config(&f.config_text))
            .unwrap_or_default();
        let summary = fence.as_ref().and_then(|f| f.summary.clone());

        let settings = self
            .settings
            .get(plugin_id)
            .cloned()
            .unwrap_or(Value::Object(serde_json::Map::new()));

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
                        response.set("ok", status >= 200 && status < 300)?;
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

            if let Some(action_id) = action_id {
                let action_obj = Object::new(ctx.clone())?;
                action_obj.set("id", action_id)?;
                if let Some(value) = action_value {
                    action_obj.set("value", json_to_js(ctx.clone(), &value)?)?;
                }
                ctx_obj.set("action", action_obj)?;
            }

            let handler_fn = handler.restore(&ctx)?;
            let value: JsValue = handler_fn.call((ctx_obj,))?;
            let mut view =
                self.parse_block_view(ctx, value, plugin_id, renderer_id, block_uid)?;
            if view.next_text.is_none() {
                if let Some(next_summary) = view.summary.clone().or(summary.clone()) {
                    if let Some(lang) = fence
                        .as_ref()
                        .map(|item| item.lang.clone())
                        .or_else(|| renderer_id.split('.').next().map(str::to_string))
                    {
                        let config_text = fence
                            .as_ref()
                            .map(|item| item.config_text.as_str())
                            .unwrap_or("");
                        view.next_text =
                            Some(format_plugin_fence(&lang, config_text, &next_summary));
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
                while let Some(ch) = chars.next() {
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
        discover_plugins, install_plugin, list_plugins, PluginRegistry, PluginRuntime, PluginState,
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
        assert_eq!(plugins[0].enabled, false);
        assert_eq!(plugins[1].manifest.id, "beta");
        assert_eq!(plugins[1].enabled, true);
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
      languages: ["weather"]
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
        assert_eq!(plugins[0].enabled, true);
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
        fs::write(source_dir.join("index.js"), "module.exports = () => {};")
            .expect("write entry");

        let registry = PluginRegistry::new(dir.path().join("plugins/state.json"));
        let info = install_plugin(dir.path(), &registry, &source_dir).expect("install");

        let dest_dir = dir.path().join("plugins").join("alpha");
        assert!(dest_dir.join("plugin.json").exists());
        assert!(dest_dir.join("index.js").exists());
        assert_eq!(info.id, "alpha");
        assert!(registry.is_enabled("alpha").expect("enabled"));
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
}
