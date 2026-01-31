use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub permissions: Vec<String>,
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

#[derive(Debug, Serialize, Deserialize)]
struct RuntimeRequest {
    id: u64,
    method: String,
    params: Value,
}

#[derive(Debug, Serialize, Deserialize)]
struct RuntimeResponse {
    id: Option<u64>,
    result: Option<Value>,
    error: Option<String>,
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
}

pub struct PluginRuntime {
    script_path: PathBuf,
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_id: u64,
}

impl PluginRuntime {
    pub fn new(script_path: PathBuf) -> Result<Self, PluginError> {
        let (child, stdin, stdout) = Self::spawn_process(&script_path)?;
        Ok(Self {
            script_path,
            child,
            stdin,
            stdout,
            next_id: 1,
        })
    }

    fn spawn_process(
        script_path: &Path,
    ) -> Result<(Child, ChildStdin, BufReader<ChildStdout>), PluginError> {
        let mut child = Command::new("node")
            .arg(script_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| PluginError::Runtime("stdin-unavailable".to_string()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| PluginError::Runtime("stdout-unavailable".to_string()))?;
        Ok((child, stdin, BufReader::new(stdout)))
    }

    fn restart(&mut self) -> Result<(), PluginError> {
        let _ = self.child.kill();
        let (child, stdin, stdout) = Self::spawn_process(&self.script_path)?;
        self.child = child;
        self.stdin = stdin;
        self.stdout = stdout;
        self.next_id = 1;
        Ok(())
    }

    fn call_once(&mut self, method: &str, params: &Value) -> Result<Value, PluginError> {
        let id = self.next_id;
        self.next_id += 1;
        let request = RuntimeRequest {
            id,
            method: method.to_string(),
            params: params.clone(),
        };
        let payload = serde_json::to_string(&request)?;

        self.stdin.write_all(payload.as_bytes())?;
        self.stdin.write_all(b"\n")?;
        self.stdin.flush()?;

        let mut line = String::new();
        let bytes = self.stdout.read_line(&mut line)?;
        if bytes == 0 {
            return Err(PluginError::Runtime("runtime-exited".to_string()));
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return Err(PluginError::Runtime("empty-response".to_string()));
        }
        let response: RuntimeResponse = serde_json::from_str(trimmed)?;
        if response.id != Some(id) {
            return Err(PluginError::Runtime("mismatched-response-id".to_string()));
        }
        if let Some(error) = response.error {
            return Err(PluginError::Runtime(error));
        }
        response
            .result
            .ok_or_else(|| PluginError::Runtime("missing-result".to_string()))
    }

    fn call(&mut self, method: &str, params: Value) -> Result<Value, PluginError> {
        for attempt in 0..2 {
            match self.call_once(method, &params) {
                Ok(result) => return Ok(result),
                Err(PluginError::Runtime(message)) if message == "runtime-exited" && attempt == 0 => {
                    self.restart()?;
                }
                Err(err) => return Err(err),
            }
        }
        Err(PluginError::Runtime("runtime-exited".to_string()))
    }

    pub fn ping(&mut self) -> Result<Value, PluginError> {
        self.call("ping", json!({}))
    }

    pub fn load_plugins(
        &mut self,
        plugins: &[PluginDescriptor],
    ) -> Result<PluginRuntimeLoadResult, PluginError> {
        let payload = json!({
            "plugins": plugins
                .iter()
                .map(|plugin| {
                    json!({
                        "id": plugin.manifest.id,
                        "name": plugin.manifest.name,
                        "version": plugin.manifest.version
                    })
                })
                .collect::<Vec<_>>()
        });
        let result = self.call("loadPlugins", payload)?;
        Ok(serde_json::from_value(result)?)
    }

    pub fn emit_event(
        &mut self,
        plugin_id: &str,
        event: &str,
        payload: Value,
    ) -> Result<Value, PluginError> {
        let result = self.call(
            "emitEvent",
            json!({
                "plugin_id": plugin_id,
                "event": event,
                "payload": payload
            }),
        )?;
        Ok(result)
    }
}

impl Drop for PluginRuntime {
    fn drop(&mut self) {
        let _ = self
            .stdin
            .write_all(b"{\"id\":0,\"method\":\"shutdown\",\"params\":{}}\n");
        let _ = self.stdin.flush();
        let _ = self.child.kill();
    }
}

pub fn runtime_script_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../plugin-runtime/sandbox-runtime.mjs")
}

pub fn load_plugins_into_runtime(
    root: &Path,
    registry: &PluginRegistry,
) -> Result<PluginRuntimeLoadResult, PluginError> {
    let plugins = discover_plugins(root, registry)?;
    let mut runtime = PluginRuntime::new(runtime_script_path())?;
    runtime.load_plugins(&plugins)
}

#[cfg(test)]
mod tests {
    use super::{
        discover_plugins, list_plugins, PluginDescriptor, PluginManifest, PluginRegistry,
        PluginRuntime, PluginState,
    };
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

