use crate::app::prelude::*;
use crate::app::store::*;
use crate::ui::tokens;
use gpui_component::Disableable;

impl AppStore {
    pub(super) fn render_plugin_error_banner(
        &mut self,
        cx: &mut Context<Self>,
    ) -> Option<gpui::AnyElement> {
        use crate::ui::components::error_display::ErrorBanner;
        let message = self.plugins.plugin_error.clone()?;
        let message = crate::app::store::helpers::single_line_text(&message);

        Some(
            div()
                .id("plugin-error-banner")
                .child(
                    ErrorBanner::new(format!(
                        "{message} — Try reloading plugins or check Details for more info."
                    ))
                    .warning()
                    .action(
                        if self.plugins.plugin_busy {
                            "Reloading..."
                        } else {
                            "Reload plugins"
                        },
                        cx.listener(|this, _event, window, cx| {
                            this.load_plugins(Some(window), cx);
                        }),
                    ),
                )
                .into_any_element(),
        )
    }

    pub(super) fn render_plugin_panel(
        &mut self,
        cx: &mut Context<Self>,
    ) -> Option<gpui::AnyElement> {
        let panel = self.plugins.plugin_active_panel.clone()?;
        let border = cx.theme().border;
        let sidebar_bg = cx.theme().sidebar;
        let muted_fg = cx.theme().muted_foreground;
        let fg = cx.theme().foreground;
        let plugin_id = panel.plugin_id.clone();
        let header = self.render_context_panel_header(cx);

        Some(
            div()
                .id("plugin-panel")
                .w(tokens::CONTEXT_PANEL_WIDTH)
                .h_full()
                .border_l_1()
                .border_color(border)
                .bg(sidebar_bg)
                .flex()
                .flex_col()
                .min_h_0()
                .child(header)
                .child(
                    div()
                        .px_4()
                        .pt_3()
                        .text_xs()
                        .text_color(muted_fg)
                        .child(format!("Plugin: {plugin_id}")),
                )
                .child(
                    div()
                        .px_4()
                        .pt_2()
                        .text_sm()
                        .text_color(fg)
                        .child("Active panel placeholder"),
                )
                .into_any_element(),
        )
    }

