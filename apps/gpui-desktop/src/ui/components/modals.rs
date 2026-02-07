use crate::app::prelude::*;
use crate::app::store::*;
use crate::ui::tokens;
use gpui_component::Disableable;

struct PermissionAudit {
    missing: Vec<String>,
    unused: Vec<String>,
    ordered_permissions: Vec<String>,
}

fn compute_permission_audit(plugin: &PluginPermissionInfo) -> PermissionAudit {
    let missing = plugin.missing_permissions.clone();
    let unused: Vec<String> = plugin
        .granted_permissions
        .iter()
        .filter(|perm| !plugin.permissions.contains(perm))
        .cloned()
        .collect();
    let mut ordered_permissions = plugin.permissions.clone();
    ordered_permissions.extend(unused.clone());
    PermissionAudit {
        missing,
        unused,
        ordered_permissions,
    }
}
impl AppStore {
    pub(in super::super) fn render_settings_general_panel(
        &mut self,
        cx: &mut Context<Self>,
    ) -> gpui::AnyElement {
        let theme = cx.theme();
        let vault_label: SharedString = self
            .app
            .active_vault_id
            .as_ref()
            .and_then(|id| self.app.vaults.iter().find(|vault| &vault.id == id))
            .map(|vault| vault.name.clone().into())
            .unwrap_or_else(|| "No vault selected".into());
        let vault_path = self
            .app
            .active_vault_root
            .as_ref()
            .map(|path| path.display().to_string())
            .unwrap_or_else(|| "—".to_string());

        let mut content = div().flex().flex_col().gap_4().child(
            div()
                .text_size(tokens::FONT_LG)
                .text_color(theme.foreground)
                .font_weight(gpui::FontWeight::MEDIUM)
                .child("General"),
        );

        content = content.child(
            div()
                .flex()
                .flex_col()
                .gap_1()
                .child(
                    div()
                        .text_size(tokens::FONT_SM)
                        .text_color(theme.muted_foreground)
                        .child("Active vault"),
                )
                .child(
                    div()
                        .text_size(tokens::FONT_BASE)
                        .text_color(theme.foreground)
                        .child(vault_label.clone()),
                )
                .child(
                    div()
                        .text_size(tokens::FONT_SM)
                        .text_color(theme.muted_foreground)
                        .child(vault_path),
                ),
        );

        content = content.child(
            div()
                .flex()
                .flex_col()
                .gap_3()
                .child(
                    div()
                        .text_size(tokens::FONT_LG)
                        .text_color(theme.foreground)
                        .font_weight(gpui::FontWeight::MEDIUM)
                        .child("Workspace"),
                )
                .child(
                    self.render_settings_row(
                        "Theme",
                        "Choose between system, light, and dark appearance.",
                        div()
                            .flex()
                            .items_center()
                            .gap_1()
                            .child({
                                let mut button = Button::new("settings-theme-system")
                                    .label("System")
                                    .xsmall();
                                button =
                                    if self.settings.theme_preference == ThemePreference::System {
                                        button.primary()
                                    } else {
                                        button.ghost()
                                    };
                                button.on_click(cx.listener(|this, _event, _window, cx| {
                                    this.set_theme_preference(ThemePreference::System, cx);
                                }))
                            })
                            .child({
                                let mut button =
                                    Button::new("settings-theme-light").label("Light").xsmall();
                                button = if self.settings.theme_preference == ThemePreference::Light
                                {
                                    button.primary()
                                } else {
                                    button.ghost()
                                };
                                button.on_click(cx.listener(|this, _event, _window, cx| {
                                    this.set_theme_preference(ThemePreference::Light, cx);
                                }))
                            })
                            .child({
                                let mut button =
                                    Button::new("settings-theme-dark").label("Dark").xsmall();
                                button = if self.settings.theme_preference == ThemePreference::Dark
                                {
                                    button.primary()
                                } else {
                                    button.ghost()
                                };
                                button.on_click(cx.listener(|this, _event, _window, cx| {
                                    this.set_theme_preference(ThemePreference::Dark, cx);
                                }))
                            })
                            .into_any_element(),
                        cx,
                    ),
                )
                .child(
                    self.render_settings_row(
                        "Context panel",
                        "Show review/backlinks/plugins panel on the right.",
                        Switch::new("settings-context-panel")
                            .checked(self.settings.context_panel_open)
                            .on_click(cx.listener(|this, checked, _window, cx| {
                                this.settings.context_panel_open = *checked;
                                this.persist_settings();
                                cx.notify();
                            }))
                            .into_any_element(),
                        cx,
                    ),
                ),
        );

        content = content.child(
            div()
                .flex()
                .flex_col()
                .gap_3()
                .child(
                    div()
                        .text_size(tokens::FONT_LG)
                        .text_color(theme.foreground)
                        .font_weight(gpui::FontWeight::MEDIUM)
                        .child("Quick Add"),
                )
                .child(
                    self.render_settings_row(
                        "Default capture target",
                        "Choose where quick add inserts new items.",
                        div()
                            .flex()
                            .items_center()
                            .gap_1()
                            .child({
                                let mut button = Button::new("settings-quick-add-inbox")
                                    .label("Inbox")
                                    .xsmall();
                                button = if self.settings.quick_add_target == QuickAddTarget::Inbox
                                {
                                    button.primary()
                                } else {
                                    button.ghost()
                                };
                                button.on_click(cx.listener(|this, _event, _window, cx| {
                                    this.settings.quick_add_target = QuickAddTarget::Inbox;
                                    this.persist_settings();
                                    cx.notify();
                                }))
                            })
                            .child({
                                let mut button = Button::new("settings-quick-add-current")
                                    .label("Current page")
                                    .xsmall();
                                button = if self.settings.quick_add_target
                                    == QuickAddTarget::CurrentPage
                                {
                                    button.primary()
                                } else {
                                    button.ghost()
                                };
                                button.on_click(cx.listener(|this, _event, _window, cx| {
                                    this.settings.quick_add_target = QuickAddTarget::CurrentPage;
                                    this.persist_settings();
                                    cx.notify();
                                }))
                            })
                            .child({
                                let mut button = Button::new("settings-quick-add-task")
                                    .label("Task in Inbox")
                                    .xsmall();
                                button = if self.settings.quick_add_target
                                    == QuickAddTarget::TaskInbox
                                {
                                    button.primary()
                                } else {
                                    button.ghost()
                                };
                                button.on_click(cx.listener(|this, _event, _window, cx| {
                                    this.settings.quick_add_target = QuickAddTarget::TaskInbox;
                                    this.persist_settings();
                                    cx.notify();
                                }))
                            })
                            .into_any_element(),
                        cx,
                    ),
                )
                .child(
                    self.render_settings_row(
                        "Density",
                        "Adjust row and panel density across the workspace.",
                        div()
                            .flex()
                            .items_center()
                            .gap_1()
                            .child({
                                let mut button = Button::new("settings-density-comfortable")
                                    .label("Comfortable")
                                    .xsmall();
                                button =
                                    if self.settings.layout_density == LayoutDensity::Comfortable {
                                        button.primary()
                                    } else {
                                        button.ghost()
                                    };
                                button.on_click(cx.listener(|this, _event, _window, cx| {
                                    this.settings.layout_density = LayoutDensity::Comfortable;
                                    this.persist_settings();
                                    cx.notify();
                                }))
                            })
                            .child({
                                let mut button = Button::new("settings-density-compact")
                                    .label("Compact")
                                    .xsmall();
                                button = if self.settings.layout_density == LayoutDensity::Compact {
                                    button.primary()
                                } else {
                                    button.ghost()
                                };
                                button.on_click(cx.listener(|this, _event, _window, cx| {
                                    this.settings.layout_density = LayoutDensity::Compact;
                                    this.persist_settings();
                                    cx.notify();
                                }))
                            })
                            .into_any_element(),
                        cx,
                    ),
                ),
        );

        content = content.child(
            div()
                .flex()
                .flex_col()
                .gap_3()
                .child(
                    div()
                        .text_size(tokens::FONT_LG)
                        .text_color(theme.foreground)
                        .font_weight(gpui::FontWeight::MEDIUM)
                        .child("Editor"),
                )
                .child(
                    self.render_settings_row(
                        "Sync scroll across panes",
                        "Keep primary and split panes aligned.",
                        Switch::new("settings-sync-scroll")
                            .checked(self.settings.sync_scroll)
                            .on_click(cx.listener(|this, checked, _window, cx| {
                                this.settings.sync_scroll = *checked;
                                this.persist_settings();
                                cx.notify();
                            }))
                            .into_any_element(),
                        cx,
                    ),
                ),
        );

        content.into_any_element()
    }

