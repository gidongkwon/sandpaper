use crate::app::prelude::*;
use crate::app::store::*;
use crate::ui::sandpaper_theme::SandpaperTheme;
use crate::ui::tokens;
use gpui::{ease_in_out, Animation, AnimationExt as _};
use gpui_component::{IconName, TitleBar};

impl AppStore {
    fn topbar_mode_switch_uses_small_buttons() -> bool {
        true
    }

    fn render_topbar(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let active_vault = self
            .app
            .active_vault_id
            .as_ref()
            .and_then(|id| self.app.vaults.iter().find(|vault| &vault.id == id));
        let vault_label: SharedString = active_vault
            .map(|vault| vault.name.clone().into())
            .unwrap_or_else(|| "No vault".into());
        let sidebar_icon = if self.settings.sidebar_collapsed {
            SandpaperIcon::PanelLeftExpand
        } else {
            SandpaperIcon::PanelLeftContract
        };
        let sidebar_hint = shortcut_hint(ShortcutSpec::new("cmd-b", "ctrl-b"));
        let command_hint = shortcut_hint(ShortcutSpec::new("cmd-k", "ctrl-k"));
        let context_panel_icon = if self.settings.context_panel_open {
            SandpaperIcon::PanelRightContract
        } else {
            SandpaperIcon::PanelRightExpand
        };
        let unread_notifications = self.unread_notifications_count();
        let notifications_label: SharedString = if unread_notifications > 0 {
            format!("Notifications ({unread_notifications})").into()
        } else {
            "Notifications".into()
        };

        let vault_fg = theme.muted_foreground;
        let vault_hover_fg = theme.foreground;
        let pending_review_count = self.editor.review_items.len();
        // Mode pills
        let current_mode = self.app.mode;
        let mut mode_pills = div()
            .id("topbar-mode-switcher")
            .flex()
            .items_center()
            .gap_1();
        for (mode, label) in [
            (Mode::Capture, "Capture"),
            (Mode::Editor, "Edit"),
            (Mode::Review, "Review"),
        ] {
            let mut btn = Button::new(format!("mode-{label}")).label(label);
            btn = if Self::topbar_mode_switch_uses_small_buttons() {
                btn.small()
            } else {
                btn.xsmall()
            };
            btn = if current_mode == mode {
                btn.primary()
            } else {
                btn.ghost()
            };
            let button = btn
                .on_click(cx.listener(move |this, _event, _window, cx| {
                    this.set_mode(mode, cx);
                }))
                .into_any_element();

            let pill = if mode == Mode::Review && pending_review_count > 0 {
                let badge_label: SharedString = if pending_review_count > 99 {
                    "99+".into()
                } else {
                    pending_review_count.to_string().into()
                };
                div()
                    .relative()
                    .child(button)
                    .child(
                        div()
                            .absolute()
                            .top(px(-4.0))
                            .right(px(-6.0))
                            .min_w(tokens::ICON_MD)
                            .h(tokens::ICON_MD)
                            .px_1()
                            .rounded_full()
                            .bg(theme.danger)
                            .text_size(tokens::FONT_XS)
                            .font_weight(gpui::FontWeight::SEMIBOLD)
                            .text_color(theme.danger_foreground)
                            .flex()
                            .items_center()
                            .justify_center()
                            .child(badge_label),
                    )
                    .into_any_element()
            } else {
                button
            };

            mode_pills = mode_pills.child(pill);
        }

        let divider_color = theme.border;
        let left_group = div()
            .id("topbar-left")
            .flex()
            .items_center()
            .gap_3()
            .child(
                Button::new("toggle-sidebar")
                    .with_size(tokens::ICON_XL)
                    .ghost()
                    .icon(sidebar_icon)
                    .tooltip(format!("Toggle sidebar ({sidebar_hint})"))
                    .on_click(cx.listener(|this, _event, _window, cx| {
                        this.settings.sidebar_collapsed = !this.settings.sidebar_collapsed;
                        this.ui.sidebar_collapse_epoch += 1;
                        this.persist_settings();
                        cx.notify();
                    })),
            )
            .child(div().w(px(1.0)).h(tokens::ICON_SM).bg(divider_color))
            .child(
                div()
                    .id("vault-name")
                    .text_size(tokens::FONT_XS)
                    .text_color(vault_fg)
                    .cursor_pointer()
                    .hover(move |s| s.text_color(vault_hover_fg))
                    .on_click(cx.listener(|this, _event, window, cx| {
                        this.open_vaults(&OpenVaults, window, cx);
                    }))
                    .child(vault_label),
            );

        let right_group = div()
            .id("topbar-right")
            .flex()
            .items_center()
            .gap_3()
            .child(
                Button::new("open-command-palette")
                    .with_size(tokens::ICON_XL)
                    .ghost()
                    .icon(SandpaperIcon::Search)
                    .tooltip(format!("Command palette ({command_hint})"))
                    .on_click(cx.listener(|this, _event, window, cx| {
                        this.open_command_palette(window, cx);
                    })),
            )
            .child({
                let notif_btn = Button::new("notifications-button")
                    .with_size(tokens::ICON_XL)
                    .ghost()
                    .icon(SandpaperIcon::Alert)
                    .tooltip(notifications_label)
                    .on_click(cx.listener(|this, _event, window, cx| {
                        this.open_notifications(window, cx);
                    }));
                if unread_notifications > 0 {
                    div()
                        .relative()
                        .child(notif_btn)
                        .child(
                            div()
                                .absolute()
                                .top(px(-2.0))
                                .right(px(-2.0))
                                .w(px(8.0))
                                .h(px(8.0))
                                .rounded_full()
                                .bg(theme.danger),
                        )
                } else {
                    div().child(notif_btn)
                }
            })
            .child(
                Button::new("settings-button")
                    .with_size(tokens::ICON_XL)
                    .ghost()
                    .icon(SandpaperIcon::Settings)
                    .tooltip("Settings")
                    .on_click(cx.listener(|this, _event, window, cx| {
                        this.open_settings(SettingsTab::General, window, cx);
                    })),
            )
            .child(
                Button::new("toggle-context-panel")
                    .with_size(tokens::ICON_XL)
                    .ghost()
                    .icon(context_panel_icon)
                    .tooltip("Toggle panel")
                    .on_click(cx.listener(|this, _event, _window, cx| {
                        this.settings.context_panel_open = !this.settings.context_panel_open;
                        this.ui.context_panel_epoch += 1;
                        this.persist_settings();
                        cx.notify();
                    })),
            );

        TitleBar::new().child(
            div()
                .h_full()
                .flex_1()
                .min_w_0()
                .px_4()
                .flex()
                .items_center()
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .flex()
                        .items_center()
                        .justify_start()
                        .child(left_group),
                )
                .child(
                    div()
                        .id("topbar-center")
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(mode_pills),
                )
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .flex()
                        .items_center()
                        .justify_end()
                        .child(right_group),
                ),
        )
    }

    fn render_sidebar_resizer(&mut self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let theme = cx.theme();
        let hover_border = theme.border;
        div()
            .id("sidebar-resizer")
            .w(tokens::SPACE_2)
            .h_full()
            .hover(move |s| s.bg(hover_border).cursor_pointer())
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|this, event: &MouseDownEvent, _window, cx| {
                    this.begin_sidebar_resize(f32::from(event.position.x), cx);
                    cx.stop_propagation();
                }),
            )
            .into_any_element()
    }

    pub(crate) fn render_context_panel_header(
        &mut self,
        cx: &mut Context<Self>,
    ) -> gpui::AnyElement {
        let active_tab = self.settings.context_panel_tab;
        let selected_index = match active_tab {
            WorkspacePanel::Review => 0,
            WorkspacePanel::Backlinks => 1,
            WorkspacePanel::Connections => 2,
            WorkspacePanel::Plugins => 3,
        };
        let tabs = TabBar::new("context-panel-tabs")
            .underline()
            .xsmall()
            .selected_index(selected_index)
            .on_click(cx.listener(|this, ix: &usize, _window, cx| {
                let tab = match *ix {
                    0 => WorkspacePanel::Review,
                    1 => WorkspacePanel::Backlinks,
                    2 => WorkspacePanel::Connections,
                    _ => WorkspacePanel::Plugins,
                };
                this.set_context_panel_tab(tab, cx);
            }))
            .child(Tab::new().label("Review"))
            .child(Tab::new().label("Backlinks"))
            .child(Tab::new().label("Connections"))
            .child(Tab::new().label("Plugins"));

        div()
            .px_4()
            .py_2()
            .child(tabs)
            .into_any_element()
    }

    fn render_empty_context_panel(
        &mut self,
        title: &str,
        message: &str,
        icon: IconName,
        cx: &mut Context<Self>,
    ) -> gpui::AnyElement {
        use crate::ui::components::empty_state::EmptyState;
        let border = cx.theme().border;
        let sidebar_bg = cx.theme().sidebar;
        let header = self.render_context_panel_header(cx);
        div()
            .w(tokens::CONTEXT_PANEL_WIDTH)
            .h_full()
            .border_l_1()
            .border_color(border)
            .bg(sidebar_bg)
            .flex()
            .flex_col()
            .min_h_0()
            .child(header)
            .child(EmptyState::new(title.to_string(), message.to_string()).icon(icon))
            .into_any_element()
    }

    fn render_connections_panel(&mut self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let theme = cx.theme();
        let semantic = cx.global::<SandpaperTheme>().colors(cx);
        let accent_subtle = semantic.accent_subtle;
        let border = theme.border;
        let sidebar_bg = theme.sidebar;
        let fg = theme.foreground;
        let muted_fg = theme.muted_foreground;
        let accent = theme.accent;
        let hover_bg = theme.list_hover;
        let header = self.render_context_panel_header(cx);

        let related = self.editor.related_pages.clone();
        let random = self.editor.random_pages.clone();

        let mut body = div()
            .flex()
            .flex_col()
            .gap_3()
            .p_4()
            .flex_1()
            .min_h_0()
            .overflow_y_scrollbar();

        // Related Notes section
        body = body.child(
            div()
                .text_size(tokens::FONT_XS)
                .font_weight(gpui::FontWeight::MEDIUM)

                .text_color(muted_fg)
                .child("Related notes"),
        );

        if related.is_empty() {
            use crate::ui::components::empty_state::EmptyState;
            body = body.child(
                EmptyState::new(
                    "No related pages",
                    "Create links between pages to discover connections.",
                )
                .icon(IconName::Globe),
            );
        } else {
            for item in &related {
                let uid = item.page_uid.clone();
                let title: SharedString = item.page_title.clone().into();
                let mut reason_pills = div().flex().items_center().gap_1().flex_wrap();
                for reason in &item.reasons {
                    let label: SharedString = match reason {
                        connections::ConnectionReason::SharedLink(target) => {
                            format!("link: {target}").into()
                        }
                        connections::ConnectionReason::DirectLink => "direct".into(),
                    };
                    reason_pills = reason_pills.child(
                        div()
                            .px_1()
                            .py(px(1.0))
                            .rounded_sm()
                            .bg(accent_subtle)
                            .text_color(accent)
                            .text_size(tokens::FONT_XS)
                            .child(label),
                    );
                }

                body = body.child(
                    div()
                        .id(SharedString::from(format!("related-{uid}")))
                        .rounded_md()
                        .px_3()
                        .py(tokens::SPACE_3)
                        .cursor_pointer()
                        .hover(move |s| s.bg(hover_bg))
                        .on_click(cx.listener(move |this, _event, _window, cx| {
                            this.open_page(&uid, cx);
                        }))
                        .flex()
                        .flex_col()
                        .gap(tokens::SPACE_1)
                        .child(
                            div()
                                .text_size(tokens::FONT_BASE)
                                .text_color(fg)
                                .child(title),
                        )
                        .child(reason_pills),
                );
            }
        }

        // Random Discovery section
        body = body.child(
            div()
                .mt_2()
                .flex()
                .items_center()
                .justify_between()
                .child(
                    div()
                        .text_size(tokens::FONT_XS)
                        .font_weight(gpui::FontWeight::MEDIUM)
        
                        .text_color(muted_fg)
                        .child("Random discovery"),
                )
                .child(
                    Button::new("refresh-random")
                        .with_size(tokens::FONT_XL)
                        .ghost()
                        .icon(SandpaperIcon::ArrowSwap)
                        .tooltip("Refresh random pages")
                        .on_click(cx.listener(|this, _event, _window, cx| {
                            this.refresh_connections(cx);
                        })),
                ),
        );

        if random.is_empty() {
            use crate::ui::components::empty_state::EmptyState;
            body = body.child(
                EmptyState::new(
                    "No pages to discover",
                    "Create more pages to see random suggestions here.",
                )
                .icon(IconName::BookOpen),
            );
        } else {
            for page in &random {
                let uid = page.uid.clone();
                let title: SharedString = page.title.clone().into();
                body = body.child(
                    div()
                        .id(SharedString::from(format!("random-{uid}")))
                        .rounded_md()
                        .px_3()
                        .py(tokens::SPACE_3)
                        .cursor_pointer()
                        .hover(move |s| s.bg(hover_bg))
                        .on_click(cx.listener(move |this, _event, _window, cx| {
                            this.open_page(&uid, cx);
                        }))
                        .child(
                            div()
                                .text_size(tokens::FONT_BASE)
                                .text_color(fg)
                                .child(title),
                        ),
                );
            }
        }

        div()
            .w(tokens::CONTEXT_PANEL_WIDTH)
            .h_full()
            .border_l_1()
            .border_color(border)
            .bg(sidebar_bg)
            .flex()
            .flex_col()
            .min_h_0()
            .child(header)
            .child(body)
            .into_any_element()
    }

    fn render_context_panel_content(&mut self, cx: &mut Context<Self>) -> gpui::AnyElement {
        match self.settings.context_panel_tab {
            WorkspacePanel::Review => self.render_review_pane(cx).into_any_element(),
            WorkspacePanel::Backlinks => self.render_backlinks_panel(cx).unwrap_or_else(|| {
                self.render_empty_context_panel(
                    "Backlinks",
                    "Open a page to view backlinks and unlinked references.",
                    IconName::ExternalLink,
                    cx,
                )
            }),
            WorkspacePanel::Plugins => self.render_plugin_panel(cx).unwrap_or_else(|| {
                self.render_empty_context_panel(
                    "Plugin Panel",
                    "Open a plugin panel from the command palette or plugin settings.",
                    IconName::Settings,
                    cx,
                )
            }),
            WorkspacePanel::Connections => self.render_connections_panel(cx),
        }
    }

    fn render_context_panel(&mut self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let open = self.settings.context_panel_open;
        let epoch = self.ui.context_panel_epoch;
        let animating = epoch > 0;
        let panel_w = f32::from(tokens::CONTEXT_PANEL_WIDTH);

        // Build the panel container — always rendered for animation
        let container = div()
            .id("context-panel-animated")
            .overflow_hidden()
            .h_full()
            .flex_shrink_0();

        if !open && !animating {
            // Not open and no animation ever triggered — render nothing (zero width)
            return container.w(px(0.0)).into_any_element();
        }

        // Render panel content only when open (or during close animation)
        let content = if open || animating {
            Some(self.render_context_panel_content(cx))
        } else {
            None
        };

        let content_div = div()
            .w(tokens::CONTEXT_PANEL_WIDTH)
            .h_full()
            .flex_shrink_0()
            .children(content);

        if animating {
            // Animated slide-in/slide-out
            let duration = if open {
                tokens::DURATION_NORMAL // 200ms for open
            } else {
                Duration::from_millis(150) // 150ms for close
            };

            container
                .child(content_div.with_animation(
                    format!("ctx-panel-opacity-{epoch}"),
                    Animation::new(duration).with_easing(ease_in_out),
                    move |el, delta| {
                        let opacity = if open { delta } else { 1.0 - delta };
                        el.opacity(opacity)
                    },
                ))
                .with_animation(
                    format!("ctx-panel-width-{epoch}"),
                    Animation::new(duration).with_easing(ease_in_out),
                    move |el, delta| {
                        let (from_w, to_w) = if open { (0.0, panel_w) } else { (panel_w, 0.0) };
                        let w = from_w + (to_w - from_w) * delta;
                        el.w(px(w))
                    },
                )
                .into_any_element()
        } else {
            // Static: panel is open, no animation on initial render
            container
                .w(tokens::CONTEXT_PANEL_WIDTH)
                .child(content_div)
                .into_any_element()
        }
    }

    pub(crate) fn render_root(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let focus_mode = self.settings.focus_mode;
        let compact = window.viewport_size().width < tokens::BREAKPOINT_COMPACT;

        let mut root = div()
            .id("sandpaper-app")
            .key_context("Sandpaper")
            .on_action(cx.listener(Self::open_vaults))
            .on_action(cx.listener(Self::new_page))
            .on_action(cx.listener(Self::rename_page))
            .on_action(cx.listener(Self::toggle_sidebar_action))
            .on_action(cx.listener(Self::toggle_context_panel_action))
            .on_action(cx.listener(Self::open_review_panel_action))
            .on_action(cx.listener(Self::cycle_context_panel_action))
            .on_action(cx.listener(Self::focus_quick_add_action))
            .on_action(cx.listener(Self::open_command_palette_action))
            .on_action(cx.listener(Self::close_command_palette_action))
            .on_action(cx.listener(Self::palette_move_up))
            .on_action(cx.listener(Self::palette_move_down))
            .on_action(cx.listener(Self::palette_run))
            .on_action(cx.listener(Self::toggle_focus_mode_action))
            .on_action(cx.listener(Self::open_quick_capture_action))
            .on_action(cx.listener(Self::switch_to_capture_action))
            .on_action(cx.listener(Self::switch_to_edit_action))
            .on_action(cx.listener(Self::switch_to_review_action))
            .on_action(cx.listener(Self::open_keyboard_shortcuts_action))
            .on_mouse_move(cx.listener(|this, event: &MouseMoveEvent, _window, cx| {
                if this.ui.sidebar_resize.is_some() {
                    if event.dragging() {
                        this.update_sidebar_resize(f32::from(event.position.x), cx);
                    }
                    return;
                }

                if this.editor.link_preview.is_some() && !this.editor.link_preview_hovering_link {
                    this.schedule_link_preview_close(cx);
                }
            }))
            .on_mouse_up(
                MouseButton::Left,
                cx.listener(|this, _event: &MouseUpEvent, _window, cx| {
                    this.end_sidebar_resize(cx);
                    let _ = this.commit_block_drag_if_active(cx);
                }),
            )
            .on_mouse_up_out(
                MouseButton::Left,
                cx.listener(|this, _event: &MouseUpEvent, _window, cx| {
                    this.end_sidebar_resize(cx);
                    let _ = this.commit_block_drag_if_active(cx);
                }),
            )
            .track_focus(self.focus_handle())
            .flex()
            .flex_col()
            .size_full()
            .bg(cx.theme().background);

        if focus_mode {
            root = root.child(self.render_focus_topbar(cx));
        } else {
            root = root.child(self.render_topbar(cx));
        }

        if !focus_mode {
            if let Some(banner) = self.render_plugin_error_banner(cx) {
                root = root.child(banner);
            }
        }

        let mut body = div().flex().flex_1().min_h_0();
        let show_sidebar = !focus_mode && !compact;
        let show_context = !focus_mode && !compact;
        match self.app.mode {
            Mode::Capture => {
                body = body.child(self.render_capture_mode(cx));
            }
            Mode::Editor => {
                if show_sidebar {
                    body = body.child(self.render_sidebar(cx));
                    if !self.settings.sidebar_collapsed {
                        body = body.child(self.render_sidebar_resizer(cx));
                    }
                }
                body = body.child(self.render_editor(cx));
                if show_context {
                    body = body.child(self.render_context_panel(cx));
                }
            }
            Mode::Review => {
                if show_sidebar {
                    body = body.child(self.render_sidebar(cx));
                    if !self.settings.sidebar_collapsed {
                        body = body.child(self.render_sidebar_resizer(cx));
                    }
                }
                body = body.child(self.render_review_feed(cx));
            }
        }

        root = root.child(body);

        if let Some(preview) = self.render_link_preview(window, cx) {
            root = root.child(preview);
        }

        if self.ui.capture_overlay_open {
            root = root.child(self.render_capture_overlay(cx));
        }

        root = root
            .children(Root::render_dialog_layer(window, cx))
            .children(Root::render_sheet_layer(window, cx))
            .children(Root::render_notification_layer(window, cx));

        root
    }

    fn render_focus_topbar(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let muted_fg = theme.muted_foreground;

        TitleBar::new().child(
            div()
                .h_full()
                .flex_1()
                .min_w_0()
                .px_4()
                .flex()
                .items_center()
                .justify_between()
                .child(
                    div()
                        .text_size(tokens::FONT_XS)
                        .text_color(muted_fg)
                        .child("Focus Mode"),
                )
                .child(
                    Button::new("exit-focus-mode")
                        .xsmall()
                        .ghost()
                        .label("Exit Focus")
                        .icon(SandpaperIcon::ArrowMinimize)
                        .on_click(cx.listener(|this, _event, _window, cx| {
                            this.settings.focus_mode = false;
                            this.persist_settings();
                            cx.notify();
                        })),
                ),
        )
    }

    fn render_capture_overlay(&mut self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let theme = cx.theme();
        let bg = theme.background;
        let border = theme.border;
        let muted_fg = theme.muted_foreground;

        let input = Input::new(&self.editor.capture_input)
            .appearance(false)
            .bordered(true)
            .focus_bordered(true)
            .small();
        let hint = shortcut_hint(ShortcutSpec::new("enter", "enter"));

        // Semi-transparent backdrop
        let backdrop = div()
            .id("capture-overlay-backdrop")
            .absolute()
            .inset_0()
            .bg(gpui::black().opacity(0.4))
            .on_click(cx.listener(|this, _event, window, cx| {
                this.dismiss_quick_capture(window, cx);
            }));

        let card =
            div()
                .absolute()
                .top(px(120.0))
                .left_auto()
                .right_auto()
                .mx_auto()
                .w(px(520.0))
                .rounded_lg()
                .bg(bg)
                .border_1()
                .border_color(border)
                .overflow_hidden()
                .flex()
                .flex_col()
                .gap_2()
                .p_4()
                .child(
                    div()
                        .text_size(tokens::FONT_LG)
                        .font_weight(gpui::FontWeight::MEDIUM)
                        .child("Quick Capture"),
                )
                .child(
                    div()
                        .capture_key_down(cx.listener(|this, event: &KeyDownEvent, window, cx| {
                            if event.keystroke.key == "escape" {
                                this.dismiss_quick_capture(window, cx);
                                cx.stop_propagation();
                            }
                        }))
                        .capture_action(cx.listener(
                            |this, _: &gpui_component::input::Enter, window, cx| {
                                this.submit_quick_capture(window, cx);
                                cx.stop_propagation();
                            },
                        ))
                        .child(input),
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .child(div().text_size(tokens::FONT_SM).text_color(muted_fg).child(
                            format!("{hint} queue  ·  shift+enter newline  ·  esc dismiss"),
                        ))
                        .child(
                            Button::new("capture-submit")
                                .xsmall()
                                .primary()
                                .label("Queue")
                                .on_click(cx.listener(|this, _event, window, cx| {
                                    this.submit_quick_capture(window, cx);
                                })),
                        ),
                );

        // Center the card horizontally
        let card_container = div()
            .absolute()
            .inset_0()
            .flex()
            .justify_center()
            .child(card);

        let epoch = self.ui.capture_overlay_epoch;
        let overlay = div()
            .absolute()
            .inset_0()
            .child(backdrop)
            .child(card_container);

        if epoch > 0 {
            overlay
                .with_animation(
                    format!("capture-overlay-fade-{epoch}"),
                    Animation::new(tokens::DURATION_FAST).with_easing(ease_in_out),
                    |el, delta| el.opacity(delta),
                )
                .into_any_element()
        } else {
            overlay.into_any_element()
        }
    }

    fn render_capture_mode(&mut self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let theme = cx.theme();
        let semantic = cx.global::<SandpaperTheme>().colors(cx);
        let border_subtle = semantic.border_subtle;
        let foreground_muted = semantic.foreground_muted;
        let fg = theme.foreground;
        let muted_fg = theme.muted_foreground;
        let bubble_bg = theme.list_hover;
        let input = Input::new(&self.editor.capture_input)
            .appearance(false)
            .bordered(true)
            .focus_bordered(true)
            .small();
        let queue_items = self.capture_queue_items();

        let mut timeline = div()
            .id("capture-queue-list")
            .flex_1()
            .min_h_0()
            .overflow_scroll()
            .flex()
            .flex_col()
            .justify_end()
            .gap_3()
            .w_full()
            .max_w(px(920.0))
            .mx_auto()
            .px_6()
            .pt_6()
            .pb_3();

        if queue_items.is_empty() {
            timeline = timeline.child(
                div()
                    .w_full()
                    .rounded_lg()
                    .border_1()
                    .border_color(border_subtle)
                    .bg(theme.background)
                    .px_4()
                    .py_3()
                    .text_size(tokens::FONT_BASE)
                    .text_color(muted_fg)
                    .child("What's on your mind? Capture anything and it will appear in Review."),
            );
        } else {
            for (i, item) in queue_items.iter().enumerate() {
                let item_text: SharedString = item.text.clone().into();
                let delete_uid_for_button = item.uid.clone();
                let bubble = div()
                    .id(SharedString::from(format!("capture-queue-item-{i}")))
                    .w_full()
                    .rounded_lg()
                    .bg(bubble_bg.opacity(0.7))
                    .border_1()
                    .border_color(border_subtle)
                    .px_4()
                    .py_3()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .child(
                        div()
                            .text_size(tokens::FONT_BASE)
                            .text_color(fg)
                            .child(item_text),
                    )
                    .child(
                        div().flex().items_center().justify_end().child(
                            Button::new(format!("capture-delete-{i}"))
                                .xsmall()
                                .ghost()
                                .icon(SandpaperIcon::Dismiss)
                                .tooltip("Delete capture")
                                .on_click(cx.listener(move |this, _event, _window, cx| {
                                    if this
                                        .delete_capture_queue_item(&delete_uid_for_button, cx)
                                        .is_ok()
                                    {
                                        cx.notify();
                                    }
                                })),
                        ),
                    );

                timeline = timeline.child(bubble);
            }
        }

        let submit_hint = shortcut_hint(ShortcutSpec::new("enter", "enter"));
        div()
            .flex_1()
            .min_w_0()
            .h_full()
            .flex()
            .flex_col()
            .child(timeline)
            .child(
                div()
                    .w_full()
                    .max_w(px(920.0))
                    .mx_auto()
                    .px_6()
                    .pb_6()
                    .pt_3()
                    .border_t_1()
                    .border_color(border_subtle)
                    .bg(theme.background)
                    .flex()
                    .flex_col()
                    .gap_2()
                    .child(
                        div()
                            .capture_key_down(cx.listener(
                                |this, event: &KeyDownEvent, _window, cx| {
                                    if event.keystroke.key == "escape" {
                                        this.set_mode(Mode::Editor, cx);
                                        cx.stop_propagation();
                                    }
                                },
                            ))
                            .capture_action(cx.listener(
                                |this, _: &gpui_component::input::Enter, window, cx| {
                                    this.submit_quick_capture(window, cx);
                                    cx.stop_propagation();
                                },
                            ))
                            .child(input),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .child(
                                div()
                                    .text_size(tokens::FONT_SM)
                                    .text_color(foreground_muted)
                                    .child(format!(
                                        "{submit_hint} queue  ·  shift+enter newline  ·  esc back to editor"
                                    )),
                            )
                            .child(
                                Button::new("capture-submit-mode")
                                    .small()
                                    .primary()
                                    .label("Queue")
                                    .on_click(cx.listener(|this, _event, window, cx| {
                                        this.submit_quick_capture(window, cx);
                                    })),
                            ),
                    ),
            )
            .into_any_element()
    }

    fn render_review_feed(&mut self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let theme = cx.theme();
        let semantic = cx.global::<SandpaperTheme>().colors(cx);
        let accent_subtle = semantic.accent_subtle;
        let fg = theme.foreground;
        let muted_fg = theme.muted_foreground;
        let sidebar_bg = theme.sidebar;
        let border = theme.border;
        let accent = theme.accent;
        let hover_bg = theme.list_hover;
        let warning = theme.warning;

        let mut feed = div()
            .w_full()
            .max_w(px(720.0))
            .mx_auto()
            .flex()
            .flex_col()
            .gap_3();

        // Header with refresh button
        feed = feed.child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .child(
                    div()
                        .text_size(tokens::FONT_LG)
                        .font_weight(gpui::FontWeight::MEDIUM)
                        .text_color(fg)
                        .child("Knowledge Feed"),
                )
                .child(
                    Button::new("refresh-feed")
                        .with_size(tokens::ICON_XL)
                        .ghost()
                        .icon(SandpaperIcon::ArrowSwap)
                        .tooltip("Refresh feed")
                        .on_click(cx.listener(|this, _event, _window, cx| {
                            this.refresh_feed(cx);
                        })),
                ),
        );

        if self.editor.feed_items.is_empty() {
            use crate::ui::components::empty_state::EmptyState;
            feed = feed.child(
                EmptyState::new(
                    "No items in your feed",
                    "Create pages and add review items to get started.",
                )
                .icon(IconName::Inbox)
                .action(
                    "Create a page",
                    cx.listener(|this, _event, _window, cx| {
                        this.open_page_dialog(PageDialogMode::Create, cx);
                    }),
                ),
            );
        }

        let items = self.editor.feed_items.clone();
        for (i, item) in items.iter().enumerate() {
            match item {
                FeedItem::SectionHeader(label) => {
                    feed = feed.child(
                        div()
                            .mt_2()
                            .text_size(tokens::FONT_XS)
                            .font_weight(gpui::FontWeight::MEDIUM)
                            .text_color(muted_fg)
                            .child(label.clone()),
                    );
                }
                FeedItem::ReviewDue(review) => {
                    let snippet: SharedString = if review.text.len() > 96 {
                        format!("{}...", &review.text[..96]).into()
                    } else {
                        review.text.clone().into()
                    };
                    let page_title: SharedString = review.page_title.clone().into();
                    let page_uid = review.page_uid.clone();
                    let item_id = review.id;
                    feed = feed.child(
                        div()
                            .id(SharedString::from(format!("feed-review-{i}")))
                            .rounded_md()
                            .border_1()
                            .border_color(border)
                            .bg(sidebar_bg)
                            .overflow_hidden()
                            .flex()
                            .flex_row()
                            .child(
                                div()
                                    .w(px(3.0))
                                    .flex_shrink_0()
                                    .bg(warning),
                            )
                            .child(
                                div()
                                    .flex_1()
                                    .p_3()
                                    .flex()
                                    .flex_col()
                                    .gap_2()
                                    .child(
                                        div()
                                            .text_size(tokens::FONT_BASE)
                                            .text_color(fg)
                                            .child(snippet),
                                    )
                                    .child(
                                        div()
                                            .flex()
                                            .items_center()
                                            .justify_between()
                                            .child(
                                                div()
                                                    .text_size(tokens::FONT_SM)
                                                    .text_color(muted_fg)
                                                    .child(page_title),
                                            )
                                            .child(
                                                div()
                                                    .flex()
                                                    .items_center()
                                                    .gap_1()
                                                    .child(
                                                        Button::new(format!("feed-done-{i}"))
                                                            .xsmall()
                                                            .ghost()
                                                            .icon(SandpaperIcon::Checkmark)
                                                            .tooltip("Mark done")
                                                            .on_click(cx.listener(
                                                                move |this,
                                                                      _event,
                                                                      _window,
                                                                      cx| {
                                                                    this.review_mark_done(
                                                                        item_id, cx,
                                                                    );
                                                                    this.refresh_feed(cx);
                                                                },
                                                            )),
                                                    )
                                                    .child(
                                                        Button::new(format!("feed-snooze-{i}"))
                                                            .xsmall()
                                                            .ghost()
                                                            .icon(SandpaperIcon::Subtract)
                                                            .tooltip("Snooze")
                                                            .on_click(cx.listener(
                                                                move |this,
                                                                      _event,
                                                                      _window,
                                                                      cx| {
                                                                    this.review_snooze_day(
                                                                        item_id, cx,
                                                                    );
                                                                    this.refresh_feed(cx);
                                                                },
                                                            )),
                                                    ),
                                            ),
                                    ),
                            )
                            .cursor_pointer()
                            .hover(move |s| s.bg(hover_bg))
                            .on_click(cx.listener(move |this, _event, _window, cx| {
                                this.open_page(&page_uid, cx);
                                this.set_mode(Mode::Editor, cx);
                            })),
                    );
                }
                FeedItem::RelatedPage(related) => {
                    let title: SharedString = related.page_title.clone().into();
                    let uid = related.page_uid.clone();
                    let mut reason_pills = div().flex().items_center().gap_1().flex_wrap();
                    for reason in &related.reasons {
                        let label: SharedString = match reason {
                            connections::ConnectionReason::SharedLink(target) => {
                                format!("link: {target}").into()
                            }
                            connections::ConnectionReason::DirectLink => "direct".into(),
                        };
                        reason_pills = reason_pills.child(
                            div()
                                .px_1()
                                .py(px(1.0))
                                .rounded_sm()
                                .bg(accent_subtle)
                                .text_color(accent)
                                .text_size(tokens::FONT_XS)
                                .child(label),
                        );
                    }
                    feed = feed.child(
                        div()
                            .id(SharedString::from(format!("feed-related-{i}")))
                            .rounded_md()
                            .border_1()
                            .border_color(border)
                            .bg(sidebar_bg)
                            .p_3()
                            .flex()
                            .flex_col()
                            .gap_2()
                            .child(
                                div()
                                    .text_size(tokens::FONT_XS)
                                    .text_color(muted_fg)
                                    .child("Related"),
                            )
                            .child(
                                div()
                                    .text_size(tokens::FONT_BASE)
                                    .text_color(fg)
                                    .child(title),
                            )
                            .child(reason_pills)
                            .cursor_pointer()
                            .hover(move |s| s.bg(hover_bg))
                            .on_click(cx.listener(move |this, _event, _window, cx| {
                                this.open_page(&uid, cx);
                                this.set_mode(Mode::Editor, cx);
                            })),
                    );
                }
                FeedItem::RecentEdit { page, .. } => {
                    let title: SharedString = page.title.clone().into();
                    let uid = page.uid.clone();
                    feed = feed.child(
                        div()
                            .id(SharedString::from(format!("feed-recent-{i}")))
                            .rounded_md()
                            .border_1()
                            .border_color(border)
                            .bg(sidebar_bg)
                            .p_3()
                            .flex()
                            .flex_col()
                            .gap_1()
                            .child(
                                div()
                                    .text_size(tokens::FONT_XS)
                                    .text_color(muted_fg)
                                    .child("Recently edited"),
                            )
                            .child(
                                div()
                                    .text_size(tokens::FONT_BASE)
                                    .text_color(fg)
                                    .child(title),
                            )
                            .cursor_pointer()
                            .hover(move |s| s.bg(hover_bg))
                            .on_click(cx.listener(move |this, _event, _window, cx| {
                                this.open_page(&uid, cx);
                                this.set_mode(Mode::Editor, cx);
                            })),
                    );
                }
                FeedItem::RandomDiscovery(page) => {
                    let title: SharedString = page.title.clone().into();
                    let uid = page.uid.clone();
                    feed = feed.child(
                        div()
                            .id(SharedString::from(format!("feed-discover-{i}")))
                            .rounded_md()
                            .border_1()
                            .border_color(border)
                            .bg(accent.opacity(0.04))
                            .p_3()
                            .flex()
                            .flex_col()
                            .gap_1()
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .justify_between()
                                    .child(
                                        div()
                                            .text_size(tokens::FONT_XS)
                                            .text_color(accent)
                                            .child("Discover"),
                                    )
                                    .child(
                                        Button::new(format!("feed-explore-{i}"))
                                            .xsmall()
                                            .ghost()
                                            .icon(SandpaperIcon::ArrowRight)
                                            .tooltip("Explore")
                                            .on_click(cx.listener(
                                                move |this, _event, _window, cx| {
                                                    this.open_page(&uid, cx);
                                                    this.set_mode(Mode::Editor, cx);
                                                },
                                            )),
                                    ),
                            )
                            .child(
                                div()
                                    .text_size(tokens::FONT_BASE)
                                    .text_color(fg)
                                    .child(title),
                            )
                            .cursor_pointer()
                            .hover(move |s| s.bg(hover_bg)),
                    );
                }
            }
        }

        div()
            .flex_1()
            .min_w_0()
            .h_full()
            .overflow_y_scrollbar()
            .p_6()
            .child(feed)
            .into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn topbar_mode_switch_prefers_small_buttons() {
        assert!(AppStore::topbar_mode_switch_uses_small_buttons());
    }

    #[test]
    fn breakpoint_compact_is_wider_than_min_window() {
        assert!(
            tokens::BREAKPOINT_COMPACT > tokens::MIN_WINDOW_WIDTH,
            "compact breakpoint must be wider than minimum window width"
        );
    }
}
