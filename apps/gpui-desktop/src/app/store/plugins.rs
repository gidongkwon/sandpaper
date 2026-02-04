use super::*;
use sandpaper_core::plugins::{PluginError, PluginErrorContext};
use serde_json::Value;

pub(crate) fn plugin_registry_for_vault(vault_root: &std::path::Path) -> PluginRegistry {
    PluginRegistry::new(vault_root.join("plugins/state.json"))
}

pub(crate) fn compute_missing_permissions(required: &[String], granted: &[String]) -> Vec<String> {
    use std::collections::HashSet;
    let granted_set: HashSet<&str> = granted.iter().map(|value| value.as_str()).collect();
    required
        .iter()
        .filter(|perm| !granted_set.contains(perm.as_str()))
        .cloned()
        .collect()
}

pub(crate) fn list_permissions_for_plugins(
    db: &Database,
    plugins: Vec<PluginInfo>,
) -> Result<Vec<PluginPermissionInfo>, String> {
    let mut result = Vec::with_capacity(plugins.len());
    for plugin in plugins {
        let granted = db
            .list_plugin_permissions(&plugin.id)
            .map_err(|err| format!("{err:?}"))?;
        let missing = compute_missing_permissions(&plugin.permissions, &granted);
        result.push(PluginPermissionInfo {
            id: plugin.id,
            name: plugin.name,
            version: plugin.version,
            description: plugin.description,
            permissions: plugin.permissions,
            settings_schema: plugin.settings_schema,
            enabled: plugin.enabled,
            path: plugin.path,
            granted_permissions: granted,
            missing_permissions: missing,
        });
    }
    Ok(result)
}

fn plugin_settings_key(plugin_id: &str) -> String {
    format!("plugin.settings.{plugin_id}")
}

fn get_plugin_settings(db: &Database, plugin_id: &str) -> Result<Option<Value>, String> {
    let key = plugin_settings_key(plugin_id);
    let Some(raw) = db.get_kv(&key).map_err(|err| format!("{err:?}"))? else {
        return Ok(None);
    };
    let value = serde_json::from_str(&raw).map_err(|err| format!("{err:?}"))?;
    Ok(Some(value))
}

fn set_plugin_settings(db: &Database, plugin_id: &str, settings: &Value) -> Result<(), String> {
    let key = plugin_settings_key(plugin_id);
    let raw = serde_json::to_string(settings).map_err(|err| format!("{err:?}"))?;
    db.set_kv(&key, &raw).map_err(|err| format!("{err:?}"))?;
    Ok(())
}

fn clear_plugin_settings(db: &Database, plugin_id: &str) -> Result<(), String> {
    let key = plugin_settings_key(plugin_id);
    db.delete_kv(&key).map_err(|err| format!("{err:?}"))?;
    Ok(())
}

