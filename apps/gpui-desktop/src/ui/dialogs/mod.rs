use crate::app::prelude::*;
use crate::app::store::*;

fn command_palette_list_height_px(rows: &[PaletteRow]) -> f32 {
    let mut measured = 0.0;
    for row in rows.iter().take(12) {
        measured += match row {
            PaletteRow::Header { .. } => 24.0,
            PaletteRow::Item(_) => COMPACT_ROW_HEIGHT,
        };
    }

    measured.clamp(120.0, 400.0)
}

fn command_palette_icon_for_action(action: &PaletteAction) -> SandpaperIcon {
    match action {
        PaletteAction::OpenVaults | PaletteAction::NewPage | PaletteAction::CreateTestPage => {
            SandpaperIcon::Add
        }
        PaletteAction::OpenSettings | PaletteAction::OpenPluginSettings => SandpaperIcon::Settings,
        PaletteAction::FocusSearch => SandpaperIcon::Search,
        PaletteAction::FocusEditor | PaletteAction::FocusQuickAdd => SandpaperIcon::Menu,
        PaletteAction::RenamePage => SandpaperIcon::Copy,
        PaletteAction::ToggleSidebar => SandpaperIcon::PanelLeftExpand,
        PaletteAction::ToggleContextPanel
        | PaletteAction::OpenContextPanel(_)
        | PaletteAction::CycleContextPanel
        | PaletteAction::ToggleBacklinks => SandpaperIcon::PanelRightExpand,
        PaletteAction::ToggleSplitPane | PaletteAction::DuplicateToSplit => {
            SandpaperIcon::SplitVertical
        }
        PaletteAction::SwapSplitPanes => SandpaperIcon::ArrowSwap,
        PaletteAction::ReloadPlugins
        | PaletteAction::RunPluginToolbarAction(_)
        | PaletteAction::RunPluginCommand(_)
        | PaletteAction::OpenPluginPanel(_)
        | PaletteAction::ClosePluginPanel => SandpaperIcon::Grid,
        PaletteAction::OpenPage(_) => SandpaperIcon::Open,
        PaletteAction::ToggleFocusMode => SandpaperIcon::Eye,
        PaletteAction::OpenQuickCapture => SandpaperIcon::Alert,
        PaletteAction::SwitchMode(_) => SandpaperIcon::ArrowSwap,
        PaletteAction::UndoEdit => SandpaperIcon::ArrowLeft,
        PaletteAction::RedoEdit => SandpaperIcon::ArrowRight,
    }
}

pub(crate) struct SettingsSheetView {
    app: Entity<AppStore>,
    _subscription: Subscription,
}

const SETTINGS_SHEET_TABS: [SettingsTab; 5] = [
    SettingsTab::General,
    SettingsTab::Vault,
    SettingsTab::Plugins,
    SettingsTab::Permissions,
    SettingsTab::Import,
];

fn settings_tab_label(tab: SettingsTab) -> &'static str {
    match tab {
        SettingsTab::General => "General",
        SettingsTab::Vault => "Vault",
        SettingsTab::Plugins => "Plugins",
        SettingsTab::Permissions => "Permissions",
        SettingsTab::Import => "Import",
    }
}

fn settings_tab_index(tab: SettingsTab) -> usize {
    SETTINGS_SHEET_TABS
        .iter()
        .position(|candidate| *candidate == tab)
        .unwrap_or(0)
}

fn settings_tab_from_index(index: usize) -> SettingsTab {
    SETTINGS_SHEET_TABS
        .get(index)
        .copied()
        .unwrap_or(SettingsTab::General)
}

impl SettingsSheetView {
    pub(crate) fn new(app: Entity<AppStore>, cx: &mut Context<Self>) -> Self {
        let subscription = cx.observe(&app, |_this, _app, cx| {
            cx.notify();
        });

        Self {
            app,
            _subscription: subscription,
        }
    }
}