    fn render_plugin_setting_field(
        &mut self,
        plugin: &PluginPermissionInfo,
        key: &str,
        field: &PluginSettingSchema,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> gpui::AnyElement {
        let label = field.title.clone().unwrap_or_else(|| key.to_string());
        let label = crate::app::store::helpers::single_line_text(&label);
        let description = field
            .description
            .clone()
            .map(|text| crate::app::store::helpers::single_line_text(&text));
        let value = self
            .plugin_setting_value(&plugin.id, key)
            .unwrap_or(Value::Null);

        let control = if !field.enum_values.is_empty() {
            let mut options = div().flex().flex_wrap().gap_1();
            for (idx, option) in field.enum_values.iter().enumerate() {
                let option_value = option.clone();
                let option_label = match option {
                    Value::String(value) => value.clone(),
                    Value::Number(value) => value.to_string(),
                    Value::Bool(value) => value.to_string(),
                    _ => option.to_string(),
                };
                let is_selected = option_value == value;
                let mut button =
                    Button::new(format!("plugin-setting-{}-{}-{}", plugin.id, key, idx))
                        .label(option_label)
                        .xsmall();
                button = if is_selected {
                    button.primary()
                } else {
                    button.ghost()
                };
                let plugin_id = plugin.id.clone();
                let key = key.to_string();
                options = options.child(button.on_click(cx.listener(
                    move |this, _event, _window, cx| {
                        this.update_plugin_setting_value(&plugin_id, &key, option_value.clone());
                        cx.notify();
                    },
                )));
            }
            options.into_any_element()
        } else {
            match crate::app::store::plugins::setting_kind(field) {
                crate::app::store::plugins::PluginSettingKind::Boolean => {
                    let checked = matches!(value, Value::Bool(true));
                    let plugin_id = plugin.id.clone();
                    let key = key.to_string();
                    Switch::new(format!("plugin-setting-{}-{}", plugin.id, key))
                        .checked(checked)
                        .on_click(cx.listener(move |this, checked, _window, cx| {
                            this.update_plugin_setting_value(
                                &plugin_id,
                                &key,
                                Value::Bool(*checked),
                            );
                            cx.notify();
                        }))
                        .into_any_element()
                }
                _ => {
                    let input =
                        self.ensure_plugin_setting_input(&plugin.id, key, field, window, cx);
                    Input::new(&input)
                        .small()
                        .cleanable(true)
                        .into_any_element()
                }
            }
        };

        let theme = cx.theme();
        let mut container = div()
            .flex()
            .flex_col()
            .gap_1()
            .child(div().text_sm().text_color(theme.foreground).child(label))
            .child(control);

        if let Some(description) = description {
            container = container.child(
                div()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .child(description),
            );
        }

        container.into_any_element()
    }

    pub(in super::super) fn render_plugin_settings_panel(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> gpui::AnyElement {
        let selected = self.settings.plugin_settings_selected.clone();
        let selected_plugin = selected
            .as_ref()
            .and_then(|id| self.plugins.plugins.iter().find(|plugin| &plugin.id == id))
            .cloned();

        let list = {
            let theme = cx.theme();
            let mut list = div().flex().flex_col().gap_1();
            if self.plugins.plugins.is_empty() {
                list = list.child(
                    div()
                        .text_sm()
                        .text_color(theme.muted_foreground)
                        .child("No plugins installed."),
                );
            } else {
                for plugin in self.plugins.plugins.iter() {
                    let is_active = selected.as_ref().is_some_and(|id| id == &plugin.id);
                    let id = plugin.id.clone();
                    let id_for_button = id.clone();
                    let id_for_row = id.clone();
                    let id_for_toggle = id.clone();
                    let id_for_update = id.clone();
                    let id_for_remove = id.clone();
                    let has_schema = plugin
                        .settings_schema
                        .as_ref()
                        .is_some_and(|schema| !schema.properties.is_empty());
                    let manage_busy = self.plugins.plugin_manage_busy.contains(&plugin.id);
                    let missing_count = plugin.missing_permissions.len();
                    let mut right_group = div().flex().items_center().gap_1();
                    if missing_count > 0 {
                        right_group = right_group.child(
                            div()
                                .px_1()
                                .py(px(1.0))
                                .rounded_sm()
                                .bg(theme.danger)
                                .text_xs()
                                .text_color(theme.danger_foreground)
                                .child(format!("{missing_count}")),
                        );
                    }
                    right_group = right_group.child(
                        Switch::new(format!("plugin-enabled-{id}"))
                            .checked(plugin.enabled)
                            .on_click(cx.listener(move |this, checked, window, cx| {
                                this.set_plugin_enabled(
                                    id_for_toggle.clone(),
                                    *checked,
                                    window,
                                    cx,
                                );
                            }))
                            .into_any_element(),
                    );
                    right_group = right_group.child(
                        Button::new(format!("plugin-update-{id}"))
                            .label("Update")
                            .xsmall()
                            .ghost()
                            .disabled(manage_busy)
                            .on_click(cx.listener(move |this, _event, _window, cx| {
                                this.update_plugin(id_for_update.clone(), cx);
                            })),
                    );
                    right_group = right_group.child(
                        Button::new(format!("plugin-remove-{id}"))
                            .label("Remove")
                            .xsmall()
                            .ghost()
                            .disabled(manage_busy)
                            .on_click(cx.listener(move |this, _event, _window, cx| {
                                this.remove_plugin(id_for_remove.clone(), cx);
                            })),
                    );
                    if self.plugins.plugin_settings_dirty.contains(&plugin.id) {
                        right_group = right_group.child(
                            div()
                                .text_xs()
                                .text_color(theme.muted_foreground)
                                .child("●"),
                        );
                    }
                    if has_schema {
                        right_group = right_group.child(
                            Button::new(format!("plugin-settings-edit-{id}"))
                                .label("Edit")
                                .xsmall()
                                .ghost()
                                .on_click(cx.listener(move |this, _event, window, cx| {
                                    this.select_plugin_settings(id_for_button.clone(), window, cx);
                                    this.focus_first_plugin_setting_input(window, cx);
                                })),
                        );
                    }

                    let title_color = if is_active {
                        theme.foreground
                    } else {
                        theme.muted_foreground
                    };
                    let background = if is_active {
                        theme.list_active
                    } else {
                        theme.colors.list
                    };
                    let row = self.render_plugin_card(
                        plugin,
                        title_color,
                        background,
                        right_group.into_any_element(),
                        false,
                        cx,
                    );
                    let row = row
                        .id(format!("plugin-settings-item-{id}"))
                        .hover(move |s| s.bg(theme.list_hover).cursor_pointer())
                        .on_click(cx.listener(move |this, _event, window, cx| {
                            this.select_plugin_settings(id_for_row.clone(), window, cx);
                        }));
                    list = list.child(row);

                    if let Some(status) = self.plugins.plugin_manage_status.get(&plugin.id).cloned()
                    {
                        list = list.child(
                            div()
                                .px_2()
                                .text_xs()
                                .text_color(theme.muted_foreground)
                                .child(status),
                        );
                    }
                }
            }
            list
        };

        let right_panel = if let Some(plugin) = selected_plugin.clone() {
            let status = self.plugins.plugin_settings_status.get(&plugin.id).cloned();
            let manage_status = self.plugins.plugin_manage_status.get(&plugin.id).cloned();
            let has_schema = plugin
                .settings_schema
                .as_ref()
                .is_some_and(|schema| !schema.properties.is_empty());
            let mut fields = div().flex().flex_col().gap_3();

            if let Some(schema) = plugin.settings_schema.as_ref() {
                let mut keys: Vec<_> = schema.properties.keys().cloned().collect();
                keys.sort();
                for key in keys {
                    if let Some(field) = schema.properties.get(&key) {
                        fields = fields.child(
                            self.render_plugin_setting_field(&plugin, &key, field, window, cx),
                        );
                    }
                }
            }

            let field_panel = if has_schema {
                fields.into_any_element()
            } else {
                let theme = cx.theme();
                div()
                    .text_sm()
                    .text_color(theme.muted_foreground)
                    .child("No settings available for this plugin.")
                    .into_any_element()
            };

            let theme = cx.theme();
            let mut command_rows = div().flex().flex_col().gap_2();
            let mut command_count = 0usize;
            if let Some(status) = self.plugins.plugin_status.as_ref() {
                let commands: Vec<_> = status
                    .commands
                    .iter()
                    .filter(|cmd| cmd.plugin_id == plugin.id)
                    .cloned()
                    .collect();
                command_count = commands.len();
                for (row_ix, command) in commands.into_iter().enumerate() {
                    let title = command.title.clone();
                    let description = command
                        .description
                        .clone()
                        .unwrap_or_else(|| format!("Command · {}", command.id));
                    command_rows = command_rows.child(
                        self.render_settings_row(
                            &title,
                            description.as_str(),
                            Button::new(format!("plugin-command-run-{}-{}", plugin.id, command.id))
                                .label("Run")
                                .xsmall()
                                .ghost()
                                .on_click(cx.listener(move |this, _event, window, cx| {
                                    this.run_plugin_command(command.clone(), window, cx);
                                }))
                                .into_any_element(),
                            super::helpers::settings_row_has_divider(row_ix, command_count),
                            cx,
                        ),
                    );
                }
            }
            if command_count == 0 {
                command_rows = command_rows.child(
                    div()
                        .text_xs()
                        .text_color(theme.muted_foreground)
                        .child("No commands registered."),
                );
            }

            let mut panel_rows = div().flex().flex_col().gap_2();
            let mut panel_count = 0usize;
            if let Some(status) = self.plugins.plugin_status.as_ref() {
                let panels: Vec<_> = status
                    .panels
                    .iter()
                    .filter(|panel| panel.plugin_id == plugin.id)
                    .cloned()
                    .collect();
                panel_count = panels.len();
                for (row_ix, panel) in panels.into_iter().enumerate() {
                    let title = panel.title.clone();
                    let location = panel
                        .location
                        .clone()
                        .unwrap_or_else(|| "Panel".to_string());
                    panel_rows = panel_rows.child(
                        self.render_settings_row(
                            &title,
                            location.as_str(),
                            Button::new(format!("plugin-panel-open-{}-{}", plugin.id, panel.id))
                                .label("Open")
                                .xsmall()
                                .ghost()
                                .on_click(cx.listener(move |this, _event, window, cx| {
                                    this.open_plugin_panel(panel.clone(), window, cx);
                                }))
                                .into_any_element(),
                            super::helpers::settings_row_has_divider(row_ix, panel_count),
                            cx,
                        ),
                    );
                }
            }
            if panel_count == 0 {
                panel_rows = panel_rows.child(
                    div()
                        .text_xs()
                        .text_color(theme.muted_foreground)
                        .child("No panels registered."),
                );
            }

            let mut permission_rows = div().flex().flex_col().gap_2();
            if plugin.missing_permissions.is_empty() {
                permission_rows = permission_rows.child(
                    div()
                        .text_xs()
                        .text_color(theme.muted_foreground)
                        .child("All requested permissions are granted."),
                );
            } else {
                let permission_count = plugin.missing_permissions.len();
                for (row_ix, perm) in plugin.missing_permissions.iter().enumerate() {
                    let plugin_id = plugin.id.clone();
                    let perm = perm.clone();
                    let label = perm.clone();
                    permission_rows = permission_rows.child(
                        self.render_settings_row(
                            &label,
                            "Missing permission",
                            Button::new(format!("plugin-grant-{}-{}", plugin_id, perm))
                                .label("Grant")
                                .xsmall()
                                .ghost()
                                .on_click(cx.listener(move |this, _event, window, cx| {
                                    this.request_plugin_permission(
                                        &plugin_id,
                                        &perm,
                                        None,
                                        Some(window),
                                        cx,
                                    );
                                }))
                                .into_any_element(),
                            super::helpers::settings_row_has_divider(row_ix, permission_count),
                            cx,
                        ),
                    );
                }
            }

            div()
                .flex()
                .flex_col()
                .min_w_0()
                .child(
                    div()
                        .text_sm()
                        .text_color(theme.foreground)
                        .font_weight(gpui::FontWeight::MEDIUM)
                        .child(plugin.name.clone()),
                )
                .child(
                    div()
                        .mt_1()
                        .text_xs()
                        .text_color(theme.muted_foreground)
                        .child(if has_schema {
                            "Schema-driven settings"
                        } else {
                            "No settings schema"
                        }),
                )
                .child(
                    div()
                        .mt_2()
                        .flex()
                        .flex_col()
                        .gap_1()
                        .child(
                            div()
                                .text_xs()
                                .text_color(theme.muted_foreground)
                                .child(format!("Version {}", plugin.version)),
                        )
                        .child(
                            div()
                                .text_xs()
                                .text_color(theme.muted_foreground)
                                .child(format!("Path {}", plugin.path)),
                        )
                        .child(div().text_xs().text_color(theme.muted_foreground).child(
                            if plugin.enabled {
                                "Enabled"
                            } else {
                                "Disabled"
                            },
                        )),
                )
                .child(
                    manage_status
                        .map(|msg| {
                            div()
                                .mt_2()
                                .text_xs()
                                .text_color(theme.muted_foreground)
                                .child(msg)
                                .into_any_element()
                        })
                        .unwrap_or_else(|| div().mt_2().into_any_element()),
                )
                .child(
                    div().mt_4().child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_3()
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(theme.foreground)
                                    .font_weight(gpui::FontWeight::MEDIUM)
                                    .child("Permissions"),
                            )
                            .child(permission_rows),
                    ),
                )
                .child(
                    div().mt_4().child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_3()
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(theme.foreground)
                                    .font_weight(gpui::FontWeight::MEDIUM)
                                    .child("Commands"),
                            )
                            .child(command_rows),
                    ),
                )
                .child(
                    div().mt_4().child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_3()
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(theme.foreground)
                                    .font_weight(gpui::FontWeight::MEDIUM)
                                    .child("Panels"),
                            )
                            .child(panel_rows),
                    ),
                )
                .child(div().mt_4().child(field_panel))
                .child(
                    div()
                        .mt_3()
                        .flex()
                        .items_center()
                        .gap_2()
                        .child(
                            Button::new("plugin-settings-save")
                                .label("Save")
                                .xsmall()
                                .primary()
                                .disabled(!has_schema)
                                .on_click(cx.listener(|this, _event, window, cx| {
                                    this.save_plugin_settings(window, cx);
                                })),
                        )
                        .child(
                            Button::new("plugin-settings-reload")
                                .label("Reload plugins")
                                .xsmall()
                                .ghost()
                                .on_click(cx.listener(|this, _event, window, cx| {
                                    this.load_plugins(Some(window), cx);
                                })),
                        ),
                )
                .child(
                    div()
                        .mt_3()
                        .pt_3()
                        .border_t_1()
                        .border_color(theme.border)
                        .child(
                            Button::new("plugin-settings-reset")
                                .label("Reset to defaults")
                                .xsmall()
                                .danger()
                                .disabled(!has_schema)
                                .on_click(cx.listener(|this, _event, window, cx| {
                                    this.reset_plugin_settings(window, cx);
                                })),
                        ),
                )
                .child(
                    status
                        .map(|msg| {
                            div()
                                .mt_2()
                                .text_xs()
                                .text_color(theme.muted_foreground)
                                .child(msg)
                                .into_any_element()
                        })
                        .unwrap_or_else(|| div().mt_2().into_any_element()),
                )
                .into_any_element()
        } else {
            let theme = cx.theme();
            div()
                .text_sm()
                .text_color(theme.muted_foreground)
                .child("Select a plugin to edit settings.")
                .into_any_element()
        };

        let theme = cx.theme();
        let installing = self.plugins.plugin_installing;
        let install_status = self.plugins.plugin_install_status.clone();
        let mut install_section = div()
            .flex()
            .flex_col()
            .gap_2()
            .child(
                div()
                    .text_sm()
                    .text_color(theme.foreground)
                    .font_weight(gpui::FontWeight::MEDIUM)
                    .child("Add plugin"),
            )
            .child(
                div()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .child("Install a plugin from a folder that contains a plugin.json manifest."),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .child(
                        Button::new("plugin-install-picker")
                            .label(if installing {
                                "Installing…"
                            } else {
                                "Install plugin…"
                            })
                            .xsmall()
                            .primary()
                            .disabled(installing)
                            .on_click(cx.listener(|this, _event, window, cx| {
                                this.install_plugin_from_folder_picker(window, cx);
                            })),
                    )
                    .child(
                        Button::new("plugin-install-clear")
                            .label("Clear")
                            .xsmall()
                            .ghost()
                            .disabled(install_status.is_none())
                            .on_click(cx.listener(|this, _event, _window, cx| {
                                this.clear_plugin_install_status(cx);
                            })),
                    ),
            );

        if let Some(status) = install_status {
            let lowered = status.to_string().to_lowercase();
            let color = if lowered.contains("failed") || lowered.contains("not available") {
                theme.danger_foreground
            } else {
                theme.muted_foreground
            };
            install_section =
                install_section.child(div().text_xs().text_color(color).child(status));
        }

        div()
            .flex()
            .flex_col()
            .gap_3()
            .flex_1()
            .min_h_0()
            .child(install_section)
            .child(
                div()
                    .flex()
                    .gap_3()
                    .flex_1()
                    .min_h_0()
                    .child(
                        div()
                            .w(tokens::SIDEBAR_WIDTH)
                            .min_h_0()
                            .overflow_scrollbar()
                            .child(list),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .min_h_0()
                            .overflow_scrollbar()
                            .child(right_panel),
                    ),
            )
            .into_any_element()
    }
}