    fn write_runtime_script(root: &std::path::Path) -> PathBuf {
        let script_path = root.join("runtime.mjs");
        fs::write(
            &script_path,
            r#"import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const respond = (payload) => process.stdout.write(`${JSON.stringify(payload)}\n`);
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "ping") {
    respond({ id: msg.id, result: { ok: true } });
    return;
  }
  if (msg.method === "loadPlugins") {
    const ids = (msg.params?.plugins ?? []).map((plugin) => plugin.id);
    const commands = ids.map((id) => ({
      plugin_id: id,
      id: `${id}.open`,
      title: `Open ${id}`
    }));
    const panels = ids.map((id) => ({
      plugin_id: id,
      id: `${id}.panel`,
      title: `${id} panel`,
      location: "sidebar"
    }));
    const toolbar_actions = ids.map((id) => ({
      plugin_id: id,
      id: `${id}.toolbar`,
      title: `Launch ${id}`,
      tooltip: `Launch ${id}`
    }));
    const renderers = ids.flatMap((id) => ([
      {
        plugin_id: id,
        id: `${id}.renderer.code`,
        title: "Code block renderer",
        kind: "code"
      },
      {
        plugin_id: id,
        id: `${id}.renderer.diagram`,
        title: "Diagram renderer",
        kind: "diagram"
      }
    ]));
    respond({ id: msg.id, result: { loaded: ids, commands, panels, toolbar_actions, renderers } });
    return;
  }
  if (msg.method === "emitEvent") {
    respond({ id: msg.id, result: { ok: true } });
    return;
  }
  if (msg.method === "shutdown") {
    respond({ id: msg.id, result: { ok: true } });
    rl.close();
    return;
  }
  respond({ id: msg.id, error: "unknown" });
});
"#,
        )
        .expect("write script");
        script_path
    }

    #[test]
    fn runtime_ping_returns_ok() {
        let dir = tempdir().expect("tempdir");
        let script_path = write_runtime_script(dir.path());
        let mut runtime = PluginRuntime::new(script_path).expect("runtime");
        let result = runtime.ping().expect("ping");
        assert_eq!(result["ok"], true);
    }

    #[test]
    fn runtime_load_plugins_returns_ids() {
        let dir = tempdir().expect("tempdir");
        let script_path = write_runtime_script(dir.path());
        let mut runtime = PluginRuntime::new(script_path).expect("runtime");
        let plugins = vec![
            PluginDescriptor {
                manifest: PluginManifest {
                    id: "alpha".to_string(),
                    name: "Alpha".to_string(),
                    version: "0.1.0".to_string(),
                    description: None,
                    permissions: vec![],
                },
                path: dir.path().join("alpha"),
                enabled: true,
            },
            PluginDescriptor {
                manifest: PluginManifest {
                    id: "beta".to_string(),
                    name: "Beta".to_string(),
                    version: "0.1.0".to_string(),
                    description: None,
                    permissions: vec![],
                },
                path: dir.path().join("beta"),
                enabled: false,
            },
        ];

        let result = runtime.load_plugins(&plugins).expect("load plugins");
        assert_eq!(result.loaded, vec!["alpha".to_string(), "beta".to_string()]);
        assert_eq!(result.commands.len(), 2);
        assert_eq!(result.commands[0].plugin_id, "alpha");
        assert_eq!(result.panels.len(), 2);
        assert_eq!(result.toolbar_actions.len(), 2);
        assert_eq!(result.renderers.len(), 4);
    }

    #[test]
    fn runtime_emit_event_returns_ok() {
        let dir = tempdir().expect("tempdir");
        let script_path = write_runtime_script(dir.path());
        let mut runtime = PluginRuntime::new(script_path).expect("runtime");
        let result = runtime
            .emit_event("alpha", "note:created", serde_json::json!({"id": "b1"}))
            .expect("emit event");
        assert_eq!(result["ok"], true);
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
    fn load_plugins_into_runtime_roundtrip() {
        let dir = tempdir().expect("tempdir");
        let plugins_dir = dir.path().join("plugins");
        fs::create_dir_all(&plugins_dir).expect("plugins dir");

        let alpha_dir = plugins_dir.join("alpha");
        fs::create_dir_all(&alpha_dir).expect("alpha dir");
        fs::write(
            alpha_dir.join("plugin.json"),
            r#"{"id":"alpha","name":"Alpha","version":"0.1.0"}"#,
        )
        .expect("write alpha manifest");

        let registry = PluginRegistry::new(plugins_dir.join("state.json"));
        let script_path = write_runtime_script(dir.path());

        let mut runtime = PluginRuntime::new(script_path).expect("runtime");
        let plugins = discover_plugins(dir.path(), &registry).expect("discover");
        let result = runtime.load_plugins(&plugins).expect("load");
        assert_eq!(result.loaded, vec!["alpha".to_string()]);
    }
}