impl Render for SettingsSheetView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let active_tab = self.app.read(cx).settings.tab;

        let selected_index = settings_tab_index(active_tab);
        let tabs = TabBar::new("settings-sheet-tabs")
            .underline()
            .xsmall()
            .selected_index(selected_index)
            .on_click(cx.listener(|this, ix: &usize, window, cx| {
                let tab = settings_tab_from_index(*ix);
                this.app.update(cx, |app, cx| {
                    app.set_settings_tab(tab, window, cx);
                });
            }))
            .child(Tab::new().label(settings_tab_label(SettingsTab::General)))
            .child(Tab::new().label(settings_tab_label(SettingsTab::Vault)))
            .child(Tab::new().label(settings_tab_label(SettingsTab::Plugins)))
            .child(Tab::new().label(settings_tab_label(SettingsTab::Permissions)))
            .child(Tab::new().label(settings_tab_label(SettingsTab::Import)));

        let content = match active_tab {
            SettingsTab::General => self
                .app
                .update(cx, |app, cx| app.render_settings_general_panel(cx)),
            SettingsTab::Vault => self
                .app
                .update(cx, |app, cx| app.render_settings_vault_panel(cx)),
            SettingsTab::Plugins => self
                .app
                .update(cx, |app, cx| app.render_plugin_settings_panel(window, cx)),
            SettingsTab::Permissions => self
                .app
                .update(cx, |app, cx| app.render_settings_permissions_panel(cx)),
            SettingsTab::Import => self
                .app
                .update(cx, |app, cx| app.render_settings_import_panel(cx)),
        };

        div()
            .id("settings-sheet")
            .flex()
            .flex_col()
            .gap_3()
            .min_h_0()
            .child(tabs)
            .child(
                div()
                    .flex_1()
                    .min_h_0()
                    .w_full()
                    .overflow_scrollbar()
                    .child(div().w_full().max_w(px(720.0)).mx_auto().child(content)),
            )
    }
}

pub(crate) struct CommandPaletteDialogView {
    app: Entity<AppStore>,
    _subscription: Subscription,
}

impl CommandPaletteDialogView {
    pub(crate) fn new(app: Entity<AppStore>, cx: &mut Context<Self>) -> Self {
        let subscription = cx.observe(&app, |_this, _app, cx| {
            cx.notify();
        });

        Self {
            app,
            _subscription: subscription,
        }
    }
}

