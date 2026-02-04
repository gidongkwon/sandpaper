use crate::app::prelude::*;
use crate::app::store::constants;
use crate::app::store::{PluginBlockInfo, PluginPermissionInfo};
use crate::app::store::plugins::{
    compute_missing_permissions, describe_plugin_error, list_permissions_for_plugins,
    plugin_registry_for_vault,
};
use sandpaper_core::plugins::{install_plugin, remove_plugin, update_plugin};

pub(crate) struct PluginLoadPlan {
    pub(crate) permissions: Vec<PluginPermissionInfo>,
    pub(crate) allowed: Vec<PluginDescriptor>,
    pub(crate) blocked: Vec<PluginBlockInfo>,
}

fn empty_load_result() -> PluginRuntimeLoadResult {
    PluginRuntimeLoadResult {
        loaded: Vec::new(),
        commands: Vec::new(),
        panels: Vec::new(),
        toolbar_actions: Vec::new(),
        renderers: Vec::new(),
    }
}

pub(crate) fn load_plan(
    db: &Database,
    vault_root: &std::path::Path,
) -> Result<PluginLoadPlan, PluginRuntimeError> {
    let registry = plugin_registry_for_vault(vault_root);
    let plugin_infos =
        list_plugins(vault_root, &registry).map_err(|err| describe_plugin_error(&err))?;
    let permissions =
        list_permissions_for_plugins(db, plugin_infos).map_err(PluginRuntimeError::new)?;
    let descriptors =
        discover_plugins(vault_root, &registry).map_err(|err| describe_plugin_error(&err))?;

    let mut allowed = Vec::new();
    let mut blocked = Vec::new();
    for plugin in descriptors {
        if !plugin.enabled {
            blocked.push(PluginBlockInfo {
                id: plugin.manifest.id,
                reason: constants::PLUGIN_BLOCK_REASON_DISABLED.to_string(),
                missing_permissions: Vec::new(),
            });
            continue;
        }

        if check_manifest_compatibility(&plugin.manifest).is_err() {
            blocked.push(PluginBlockInfo {
                id: plugin.manifest.id,
                reason: constants::PLUGIN_BLOCK_REASON_INCOMPATIBLE.to_string(),
                missing_permissions: Vec::new(),
            });
            continue;
        }

        let granted = db
            .list_plugin_permissions(&plugin.manifest.id)
            .map_err(|err| PluginRuntimeError::new(format!("{err:?}")))?;
        let missing = compute_missing_permissions(&plugin.manifest.permissions, &granted);
        if missing.is_empty() {
            allowed.push(plugin);
        } else {
            blocked.push(PluginBlockInfo {
                id: plugin.manifest.id,
                reason: constants::PLUGIN_BLOCK_REASON_MISSING_PERMISSIONS.to_string(),
                missing_permissions: missing,
            });
        }
    }

    Ok(PluginLoadPlan {
        permissions,
        allowed,
        blocked,
    })
}

pub(crate) fn load_runtime(
    runtime: &mut Option<PluginRuntime>,
    allowed: &[PluginDescriptor],
    settings_by_plugin: HashMap<String, Value>,
) -> Result<PluginRuntimeLoadResult, PluginRuntimeError> {
    if allowed.is_empty() {
        return Ok(empty_load_result());
    }

    let runtime_ref = if let Some(existing) = runtime.as_mut() {
        existing
    } else {
        let new_runtime = PluginRuntime::new().map_err(|err| describe_plugin_error(&err))?;
        *runtime = Some(new_runtime);
        runtime.as_mut().expect("runtime")
    };

    runtime_ref
        .load_plugins(allowed, settings_by_plugin)
        .map_err(|err| describe_plugin_error(&err))
}

#[allow(dead_code)]
pub(crate) fn install(
    vault_root: &std::path::Path,
    source_dir: &std::path::Path,
) -> Result<PluginInfo, PluginRuntimeError> {
    let registry = plugin_registry_for_vault(vault_root);
    install_plugin(vault_root, &registry, source_dir).map_err(|err| describe_plugin_error(&err))
}

#[allow(dead_code)]
pub(crate) fn update(
    vault_root: &std::path::Path,
    plugin_id: &str,
) -> Result<PluginInfo, PluginRuntimeError> {
    let registry = plugin_registry_for_vault(vault_root);
    update_plugin(vault_root, &registry, plugin_id).map_err(|err| describe_plugin_error(&err))
}

#[allow(dead_code)]
pub(crate) fn remove(
    vault_root: &std::path::Path,
    plugin_id: &str,
) -> Result<(), PluginRuntimeError> {
    let registry = plugin_registry_for_vault(vault_root);
    remove_plugin(vault_root, &registry, plugin_id).map_err(|err| describe_plugin_error(&err))
}

