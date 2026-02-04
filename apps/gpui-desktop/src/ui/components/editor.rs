use crate::app::prelude::*;
use crate::app::store::helpers::format_snippet;
use crate::app::store::*;
impl AppStore {
    pub(super) fn render_editor(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let editor_body = match self.app.mode {
            Mode::Editor => {
                let mut body = div()
                    .flex()
                    .flex_1()
                    .min_h_0()
                    .child(self.render_blocks_list(cx));
                if let Some(pane) = self.render_secondary_pane(cx) {
                    body = body.child(pane);
                }
                if let Some(panel) = self.render_backlinks_panel(cx) {
                    body = body.child(panel);
                }
                body.into_any_element()
            }
            Mode::Capture => self.render_capture_pane(cx).into_any_element(),
            Mode::Review => self.render_review_pane(cx).into_any_element(),
        };

        let container = div()
            .flex_1()
            .min_w_0()
            .min_h_0()
            .h_full()
            .flex()
            .flex_col()
            .bg(cx.theme().background)
            .key_context("SandpaperEditor")
            .on_action(cx.listener(Self::insert_block_below))
            .on_action(cx.listener(Self::indent_block))
            .on_action(cx.listener(Self::outdent_block))
            .on_action(cx.listener(Self::move_block_up))
            .on_action(cx.listener(Self::move_block_down))
            .on_action(cx.listener(Self::duplicate_block))
            .on_action(cx.listener(Self::delete_selection_action))
            .on_action(cx.listener(Self::clear_selection_action))
            .on_action(cx.listener(Self::toggle_split_pane_action))
            .child(editor_body);

        container
    }

    fn render_placeholder(&mut self, label: &str, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        div()
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .text_sm()
            .text_color(theme.muted_foreground)
            .child(label.to_string())
    }

    fn render_blocks_list(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let state = self.editor.blocks_list_state.clone();
        let list = if self.editor.editor.is_some() {
            v_virtual_list(
                cx.entity(),
                "blocks-list",
                state.item_sizes.clone(),
                |this, range: std::ops::Range<usize>, window, cx| {
                    range
                        .map(|ix| {
                            this.render_block_row_for_pane(EditorPane::Primary, ix, window, cx)
                        })
                        .collect::<Vec<_>>()
                },
            )
            .track_scroll(&state.scroll_handle)
            .flex_1()
            .min_h_0()
            .size_full()
            .into_any_element()
        } else {
            div()
                .flex_1()
                .min_h_0()
                .child(self.render_placeholder("Select or create a page to start writing.", cx))
                .into_any_element()
        };

        let theme = cx.theme();
        let is_active = self.editor.active_pane == EditorPane::Primary;
        let mut container = div()
            .id("blocks")
            .flex_1()
            .min_w_0()
            .h_full()
            .flex()
            .flex_col()
            .p_3()
            .bg(theme.background)
            .border_1()
            .rounded_lg()
            .border_color(if is_active && self.editor.secondary_pane.is_some() {
                theme.ring
            } else {
                theme.border
            });

        if let Some(header) = self.render_editor_header(cx) {
            container = container.child(header);
        }

        if let Some(toolbar) = self.render_selection_toolbar_for_pane(EditorPane::Primary, cx) {
            container = container.child(toolbar);
        }

        container.child(list)
    }

    fn build_breadcrumb_items(&self) -> Vec<BreadcrumbItem> {
        self.build_breadcrumb_items_for_pane(EditorPane::Primary)
    }

    fn build_breadcrumb_items_for_pane(&self, pane: EditorPane) -> Vec<BreadcrumbItem> {
        let Some(editor) = self.editor_for_pane(pane) else {
            return Vec::new();
        };
        if editor.blocks.is_empty() {
            return Vec::new();
        }
        let mut chain = Vec::new();
        let mut current_ix = editor.active_ix.min(editor.blocks.len() - 1);
        let mut current_indent = editor.blocks[current_ix].indent;
        chain.push(current_ix);

        while current_ix > 0 {
            let mut found = None;
            for ix in (0..current_ix).rev() {
                let indent = editor.blocks[ix].indent;
                if indent < current_indent {
                    found = Some(ix);
                    current_ix = ix;
                    current_indent = indent;
                    break;
                }
            }
            if let Some(ix) = found {
                chain.push(ix);
            } else {
                break;
            }
        }

        chain
            .into_iter()
            .rev()
            .map(|ix| {
                let block = &editor.blocks[ix];
                let label = if block.text.trim().is_empty() {
                    "Untitled".to_string()
                } else {
                    format_snippet(&block.text, 32)
                };
                BreadcrumbItem {
                    uid: block.uid.clone(),
                    label,
                }
            })
            .collect()
    }