impl Render for CommandPaletteDialogView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let (rows, active_ix, palette_input) = {
            let app = self.app.read(cx);
            (
                app.filtered_palette_rows(),
                app.ui.palette_index,
                app.ui.palette_input.clone(),
            )
        };

        let item_count = rows
            .iter()
            .filter(|row| matches!(row, PaletteRow::Item(_)))
            .count();
        let list_height = px(command_palette_list_height_px(&rows));

        let (list_active, list_hover, foreground, muted, border, secondary, ring, accent) = {
            let theme = cx.theme();
            (
                theme.list_active,
                theme.list_hover,
                theme.foreground,
                theme.muted_foreground,
                theme.border,
                theme.secondary,
                theme.ring,
                theme.accent,
            )
        };
        let popover = cx.theme().popover;

        let mut active_ix = active_ix;
        if active_ix >= rows.len() {
            active_ix = 0;
        }
        if !matches!(rows.get(active_ix), Some(PaletteRow::Item(_))) {
            if let Some((ix, _)) = rows
                .iter()
                .enumerate()
                .skip(active_ix)
                .find(|(_, row)| matches!(row, PaletteRow::Item(_)))
            {
                active_ix = ix;
            } else if let Some((ix, _)) = rows
                .iter()
                .enumerate()
                .rev()
                .find(|(_, row)| matches!(row, PaletteRow::Item(_)))
            {
                active_ix = ix;
            } else {
                active_ix = 0;
            }
        }

        let list = if item_count == 0 {
            div()
                .h_full()
                .px_3()
                .py_4()
                .text_xs()
                .text_color(muted)
                .child("No matches")
                .into_any_element()
        } else {
            let item_sizes = Rc::new(
                rows.iter()
                    .map(|row| match row {
                        PaletteRow::Header { .. } => size(px(0.), px(24.0)),
                        PaletteRow::Item(_) => size(px(0.), px(COMPACT_ROW_HEIGHT + 6.0)),
                    })
                    .collect::<Vec<_>>(),
            );
            let rows_for_list = rows.clone();
            v_virtual_list(
                cx.entity(),
                "command-palette-list",
                item_sizes,
                move |_this, range: std::ops::Range<usize>, _window, cx| {
                    range
                        .map(|idx| match rows_for_list[idx].clone() {
                            PaletteRow::Header { id, label } => div()
                                .id(format!("command-palette-header-{}", id))
                                .px_3()
                                .pt_2()
                                .pb_1()
                                .text_xs()
                                .text_color(muted)
                                .font_weight(gpui::FontWeight::MEDIUM)
                                .child(label.to_ascii_uppercase())
                                .into_any_element(),
                            PaletteRow::Item(item) => {
                                let is_active = idx == active_ix;
                                let hint = item.hint.clone();
                                let icon_kind = command_palette_icon_for_action(&item.action);
                                let icon_bg = if is_active {
                                    accent.opacity(0.18)
                                } else {
                                    secondary
                                };
                                let icon_fg = if is_active { accent } else { muted };

                                let mut row = div()
                                    .id(format!("command-palette-item-{}", item.id))
                                    .mx_1()
                                    .my(px(1.0))
                                    .px_2()
                                    .py_1()
                                    .rounded_md()
                                    .border_1()
                                    .border_color(if is_active {
                                        ring.opacity(0.6)
                                    } else {
                                        gpui::transparent_black()
                                    })
                                    .bg(if is_active {
                                        list_active
                                    } else {
                                        gpui::transparent_black()
                                    })
                                    .hover(move |s| {
                                        if is_active {
                                            s
                                        } else {
                                            s.bg(list_hover).cursor_pointer()
                                        }
                                    })
                                    .flex()
                                    .items_center()
                                    .justify_between()
                                    .child(
                                        div()
                                            .flex()
                                            .items_center()
                                            .gap_2()
                                            .text_sm()
                                            .text_color(foreground)
                                            .child(
                                                div()
                                                    .w(px(20.0))
                                                    .h(px(20.0))
                                                    .rounded_sm()
                                                    .bg(icon_bg)
                                                    .flex()
                                                    .items_center()
                                                    .justify_center()
                                                    .child(
                                                        Icon::new(icon_kind)
                                                            .size_3()
                                                            .text_color(icon_fg),
                                                    ),
                                            )
                                            .child(item.label.clone()),
                                    );

                                if let Some(hint) = hint {
                                    row = row.child(
                                        div()
                                            .text_xs()
                                            .text_color(muted)
                                            .bg(secondary)
                                            .rounded_sm()
                                            .px_1()
                                            .py(px(2.0))
                                            .child(hint),
                                    );
                                }

                                row.on_click(cx.listener(move |this, _event, window, cx| {
                                    this.app.update(cx, |app, cx| {
                                        app.run_palette_command(idx, window, cx);
                                    });
                                }))
                                .into_any_element()
                            }
                        })
                        .collect::<Vec<_>>()
                },
            )
            .w_full()
            .h_full()
            .into_any_element()
        };

        div()
            .id("command-palette")
            .key_context("CommandPalette")
            .flex()
            .flex_col()
            .rounded_xl()
            .border_1()
            .border_color(border)
            .bg(popover)
            .overflow_hidden()
            .min_h_0()
            .child(
                div().p_3().border_b_1().border_color(border).child(
                    div()
                        .rounded_md()
                        .border_1()
                        .border_color(border)
                        .bg(secondary)
                        .px_2()
                        .child(
                            Input::new(&palette_input)
                                .small()
                                .appearance(false)
                                .bordered(false)
                                .focus_bordered(false)
                                .cleanable(true)
                                .prefix(
                                    Icon::new(SandpaperIcon::Search)
                                        .small()
                                        .text_color(cx.theme().muted_foreground),
                                ),
                        ),
                ),
            )
            .child(
                div()
                    .px_2()
                    .py_2()
                    .h(list_height)
                    .max_h(px(400.0))
                    .child(list),
            )
    }
}

