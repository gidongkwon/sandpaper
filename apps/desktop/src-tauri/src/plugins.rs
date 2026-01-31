use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub enum PluginError {
    Io(std::io::Error),
    Serde(serde_json::Error),
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

#[cfg(test)]
mod tests {
    use super::{discover_plugins, PluginRegistry, PluginState};
    use std::fs;
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
}