    pub(in super::super) fn render_settings_vault_panel(
        &mut self,
        cx: &mut Context<Self>,
    ) -> gpui::AnyElement {
        let theme = cx.theme();
        let vault_label: SharedString = self
            .app
            .active_vault_id
            .as_ref()
            .and_then(|id| self.app.vaults.iter().find(|vault| &vault.id == id))
            .map(|vault| vault.name.clone().into())
            .unwrap_or_else(|| "No vault selected".into());
        let vault_path = self
            .app
            .active_vault_root
            .as_ref()
            .map(|path| path.display().to_string())
            .unwrap_or_else(|| "—".to_string());
        let pages_path = self
            .app
            .active_vault_root
            .as_ref()
            .map(|path| path.join("pages").display().to_string())
            .unwrap_or_else(|| "—".to_string());

        let pending = self.ui.shadow_write_pending.len();
        let busy = self.ui.shadow_write_busy;
        let queue_label: SharedString = if busy {
            format!("{pending} pending (writing…)").into()
        } else {
            format!("{pending} pending").into()
        };

        let mut content = div().flex().flex_col().gap_4().child(
            div()
                .text_size(tokens::FONT_LG)
                .text_color(theme.foreground)
                .font_weight(gpui::FontWeight::MEDIUM)
                .child("Vault"),
        );

        content = content.child(
            div()
                .flex()
                .flex_col()
                .gap_1()
                .child(
                    div()
                        .text_size(tokens::FONT_SM)
                        .text_color(theme.muted_foreground)
                        .child("Active vault"),
                )
                .child(
                    div()
                        .text_size(tokens::FONT_BASE)
                        .text_color(theme.foreground)
                        .child(vault_label),
                )
                .child(
                    div()
                        .text_size(tokens::FONT_SM)
                        .text_color(theme.muted_foreground)
                        .child(vault_path),
                ),
        );

        content = content.child(
            div()
                .flex()
                .flex_col()
                .gap_3()
                .child(
                    div()
                        .text_size(tokens::FONT_LG)
                        .text_color(theme.foreground)
                        .font_weight(gpui::FontWeight::MEDIUM)
                        .child("Shadow Markdown"),
                )
                .child(
                    div()
                        .text_size(tokens::FONT_SM)
                        .text_color(theme.muted_foreground)
                        .child("Writes read-only per-page Markdown under the vault pages folder."),
                )
                .child(
                    self.render_settings_row(
                        "Pages folder",
                        "Location for generated .md files.",
                        div()
                            .text_size(tokens::FONT_SM)
                            .text_color(theme.muted_foreground)
                            .child(pages_path)
                            .into_any_element(),
                        cx,
                    ),
                )
                .child(
                    self.render_settings_row(
                        "Shadow write queue",
                        "Pending writes will flush after autosave, or manually.",
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .when(busy, |this| {
                                this.child(
                                    crate::ui::components::spinner::Spinner::new().small(),
                                )
                            })
                            .child(
                                div()
                                    .text_size(tokens::FONT_SM)
                                    .text_color(theme.muted_foreground)
                                    .child(queue_label),
                            )
                            .child(
                                Button::new("shadow-flush-queue")
                                    .label("Flush queue")
                                    .xsmall()
                                    .ghost()
                                    .disabled(pending == 0 || busy)
                                    .on_click(cx.listener(|this, _event, _window, cx| {
                                        this.flush_shadow_write_queue(cx);
                                    })),
                            )
                            .into_any_element(),
                        cx,
                    ),
                )
                .child(
                    Button::new("shadow-export-all")
                        .label("Export all Markdown now")
                        .xsmall()
                        .ghost()
                        .disabled(busy)
                        .on_click(cx.listener(|this, _event, _window, cx| {
                            this.export_all_shadow_markdown(cx);
                        })),
                ),
        );

        if let Some(err) = self.ui.shadow_write_last_error.clone() {
            content = content.child(
                div()
                    .text_size(tokens::FONT_SM)
                    .text_color(theme.danger_foreground)
                    .child(err),
            );
        }

        content.into_any_element()
    }