pub(crate) struct NotificationsDialogView {
    app: Entity<AppStore>,
    _subscription: Subscription,
}

impl NotificationsDialogView {
    pub(crate) fn new(app: Entity<AppStore>, cx: &mut Context<Self>) -> Self {
        let subscription = cx.observe(&app, |_this, _app, cx| {
            cx.notify();
        });

        Self {
            app,
            _subscription: subscription,
        }
    }
}

impl Render for NotificationsDialogView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let (items, unread) = {
            let app = self.app.read(cx);
            (
                app.ui.notifications.clone(),
                app.unread_notifications_count(),
            )
        };

        let theme = cx.theme();
        let title = if unread > 0 {
            format!("Notifications ({unread})")
        } else {
            "Notifications".to_string()
        };

        let actions = div()
            .flex()
            .items_center()
            .justify_between()
            .child(
                div()
                    .text_sm()
                    .text_color(theme.foreground)
                    .font_weight(gpui::FontWeight::MEDIUM)
                    .child(title),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .child(
                        Button::new("notifications-mark-read")
                            .label("Mark all read")
                            .xsmall()
                            .ghost()
                            .on_click(cx.listener(|this, _event, _window, cx| {
                                this.app.update(cx, |app, cx| {
                                    app.mark_all_notifications_read(cx);
                                });
                            })),
                    )
                    .child(
                        Button::new("notifications-clear")
                            .label("Clear")
                            .xsmall()
                            .ghost()
                            .on_click(cx.listener(|this, _event, _window, cx| {
                                this.app.update(cx, |app, cx| {
                                    app.clear_notifications(cx);
                                });
                            })),
                    ),
            );

        let mut list = div().flex().flex_col().gap_3();
        if items.is_empty() {
            list = list.child(
                div()
                    .text_sm()
                    .text_color(theme.muted_foreground)
                    .child("No notifications."),
            );
        } else {
            for item in items.iter().rev() {
                let icon = match item.kind {
                    NotificationKind::PluginError => SandpaperIcon::Warning,
                };
                let stamp = chrono::Utc
                    .timestamp_millis_opt(item.created_at_ms)
                    .single()
                    .map(|dt| {
                        dt.with_timezone(&Local)
                            .format("%Y-%m-%d %H:%M")
                            .to_string()
                    })
                    .unwrap_or_else(|| "—".to_string());
                let mut card = div()
                    .id(format!("notification-{}", item.id))
                    .px_4()
                    .py_4()
                    .rounded_md()
                    .bg(theme.colors.list)
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_2()
                                    .child(
                                        Icon::new(icon).small().text_color(theme.muted_foreground),
                                    )
                                    .child(
                                        div()
                                            .text_sm()
                                            .text_color(theme.foreground)
                                            .font_weight(gpui::FontWeight::MEDIUM)
                                            .child(item.title.clone()),
                                    ),
                            )
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_2()
                                    .child(
                                        div()
                                            .text_xs()
                                            .text_color(theme.muted_foreground)
                                            .child(stamp),
                                    )
                                    .child(
                                        div()
                                            .text_xs()
                                            .text_color(theme.muted_foreground)
                                            .child(if item.read { "Read" } else { "Unread" }),
                                    ),
                            ),
                    )
                    .child(
                        div()
                            .mt_2()
                            .text_sm()
                            .text_color(theme.foreground)
                            .child(item.message.clone()),
                    );

                if let Some(details) = item.details.clone() {
                    card = card.child(
                        div()
                            .mt_2()
                            .text_xs()
                            .text_color(theme.muted_foreground)
                            .child(details),
                    );
                }

                list = list.child(card);
            }
        }

        div()
            .id("notifications-dialog")
            .flex()
            .flex_col()
            .gap_3()
            .min_h_0()
            .child(actions)
            .child(div().flex_1().min_h_0().overflow_scrollbar().child(list))
    }
}

