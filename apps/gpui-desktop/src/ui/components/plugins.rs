use crate::app::prelude::*;
use crate::app::store::*;
use gpui_component::Disableable;

impl AppStore {
    pub(super) fn render_plugin_error_banner(&mut self, cx: &mut Context<Self>) -> Option<gpui::AnyElement> {
        let message = self.plugins.plugin_error.clone()?;
        let theme = cx.theme();

        Some(
            div()
                .id("plugin-error-banner")
                .px_3()
                .py_2()
                .bg(theme.colors.list)
                .border_b_1()
                .border_color(theme.border)
                .flex()
                .items_center()
                .justify_between()
                .child(
                    div()
                        .text_sm()
                        .text_color(theme.danger_foreground)
                        .child(message),
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .child(
                            Button::new("plugin-error-reload")
                                .label(if self.plugins.plugin_busy {
                                    "Reloading..."
                                } else {
                                    "Reload plugins"
                                })
                                .xsmall()
                                .ghost()
                                .on_click(cx.listener(|this, _event, window, cx| {
                                    this.load_plugins(Some(window), cx);
                                })),
                        )
                        .child(
                            Button::new("plugin-error-details")
                                .label("Details")
                                .xsmall()
                                .ghost()
                                .on_click(cx.listener(|this, _event, window, cx| {
                                    this.open_plugin_error_details(window, cx);
                                })),
                        )
                        .child(
                            Button::new("plugin-error-dismiss")
                                .label("Dismiss")
                                .xsmall()
                                .ghost()
                                .on_click(cx.listener(|this, _event, _window, cx| {
                                    this.clear_plugin_error(cx);
                                })),
                        ),
                )
                .into_any_element(),
        )
    }

    pub(super) fn render_plugin_panel(&mut self, cx: &mut Context<Self>) -> Option<gpui::AnyElement> {
        let panel = self.plugins.plugin_active_panel.clone()?;
        let theme = cx.theme();
        let title = panel.title.clone();
        let plugin_id = panel.plugin_id.clone();

        Some(
            div()
                .id("plugin-panel")
                .absolute()
                .top(px(64.0))
                .right(px(24.0))
                .w(px(280.0))
                .p_3()
                .rounded_lg()
                .bg(theme.popover)
                .border_1()
                .border_color(theme.border)
                .child(self.render_header_row(
                    &title,
                    Button::new("plugin-panel-close")
                        .label("Close")
                        .xsmall()
                        .ghost()
                        .on_click(cx.listener(|this, _event, _window, cx| {
                            this.close_plugin_panel(cx);
                        }))
                        .into_any_element(),
                    cx,
                ))
                .child(
                    div()
                        .mt_2()
                        .text_xs()
                        .text_color(theme.muted_foreground)
                        .child(format!("Plugin: {plugin_id}")),
                )
                .child(
                    div()
                        .mt_3()
                        .text_sm()
                        .text_color(theme.foreground)
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
        let description = field.description.clone();
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
                let mut button = Button::new(format!(
                    "plugin-setting-{}-{}-{}",
                    plugin.id, key, idx
                ))
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
                    Input::new(&input).small().cleanable(true).into_any_element()
                }
            }
        };

        let theme = cx.theme();
        let mut container = div()
            .flex()
            .flex_col()
            .gap_1()
            .child(
                div()
                    .text_sm()
                    .text_color(theme.foreground)
                    .child(label),
            )
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
                    let has_schema = plugin
                        .settings_schema
                        .as_ref()
                        .is_some_and(|schema| !schema.properties.is_empty());
                    let mut right_group = div().flex().items_center().gap_1();
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
                }
            }
            list
        };

        let right_panel = if let Some(plugin) = selected_plugin.clone() {
            let status = self.plugins.plugin_settings_status.get(&plugin.id).cloned();
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
                        fields = fields.child(self.render_plugin_setting_field(
                            &plugin,
                            &key,
                            field,
                            window,
                            cx,
                        ));
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
            div()
                .flex()
                .flex_col()
                .min_w_0()
                .child(
                    div()
                        .text_sm()
                        .text_color(theme.foreground)
                        .font_weight(gpui::FontWeight::SEMIBOLD)
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
                .child(div().mt_3().child(field_panel))
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
                            Button::new("plugin-settings-reset")
                                .label("Reset")
                                .xsmall()
                                .ghost()
                                .disabled(!has_schema)
                                .on_click(cx.listener(|this, _event, window, cx| {
                                    this.reset_plugin_settings(window, cx);
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

        div()
            .flex()
            .gap_3()
            .flex_1()
            .min_h_0()
            .child(
                div()
                    .w(px(220.0))
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
            )
            .into_any_element()
    }

}