    pub(in super::super) fn render_settings_permissions_panel(
        &mut self,
        cx: &mut Context<Self>,
    ) -> gpui::AnyElement {
        let theme = cx.theme();

        let legend = div()
            .flex()
            .items_center()
            .gap_2()
            .child(
                div()
                    .px_2()
                    .py(px(1.0))
                    .rounded_sm()
                    .bg(theme.success)
                    .text_size(tokens::FONT_SM)
                    .text_color(theme.success_foreground)
                    .child("Granted"),
            )
            .child(
                div()
                    .px_2()
                    .py(px(1.0))
                    .rounded_sm()
                    .bg(theme.danger)
                    .text_size(tokens::FONT_SM)
                    .text_color(theme.danger_foreground)
                    .child("Missing"),
            )
            .child(
                div()
                    .px_2()
                    .py(px(1.0))
                    .rounded_sm()
                    .bg(theme.warning)
                    .text_size(tokens::FONT_SM)
                    .text_color(theme.warning_foreground)
                    .child("Unused"),
            );

        let mut content = div()
            .flex()
            .flex_col()
            .gap_3()
            .child(
                div()
                    .text_size(tokens::FONT_LG)
                    .text_color(theme.foreground)
                    .font_weight(gpui::FontWeight::MEDIUM)
                    .child("Permission Audit"),
            )
            .child(
                div()
                    .text_size(tokens::FONT_SM)
                    .text_color(theme.muted_foreground)
                    .child("Review required permissions, missing grants, and unused grants."),
            )
            .child(legend);

        if self.plugins.plugins.is_empty() {
            content = content.child(
                div()
                    .text_size(tokens::FONT_BASE)
                    .text_color(theme.muted_foreground)
                    .child("No plugins installed."),
            );
            return content.into_any_element();
        }

        for plugin in self.plugins.plugins.iter() {
            let audit = compute_permission_audit(plugin);
            let show_permissions = !audit.ordered_permissions.is_empty();

            let mut card = div()
                .flex()
                .flex_col()
                .gap_2()
                .px_3()
                .py_3()
                .rounded_md()
                .border_1()
                .border_color(theme.border)
                .bg(theme.colors.list)
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .child(
                            div()
                                .text_size(tokens::FONT_BASE)
                                .text_color(theme.foreground)
                                .font_weight(gpui::FontWeight::MEDIUM)
                                .child(plugin.name.clone()),
                        )
                        .child(
                            div()
                                .text_size(tokens::FONT_SM)
                                .text_color(theme.muted_foreground)
                                .child(plugin.version.clone()),
                        ),
                );

            if let Some(description) = plugin.description.clone() {
                card = card.child(
                    div()
                        .text_size(tokens::FONT_SM)
                        .text_color(theme.muted_foreground)
                        .child(description),
                );
            }

            if show_permissions {
                let mut chips = div().flex().flex_wrap().gap_1();
                for perm in audit.ordered_permissions.iter() {
                    let is_missing = audit.missing.iter().any(|item| item == perm);
                    let is_unused = audit.unused.iter().any(|item| item == perm);

                    let (bg, fg) = if is_missing {
                        (theme.danger, theme.danger_foreground)
                    } else if is_unused {
                        (theme.warning, theme.warning_foreground)
                    } else {
                        (theme.success, theme.success_foreground)
                    };

                    chips = chips.child(
                        div()
                            .px_2()
                            .py(px(1.0))
                            .rounded_sm()
                            .bg(bg)
                            .text_size(tokens::FONT_SM)
                            .text_color(fg)
                            .child(perm.clone()),
                    );
                }
                card = card.child(chips);
            } else {
                card = card.child(
                    div()
                        .text_size(tokens::FONT_SM)
                        .text_color(theme.muted_foreground)
                        .child("No permissions requested."),
                );
            }

            if !audit.missing.is_empty() {
                card = card.child(
                    div()
                        .text_size(tokens::FONT_SM)
                        .text_color(theme.danger_foreground)
                        .child(format!("Missing: {}", audit.missing.join(", "))),
                );
            }
            if !audit.unused.is_empty() {
                card = card.child(
                    div()
                        .text_size(tokens::FONT_SM)
                        .text_color(theme.warning_foreground)
                        .child(format!("Unused grants: {}", audit.unused.join(", "))),
                );
            }

            content = content.child(card);
        }