pub(crate) struct VaultDialogView {
    app: Entity<AppStore>,
    _subscription: Subscription,
}

impl VaultDialogView {
    pub(crate) fn new(app: Entity<AppStore>, cx: &mut Context<Self>) -> Self {
        let subscription = cx.observe(&app, |_this, _app, cx| {
            cx.notify();
        });

        Self {
            app,
            _subscription: subscription,
        }
    }
}

impl Render for VaultDialogView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let (vaults, active_id, name_input, path_input, error) = {
            let app = self.app.read(cx);
            (
                app.app.vaults.clone(),
                app.app.active_vault_id.clone(),
                app.ui.vault_dialog_name_input.clone(),
                app.ui.vault_dialog_path_input.clone(),
                app.ui.vault_dialog_error.clone(),
            )
        };

        let (list_bg, list_active, list_hover, foreground, muted, danger) = {
            let theme = cx.theme();
            (
                theme.colors.list,
                theme.list_active,
                theme.list_hover,
                theme.foreground,
                theme.muted_foreground,
                theme.danger_foreground,
            )
        };

        let mut list = div().flex().flex_col().gap_1();
        if vaults.is_empty() {
            list = list.child(div().text_xs().text_color(muted).child("No vaults yet."));
        } else {
            for vault in vaults.into_iter() {
                let id = vault.id.clone();
                let is_active = active_id.as_ref().is_some_and(|active| active == &id);
                let bg = if is_active { list_active } else { list_bg };
                let title_color = if is_active { foreground } else { muted };

                list = list.child(
                    div()
                        .id(format!("vault-item-{id}"))
                        .px_3()
                        .py(px(10.0))
                        .rounded_md()
                        .bg(bg)
                        .hover(move |s| s.bg(list_hover).cursor_pointer())
                        .flex()
                        .items_center()
                        .justify_between()
                        .child(
                            div()
                                .text_sm()
                                .text_color(title_color)
                                .child(vault.name.clone()),
                        )
                        .on_click(cx.listener(move |this, _event, window, cx| {
                            this.app.update(cx, |app, cx| {
                                app.set_active_vault(id.clone(), cx);
                                app.ui.vault_dialog_open = false;
                                cx.notify();
                            });
                            window.close_dialog(cx);
                        })),
                );
            }
        }

        if let Some(msg) = error {
            list = list.child(div().mt_1().text_xs().text_color(danger).child(msg));
        }

        let browse_button = Button::new("vault-path-browse")
            .label("Browse…")
            .xsmall()
            .ghost()
            .on_click(cx.listener(|this, _event, _window, cx| {
                let receiver = cx.prompt_for_paths(gpui::PathPromptOptions {
                    files: false,
                    directories: true,
                    multiple: false,
                    prompt: Some("Select vault directory".into()),
                });
                let app = this.app.clone();
                cx.spawn(async move |_this, cx| {
                    let Ok(result) = receiver.await else {
                        return;
                    };
                    let Ok(Some(mut paths)) = result else {
                        return;
                    };
                    let Some(path) = paths.pop() else {
                        return;
                    };
                    let display = path.display().to_string();
                    app.update(cx, |app, cx| {
                        let input = app.ui.vault_dialog_path_input.clone();
                        app.with_window(cx, move |window, cx| {
                            input.update(cx, |input, cx| {
                                input.set_value(display.clone(), window, cx);
                                let position = input.text().offset_to_position(0);
                                input.set_cursor_position(position, window, cx);
                            });
                        });
                        cx.notify();
                    });
                })
                .detach();
            }));

        let create_button = Button::new("vault-create")
            .label("Create vault")
            .xsmall()
            .primary()
            .on_click(cx.listener(|this, _event, window, cx| {
                let should_close = this.app.update(cx, |app, cx| {
                    app.create_vault(cx);
                    !app.ui.vault_dialog_open
                });

                if should_close {
                    window.close_dialog(cx);
                }
            }));

        div()
            .id("vault-dialog")
            .flex()
            .flex_col()
            .gap_3()
            .child(
                div()
                    .text_sm()
                    .text_color(foreground)
                    .font_weight(gpui::FontWeight::MEDIUM)
                    .child("Vaults"),
            )
            .child(list)
            .child(
                div()
                    .text_sm()
                    .text_color(foreground)
                    .font_weight(gpui::FontWeight::MEDIUM)
                    .child("Create new vault"),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_1()
                    .child(div().text_xs().text_color(muted).child("Name"))
                    .child(Input::new(&name_input).small()),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_1()
                    .child(div().text_xs().text_color(muted).child("Path"))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .child(Input::new(&path_input).small())
                            .child(browse_button),
                    ),
            )
            .child(create_button)
    }
}