fn apply_settings_schema_defaults(
    schema: Option<&PluginSettingsSchema>,
    stored: Option<Value>,
) -> Value {
    let mut base_map = match stored {
        Some(Value::Object(map)) => map,
        _ => serde_json::Map::new(),
    };

    let Some(schema) = schema else {
        return Value::Object(base_map);
    };

    let mut next = serde_json::Map::new();
    for (key, field) in schema.properties.iter() {
        if let Some(value) = base_map.remove(key) {
            next.insert(key.clone(), value);
        } else if let Some(default) = field.default.clone() {
            next.insert(key.clone(), default);
        }
    }

    Value::Object(next)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PluginSettingKind {
    String,
    Boolean,
    Integer,
    Number,
}

pub(crate) fn setting_kind(field: &PluginSettingSchema) -> PluginSettingKind {
    match field.kind.as_deref().unwrap_or("string") {
        "boolean" | "bool" => PluginSettingKind::Boolean,
        "integer" | "int" => PluginSettingKind::Integer,
        "number" | "float" => PluginSettingKind::Number,
        _ => PluginSettingKind::String,
    }
}

pub(crate) fn coerce_setting_value(field: &PluginSettingSchema, raw: &str) -> Value {
    let trimmed = raw.trim();
    match setting_kind(field) {
        PluginSettingKind::Boolean => {
            let normalized = trimmed.to_lowercase();
            if matches!(normalized.as_str(), "true" | "1" | "yes" | "on") {
                Value::Bool(true)
            } else if matches!(normalized.as_str(), "false" | "0" | "no" | "off") {
                Value::Bool(false)
            } else {
                Value::Bool(!normalized.is_empty())
            }
        }
        PluginSettingKind::Integer => trimmed
            .parse::<i64>()
            .map(|value| Value::Number(value.into()))
            .unwrap_or_else(|_| Value::String(trimmed.to_string())),
        PluginSettingKind::Number => {
            let value = trimmed
                .parse::<f64>()
                .ok()
                .and_then(serde_json::Number::from_f64);
            value
                .map(Value::Number)
                .unwrap_or_else(|| Value::String(trimmed.to_string()))
        }
        PluginSettingKind::String => Value::String(trimmed.to_string()),
    }
}

pub(crate) fn setting_value_to_string(value: &Value) -> String {
    match value {
        Value::String(value) => value.clone(),
        Value::Number(value) => value.to_string(),
        Value::Bool(value) => value.to_string(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

enum PluginCommandDecision {
    Execute(PluginCommand),
    PermissionRequested,
}

impl PluginsState {
    fn has_permission(&self, plugin_id: &str, permission: &str) -> bool {
        self.plugins
            .iter()
            .find(|plugin| plugin.id == plugin_id)
            .is_some_and(|plugin| {
                plugin
                    .granted_permissions
                    .iter()
                    .any(|perm| perm == permission)
            })
    }

    fn request_permission(
        &mut self,
        plugin_id: &str,
        permission: &str,
        action: Option<PluginPermissionAction>,
    ) {
        let plugin_name = self
            .plugins
            .iter()
            .find(|plugin| plugin.id == plugin_id)
            .map(|plugin| plugin.name.clone())
            .unwrap_or_else(|| plugin_id.to_string());

        self.plugin_permission_prompt = Some(PluginPermissionPrompt {
            plugin_id: plugin_id.to_string(),
            plugin_name,
            permission: permission.to_string(),
            action,
        });
    }

    fn run_command(&mut self, command: PluginCommand) -> PluginCommandDecision {
        let plugin_id = command.plugin_id.clone();
        if !self.has_permission(&plugin_id, "data.write") {
            self.request_permission(
                &plugin_id,
                "data.write",
                Some(PluginPermissionAction::RunCommand(command)),
            );
            return PluginCommandDecision::PermissionRequested;
        }
        PluginCommandDecision::Execute(command)
    }
}

fn input_keys_for_schema(
    plugin_id: &str,
    schema: Option<&PluginSettingsSchema>,
) -> HashSet<String> {
    let mut keys = HashSet::new();
    let Some(schema) = schema else {
        return keys;
    };
    for (key, field) in schema.properties.iter() {
        if !field.enum_values.is_empty()
            || matches!(setting_kind(field), PluginSettingKind::Boolean)
        {
            continue;
        }
        keys.insert(AppStore::plugin_setting_input_key(plugin_id, key));
    }
    keys
}

fn build_plugin_settings_state(
    db: &Database,
    plugins: &[PluginPermissionInfo],
) -> (
    HashMap<String, Value>,
    HashMap<String, Value>,
    HashMap<String, SharedString>,
) {
    let mut values = HashMap::new();
    let mut saved = HashMap::new();
    let mut status = HashMap::new();

    for plugin in plugins.iter() {
        let stored = match get_plugin_settings(db, &plugin.id) {
            Ok(value) => value,
            Err(err) => {
                status.insert(plugin.id.clone(), format!("Failed to load: {err}").into());
                None
            }
        };
        let stored_snapshot = stored.clone();
        let value = apply_settings_schema_defaults(plugin.settings_schema.as_ref(), stored);
        if !status.contains_key(&plugin.id) {
            if let Some(stored_value) = stored_snapshot {
                if stored_value != value {
                    status.insert(
                        plugin.id.clone(),
                        "Settings refreshed for new schema.".into(),
                    );
                }
            }
        }
        values.insert(plugin.id.clone(), value.clone());
        saved.insert(plugin.id.clone(), value);
    }

    (values, saved, status)
}

pub(crate) fn format_error_context(ctx: &PluginErrorContext) -> String {
    let mut parts = Vec::new();
    parts.push(ctx.phase.clone());
    if let Some(plugin_id) = ctx.plugin_id.as_ref() {
        parts.push(format!("plugin={plugin_id}"));
    }
    if let Some(renderer_id) = ctx.renderer_id.as_ref() {
        parts.push(format!("renderer={renderer_id}"));
    }
    if let Some(block_uid) = ctx.block_uid.as_ref() {
        parts.push(format!("block={block_uid}"));
    }
    if let Some(action_id) = ctx.action_id.as_ref() {
        parts.push(format!("action={action_id}"));
    }
    parts.join(" ")
}

fn format_runtime_error(err: &PluginRuntimeError) -> String {
    let context = err.context.as_ref().map(format_error_context);
    match context {
        Some(context) => format!("plugin-error: {} ({})", err.message, context),
        None => format!("plugin-error: {}", err.message),
    }
}

pub(crate) fn describe_plugin_error(err: &PluginError) -> PluginRuntimeError {
    match err {
        PluginError::Io(inner) => PluginRuntimeError::new(format!("io: {inner}")),
        PluginError::Serde(inner) => PluginRuntimeError::new(format!("serde: {inner}")),
        PluginError::Runtime(inner) => inner.clone(),
    }
}

impl AppStore {
    pub(crate) fn reset_plugins_state(&mut self) {
        self.plugins.plugins.clear();
        self.plugins.plugin_status = None;
        self.plugins.plugin_error = None;
        self.plugins.plugin_error_details = None;
        self.plugins.plugin_busy = false;
        self.plugins.plugin_runtime = None;
        self.plugins.plugin_active_panel = None;
        self.plugins.plugin_permission_prompt = None;
        self.settings.plugin_settings_selected = None;
        self.plugins.plugin_settings_values.clear();
        self.plugins.plugin_settings_saved.clear();
        self.plugins.plugin_settings_dirty.clear();
        self.plugins.plugin_settings_status.clear();
        self.plugins.plugin_setting_inputs.clear();
    }

    fn plugin_setting_input_key(plugin_id: &str, key: &str) -> String {
        format!("{plugin_id}:{key}")
    }

    fn prune_plugin_setting_inputs(&mut self) {
        let mut allowed = HashSet::new();
        for plugin in self.plugins.plugins.iter() {
            allowed.extend(input_keys_for_schema(
                &plugin.id,
                plugin.settings_schema.as_ref(),
            ));
        }
        self.plugins.plugin_setting_inputs.prune_to_keys(&allowed);
    }

    pub(crate) fn persist_settings(&mut self) {
        let Some(db) = self.app.db.as_ref() else {
            return;
        };
        let _ = self.settings.save_to_db(db);
    }

    fn ensure_plugin_settings_selection(&mut self) {
        let selected_valid = self
            .settings
            .plugin_settings_selected
            .as_ref()
            .is_some_and(|id| self.plugins.plugins.iter().any(|plugin| &plugin.id == id));
        if !selected_valid {
            self.settings.plugin_settings_selected = None;
        }
        if self.settings.plugin_settings_selected.is_none() {
            self.settings.plugin_settings_selected = self
                .plugins
                .plugins
                .iter()
                .find(|plugin| plugin.settings_schema.is_some())
                .or_else(|| self.plugins.plugins.first())
                .map(|plugin| plugin.id.clone());
        }
    }

    fn on_plugin_list_changed(&mut self, window: Option<&mut Window>, cx: &mut Context<Self>) {
        self.prune_plugin_setting_inputs();
        if self.settings.open && self.settings.tab == SettingsTab::Plugins {
            self.ensure_plugin_settings_selection();
            if let Some(window) = window {
                self.sync_plugin_setting_inputs_for_selected(window, cx);
            }
        }
    }

    fn on_settings_tab_changed(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.settings.tab == SettingsTab::Plugins {
            self.ensure_plugin_settings_selection();
            self.sync_plugin_setting_inputs_for_selected(window, cx);
        }
        self.persist_settings();
        cx.notify();
    }

    pub(crate) fn plugin_setting_value(&self, plugin_id: &str, key: &str) -> Option<Value> {
        self.plugins
            .plugin_settings_values
            .get(plugin_id)
            .and_then(|value| value.as_object())
            .and_then(|map| map.get(key).cloned())
    }

    fn update_plugin_settings_dirty(&mut self, plugin_id: &str) {
        let current = self.plugins.plugin_settings_values.get(plugin_id);
        let saved = self.plugins.plugin_settings_saved.get(plugin_id);
        let is_dirty = match (current, saved) {
            (Some(current), Some(saved)) => current != saved,
            (Some(current), None) => current != &Value::Object(serde_json::Map::new()),
            (None, Some(_)) => true,
            (None, None) => false,
        };
        if is_dirty {
            self.plugins
                .plugin_settings_dirty
                .insert(plugin_id.to_string());
        } else {
            self.plugins.plugin_settings_dirty.remove(plugin_id);
        }
    }

    fn set_plugin_settings_value(&mut self, plugin_id: &str, value: Value) {
        self.plugins
            .plugin_settings_values
            .insert(plugin_id.to_string(), value);
        self.update_plugin_settings_dirty(plugin_id);
        self.plugins.plugin_settings_status.remove(plugin_id);
    }

    pub(crate) fn update_plugin_setting_value(&mut self, plugin_id: &str, key: &str, value: Value) {
        let entry = self
            .plugins
            .plugin_settings_values
            .entry(plugin_id.to_string())
            .or_insert_with(|| Value::Object(serde_json::Map::new()));
        if let Value::Object(map) = entry {
            map.insert(key.to_string(), value);
        } else {
            let mut map = serde_json::Map::new();
            map.insert(key.to_string(), value);
            *entry = Value::Object(map);
        }
        self.update_plugin_settings_dirty(plugin_id);
        self.plugins.plugin_settings_status.remove(plugin_id);
    }

    pub(crate) fn ensure_plugin_setting_input(
        &mut self,
        plugin_id: &str,
        key: &str,
        field: &PluginSettingSchema,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Entity<InputState> {
        let input_key = Self::plugin_setting_input_key(plugin_id, key);
        if let Some(input) = self.plugins.plugin_setting_inputs.get(&input_key) {
            return input;
        }

        let placeholder = field.title.clone().unwrap_or_else(|| key.to_string());
        let input = cx.new(|cx| InputState::new(window, cx).placeholder(placeholder));
        let initial_value = self
            .plugin_setting_value(plugin_id, &key)
            .unwrap_or(Value::Null);
        let initial_text = setting_value_to_string(&initial_value);
        input.update(cx, |input, cx| {
            input.set_value(initial_text.clone(), window, cx);
        });
        let plugin_id = plugin_id.to_string();
        let key = key.to_string();
        let sub = cx.observe(&input, move |this, input, cx| {
            let raw = input.read(cx).value().to_string();
            let Some(field) = this
                .plugins
                .plugins
                .iter()
                .find(|plugin| plugin.id == plugin_id)
                .and_then(|plugin| plugin.settings_schema.as_ref())
                .and_then(|schema| schema.properties.get(&key))
            else {
                return;
            };
            let value = coerce_setting_value(field, &raw);
            if this
                .plugin_setting_value(&plugin_id, &key)
                .is_some_and(|current| current == value)
            {
                return;
            }
            this.update_plugin_setting_value(&plugin_id, &key, value);
            cx.notify();
        });
        self.plugins
            .plugin_setting_inputs
            .insert(input_key.clone(), input.clone(), sub);
        input
    }

    pub(crate) fn sync_plugin_setting_inputs_for_selected(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.prune_plugin_setting_inputs();
        let Some(plugin_id) = self.settings.plugin_settings_selected.clone() else {
            return;
        };
        let Some(schema) = self
            .plugins
            .plugins
            .iter()
            .find(|plugin| plugin.id == plugin_id)
            .and_then(|plugin| plugin.settings_schema.clone())
        else {
            return;
        };

        let mut keys: Vec<_> = schema.properties.keys().cloned().collect();
        keys.sort();

        for key in keys {
            let Some(field) = schema.properties.get(&key) else {
                continue;
            };
            if !field.enum_values.is_empty()
                || matches!(setting_kind(field), PluginSettingKind::Boolean)
            {
                continue;
            }
            let input = self.ensure_plugin_setting_input(&plugin_id, &key, field, window, cx);
            let value = self
                .plugin_setting_value(&plugin_id, &key)
                .unwrap_or(Value::Null);
            let text = setting_value_to_string(&value);
            input.update(cx, |input, cx| {
                input.set_value(text.clone(), window, cx);
            });
        }
    }

    pub(crate) fn focus_first_plugin_setting_input(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(plugin_id) = self.settings.plugin_settings_selected.clone() else {
            return;
        };
        let Some(schema) = self
            .plugins
            .plugins
            .iter()
            .find(|plugin| plugin.id == plugin_id)
            .and_then(|plugin| plugin.settings_schema.clone())
        else {
            return;
        };

        let mut keys: Vec<_> = schema.properties.keys().cloned().collect();
        keys.sort();
        for key in keys {
            let Some(field) = schema.properties.get(&key) else {
                continue;
            };
            if !field.enum_values.is_empty()
                || matches!(setting_kind(field), PluginSettingKind::Boolean)
            {
                continue;
            }
            let input_key = Self::plugin_setting_input_key(&plugin_id, &key);
            if let Some(input) = self.plugins.plugin_setting_inputs.get(&input_key) {
                window.focus(&input.focus_handle(cx), cx);
                break;
            }
        }
    }

    pub(crate) fn load_plugins(&mut self, window: Option<&mut Window>, cx: &mut Context<Self>) {
        self.plugins.plugin_busy = true;
        self.plugins.plugin_error = None;
        self.plugins.plugin_error_details = None;

        if self.app.db.is_none() {
            self.reset_plugins_state();
            cx.notify();
            return;
        }
        let Some(vault_root) = self.app.active_vault_root.clone() else {
            self.reset_plugins_state();
            cx.notify();
            return;
        };

        let load_result = {
            let db = self.app.db.as_ref().expect("db");
            crate::services::plugins::load_plan(db, &vault_root)
        };

        let crate::services::plugins::PluginLoadPlan {
            permissions,
            allowed,
            blocked,
        } = match load_result {
            Ok(result) => result,
            Err(err) => {
                let message = format_runtime_error(&err);
                self.plugins.plugin_error = Some(message.into());
                self.plugins.plugin_error_details = Some(err);
                self.plugins.plugins.clear();
                self.plugins.plugin_status = None;
                self.plugins.plugin_busy = false;
                cx.notify();
                return;
            }
        };

        let (values, saved, status) = {
            let db = self.app.db.as_ref().expect("db");
            build_plugin_settings_state(db, &permissions)
        };
        self.plugins.plugins = permissions;
        self.plugins.plugin_settings_values = values;
        self.plugins.plugin_settings_saved = saved;
        self.plugins.plugin_settings_status = status;
        self.plugins.plugin_settings_dirty.clear();
        self.on_plugin_list_changed(window, cx);

        let mut settings_by_plugin = HashMap::new();
        for plugin in allowed.iter() {
            if let Some(value) = self.plugins.plugin_settings_values.get(&plugin.manifest.id) {
                settings_by_plugin.insert(plugin.manifest.id.clone(), value.clone());
            }
        }

        match crate::services::plugins::load_runtime(
            &mut self.plugins.plugin_runtime,
            &allowed,
            settings_by_plugin,
        ) {
            Ok(result) => {
                self.plugins.plugin_status = Some(PluginRuntimeStatus {
                    loaded: result.loaded,
                    blocked,
                    commands: result.commands,
                    panels: result.panels,
                    toolbar_actions: result.toolbar_actions,
                    renderers: result.renderers,
                });
            }
            Err(err) => {
                self.plugins.plugin_error_details = Some(err.clone());
                self.plugins.plugin_error = Some(format_runtime_error(&err).into());
                self.plugins.plugin_status = None;
            }
        }

        if let Some(active_panel) = self.plugins.plugin_active_panel.clone() {
            let panel_exists = self.plugins.plugin_status.as_ref().is_some_and(|status| {
                status.panels.iter().any(|panel| {
                    panel.plugin_id == active_panel.plugin_id && panel.id == active_panel.id
                })
            });
            if !panel_exists {
                self.plugins.plugin_active_panel = None;
            }
        }

        self.plugins.plugin_busy = false;
        cx.notify();
    }

    pub(crate) fn reload_plugin_runtime(
        &mut self,
        window: Option<&mut Window>,
        cx: &mut Context<Self>,
    ) {
        self.load_plugins(window, cx);
    }

    pub(crate) fn request_plugin_permission(
        &mut self,
        plugin_id: &str,
        permission: &str,
        action: Option<PluginPermissionAction>,
        cx: &mut Context<Self>,
    ) {
        let already_prompting = self.plugins.plugin_permission_prompt.is_some();
        self.plugins
            .request_permission(plugin_id, permission, action);

        if already_prompting {
            cx.notify();
            return;
        }

        let app = cx.entity();
        self.with_window(cx, move |window, cx| {
            if window.root::<Root>().flatten().is_none() {
                return;
            }

            window.open_dialog(cx, move |dialog, _window, cx| {
                let (plugin_name, permission) = app
                    .read(cx)
                    .plugins
                    .plugin_permission_prompt
                    .as_ref()
                    .map(|prompt| (prompt.plugin_name.clone(), prompt.permission.clone()))
                    .unwrap_or_else(|| ("Plugin".to_string(), "permission".to_string()));

                dialog
                    .title("Grant permission")
                    .confirm()
                    .button_props(
                        gpui_component::dialog::DialogButtonProps::default()
                            .ok_text("Allow")
                            .cancel_text("Cancel"),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_2()
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(cx.theme().foreground)
                                    .child(format!("Allow {plugin_name} to use {permission}?")),
                            )
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(cx.theme().muted_foreground)
                                    .child("This can be changed later in Settings → Plugins."),
                            ),
                    )
                    .on_ok({
                        let app = app.clone();
                        move |_event, window, cx| {
                            app.update(cx, |app, cx| app.grant_plugin_permission_action(window, cx))
                        }
                    })
                    .on_cancel({
                        let app = app.clone();
                        move |_event, _window, cx| {
                            app.update(cx, |app, cx| app.clear_plugin_permission_prompt(cx));
                            true
                        }
                    })
                    .on_close({
                        let app = app.clone();
                        move |_event, _window, cx| {
                            app.update(cx, |app, cx| app.clear_plugin_permission_prompt(cx));
                        }
                    })
            });
        });

        cx.notify();
    }

    pub(crate) fn clear_plugin_permission_prompt(&mut self, cx: &mut Context<Self>) {
        self.plugins.plugin_permission_prompt = None;
        cx.notify();
    }

    pub(crate) fn grant_plugin_permission_action(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        let Some(prompt) = self.plugins.plugin_permission_prompt.clone() else {
            return true;
        };

        {
            let Some(db) = self.app.db.as_ref() else {
                self.plugins.plugin_error = Some("Database not available.".into());
                cx.notify();
                return false;
            };
            if db
                .grant_plugin_permission(&prompt.plugin_id, &prompt.permission)
                .is_err()
            {
                self.plugins.plugin_error = Some("Failed to grant permission.".into());
                cx.notify();
                return false;
            }
        }

        let toast: SharedString =
            format!("Granted {} to {}.", prompt.permission, prompt.plugin_name).into();

        self.plugins.plugin_permission_prompt = None;
        self.load_plugins(Some(window), cx);

        if let Some(action) = prompt.action {
            self.perform_plugin_permission_action(action, window, cx);
        }

        if window.root::<Root>().flatten().is_some() {
            window.push_notification(
                (
                    gpui_component::notification::NotificationType::Success,
                    toast,
                ),
                cx,
            );
        }

        true
    }

    fn perform_plugin_permission_action(
        &mut self,
        action: PluginPermissionAction,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match action {
            PluginPermissionAction::RunCommand(command) => {
                self.run_plugin_command(command, window, cx);
            }
            PluginPermissionAction::OpenPanel(panel) => {
                self.open_plugin_panel(panel, cx);
            }
        }
    }

    pub(crate) fn open_plugin_panel(&mut self, panel: PluginPanel, cx: &mut Context<Self>) {
        let plugin_id = panel.plugin_id.clone();
        if !self.plugins.has_permission(&plugin_id, "ui") {
            self.request_plugin_permission(
                &plugin_id,
                "ui",
                Some(PluginPermissionAction::OpenPanel(panel)),
                cx,
            );
            return;
        }

        if self.app.mode != Mode::Editor {
            self.set_mode(Mode::Editor, cx);
        }

        self.plugins.plugin_active_panel = Some(panel);
        cx.notify();
    }

    pub(crate) fn close_plugin_panel(&mut self, cx: &mut Context<Self>) {
        self.plugins.plugin_active_panel = None;
        cx.notify();
    }

    pub(crate) fn run_plugin_command(
        &mut self,
        command: PluginCommand,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let command = match self.plugins.run_command(command) {
            PluginCommandDecision::Execute(command) => command,
            PluginCommandDecision::PermissionRequested => {
                cx.notify();
                return;
            }
        };

        if self.app.mode != Mode::Editor {
            self.set_mode(Mode::Editor, cx);
        }

        let Some(editor) = self.editor.editor.as_mut() else {
            return;
        };

        let new_block = BlockSnapshot {
            uid: Uuid::new_v4().to_string(),
            text: format!("Plugin action: {}", command.title),
            indent: 0,
        };

        let next_active = editor.active_ix.saturating_add(1);
        editor.blocks.insert(0, new_block);
        editor.active_ix = next_active.min(editor.blocks.len().saturating_sub(1));

        self.update_block_list_for_pane(EditorPane::Primary);
        self.mark_dirty_for_pane(EditorPane::Primary, cx);
        self.schedule_references_refresh(cx);
        window.focus(&self.editor.block_input.focus_handle(cx), cx);
        cx.notify();
    }

    pub(crate) fn open_settings(
        &mut self,
        tab: SettingsTab,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if window.root::<Root>().flatten().is_none() {
            return;
        }

        if self.settings.open && window.has_active_sheet(cx) {
            self.set_settings_tab(tab, window, cx);
            return;
        }

        self.settings.open(tab);
        self.on_settings_tab_changed(window, cx);

        let app = cx.entity();
        let view = cx.new(|cx| crate::ui::dialogs::SettingsSheetView::new(app.clone(), cx));

        window.open_sheet(cx, move |sheet, _window, _cx| {
            let app = app.clone();
            let view = view.clone();
            sheet
                .title("Settings")
                .size(px(760.0))
                .child(view)
                .on_close(move |_event, _window, cx| {
                    app.update(cx, |app, cx| {
                        app.close_settings(cx);
                    });
                })
        });
    }

    pub(crate) fn close_settings(&mut self, cx: &mut Context<Self>) {
        self.settings.close();
        self.plugins.plugin_setting_inputs.clear();
        self.persist_settings();
        cx.notify();
    }

    pub(crate) fn set_settings_tab(
        &mut self,
        tab: SettingsTab,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.settings.set_tab(tab);
        self.on_settings_tab_changed(window, cx);
    }

    pub(crate) fn open_plugin_settings(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.open_settings(SettingsTab::Plugins, window, cx);
        self.focus_first_plugin_setting_input(window, cx);
    }

    pub(crate) fn select_plugin_settings(
        &mut self,
        plugin_id: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.settings.set_plugin_selection(Some(plugin_id));
        self.sync_plugin_setting_inputs_for_selected(window, cx);
        cx.notify();
    }

    pub(crate) fn save_plugin_settings(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(selected) = self.settings.plugin_settings_selected.clone() else {
            return;
        };
        let Some(db) = self.app.db.as_ref() else {
            self.plugins
                .plugin_settings_status
                .insert(selected, "Database not available.".into());
            cx.notify();
            return;
        };

        let value = self
            .plugins
            .plugin_settings_values
            .get(&selected)
            .cloned()
            .unwrap_or_else(|| Value::Object(serde_json::Map::new()));

        if let Err(err) = set_plugin_settings(db, &selected, &value) {
            self.plugins
                .plugin_settings_status
                .insert(selected, format!("Failed to save: {err}").into());
            cx.notify();
            return;
        }

        self.plugins
            .plugin_settings_saved
            .insert(selected.clone(), value.clone());
        self.plugins.plugin_settings_dirty.remove(&selected);
        self.plugins
            .plugin_settings_status
            .insert(selected.clone(), "Saved. Reloading…".into());
        self.reload_plugin_runtime(Some(window), cx);
        self.plugins
            .plugin_settings_status
            .insert(selected.clone(), "Saved and reloaded.".into());
        self.sync_plugin_setting_inputs_for_selected(window, cx);
        cx.notify();
    }

    pub(crate) fn reset_plugin_settings(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(selected) = self.settings.plugin_settings_selected.clone() else {
            return;
        };
        let Some(db) = self.app.db.as_ref() else {
            self.plugins
                .plugin_settings_status
                .insert(selected, "Database not available.".into());
            cx.notify();
            return;
        };

        if let Err(err) = clear_plugin_settings(db, &selected) {
            self.plugins
                .plugin_settings_status
                .insert(selected, format!("Failed to reset: {err}").into());
            cx.notify();
            return;
        }

        let schema = self
            .plugins
            .plugins
            .iter()
            .find(|plugin| plugin.id == selected)
            .and_then(|plugin| plugin.settings_schema.as_ref());
        let value = apply_settings_schema_defaults(schema, None);
        self.set_plugin_settings_value(&selected, value);
        self.plugins
            .plugin_settings_status
            .insert(selected.clone(), "Reset to defaults.".into());
        self.sync_plugin_setting_inputs_for_selected(window, cx);
        cx.notify();
    }

    pub(crate) fn clear_plugin_error(&mut self, cx: &mut Context<Self>) {
        self.plugins.plugin_error = None;
        self.plugins.plugin_error_details = None;
        cx.notify();
    }

    pub(crate) fn open_plugin_error_details(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(details) = self.plugins.plugin_error_details.clone() else {
            return;
        };

        if window.root::<Root>().flatten().is_none() {
            return;
        }

        window.open_dialog(cx, move |dialog, _window, cx| {
            let theme = cx.theme();

            let mut body = div()
                .text_sm()
                .text_color(theme.foreground)
                .child(format!("Message: {}", details.message));

            if let Some(context) = details.context.as_ref() {
                body = body.child(
                    div()
                        .mt_2()
                        .text_xs()
                        .text_color(theme.muted_foreground)
                        .child(format!("Context: {}", format_error_context(context))),
                );
            }

            if let Some(stack) = details.stack.as_ref() {
                body = body.child(
                    div()
                        .mt_2()
                        .text_xs()
                        .text_color(theme.muted_foreground)
                        .child(stack.clone()),
                );
            }

            dialog
                .title("Plugin error details")
                .w(px(560.0))
                .child(body)
        });
    }
}

#[cfg(test)]
mod tests {
    use super::{
        apply_settings_schema_defaults, build_plugin_settings_state, coerce_setting_value,
        compute_missing_permissions, get_plugin_settings, list_permissions_for_plugins,
        set_plugin_settings, setting_kind, AppStore, PluginPermissionInfo, PluginSettingKind,
    };
    use gpui::{AppContext, Entity, TestAppContext};
    use sandpaper_core::db::Database;
    use sandpaper_core::plugins::{PluginInfo, PluginSettingSchema, PluginSettingsSchema};
    use serde_json::{json, Value};
    use std::collections::HashMap;

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

        db.grant_plugin_permission("alpha", "fs").expect("grant fs");

        let plugins = vec![PluginInfo {
            id: "alpha".to_string(),
            name: "Alpha".to_string(),
            version: "0.1.0".to_string(),
            description: None,
            permissions: vec!["fs".to_string(), "network".to_string()],
            settings_schema: None,
            enabled: true,
            path: "/tmp/alpha".to_string(),
        }];

        let result = list_permissions_for_plugins(&db, plugins).expect("list permissions");
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].granted_permissions, vec!["fs".to_string()]);
        assert_eq!(result[0].missing_permissions, vec!["network".to_string()]);
    }

    #[test]
    fn apply_settings_schema_defaults_sets_missing_values() {
        let mut properties = HashMap::new();
        properties.insert(
            "units".to_string(),
            PluginSettingSchema {
                default: Some(Value::String("c".to_string())),
                ..Default::default()
            },
        );
        let schema = PluginSettingsSchema {
            properties,
            ..Default::default()
        };

        let stored = Some(json!({}));
        let result = apply_settings_schema_defaults(Some(&schema), stored);
        assert_eq!(result["units"], json!("c"));
    }

    #[test]
    fn apply_settings_schema_defaults_preserves_stored_values() {
        let mut properties = HashMap::new();
        properties.insert(
            "units".to_string(),
            PluginSettingSchema {
                default: Some(Value::String("c".to_string())),
                ..Default::default()
            },
        );
        let schema = PluginSettingsSchema {
            properties,
            ..Default::default()
        };

        let stored = Some(json!({ "units": "f" }));
        let result = apply_settings_schema_defaults(Some(&schema), stored);
        assert_eq!(result["units"], json!("f"));
    }

    #[test]
    fn apply_settings_schema_defaults_drops_unknown_keys() {
        let mut properties = HashMap::new();
        properties.insert(
            "units".to_string(),
            PluginSettingSchema {
                default: Some(Value::String("c".to_string())),
                ..Default::default()
            },
        );
        let schema = PluginSettingsSchema {
            properties,
            ..Default::default()
        };

        let stored = Some(json!({ "units": "f", "legacy": 42 }));
        let result = apply_settings_schema_defaults(Some(&schema), stored);
        assert_eq!(result["units"], json!("f"));
        assert!(result.get("legacy").is_none());
    }

    #[test]
    fn plugin_settings_reload_preserves_saved_values() {
        let db = Database::new_in_memory().expect("db init");
        db.run_migrations().expect("migrations");

        let mut properties = HashMap::new();
        properties.insert(
            "units".to_string(),
            PluginSettingSchema {
                default: Some(Value::String("c".to_string())),
                ..Default::default()
            },
        );
        let schema = PluginSettingsSchema {
            properties,
            ..Default::default()
        };

        let plugin = PluginPermissionInfo {
            id: "weather".to_string(),
            name: "Weather".to_string(),
            version: "0.1.0".to_string(),
            description: None,
            permissions: Vec::new(),
            settings_schema: Some(schema),
            enabled: true,
            path: "/tmp/weather".to_string(),
            granted_permissions: Vec::new(),
            missing_permissions: Vec::new(),
        };

        let settings = json!({ "units": "f" });
        set_plugin_settings(&db, "weather", &settings).expect("set settings");

        let (values, saved, status) = build_plugin_settings_state(&db, &[plugin]);
        assert_eq!(values.get("weather"), Some(&settings));
        assert_eq!(saved.get("weather"), Some(&settings));
        assert!(status.get("weather").is_none());
    }

    #[test]
    fn plugin_settings_roundtrip() {
        let db = Database::new_in_memory().expect("db init");
        db.run_migrations().expect("migrations");

        let settings = json!({ "units": "f", "max": 3 });
        set_plugin_settings(&db, "weather", &settings).expect("set settings");
        let loaded = get_plugin_settings(&db, "weather").expect("get settings");
        assert_eq!(loaded, Some(settings));
    }

    #[test]
    fn plugin_settings_returns_none_when_missing() {
        let db = Database::new_in_memory().expect("db init");
        db.run_migrations().expect("migrations");
        let loaded = get_plugin_settings(&db, "missing").expect("get settings");
        assert!(loaded.is_none());
    }

    #[test]
    fn setting_kind_normalizes() {
        let field = PluginSettingSchema {
            kind: Some("boolean".to_string()),
            ..Default::default()
        };
        assert_eq!(setting_kind(&field), PluginSettingKind::Boolean);
    }

    #[test]
    fn coerce_setting_value_handles_boolean() {
        let field = PluginSettingSchema {
            kind: Some("boolean".to_string()),
            ..Default::default()
        };
        assert_eq!(coerce_setting_value(&field, "true"), Value::Bool(true));
        assert_eq!(coerce_setting_value(&field, "false"), Value::Bool(false));
        assert_eq!(coerce_setting_value(&field, "1"), Value::Bool(true));
        assert_eq!(coerce_setting_value(&field, "0"), Value::Bool(false));
    }

    #[test]
    fn coerce_setting_value_handles_numbers() {
        let integer_field = PluginSettingSchema {
            kind: Some("integer".to_string()),
            ..Default::default()
        };
        assert_eq!(
            coerce_setting_value(&integer_field, "42"),
            Value::Number(42.into())
        );

        let number_field = PluginSettingSchema {
            kind: Some("number".to_string()),
            ..Default::default()
        };
        assert_eq!(
            coerce_setting_value(&number_field, "3.14"),
            Value::Number(serde_json::Number::from_f64(3.14).expect("num"))
        );
    }

    #[gpui::test]
    fn plugin_permission_prompt_grants_permission(cx: &mut TestAppContext) {
        cx.skip_drawing();
        use gpui_component::{Root, WindowExt as _};
        use std::cell::RefCell;
        use std::rc::Rc;

        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        app.update(cx, |app, cx| {
            let db = Database::new_in_memory().expect("db init");
            db.run_migrations().expect("migrations");
            app.app.db = Some(db);
            app.app.active_vault_root = Some(std::env::temp_dir());
            app.plugins.plugins = vec![PluginPermissionInfo {
                id: "alpha".to_string(),
                name: "Alpha".to_string(),
                version: "0.1.0".to_string(),
                description: None,
                permissions: vec!["data.write".to_string()],
                settings_schema: None,
                enabled: true,
                path: "/tmp/alpha".to_string(),
                granted_permissions: Vec::new(),
                missing_permissions: vec!["data.write".to_string()],
            }];

            app.request_plugin_permission("alpha", "data.write", None, cx);
            let prompt = app
                .plugins
                .plugin_permission_prompt
                .clone()
                .expect("prompt");
            assert_eq!(prompt.plugin_name, "Alpha");
            assert_eq!(prompt.permission, "data.write");
        });

        cx.update_window(*window, |_root, window, cx| {
            assert!(window.has_active_dialog(cx));

            app.update(cx, |app, cx| {
                assert!(app.grant_plugin_permission_action(window, cx));

                let db = app.app.db.as_ref().expect("db");
                let permissions = db
                    .list_plugin_permissions("alpha")
                    .expect("list permissions");
                assert!(permissions.contains(&"data.write".to_string()));
                assert!(app.plugins.plugin_permission_prompt.is_none());
            });

            window.close_dialog(cx);
            assert!(!window.has_active_dialog(cx));
        })
        .unwrap();
    }

    #[gpui::test]
    fn plugin_error_details_opens_dialog(cx: &mut TestAppContext) {
        cx.skip_drawing();
        use gpui_component::{Root, WindowExt as _};
        use sandpaper_core::plugins::PluginRuntimeError;
        use std::cell::RefCell;
        use std::rc::Rc;

        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        app.update(cx, |app, _cx| {
            app.plugins.plugin_error_details = Some(PluginRuntimeError::new("boom"));
        });

        cx.update_window(*window, |_root, window, cx| {
            app.update(cx, |app, cx| {
                app.open_plugin_error_details(window, cx);
            });
            assert!(window.has_active_dialog(cx));
            window.close_dialog(cx);
            assert!(!window.has_active_dialog(cx));
        })
        .unwrap();
    }
}
