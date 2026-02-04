use crate::app::prelude::*;
use crate::app::store::*;

pub(crate) struct SettingsSheetView {
    app: Entity<AppStore>,
    _subscription: Subscription,
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

        let foreground = cx.theme().foreground;
        let mut nav = div().flex().flex_col().gap_1();

        for tab in [SettingsTab::General, SettingsTab::Plugins] {
            let label = match tab {
                SettingsTab::General => "General",
                SettingsTab::Plugins => "Plugins",
            };
            let is_active = active_tab == tab;
            let mut button = Button::new(format!("settings-sheet-tab-{}", label.to_lowercase()))
                .label(label)
                .xsmall();
            button = if is_active { button.primary() } else { button.ghost() };

            nav = nav.child(button.on_click(cx.listener(move |this, _event, window, cx| {
                this.app.update(cx, |app, cx| {
                    app.set_settings_tab(tab, window, cx);
                });
            })));
        }

        let content = match active_tab {
            SettingsTab::General => self
                .app
                .update(cx, |app, cx| app.render_settings_general_panel(cx)),
            SettingsTab::Plugins => self.app.update(cx, |app, cx| {
                div()
                    .flex()
                    .flex_col()
                    .min_h_0()
                    .child(
                        div()
                            .text_sm()
                            .text_color(cx.theme().foreground)
                            .font_weight(gpui::FontWeight::SEMIBOLD)
                            .child("Plugins"),
                    )
                    .child(div().mt_2().flex_1().min_h_0().child(
                        app.render_plugin_settings_panel(window, cx),
                    ))
                    .into_any_element()
            }),
        };

        div()
            .id("settings-sheet")
            .flex()
            .flex_col()
            .gap_3()
            .min_h_0()
            .child(
                div()
                    .text_sm()
                    .text_color(foreground)
                    .font_weight(gpui::FontWeight::SEMIBOLD)
                    .child("Settings"),
            )
            .child(
                div()
                    .flex()
                    .gap_3()
                    .flex_1()
                    .min_h_0()
                    .child(div().w(px(160.0)).child(nav))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .min_h_0()
                            .overflow_scrollbar()
                            .child(content),
                    ),
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
        let (items, active_ix, palette_input) = {
            let app = self.app.read(cx);
            (
                app.filtered_palette_items(),
                app.ui.palette_index,
                app.ui.palette_input.clone(),
            )
        };

        let (list_active, list_bg, list_hover, foreground, muted) = {
            let theme = cx.theme();
            (
                theme.list_active,
                theme.colors.list,
                theme.list_hover,
                theme.foreground,
                theme.muted_foreground,
            )
        };

        let list = if items.is_empty() {
            div()
                .text_xs()
                .text_color(muted)
                .child("No matches")
                .into_any_element()
        } else {
            let item_sizes = Rc::new(vec![size(px(0.), px(COMPACT_ROW_HEIGHT)); items.len()]);
            let items_for_list = items.clone();
            v_virtual_list(
                cx.entity(),
                "command-palette-list",
                item_sizes,
                move |_this, range: std::ops::Range<usize>, _window, cx| {
                    range
                        .map(|idx| {
                            let item = items_for_list[idx].clone();
                            let is_active = idx == active_ix;
                            let hint = item.hint.clone();

                            let mut row = div()
                                .id(format!("command-palette-item-{}", item.id))
                                .px_3()
                                .py_2()
                                .rounded_md()
                                .bg(if is_active { list_active } else { list_bg })
                                .hover(move |s| s.bg(list_hover).cursor_pointer())
                                .flex()
                                .items_center()
                                .justify_between()
                                .child(
                                    div()
                                        .text_sm()
                                        .text_color(foreground)
                                        .child(item.label.clone()),
                                );

                            if let Some(hint) = hint {
                                row = row.child(
                                    div()
                                        .text_xs()
                                        .text_color(muted)
                                        .child(hint),
                                );
                            }

                            row.on_click(cx.listener(move |this, _event, window, cx| {
                                this.app.update(cx, |app, cx| {
                                    app.run_palette_command(idx, window, cx);
                                });
                            }))
                        })
                        .collect::<Vec<_>>()
                },
            )
            .flex_1()
            .min_h_0()
            .into_any_element()
        };

        div()
            .id("command-palette")
            .key_context("CommandPalette")
            .flex()
            .flex_col()
            .gap_2()
            .min_h_0()
            .child(Input::new(&palette_input).small().cleanable(true))
            .child(list)
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
            list = list.child(
                div()
                    .text_xs()
                    .text_color(muted)
                    .child("No vaults yet."),
            );
        } else {
            for vault in vaults.into_iter() {
                let id = vault.id.clone();
                let is_active = active_id.as_ref().is_some_and(|active| active == &id);
                let bg = if is_active { list_active } else { list_bg };
                let title_color = if is_active { foreground } else { muted };

                list = list.child(
                    div()
                        .id(format!("vault-item-{id}"))
                        .px_2()
                        .py_2()
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
                    .font_weight(gpui::FontWeight::SEMIBOLD)
                    .child("Vaults"),
            )
            .child(list)
            .child(
                div()
                    .text_sm()
                    .text_color(foreground)
                    .font_weight(gpui::FontWeight::SEMIBOLD)
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
            (theme.foreground, theme.muted_foreground, theme.danger_foreground)
        };

        let label = match mode {
            PageDialogMode::Create => "Page title",
            PageDialogMode::Rename => "New title",
        };

        let mut content = div()
            .id("page-dialog")
            .flex()
            .flex_col()
            .gap_2()
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