pub(crate) struct PageDialogView {
    app: Entity<AppStore>,
    _subscription: Subscription,
}

impl PageDialogView {
    pub(crate) fn new(app: Entity<AppStore>, cx: &mut Context<Self>) -> Self {
        let subscription = cx.observe(&app, |_this, _app, cx| {
            cx.notify();
        });

        Self {
            app,
            _subscription: subscription,
        }
    }
}

impl Render for PageDialogView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let (input, error, mode) = {
            let app = self.app.read(cx);
            (
                app.ui.page_dialog_input.clone(),
                app.ui.page_dialog_error.clone(),
                app.ui.page_dialog_mode,
            )
        };

        let (foreground, muted, danger) = {
            let theme = cx.theme();
            (
                theme.foreground,
                theme.muted_foreground,
                theme.danger_foreground,
            )
        };

        let label = match mode {
            PageDialogMode::Create => "Page title",
            PageDialogMode::Rename => "New title",
        };

        let mut content = div()
            .id("page-dialog")
            .flex()
            .flex_col()
            .gap_3()
            .child(div().text_xs().text_color(muted).child(label))
            .child(Input::new(&input).small());

        if let Some(error) = error {
            content = content.child(div().text_xs().text_color(danger).child(error));
        } else {
            content = content.child(
                div()
                    .text_xs()
                    .text_color(muted)
                    .child("Press Enter to confirm."),
            );
        }

        content.text_color(foreground)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_palette_list_height_has_minimum() {
        let rows: Vec<PaletteRow> = Vec::new();
        assert_eq!(command_palette_list_height_px(&rows), 120.0);
    }

    #[test]
    fn command_palette_list_height_caps_for_large_lists() {
        let rows = (0..40)
            .map(|ix| {
                PaletteRow::Item(PaletteItem {
                    id: format!("item-{ix}"),
                    label: format!("Item {ix}"),
                    hint: None,
                    action: PaletteAction::NewPage,
                })
            })
            .collect::<Vec<_>>();

        assert!(command_palette_list_height_px(&rows) <= 400.0);
    }

    #[test]
    fn command_palette_icon_maps_page_actions() {
        assert_eq!(
            command_palette_icon_for_action(&PaletteAction::OpenPage("page-a".to_string())),
            SandpaperIcon::Open
        );
        assert_eq!(
            command_palette_icon_for_action(&PaletteAction::CreateTestPage),
            SandpaperIcon::Add
        );
    }

    #[test]
    fn settings_tab_index_and_lookup_roundtrip() {
        for (ix, tab) in SETTINGS_SHEET_TABS.iter().enumerate() {
            assert_eq!(settings_tab_index(*tab), ix);
            assert_eq!(settings_tab_from_index(ix), *tab);
            assert!(!settings_tab_label(*tab).is_empty());
        }
    }

    #[test]
    fn settings_tab_lookup_defaults_to_general_for_invalid_index() {
        assert_eq!(settings_tab_from_index(usize::MAX), SettingsTab::General);
    }
}