    fn render_editor_header(&mut self, cx: &mut Context<Self>) -> Option<gpui::AnyElement> {
        let Some(active_page) = self.editor.active_page.as_ref() else {
            return None;
        };
        let theme = cx.theme();
        let block_count = self
            .editor
            .editor
            .as_ref()
            .map(|editor| editor.blocks.len())
            .unwrap_or(0);
        let title = if active_page.title.trim().is_empty() {
            "Untitled"
        } else {
            active_page.title.as_str()
        };
        let breadcrumbs = self.build_breadcrumb_items();

        let mut title_group = div()
            .flex()
            .flex_col()
            .gap_1()
            .child(
                div()
                    .text_lg()
                    .text_color(theme.foreground)
                    .font_weight(gpui::FontWeight::SEMIBOLD)
                    .child(title.to_string()),
            )
            .child(
                div()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .child(format!("{block_count} blocks")),
            );

        if breadcrumbs.len() > 1 {
            let mut trail = div().id("editor-breadcrumbs").flex().items_center().gap_1();
            let crumb_hover = theme.list_hover;
            for (idx, item) in breadcrumbs.iter().enumerate() {
                let is_last = idx == breadcrumbs.len() - 1;
                let uid = item.uid.clone();
                let label = item.label.clone();
                let mut crumb = div()
                    .id(format!("breadcrumb-{}", uid))
                    .px_1()
                    .py(px(1.0))
                    .rounded_sm()
                    .bg(if is_last {
                        theme.list_active
                    } else {
                        theme.secondary
                    })
                    .hover(move |s| s.bg(crumb_hover).cursor_pointer())
                    .text_xs()
                    .text_color(if is_last {
                        theme.foreground
                    } else {
                        theme.muted_foreground
                    })
                    .on_click(cx.listener(move |this, _event, window, cx| {
                        this.focus_block_by_uid(&uid, Some(window), cx);
                        cx.notify();
                    }))
                    .child(label);
                if !is_last {
                    crumb = crumb.child(
                        div()
                            .ml_1()
                            .text_xs()
                            .text_color(theme.muted_foreground)
                            .child("/"),
                    );
                }
                trail = trail.child(crumb);
            }
            title_group = title_group.child(trail);
        }

        let mut actions = div()
            .flex()
            .items_center()
            .gap_2()
            .child(
                Button::new("editor-rename")
                    .label("Rename")
                    .xsmall()
                    .ghost()
                    .on_click(cx.listener(|this, _event, _window, cx| {
                        this.open_page_dialog(PageDialogMode::Rename, cx);
                    })),
            )
            .child(
                Button::new("editor-split")
                    .label(if self.editor.secondary_pane.is_some() {
                        "Close split"
                    } else {
                        "Split"
                    })
                    .xsmall()
                    .ghost()
                    .on_click(cx.listener(|this, _event, _window, cx| {
                        this.toggle_split_pane(cx);
                    })),
            )
            .child(
                Button::new("editor-duplicate")
                    .label("Duplicate to split")
                    .xsmall()
                    .ghost()
                    .on_click(cx.listener(|this, _event, _window, cx| {
                        this.copy_primary_to_secondary(cx);
                    })),
            );

        if self.editor.secondary_pane.is_some() {
            actions = actions
                .child(
                    Button::new("editor-swap")
                        .label("Swap panes")
                        .xsmall()
                        .ghost()
                        .on_click(cx.listener(|this, _event, _window, cx| {
                            this.swap_panes(cx);
                        })),
                )
                .child(
                    Button::new("editor-sync-scroll")
                        .label(if self.settings.sync_scroll {
                            "Sync scroll: On"
                        } else {
                            "Sync scroll: Off"
                        })
                        .xsmall()
                        .ghost()
                        .on_click(cx.listener(|this, _event, _window, cx| {
                            this.settings.sync_scroll = !this.settings.sync_scroll;
                            this.persist_settings();
                            cx.notify();
                        })),
                );
        }

        actions = actions.child(self.render_backlinks_toggle(cx));

        Some(
            div()
                .id("editor-header")
                .mb_3()
                .flex()
                .items_center()
                .justify_between()
                .child(title_group)
                .child(actions)
                .into_any_element(),
        )
    }

    fn render_backlinks_toggle(&mut self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let total = self.editor.backlinks.len() + self.editor.block_backlinks.len();
        let is_open = self.settings.backlinks_open;
        let label = if total > 0 {
            format!(
                "{} ({total})",
                if is_open {
                    "Hide backlinks"
                } else {
                    "Show backlinks"
                }
            )
        } else if is_open {
            "Hide backlinks".to_string()
        } else {
            "Show backlinks".to_string()
        };

        Button::new("backlinks-toggle")
            .label(label)
            .xsmall()
            .ghost()
            .on_click(cx.listener(|this, _event, _window, cx| {
                this.settings.backlinks_open = !this.settings.backlinks_open;
                this.persist_settings();
                cx.notify();
            }))
            .into_any_element()
    }