        content.into_any_element()
    }

    pub(in super::super) fn render_settings_import_panel(
        &mut self,
        cx: &mut Context<Self>,
    ) -> gpui::AnyElement {
        let theme = cx.theme();
        let exporting = self.ui.offline_export_busy;
        let importing = self.ui.offline_import_busy;

        let mut content = div().flex().flex_col().gap_4().child(
            div()
                .text_size(tokens::FONT_LG)
                .text_color(theme.foreground)
                .font_weight(gpui::FontWeight::MEDIUM)
                .child("Import / Export"),
        );

        content = content.child(
            div()
                .flex()
                .flex_col()
                .gap_3()
                .child(
                    div()
                        .text_size(tokens::FONT_LG)
                        .text_color(theme.foreground)
                        .font_weight(gpui::FontWeight::MEDIUM)
                        .child("Offline archive"),
                )
                .child(div().text_size(tokens::FONT_SM).text_color(theme.muted_foreground).child(
                    "Export a zip with pages and a manifest, or import one back into the vault.",
                ))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .when(exporting || importing, |this| {
                            this.child(
                                crate::ui::components::spinner::Spinner::new().small(),
                            )
                        })
                        .child(
                            Button::new("offline-export")
                                .label(if exporting {
                                    "Exporting…"
                                } else {
                                    "Export offline archive…"
                                })
                                .xsmall()
                                .primary()
                                .disabled(exporting || importing)
                                .on_click(cx.listener(|this, _event, _window, cx| {
                                    this.export_offline_archive(cx);
                                })),
                        )
                        .child(
                            Button::new("offline-import")
                                .label(if importing {
                                    "Importing…"
                                } else {
                                    "Import offline archive…"
                                })
                                .xsmall()
                                .ghost()
                                .disabled(importing || exporting)
                                .on_click(cx.listener(|this, _event, _window, cx| {
                                    this.import_offline_archive(cx);
                                })),
                        ),
                ),
        );

        if let Some(status) = self.ui.offline_export_status.clone() {
            content = content.child(
                div()
                    .text_size(tokens::FONT_SM)
                    .text_color(theme.muted_foreground)
                    .child(status),
            );
        }
        if let Some(status) = self.ui.offline_import_status.clone() {
            content = content.child(
                div()
                    .text_size(tokens::FONT_SM)
                    .text_color(theme.muted_foreground)
                    .child(status),
            );
        }

        content.into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::TestAppContext;
    use gpui_component::Root;
    use std::cell::RefCell;
    use std::rc::Rc;

    #[gpui::test]
    fn settings_modal_render_smoke(cx: &mut TestAppContext) {
        cx.skip_drawing();
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
        cx.update_window(*window, |_root, window, cx| {
            app.update(cx, |app, cx| {
                app.open_settings(SettingsTab::General, window, cx);
            });
            assert!(window.has_active_sheet(cx));
        })
        .unwrap();
    }

    #[test]
    fn permission_audit_orders_requested_then_unused() {
        let plugin = PluginPermissionInfo {
            id: "alpha".into(),
            name: "Alpha".into(),
            version: "0.1.0".into(),
            description: None,
            permissions: vec!["network".into()],
            settings_schema: None,
            enabled: true,
            path: "/plugins/alpha".into(),
            granted_permissions: vec!["clipboard".into(), "network".into()],
            missing_permissions: vec![],
        };

        let audit = compute_permission_audit(&plugin);
        assert_eq!(audit.unused, vec!["clipboard".to_string()]);
        assert_eq!(
            audit.ordered_permissions,
            vec!["network".to_string(), "clipboard".to_string()]
        );
    }
}