    fn render_selection_toolbar_for_pane(
        &mut self,
        pane: EditorPane,
        cx: &mut Context<Self>,
    ) -> Option<gpui::AnyElement> {
        let theme = cx.theme();
        let selection = self.selection_for_pane(pane)?;
        if !selection.has_range() {
            return None;
        }
        let id_prefix = match pane {
            EditorPane::Primary => "selection",
            EditorPane::Secondary => "secondary-selection",
        };

        Some(
            div()
                .id(format!("{id_prefix}-toolbar"))
                .mb_2()
                .px_2()
                .py_2()
                .rounded_md()
                .bg(theme.colors.list)
                .border_1()
                .border_color(theme.border)
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .child(
                            div()
                                .text_xs()
                                .text_color(theme.muted_foreground)
                                .child("Selection"),
                        )
                        .child(
                            Button::new(format!("{id_prefix}-duplicate"))
                                .label("Duplicate")
                                .xsmall()
                                .ghost()
                                .on_click(cx.listener(move |this, _event, window, cx| {
                                    this.set_active_pane(pane, cx);
                                    this.duplicate_selection_in_pane(pane, window, cx);
                                })),
                        )
                        .child(
                            Button::new(format!("{id_prefix}-delete"))
                                .label("Delete")
                                .xsmall()
                                .ghost()
                                .on_click(cx.listener(move |this, _event, _window, cx| {
                                    this.set_active_pane(pane, cx);
                                    this.delete_selection_in_pane(pane, cx);
                                })),
                        )
                        .child(
                            Button::new(format!("{id_prefix}-indent"))
                                .label("Indent")
                                .xsmall()
                                .ghost()
                                .on_click(cx.listener(move |this, _event, _window, cx| {
                                    this.set_active_pane(pane, cx);
                                    this.indent_selection_in_pane(pane, cx);
                                })),
                        )
                        .child(
                            Button::new(format!("{id_prefix}-outdent"))
                                .label("Outdent")
                                .xsmall()
                                .ghost()
                                .on_click(cx.listener(move |this, _event, _window, cx| {
                                    this.set_active_pane(pane, cx);
                                    this.outdent_selection_in_pane(pane, cx);
                                })),
                        )
                        .child(
                            Button::new(format!("{id_prefix}-move-up"))
                                .label("Move up")
                                .xsmall()
                                .ghost()
                                .on_click(cx.listener(move |this, _event, window, cx| {
                                    this.set_active_pane(pane, cx);
                                    this.move_selection_in_pane(pane, -1, window, cx);
                                })),
                        )
                        .child(
                            Button::new(format!("{id_prefix}-move-down"))
                                .label("Move down")
                                .xsmall()
                                .ghost()
                                .on_click(cx.listener(move |this, _event, window, cx| {
                                    this.set_active_pane(pane, cx);
                                    this.move_selection_in_pane(pane, 1, window, cx);
                                })),
                        )
                        .child(
                            Button::new(format!("{id_prefix}-clear"))
                                .label("Clear")
                                .xsmall()
                                .ghost()
                                .on_click(cx.listener(move |this, _event, _window, cx| {
                                    this.clear_selection_for_pane(pane);
                                    cx.notify();
                                })),
                        ),
                )
                .into_any_element(),
        )
    }

    fn render_slash_menu_at(
        &mut self,
        origin: gpui::Point<gpui::Pixels>,
        cx: &mut Context<Self>,
    ) -> gpui::AnyElement {
        let theme = cx.theme();
        let query = self.editor.slash_menu.query.trim();
        let title: SharedString = if query.is_empty() {
            "Commands".into()
        } else {
            format!("Commands: {query}").into()
        };

        let commands = self.filtered_slash_commands();
        if self.editor.slash_menu.selected_index >= commands.len() {
            self.editor.slash_menu.selected_index = 0;
        }
        let selected_index = self.editor.slash_menu.selected_index;

        let mut menu = div()
            .absolute()
            .top(origin.y)
            .left(origin.x)
            .w(px(220.0))
            .rounded_md()
            .bg(theme.popover)
            .border_1()
            .border_color(theme.border)
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|_this, _event, _window, cx| {
                    cx.stop_propagation();
                }),
            )
            .on_mouse_up(
                MouseButton::Left,
                cx.listener(|_this, _event, _window, cx| {
                    cx.stop_propagation();
                }),
            )
            .child(
                div()
                    .px_3()
                    .py_2()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .child(title),
            );

        let hover_bg = theme.list_hover;
        let selected_bg = theme.list_active;
        if commands.is_empty() {
            menu = menu.child(
                div()
                    .px_3()
                    .py_2()
                    .text_sm()
                    .text_color(theme.muted_foreground)
                    .child("No matches"),
            );
        } else {
            for (ix, (id, label)) in commands.into_iter().enumerate() {
                let is_selected = ix == selected_index;
                let row_bg = if is_selected {
                    selected_bg
                } else {
                    theme.popover
                };
                menu = menu.child(
                    div()
                        .id(format!("slash-{id}"))
                        .px_3()
                        .py_2()
                        .text_sm()
                        .text_color(theme.foreground)
                        .bg(row_bg)
                        .hover(move |s| s.bg(hover_bg).cursor_pointer())
                        .on_mouse_down(
                            MouseButton::Left,
                            cx.listener(|_this, _event, _window, cx| {
                                cx.stop_propagation();
                            }),
                        )
                        .on_mouse_move(cx.listener(
                            move |this, _event: &MouseMoveEvent, _window, cx| {
                                if this.editor.slash_menu.selected_index != ix {
                                    this.editor.slash_menu.selected_index = ix;
                                    cx.notify();
                                }
                            },
                        ))
                        .on_click(cx.listener(move |this, _event, window, cx| {
                            this.apply_slash_command(id, window, cx);
                        }))
                        .child(label),
                );
            }
        }

        menu.into_any_element()
    }

    fn render_wikilink_menu_at(
        &mut self,
        origin: gpui::Point<gpui::Pixels>,
        cx: &mut Context<Self>,
    ) -> gpui::AnyElement {
        let theme = cx.theme();
        let mut items = self.wikilink_menu_items();
        if self.editor.wikilink_menu.selected_index >= items.len() {
            self.editor.wikilink_menu.selected_index = 0;
        }
        let selected_index = self.editor.wikilink_menu.selected_index;

        let mut menu = div()
            .absolute()
            .top(origin.y)
            .left(origin.x)
            .w(px(260.0))
            .rounded_md()
            .bg(theme.popover)
            .border_1()
            .border_color(theme.border)
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|_this, _event, _window, cx| {
                    cx.stop_propagation();
                }),
            )
            .on_mouse_up(
                MouseButton::Left,
                cx.listener(|_this, _event, _window, cx| {
                    cx.stop_propagation();
                }),
            )
            .child(
                div()
                    .px_3()
                    .py_2()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .child("Link suggestions"),
            );

        let hover_bg = theme.list_hover;
        let selected_bg = theme.list_active;
        if items.is_empty() {
            menu = menu.child(
                div()
                    .px_3()
                    .py_2()
                    .text_sm()
                    .text_color(theme.muted_foreground)
                    .child("No matches"),
            );
        } else {
            for (ix, item) in items.drain(..).enumerate() {
                let is_selected = ix == selected_index;
                let row_bg = if is_selected {
                    selected_bg
                } else {
                    theme.popover
                };
                let (label, create, query) = match item {
                    WikilinkMenuItem::Page(page) => {
                        let title = if page.title.trim().is_empty() {
                            page.uid
                        } else {
                            page.title
                        };
                        (title, false, String::new())
                    }
                    WikilinkMenuItem::Create { label, query } => (label, true, query),
                };
                let label_clone = label.clone();
                menu = menu.child(
                    div()
                        .id(format!("wikilink-item-{ix}"))
                        .px_3()
                        .py_2()
                        .text_sm()
                        .text_color(theme.foreground)
                        .bg(row_bg)
                        .hover(move |s| s.bg(hover_bg).cursor_pointer())
                        .on_mouse_down(
                            MouseButton::Left,
                            cx.listener(|_this, _event, _window, cx| {
                                cx.stop_propagation();
                            }),
                        )
                        .on_mouse_move(cx.listener(
                            move |this, _event: &MouseMoveEvent, _window, cx| {
                                if this.editor.wikilink_menu.selected_index != ix {
                                    this.editor.wikilink_menu.selected_index = ix;
                                    cx.notify();
                                }
                            },
                        ))
                        .on_click(cx.listener(move |this, _event, window, cx| {
                            if create {
                                this.apply_wikilink_suggestion(&query, true, window, cx);
                            } else {
                                this.apply_wikilink_suggestion(&label_clone, false, window, cx);
                            }
                        }))
                        .child(label),
                );
            }
        }

        menu.into_any_element()
    }

    pub(super) fn render_link_preview(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<gpui::AnyElement> {
        let preview = self.editor.link_preview.clone()?;
        if !preview.open {
            return None;
        }

        let theme = cx.theme();
        let viewport = window.viewport_size();
        let panel_width = px(280.0);
        let margin = px(12.0);
        let header_height = px(36.0);
        let body_height = if preview.loading || preview.blocks.is_empty() {
            px(28.0)
        } else {
            px(22.0) * preview.blocks.len() as f32
        };
        let estimated_height = header_height + body_height + px(8.0);
        let min_x = margin;
        let max_x = if viewport.width > panel_width + margin {
            viewport.width - panel_width - margin
        } else {
            min_x
        };
        let min_y = margin;
        let max_y = if viewport.height > estimated_height + margin {
            viewport.height - estimated_height - margin
        } else {
            min_y
        };
        let mut clamped_x = preview.position.x;
        if clamped_x < min_x {
            clamped_x = min_x;
        }
        if clamped_x > max_x {
            clamped_x = max_x;
        }
        let mut clamped_y = preview.position.y;
        if clamped_y < min_y {
            clamped_y = min_y;
        }
        if clamped_y > max_y {
            clamped_y = max_y;
        }

        let open_title = preview.title.clone();
        let preview_title = preview.title.clone();
        let preview_blocks = preview.blocks.clone();
        let preview_loading = preview.loading;

        let mut panel = div()
            .id("link-preview")
            .absolute()
            .top(clamped_y)
            .left(clamped_x)
            .w(panel_width)
            .rounded_md()
            .bg(theme.popover)
            .border_1()
            .border_color(theme.border)
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|_this, _event, _window, cx| {
                    cx.stop_propagation();
                }),
            )
            .on_mouse_up(
                MouseButton::Left,
                cx.listener(|_this, _event, _window, cx| {
                    cx.stop_propagation();
                }),
            )
            .on_mouse_move(cx.listener(|this, _event: &MouseMoveEvent, _window, cx| {
                this.keep_link_preview_open();
                cx.stop_propagation();
            }))
            .child(
                div()
                    .px_3()
                    .py_2()
                    .flex()
                    .items_center()
                    .justify_between()
                    .border_b_1()
                    .border_color(theme.border)
                    .child(
                        div()
                            .text_sm()
                            .text_color(theme.foreground)
                            .font_weight(gpui::FontWeight::SEMIBOLD)
                            .child(preview_title),
                    )
                    .child(
                        Button::new("link-preview-open")
                            .label("Open")
                            .xsmall()
                            .ghost()
                            .on_click(cx.listener(move |this, _event, _window, cx| {
                                this.open_page(&open_title, cx);
                                this.editor.link_preview = None;
                                this.editor.link_preview_hovering_link = false;
                                cx.notify();
                            })),
                    ),
            );

        if preview_loading {
            panel = panel.child(
                div()
                    .px_3()
                    .py_2()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .child("Loading preview..."),
            );
        } else if preview_blocks.is_empty() {
            panel = panel.child(
                div()
                    .px_3()
                    .py_2()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .child("No content yet."),
            );
        } else {
            for (ix, block_text) in preview_blocks.iter().enumerate() {
                panel = panel.child(
                    div()
                        .id(format!("link-preview-block-{ix}"))
                        .px_3()
                        .py_2()
                        .text_xs()
                        .text_color(theme.foreground)
                        .child(block_text.clone()),
                );
            }
        }

        Some(panel.into_any_element())
    }

    fn render_wikilink_text(
        &mut self,
        pane: EditorPane,
        block_uid: &str,
        text: &str,
        cx: &mut Context<Self>,
    ) -> gpui::AnyElement {
        let theme = cx.theme();
        let tokens = helpers::parse_wikilink_tokens(text);
        let mut display = String::new();
        let mut link_ranges: Vec<std::ops::Range<usize>> = Vec::new();
        let mut link_targets: Vec<String> = Vec::new();

        for token in tokens {
            match token {
                helpers::WikilinkToken::Text(value) => {
                    display.push_str(&value);
                }
                helpers::WikilinkToken::Link { target, label } => {
                    let start = display.len();
                    display.push_str(&label);
                    let end = display.len();
                    if start < end {
                        link_ranges.push(start..end);
                        link_targets.push(target);
                    }
                }
            }
        }

        if display.is_empty() {
            display.push(' ');
        }

        if link_targets.is_empty() {
            return div()
                .text_sm()
                .text_color(theme.foreground)
                .child(display)
                .into_any_element();
        }

        let link_color = theme.accent;
        let underline = UnderlineStyle {
            thickness: px(1.0),
            color: Some(link_color),
            wavy: false,
        };
        let mut highlights = Vec::with_capacity(link_ranges.len());
        for range in link_ranges.iter() {
            highlights.push((
                range.clone(),
                HighlightStyle {
                    color: Some(link_color),
                    underline: Some(underline),
                    ..Default::default()
                },
            ));
        }

        let styled = StyledText::new(display).with_highlights(highlights);
        let entity = cx.entity();
        let click_entity = entity.clone();
        let hover_entity = entity.clone();
        let link_targets = Rc::new(link_targets);
        let hover_targets = link_targets.clone();
        let click_targets = link_targets.clone();
        let hover_ranges = Rc::new(link_ranges);
        let click_ranges = hover_ranges.as_ref().clone();
        let hover_ranges_clone = hover_ranges.clone();
        let id_prefix = match pane {
            EditorPane::Primary => "primary",
            EditorPane::Secondary => "secondary",
        };

        let interactive =
            InteractiveText::new(format!("wikilink-text-{id_prefix}-{block_uid}"), styled)
                .on_click(click_ranges, move |idx, _window, cx| {
                    if let Some(target) = click_targets.get(idx) {
                        let target = target.clone();
                        click_entity.update(cx, |this, cx| {
                            this.open_page(&target, cx);
                            this.editor.link_preview = None;
                            this.editor.link_preview_hovering_link = false;
                        });
                    }
                    cx.stop_propagation();
                })
                .on_hover(move |hover_ix, event, _window, cx| {
                    let mut hovered_target = None;
                    if let Some(ix) = hover_ix {
                        for (range_ix, range) in hover_ranges_clone.iter().enumerate() {
                            if range.contains(&ix) {
                                hovered_target = hover_targets.get(range_ix).cloned();
                                break;
                            }
                        }
                    }

                    hover_entity.update(cx, |this, cx| {
                        if let Some(target) = hovered_target {
                            this.editor.link_preview_hovering_link = true;
                            this.keep_link_preview_open();
                            this.open_link_preview(&target, event.position, cx);
                        } else {
                            this.editor.link_preview_hovering_link = false;
                            this.schedule_link_preview_close(cx);
                        }
                    });
                });

        div()
            .text_sm()
            .text_color(theme.foreground)
            .child(interactive)
            .into_any_element()
    }

    fn render_backlinks_panel(&mut self, cx: &mut Context<Self>) -> Option<gpui::AnyElement> {
        if self.app.mode != Mode::Editor {
            return None;
        }
        if !self.settings.backlinks_open {
            return None;
        }
        if self.editor.active_page.is_none() {
            return None;
        }
        let theme = cx.theme();

        let active_block_text = self
            .editor
            .editor
            .as_ref()
            .map(|editor| editor.active().text.clone())
            .unwrap_or_default();

        let has_page_backlinks = !self.editor.backlinks.is_empty();
        let has_block_backlinks = !self.editor.block_backlinks.is_empty();
        let list_bg = theme.colors.list;
        let list_hover = theme.list_hover;
        let muted = theme.muted_foreground;
        let foreground = theme.foreground;

        let mut panel = div()
            .id("backlinks-panel")
            .w(px(320.0))
            .h_full()
            .border_l_1()
            .border_color(theme.border)
            .bg(theme.background)
            .flex()
            .flex_col()
            .min_h_0()
            .child(
                div()
                    .px_3()
                    .py_2()
                    .flex()
                    .items_center()
                    .justify_between()
                    .border_b_1()
                    .border_color(theme.border)
                    .child(
                        div()
                            .text_sm()
                            .text_color(theme.foreground)
                            .font_weight(gpui::FontWeight::SEMIBOLD)
                            .child("Backlinks"),
                    )
                    .child(
                        Button::new("backlinks-close")
                            .xsmall()
                            .ghost()
                            .icon(IconName::Close)
                            .tooltip("Close backlinks")
                            .on_click(cx.listener(|this, _event, _window, cx| {
                                this.settings.backlinks_open = false;
                                this.persist_settings();
                                cx.notify();
                            })),
                    ),
            );

        let mut body = div()
            .id("backlinks-body")
            .flex_1()
            .min_h_0()
            .overflow_scroll();

        if !has_page_backlinks && !has_block_backlinks {
            body = body.child(
                div()
                    .px_3()
                    .py_3()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .child("No backlinks yet."),
            );
        }

        if has_page_backlinks {
            body = body.child(
                div()
                    .px_3()
                    .pt_3()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .child("Page backlinks"),
            );
            body = body.child(div().h(px(6.0)));
            body = body.children(self.editor.backlinks.iter().cloned().map(|entry| {
                let snippet = format_snippet(&entry.text, 90);
                let page_uid = entry.page_uid.clone();
                let block_uid = entry.block_uid.clone();
                let open_block_uid = block_uid.clone();
                let split_page_uid = entry.page_uid.clone();
                let split_block_uid = block_uid.clone();
                div()
                    .id(format!("backlinks-page-{}", entry.block_uid))
                    .px_3()
                    .py_2()
                    .rounded_md()
                    .bg(list_bg)
                    .hover(move |s| s.bg(list_hover))
                    .child(
                        div()
                            .flex()
                            .items_start()
                            .justify_between()
                            .gap_2()
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .gap_1()
                                    .child(div().text_sm().text_color(foreground).child(snippet))
                                    .child(
                                        div()
                                            .text_xs()
                                            .text_color(muted)
                                            .child(entry.page_title.clone()),
                                    ),
                            )
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_1()
                                    .child(
                                        Button::new(format!("backlinks-open-{}", block_uid))
                                            .label("Open")
                                            .xsmall()
                                            .ghost()
                                            .on_click(cx.listener(
                                                move |this, _event, window, cx| {
                                                    this.open_page_and_focus_block(
                                                        &page_uid,
                                                        &open_block_uid,
                                                        window,
                                                        cx,
                                                    );
                                                },
                                            )),
                                    )
                                    .child(
                                        Button::new(format!("backlinks-split-{}", block_uid))
                                            .label("Split")
                                            .xsmall()
                                            .ghost()
                                            .on_click(cx.listener(
                                                move |this, _event, _window, cx| {
                                                    this.open_secondary_pane_for_page(
                                                        &split_page_uid,
                                                        cx,
                                                    );
                                                    this.focus_block_by_uid_in_pane(
                                                        EditorPane::Secondary,
                                                        &split_block_uid,
                                                        None,
                                                        cx,
                                                    );
                                                },
                                            )),
                                    ),
                            ),
                    )
            }));
        }

        if has_block_backlinks {
            let block_label = if active_block_text.trim().is_empty() {
                "this block".to_string()
            } else {
                format_snippet(&active_block_text, 40)
            };
            body = body.child(
                div()
                    .px_3()
                    .pt_3()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .child("Block backlinks"),
            );
            body = body.child(
                div()
                    .px_3()
                    .pt_1()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .child(format!("Linked to {block_label}")),
            );
            body = body.children(self.editor.block_backlinks.iter().cloned().map(|entry| {
                let snippet = format_snippet(&entry.text, 90);
                let page_uid = entry.page_uid.clone();
                let block_uid = entry.block_uid.clone();
                let open_block_uid = block_uid.clone();
                let split_page_uid = entry.page_uid.clone();
                let split_block_uid = block_uid.clone();
                div()
                    .id(format!("backlinks-block-{}", entry.block_uid))
                    .px_3()
                    .py_2()
                    .rounded_md()
                    .bg(list_bg)
                    .hover(move |s| s.bg(list_hover))
                    .child(
                        div()
                            .flex()
                            .items_start()
                            .justify_between()
                            .gap_2()
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .gap_1()
                                    .child(div().text_sm().text_color(foreground).child(snippet))
                                    .child(
                                        div()
                                            .text_xs()
                                            .text_color(muted)
                                            .child(entry.page_title.clone()),
                                    ),
                            )
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_1()
                                    .child(
                                        Button::new(format!("backlinks-block-open-{}", block_uid))
                                            .label("Open")
                                            .xsmall()
                                            .ghost()
                                            .on_click(cx.listener(
                                                move |this, _event, window, cx| {
                                                    this.open_page_and_focus_block(
                                                        &page_uid,
                                                        &open_block_uid,
                                                        window,
                                                        cx,
                                                    );
                                                },
                                            )),
                                    )
                                    .child(
                                        Button::new(format!("backlinks-block-split-{}", block_uid))
                                            .label("Split")
                                            .xsmall()
                                            .ghost()
                                            .on_click(cx.listener(
                                                move |this, _event, _window, cx| {
                                                    this.open_secondary_pane_for_page(
                                                        &split_page_uid,
                                                        cx,
                                                    );
                                                    this.focus_block_by_uid_in_pane(
                                                        EditorPane::Secondary,
                                                        &split_block_uid,
                                                        None,
                                                        cx,
                                                    );
                                                },
                                            )),
                                    ),
                            ),
                    )
            }));
        }

        panel = panel.child(body);

        Some(panel.into_any_element())
    }

    fn render_secondary_pane(&mut self, cx: &mut Context<Self>) -> Option<gpui::AnyElement> {
        let (title, block_count, list_state) = {
            let pane = self.editor.secondary_pane.as_ref()?;
            let title = if pane.page.title.trim().is_empty() {
                "Untitled".to_string()
            } else {
                pane.page.title.clone()
            };
            let block_count = pane.editor.blocks.len();
            let list_state = pane.list_state.clone();
            (title, block_count, list_state)
        };

        let list = v_virtual_list(
            cx.entity(),
            "secondary-blocks",
            list_state.item_sizes.clone(),
            |this, range: std::ops::Range<usize>, window, cx| {
                range
                    .map(|ix| this.render_block_row_for_pane(EditorPane::Secondary, ix, window, cx))
                    .collect::<Vec<_>>()
            },
        )
        .track_scroll(&list_state.scroll_handle)
        .flex_1()
        .min_h_0()
        .size_full();

        let breadcrumbs = self.build_breadcrumb_items_for_pane(EditorPane::Secondary);
        let is_active = self.editor.active_pane == EditorPane::Secondary;
        let toolbar = self.render_selection_toolbar_for_pane(EditorPane::Secondary, cx);
        let theme = cx.theme();

        let mut title_group = div()
            .flex()
            .flex_col()
            .gap_1()
            .child(
                div()
                    .text_sm()
                    .text_color(theme.foreground)
                    .font_weight(gpui::FontWeight::SEMIBOLD)
                    .child(title),
            )
            .child(
                div()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .child(format!("{block_count} blocks")),
            );

        if breadcrumbs.len() > 1 {
            let mut trail = div()
                .id("secondary-breadcrumbs")
                .flex()
                .items_center()
                .gap_1();
            let crumb_hover = theme.list_hover;
            for (idx, item) in breadcrumbs.iter().enumerate() {
                let is_last = idx == breadcrumbs.len() - 1;
                let uid = item.uid.clone();
                let label = item.label.clone();
                let mut crumb = div()
                    .id(format!("secondary-crumb-{}", uid))
                    .px_1()
                    .py(px(1.0))
                    .rounded_sm()
                    .bg(if is_last {
                        theme.list_active
                    } else {
                        theme.secondary
                    })
                    .hover(move |s| s.bg(crumb_hover).cursor_pointer())
                    .text_xs()
                    .text_color(if is_last {
                        theme.foreground
                    } else {
                        theme.muted_foreground
                    })
                    .on_click(cx.listener(move |this, _event, window, cx| {
                        this.focus_block_by_uid_in_pane(
                            EditorPane::Secondary,
                            &uid,
                            Some(window),
                            cx,
                        );
                        cx.notify();
                    }))
                    .child(label);
                if !is_last {
                    crumb = crumb.child(
                        div()
                            .ml_1()
                            .text_xs()
                            .text_color(theme.muted_foreground)
                            .child("/"),
                    );
                }
                trail = trail.child(crumb);
            }
            title_group = title_group.child(trail);
        }

        let mut body = div()
            .id("secondary-scroll")
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .p_3();

        if let Some(toolbar) = toolbar {
            body = body.child(toolbar);
        }

        body = body.child(list);

        Some(
            div()
                .id("secondary-pane")
                .w(px(360.0))
                .h_full()
                .border_l_1()
                .border_color(if is_active { theme.ring } else { theme.border })
                .bg(theme.background)
                .flex()
                .flex_col()
                .min_h_0()
                .child(
                    div()
                        .px_3()
                        .py_2()
                        .flex()
                        .items_center()
                        .justify_between()
                        .border_b_1()
                        .border_color(theme.border)
                        .child(title_group)
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap_2()
                                .child(
                                    Button::new("secondary-open")
                                        .xsmall()
                                        .ghost()
                                        .icon(IconName::ArrowLeft)
                                        .tooltip("Open in primary")
                                        .on_click(cx.listener(move |this, _event, window, cx| {
                                            this.copy_secondary_to_primary(window, cx);
                                        })),
                                )
                                .child(
                                    Button::new("secondary-swap")
                                        .xsmall()
                                        .ghost()
                                        .icon(IconName::Replace)
                                        .tooltip("Swap panes")
                                        .on_click(cx.listener(|this, _event, _window, cx| {
                                            this.swap_panes(cx);
                                        })),
                                )
                                .child(
                                    Button::new("secondary-close")
                                        .xsmall()
                                        .ghost()
                                        .icon(IconName::Close)
                                        .tooltip("Close split")
                                        .on_click(cx.listener(|this, _event, _window, cx| {
                                            if this
                                                .editor
                                                .secondary_pane
                                                .as_ref()
                                                .is_some_and(|pane| pane.dirty)
                                            {
                                                this.save(cx);
                                            }
                                            this.editor.secondary_pane = None;
                                            this.editor.active_pane = EditorPane::Primary;
                                            this.sync_block_input_from_active_for_pane(
                                                EditorPane::Primary,
                                                None,
                                                cx,
                                            );
                                            cx.notify();
                                        })),
                                ),
                        ),
                )
                .child(body)
                .into_any_element(),
        )
    }

    fn render_block_row_for_pane(
        &mut self,
        pane: EditorPane,
        ix: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> gpui::AnyElement {
        let Some(editor) = self.editor_for_pane(pane) else {
            return div().into_any_element();
        };
        if ix >= editor.blocks.len() {
            return div().into_any_element();
        }

        let block = editor.blocks[ix].clone();
        let is_active = editor.active_ix == ix;
        let selection = self.selection_for_pane(pane);
        let is_selected = selection.is_some_and(|selection| selection.contains(ix));
        let has_selection = selection.is_some_and(|selection| selection.has_range());
        let is_highlighted = pane == EditorPane::Primary
            && self
                .editor
                .highlighted_block_uid
                .as_ref()
                .is_some_and(|uid| uid == &block.uid);
        let indent_px = px(12.0 + (block.indent.max(0) as f32) * 18.0);

        let show_input = is_active && !has_selection && self.editor.active_pane == pane;
        let actions = if show_input {
            self.render_block_actions_for_pane(pane, ix, cx)
                .into_any_element()
        } else {
            div().into_any_element()
        };
        let content = if show_input {
            let input = Input::new(&self.editor.block_input)
                .appearance(false)
                .bordered(false)
                .focus_bordered(false)
                .small();
            div()
                .capture_key_down(cx.listener(move |this, event, window, cx| {
                    if this.handle_block_input_key_down(pane, event, window, cx) {
                        cx.stop_propagation();
                    }
                }))
                .child(input)
                .into_any_element()
        } else {
            self.render_wikilink_text(pane, &block.uid, &block.text, cx)
        };

        let mut content_container = div().flex_1().min_w_0().relative().child(content);
        if show_input
            && self.editor.slash_menu.open
            && self.editor.slash_menu.pane == pane
            && self.editor.slash_menu.block_ix == Some(ix)
        {
            let cursor_x = self.block_input_cursor_x(window, cx) + px(BLOCK_INPUT_PADDING_X);
            let menu_origin = point(cursor_x.max(px(0.0)), px(BLOCK_ROW_HEIGHT));
            let menu = gpui::deferred(self.render_slash_menu_at(menu_origin, cx)).with_priority(10);
            content_container = content_container.child(menu);
        }
        if show_input
            && self.editor.wikilink_menu.open
            && self.editor.wikilink_menu.pane == pane
            && self.editor.wikilink_menu.block_ix == Some(ix)
        {
            let cursor_x = self.block_input_cursor_x(window, cx) + px(BLOCK_INPUT_PADDING_X);
            let menu_origin = point(cursor_x.max(px(0.0)), px(BLOCK_ROW_HEIGHT));
            let menu =
                gpui::deferred(self.render_wikilink_menu_at(menu_origin, cx)).with_priority(10);
            content_container = content_container.child(menu);
        }

        let theme = cx.theme();
        let base_bg = if pane == EditorPane::Secondary {
            theme.sidebar
        } else {
            theme.background
        };
        let selected_bg = theme.selection;
        let active_bg = theme.list_active;
        let hover_bg = theme.list_hover;
        let highlight_bg = theme.accent.opacity(0.25);

        div()
            .id(match pane {
                EditorPane::Primary => block.uid.clone(),
                EditorPane::Secondary => format!("secondary-{}", block.uid),
            })
            .w_full()
            .flex()
            .items_center()
            .gap_2()
            .py_1()
            .px_2()
            .rounded_md()
            .bg(if is_selected {
                selected_bg
            } else if is_active {
                active_bg
            } else if is_highlighted {
                highlight_bg
            } else {
                base_bg
            })
            .hover(move |s| {
                if is_active || is_selected {
                    s
                } else {
                    s.bg(hover_bg)
                }
            })
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(move |this, event: &MouseDownEvent, _window, cx| {
                    this.set_active_pane(pane, cx);
                    if let Some(selection) = this.selection_for_pane_mut(pane) {
                        if !event.modifiers.shift {
                            selection.anchor = Some(ix);
                        }
                        selection.range = None;
                        selection.dragging = true;
                        selection.drag_completed = false;
                    }
                    cx.notify();
                }),
            )
            .on_mouse_move(
                cx.listener(move |this, _event: &MouseMoveEvent, _window, cx| {
                    if let Some(selection) = this.selection_for_pane_mut(pane) {
                        if !selection.dragging {
                            return;
                        }
                        let Some(anchor) = selection.anchor else {
                            return;
                        };
                        selection.set_range(anchor, ix);
                        cx.notify();
                    }
                }),
            )
            .on_mouse_up(
                MouseButton::Left,
                cx.listener(move |this, _event: &MouseUpEvent, _window, cx| {
                    if let Some(selection) = this.selection_for_pane_mut(pane) {
                        if selection.dragging {
                            selection.dragging = false;
                            selection.drag_completed = selection.has_range();
                            cx.notify();
                        }
                    }
                }),
            )
            .on_mouse_up_out(
                MouseButton::Left,
                cx.listener(move |this, _event: &MouseUpEvent, _window, cx| {
                    if let Some(selection) = this.selection_for_pane_mut(pane) {
                        if selection.dragging {
                            selection.dragging = false;
                            selection.drag_completed = selection.has_range();
                            cx.notify();
                        }
                    }
                }),
            )
            .on_click(cx.listener(move |this, event, window, cx| {
                this.on_click_block_with_event_in_pane(pane, ix, event, window, cx);
            }))
            .child(div().w(indent_px).h(px(1.0)).bg(base_bg))
            .child(
                div()
                    .w(px(10.0))
                    .h(px(10.0))
                    .rounded_full()
                    .bg(theme.border),
            )
            .child(content_container)
            .child(actions)
            .into_any_element()
    }

    fn render_block_actions_for_pane(
        &mut self,
        pane: EditorPane,
        ix: usize,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let insert_ix = ix;
        let review_ix = ix;
        let link_ix = ix;
        let duplicate_ix = ix;
        let id_prefix = match pane {
            EditorPane::Primary => "block",
            EditorPane::Secondary => "secondary-block",
        };

        div()
            .flex()
            .items_center()
            .gap_1()
            .child(
                Button::new(format!("{id_prefix}-insert-{ix}"))
                    .label("Insert")
                    .xsmall()
                    .ghost()
                    .on_click(cx.listener(move |this, _event, window, cx| {
                        this.set_active_pane(pane, cx);
                        this.insert_block_after_in_pane(pane, insert_ix, window, cx);
                    })),
            )
            .child(
                Button::new(format!("{id_prefix}-review-{ix}"))
                    .label("Review")
                    .xsmall()
                    .ghost()
                    .on_click(cx.listener(move |this, _event, _window, cx| {
                        this.set_active_pane(pane, cx);
                        this.add_review_from_block_in_pane(pane, review_ix, cx);
                    })),
            )
            .child(
                Button::new(format!("{id_prefix}-link-{ix}"))
                    .label("Link")
                    .xsmall()
                    .ghost()
                    .on_click(cx.listener(move |this, _event, window, cx| {
                        this.set_active_pane(pane, cx);
                        this.link_block_to_page_in_pane(pane, link_ix, window, cx);
                    })),
            )
            .child(
                Button::new(format!("{id_prefix}-duplicate-{ix}"))
                    .label("Duplicate")
                    .xsmall()
                    .ghost()
                    .on_click(cx.listener(move |this, _event, window, cx| {
                        this.set_active_pane(pane, cx);
                        this.duplicate_block_at_in_pane(pane, duplicate_ix, window, cx);
                    })),
            )
    }

    fn render_capture_pane(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        div()
            .flex_1()
            .h_full()
            .px_6()
            .py_4()
            .child(
                div()
                    .text_lg()
                    .text_color(theme.foreground)
                    .font_weight(gpui::FontWeight::SEMIBOLD)
                    .child("Quick Capture"),
            )
            .child(div().h(px(12.0)))
            .child(
                div()
                    .capture_key_down(cx.listener(|this, event: &KeyDownEvent, window, cx| {
                        if event.keystroke.key == "enter" && event.keystroke.modifiers.secondary() {
                            this.add_capture(window, cx);
                            cx.stop_propagation();
                        }
                    }))
                    .child(Input::new(&self.editor.capture_input).h(px(160.0))),
            )
            .child(div().h(px(12.0)))
            .child(
                Button::new("capture-submit")
                    .label("Capture")
                    .xsmall()
                    .primary()
                    .on_click(cx.listener(|this, _event, window, cx| {
                        this.add_capture(window, cx);
                    })),
            )
    }

    fn render_review_pane(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let mut body = div()
            .flex_1()
            .h_full()
            .px_6()
            .py_4()
            .child(
                div()
                    .text_lg()
                    .text_color(theme.foreground)
                    .font_weight(gpui::FontWeight::SEMIBOLD)
                    .child("Review Queue"),
            )
            .child(div().h(px(12.0)));

        if self.editor.review_items.is_empty() {
            body = body.child(
                div()
                    .text_sm()
                    .text_color(theme.muted_foreground)
                    .child("No review items due yet."),
            );
        } else {
            for item in self.editor.review_items.iter() {
                let block_uid = item.block_uid.clone();
                let page_uid = item.page_uid.clone();
                let item_id = item.id;
                let snippet = format_snippet(&item.text, 80);
                let page_title = item.page_title.clone();
                let due_label = chrono::Local
                    .timestamp_millis_opt(item.due_at)
                    .single()
                    .map(|dt| dt.format("%b %d, %H:%M").to_string())
                    .unwrap_or_else(|| "Due soon".to_string());

                body = body.child(
                    div()
                        .rounded_md()
                        .bg(theme.colors.list)
                        .border_1()
                        .border_color(theme.border)
                        .px_3()
                        .py_3()
                        .mb_3()
                        .child(div().text_sm().text_color(theme.foreground).child(snippet))
                        .child(
                            div()
                                .text_xs()
                                .text_color(theme.muted_foreground)
                                .child(page_title),
                        )
                        .child(
                            div()
                                .text_xs()
                                .text_color(theme.muted_foreground)
                                .child(format!("Due {due_label}")),
                        )
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap_2()
                                .pt_2()
                                .child(
                                    Button::new(format!("review-open-{item_id}"))
                                        .label("Open")
                                        .xsmall()
                                        .ghost()
                                        .on_click(cx.listener(move |this, _event, window, cx| {
                                            this.open_page_and_focus_block(
                                                &page_uid, &block_uid, window, cx,
                                            );
                                        })),
                                )
                                .child(
                                    Button::new(format!("review-done-{item_id}"))
                                        .label("Done")
                                        .xsmall()
                                        .ghost()
                                        .on_click(cx.listener(move |this, _event, _window, cx| {
                                            this.review_mark_done(item_id, cx);
                                        })),
                                )
                                .child(
                                    Button::new(format!("review-snooze-day-{item_id}"))
                                        .label("Snooze 1 day")
                                        .xsmall()
                                        .ghost()
                                        .on_click(cx.listener(move |this, _event, _window, cx| {
                                            this.review_snooze_day(item_id, cx);
                                        })),
                                )
                                .child(
                                    Button::new(format!("review-snooze-week-{item_id}"))
                                        .label("Snooze 1 week")
                                        .xsmall()
                                        .ghost()
                                        .on_click(cx.listener(move |this, _event, _window, cx| {
                                            this.review_snooze_week(item_id, cx);
                                        })),
                                ),
                        ),
                );
            }
        }

        body
    }
}
