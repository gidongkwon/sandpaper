use super::*;
use super::helpers::format_snippet;

const SLASH_COMMANDS: &[(&str, &str)] = &[
    ("link", "Link to page"),
    ("date", "Insert date"),
    ("task", "Convert to task"),
];

impl SandpaperApp {
    fn render_topbar(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let mode_label = match self.mode {
            Mode::Editor => "Editor",
            Mode::Capture => "Capture",
            Mode::Review => "Review",
        };

        let vault_label: SharedString = self
            .active_vault_id
            .as_ref()
            .and_then(|id| self.vaults.iter().find(|vault| &vault.id == id))
            .map(|vault| vault.name.clone().into())
            .unwrap_or_else(|| "Vaults".into());

        let save_label: SharedString = match &self.save_state {
            SaveState::Saved => "Saved".into(),
            SaveState::Dirty => "Unsaved changes".into(),
            SaveState::Saving => "Saving…".into(),
            SaveState::Error(err) => format!("Save failed: {err}").into(),
        };

        let mut status_group = div()
            .flex()
            .items_center()
            .gap_2()
            .child(
                div()
                    .text_sm()
                    .text_color(theme.foreground)
                    .font_weight(gpui::FontWeight::SEMIBOLD)
                    .child(format!("Sandpaper · {mode_label}")),
            )
            .child(
                div()
                    .ml_2()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .child(self.boot_status.clone()),
            );

        if let Some(note) = self.capture_confirmation.clone() {
            status_group = status_group.child(
                div()
                    .ml_2()
                    .px_2()
                    .py(px(1.0))
                    .rounded_sm()
                    .bg(theme.success)
                    .text_xs()
                    .text_color(theme.success_foreground)
                    .child(note),
            );
        }

        let right_group = div()
            .flex()
            .items_center()
            .gap_2()
            .child(
                div()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .child(save_label),
            )
            .child(
                Button::new("vaults-button")
                    .label(vault_label)
                    .xsmall()
                    .on_click(cx.listener(|this, _event, window, cx| {
                        this.open_vaults(&OpenVaults, window, cx);
                    })),
            );

        div()
            .h(px(44.0))
            .px_3()
            .flex()
            .items_center()
            .justify_between()
            .bg(theme.title_bar)
            .border_b_1()
            .border_color(theme.title_bar_border)
            .child(status_group)
            .child(right_group)
    }

    fn render_sidebar(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let active_uid = self.active_page.as_ref().map(|page| page.uid.clone());
        let has_query = !self.sidebar_search_query.trim().is_empty();
        let list = if has_query {
            self.render_search_results(cx).into_any_element()
        } else {
            self.render_pages_list(cx, active_uid.clone())
        };
        let theme = cx.theme();

        let mut sidebar = div()
            .w(px(280.0))
            .h_full()
            .bg(theme.sidebar)
            .border_r_1()
            .border_color(theme.sidebar_border)
            .flex()
            .flex_col()
            .child(
                div()
                    .p_3()
                    .flex()
                    .justify_between()
                    .items_center()
                    .child(
                        div()
                            .text_sm()
                            .text_color(theme.sidebar_foreground)
                            .font_weight(gpui::FontWeight::SEMIBOLD)
                            .child("Pages"),
                    )
                    .child(
                        Button::new("new-page")
                            .label("New")
                            .xsmall()
                            .on_click(cx.listener(|this, _event, _window, cx| {
                                this.open_page_dialog(PageDialogMode::Create, cx);
                            })),
                    ),
            )
            .child(
                div()
                    .px_3()
                    .pb_2()
                    .child(Input::new(&self.sidebar_search_input).small().cleanable(true)),
            )
            .child(list);

        if let Some(references) = self.render_sidebar_references(cx) {
            sidebar = sidebar.child(references);
        }

        sidebar
    }

    fn render_pages_list(
        &mut self,
        cx: &mut Context<Self>,
        active_uid: Option<String>,
    ) -> gpui::AnyElement {
        let theme = cx.theme();
        if self.pages.is_empty() {
            return div()
                .id("pages-list")
                .flex_1()
                .min_h_0()
                .child(
                    div()
                        .px_3()
                        .py_3()
                        .text_sm()
                        .text_color(theme.muted_foreground)
                        .child("No pages yet"),
                )
                .into_any_element();
        }

        let item_sizes = Rc::new(vec![
            size(px(0.), px(COMPACT_ROW_HEIGHT));
            self.pages.len()
        ]);
        let active_uid = active_uid.clone();

        v_virtual_list(
            cx.entity(),
            "pages-list",
            item_sizes,
            move |this, range: std::ops::Range<usize>, _window, cx| {
                let theme = cx.theme();
                range
                    .map(|ix| {
                        let page = this.pages[ix].clone();
                        let is_active =
                            active_uid.as_ref().is_some_and(|uid| uid == &page.uid);
                        let text_color = if is_active {
                            theme.sidebar_accent_foreground
                        } else {
                            theme.sidebar_foreground
                        };
                        let bg = if is_active {
                            theme.sidebar_accent
                        } else {
                            theme.sidebar
                        };
                        let hover_bg = theme.sidebar_accent;

                        div()
                            .id(page.uid.clone())
                            .px_3()
                            .py_2()
                            .cursor_pointer()
                            .bg(bg)
                            .hover(move |s| {
                                if is_active {
                                    s
                                } else {
                                    s.bg(hover_bg).cursor_pointer()
                                }
                            })
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(text_color)
                                    .child(page.title.clone()),
                            )
                            .on_click(cx.listener(move |this, _event, window, cx| {
                                this.on_click_page(page.uid.clone(), window, cx);
                            }))
                    })
                    .collect()
            },
        )
        .flex_1()
        .min_h_0()
        .size_full()
        .into_any_element()
    }

    fn render_search_results(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let list_hover = theme.list_hover;
        let mut content = div()
            .id("search-scroll")
            .flex_1()
            .min_h_0()
            .overflow_scroll();

        if self.search_pages.is_empty() && self.search_blocks.is_empty() {
            return content.child(
                div()
                    .px_3()
                    .py_3()
                    .text_sm()
                    .text_color(theme.muted_foreground)
                    .child("No results"),
            );
        }

        if !self.search_pages.is_empty() {
            content = content.child(
                div()
                    .px_3()
                    .pt_3()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .child("Pages"),
            );
            content = content.children(self.search_pages.iter().cloned().map(|page| {
                let page_uid = page.uid.clone();
                let open_uid = page.uid.clone();
                let split_uid = page.uid.clone();
                div()
                    .id(format!("search-page-{}", page_uid))
                    .px_3()
                    .py_2()
                    .hover(move |s| s.bg(list_hover))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(theme.foreground)
                                    .child(page.title.clone()),
                            )
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_2()
                                    .child(
                                        Button::new(format!("search-open-{}", page_uid))
                                            .label("Open")
                                            .xsmall()
                                            .ghost()
                                            .on_click(cx.listener(
                                                move |this, _event, window, cx| {
                                                    this.on_click_page(open_uid.clone(), window, cx);
                                                },
                                            )),
                                    )
                                    .child(
                                        Button::new(format!("search-split-{}", page_uid))
                                            .label("Split")
                                            .xsmall()
                                            .ghost()
                                            .on_click(cx.listener(
                                                move |this, _event, _window, cx| {
                                                    this.open_secondary_pane_for_page(&split_uid, cx);
                                                },
                                            )),
                                    ),
                            ),
                    )
            }));
        }

        if !self.search_blocks.is_empty() {
            content = content.child(
                div()
                    .px_3()
                    .pt_3()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .child("Blocks"),
            );
            content = content.children(self.search_blocks.iter().cloned().map(|block| {
                let snippet = format_snippet(&block.text, 80);
                div()
                    .id(format!("search-block-{}", block.block_uid))
                    .px_3()
                    .py_2()
                    .cursor_pointer()
                    .hover(move |s| s.bg(list_hover))
                    .child(
                        div()
                            .text_sm()
                            .text_color(theme.foreground)
                            .child(snippet),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(theme.muted_foreground)
                            .child(block.page_title.clone()),
                    )
                    .on_click(cx.listener(move |this, _event, window, cx| {
                        this.open_page_and_focus_block(&block.page_uid, &block.block_uid, window, cx);
                    }))
            }));
        }

        content
    }

    fn render_sidebar_references(&mut self, cx: &mut Context<Self>) -> Option<gpui::AnyElement> {
        if self.active_page.is_none() {
            return None;
        }

        let theme = cx.theme();
        let references = self.unlinked_references.clone();
        if references.is_empty() {
            let panel = div()
                .flex()
                .flex_col()
                .gap_2()
                .px_3()
                .py_3()
                .border_t_1()
                .border_color(theme.border)
                .child(
                    div()
                        .text_xs()
                        .text_color(theme.muted_foreground)
                        .child("Unlinked references"),
                )
                .child(
                    div()
                        .text_xs()
                        .text_color(theme.muted_foreground)
                        .child("No unlinked references."),
                );
            return Some(panel.into_any_element());
        }

        let mut panel = div()
            .flex()
            .flex_col()
            .gap_2()
            .px_3()
            .py_3()
            .border_t_1()
            .border_color(theme.border)
            .child(
                div()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .child("Unlinked references"),
            );

        panel = panel.children(references.iter().map(|entry| {
            let entry = entry.clone();
            let snippet = format_snippet(&entry.snippet, 100);
            let count_label = if entry.match_count == 1 {
                "1 match".to_string()
            } else {
                format!("{} matches", entry.match_count)
            };
            div()
                .flex()
                .flex_col()
                .gap_2()
                .p_2()
                .rounded_md()
                .bg(theme.colors.list)
                .child(
                    div()
                        .text_xs()
                        .text_color(theme.foreground)
                        .child(snippet),
                )
                .child(
                    div()
                        .text_xs()
                        .text_color(theme.muted_foreground)
                        .child(entry.page_title.clone()),
                )
                .child(
                    div()
                        .text_xs()
                        .text_color(theme.muted_foreground)
                        .child(count_label),
                )
                .child(
                    Button::new(format!("unlinked-link-{}", entry.block_uid))
                        .label("Link")
                        .xsmall()
                        .ghost()
                        .on_click(cx.listener(move |this, _event, _window, cx| {
                            this.link_unlinked_reference(&entry, cx);
                        })),
                )
        }));

        Some(panel.into_any_element())
    }

    fn render_editor(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let editor_body = match self.mode {
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

        let mut container = div()
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

        if let Some(menu) = self.render_slash_menu(cx) {
            container = container.child(menu);
        }

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
        let state = self.blocks_list_state.clone();
        let list = if self.editor.is_some() {
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
                .child(self.render_placeholder(
                    "Select or create a page to start writing.",
                    cx,
                ))
                .into_any_element()
        };

        let theme = cx.theme();
        let is_active = self.active_pane == EditorPane::Primary;
        let mut container = div()
            .id("blocks")
            .flex_1()
            .min_w_0()
            .h_full()
            .flex()
            .flex_col()
            .p_4()
            .bg(theme.background)
            .border_1()
            .border_color(if is_active && self.secondary_pane.is_some() {
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
        let Some(active_page) = self.active_page.as_ref() else {
            return None;
        };
        let theme = cx.theme();
        let block_count = self.editor.as_ref().map(|editor| editor.blocks.len()).unwrap_or(0);
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
            let mut trail = div()
                .id("editor-breadcrumbs")
                .flex()
                .items_center()
                .gap_1();
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
                    .label(if self.secondary_pane.is_some() {
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

        if self.secondary_pane.is_some() {
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
                        .label(if self.sync_scroll {
                            "Sync scroll: On"
                        } else {
                            "Sync scroll: Off"
                        })
                        .xsmall()
                        .ghost()
                        .on_click(cx.listener(|this, _event, _window, cx| {
                            this.sync_scroll = !this.sync_scroll;
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
        let total = self.backlinks.len() + self.block_backlinks.len();
        let is_open = self.backlinks_open;
        let label = if total > 0 {
            format!(
                "{} ({total})",
                if is_open { "Hide backlinks" } else { "Show backlinks" }
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
                this.backlinks_open = !this.backlinks_open;
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

    fn render_slash_menu(&mut self, cx: &mut Context<Self>) -> Option<gpui::AnyElement> {
        if !self.slash_menu.open {
            return None;
        }
        let theme = cx.theme();

        let mut menu = div()
            .absolute()
            .top(px(72.0))
            .left(px(24.0))
            .w(px(220.0))
            .rounded_md()
            .bg(theme.popover)
            .border_1()
            .border_color(theme.border)
            .child(
                div()
                    .px_3()
                    .py_2()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .child("Commands"),
            );

        let hover_bg = theme.list_hover;
        for (id, label) in SLASH_COMMANDS.iter().copied() {
            menu = menu.child(
                div()
                    .id(format!("slash-{id}"))
                    .px_3()
                    .py_2()
                    .text_sm()
                    .text_color(theme.foreground)
                    .hover(move |s| s.bg(hover_bg).cursor_pointer())
                    .on_click(cx.listener(move |this, _event, window, cx| {
                        this.apply_slash_command(id, window, cx);
                    }))
                    .child(label),
            );
        }

        Some(menu.into_any_element())
    }

    fn render_backlinks_panel(&mut self, cx: &mut Context<Self>) -> Option<gpui::AnyElement> {
        if self.mode != Mode::Editor {
            return None;
        }
        if !self.backlinks_open {
            return None;
        }
        if self.active_page.is_none() {
            return None;
        }
        let theme = cx.theme();

        let active_block_text = self
            .editor
            .as_ref()
            .map(|editor| editor.active().text.clone())
            .unwrap_or_default();

        let has_page_backlinks = !self.backlinks.is_empty();
        let has_block_backlinks = !self.block_backlinks.is_empty();
        let list_bg = theme.colors.list;
        let list_hover = theme.list_hover;
        let muted = theme.muted_foreground;
        let foreground = theme.foreground;

        let mut panel = div()
            .id("backlinks-panel")
            .w(px(320.0))
            .h_full()
            .border_l_1()
            .border_color(theme.sidebar_border)
            .bg(theme.sidebar)
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
                            .label("Close")
                            .xsmall()
                            .ghost()
                            .on_click(cx.listener(|this, _event, _window, cx| {
                                this.backlinks_open = false;
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
            body = body.children(self.backlinks.iter().cloned().map(|entry| {
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
                                    .child(
                                        div()
                                            .text_sm()
                                            .text_color(foreground)
                                            .child(snippet),
                                    )
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
            body = body.children(self.block_backlinks.iter().cloned().map(|entry| {
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
                                    .child(
                                        div()
                                            .text_sm()
                                            .text_color(foreground)
                                            .child(snippet),
                                    )
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
                                        Button::new(format!(
                                            "backlinks-block-split-{}",
                                            block_uid
                                        ))
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
            let pane = self.secondary_pane.as_ref()?;
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
                    .map(|ix| {
                        this.render_block_row_for_pane(EditorPane::Secondary, ix, window, cx)
                    })
                    .collect::<Vec<_>>()
            },
        )
        .track_scroll(&list_state.scroll_handle)
        .flex_1()
        .min_h_0()
        .size_full();

        let breadcrumbs = self.build_breadcrumb_items_for_pane(EditorPane::Secondary);
        let is_active = self.active_pane == EditorPane::Secondary;
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
                    .bg(if is_last { theme.list_active } else { theme.secondary })
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
                .border_color(if is_active { theme.ring } else { theme.sidebar_border })
                .bg(theme.sidebar)
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
                                        .label("Open")
                                        .xsmall()
                                        .ghost()
                                        .on_click(cx.listener(move |this, _event, window, cx| {
                                            this.copy_secondary_to_primary(window, cx);
                                        })),
                                )
                                .child(
                                    Button::new("secondary-swap")
                                        .label("Swap")
                                        .xsmall()
                                        .ghost()
                                        .on_click(cx.listener(|this, _event, _window, cx| {
                                            this.swap_panes(cx);
                                        })),
                                )
                                .child(
                                    Button::new("secondary-close")
                                        .label("Close")
                                        .xsmall()
                                        .ghost()
                                        .on_click(cx.listener(|this, _event, _window, cx| {
                                            if this
                                                .secondary_pane
                                                .as_ref()
                                                .is_some_and(|pane| pane.dirty)
                                            {
                                                this.save(cx);
                                            }
                                            this.secondary_pane = None;
                                            this.active_pane = EditorPane::Primary;
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
        _window: &mut Window,
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
                .highlighted_block_uid
                .as_ref()
                .is_some_and(|uid| uid == &block.uid);
        let indent_px = px(12.0 + (block.indent.max(0) as f32) * 18.0);

        let show_input = is_active && !has_selection && self.active_pane == pane;
        let actions = if show_input {
            self.render_block_actions_for_pane(pane, ix, cx)
                .into_any_element()
        } else {
            div().into_any_element()
        };
        let theme = cx.theme();
        let content = if show_input {
            let input = Input::new(&self.block_input)
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
            div()
                .text_sm()
                .text_color(theme.foreground)
                .child(if block.text.is_empty() { " " } else { &block.text }.to_string())
                .into_any_element()
        };

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
            .on_mouse_move(cx.listener(move |this, _event: &MouseMoveEvent, _window, cx| {
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
            }))
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
            .child(div().flex_1().min_w_0().child(content))
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
                        if event.keystroke.key == "enter"
                            && event.keystroke.modifiers.secondary()
                        {
                            this.add_capture(window, cx);
                            cx.stop_propagation();
                        }
                    }))
                    .child(Input::new(&self.capture_input).h(px(160.0))),
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

        if self.review_items.is_empty() {
            body = body.child(
                div()
                    .text_sm()
                    .text_color(theme.muted_foreground)
                    .child("No review items due yet."),
            );
        } else {
            for item in self.review_items.iter() {
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
                        .child(
                            div()
                                .text_sm()
                                .text_color(theme.foreground)
                                .child(snippet),
                        )
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
                                        .on_click(cx.listener(
                                            move |this, _event, window, cx| {
                                                this.open_page_and_focus_block(
                                                    &page_uid,
                                                    &block_uid,
                                                    window,
                                                    cx,
                                                );
                                            },
                                        )),
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

    fn render_page_dialog(&mut self, cx: &mut Context<Self>) -> Option<gpui::AnyElement> {
        if !self.page_dialog_open {
            return None;
        }
        let theme = cx.theme();

        let title = match self.page_dialog_mode {
            PageDialogMode::Create => "Create Page",
            PageDialogMode::Rename => "Rename Page",
        };
        let confirm_label = match self.page_dialog_mode {
            PageDialogMode::Create => "Create",
            PageDialogMode::Rename => "Rename",
        };

        Some(
            div()
                .id("page-dialog")
                .absolute()
                .inset_0()
                .bg(rgba(0x0000008c))
                .flex()
                .items_center()
                .justify_center()
                .child(
                    div()
                        .w(px(420.0))
                        .p_4()
                        .rounded_lg()
                        .bg(theme.popover)
                        .border_1()
                        .border_color(theme.border)
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .justify_between()
                                .child(
                                    div()
                                        .text_sm()
                                        .text_color(theme.foreground)
                                        .font_weight(gpui::FontWeight::SEMIBOLD)
                                        .child(title),
                                )
                                .child(
                                    Button::new("page-dialog-close")
                                        .label("Close")
                                        .xsmall()
                                        .ghost()
                                        .on_click(cx.listener(|this, _event, _window, cx| {
                                            this.close_page_dialog(cx);
                                        })),
                                ),
                        )
                        .child(div().h(px(8.0)))
                        .child(Input::new(&self.page_dialog_input).small())
                        .child(div().h(px(8.0)))
                        .child(
                            Button::new("page-dialog-confirm")
                                .label(confirm_label)
                                .xsmall()
                                .primary()
                                .on_click(cx.listener(|this, _event, _window, cx| {
                                    this.confirm_page_dialog(cx);
                                })),
                        ),
                )
                .into_any_element(),
        )
    }

    fn render_vault_dialog(&mut self, cx: &mut Context<Self>) -> Option<gpui::AnyElement> {
        if !self.vault_dialog_open {
            return None;
        }
        let theme = cx.theme();

        let vaults = self.vaults.clone();
        let active_id = self.active_vault_id.clone();
        let error = self.vault_dialog_error.clone();

        let mut list = div().flex().flex_col().gap_2().pb_3();
        let list_hover = theme.list_hover;
        if vaults.is_empty() {
            list = list.child(
                div()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .child("No vaults yet."),
            );
        } else {
            for vault in vaults.into_iter() {
                let id = vault.id.clone();
                let is_active = active_id.as_ref().is_some_and(|active| active == &id);
                list = list.child(
                    div()
                        .id(format!("vault-item-{id}"))
                        .px_2()
                        .py_2()
                        .rounded_md()
                        .bg(if is_active { theme.list_active } else { theme.colors.list })
                        .hover(move |s| s.bg(list_hover).cursor_pointer())
                        .text_sm()
                        .text_color(if is_active {
                            theme.foreground
                        } else {
                            theme.muted_foreground
                        })
                        .on_click(cx.listener(move |this, _event, _window, cx| {
                            this.set_active_vault(id.clone(), cx);
                        }))
                        .child(vault.name.clone()),
                );
            }
        }

        if let Some(msg) = error {
            list = list.child(
                div()
                    .text_xs()
                    .text_color(theme.danger_foreground)
                    .child(msg),
            );
        }

        Some(
            div()
                .id("vault-dialog")
                .absolute()
                .inset_0()
                .bg(rgba(0x0000008c))
                .flex()
                .items_center()
                .justify_center()
                .child(
                    div()
                        .w(px(500.0))
                        .p_4()
                        .rounded_lg()
                        .bg(theme.popover)
                        .border_1()
                        .border_color(theme.border)
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .justify_between()
                                .child(
                                    div()
                                        .text_sm()
                                        .text_color(theme.foreground)
                                        .font_weight(gpui::FontWeight::SEMIBOLD)
                                        .child("Vaults"),
                                )
                                .child(
                                    Button::new("vault-dialog-close")
                                        .label("Close")
                                        .xsmall()
                                        .ghost()
                                        .on_click(cx.listener(|this, _event, _window, cx| {
                                            this.close_vault_dialog(cx);
                                        })),
                                ),
                        )
                        .child(div().h(px(8.0)))
                        .child(list)
                        .child(
                            div()
                                .text_sm()
                                .text_color(theme.foreground)
                                .font_weight(gpui::FontWeight::SEMIBOLD)
                                .child("Create new vault"),
                        )
                        .child(div().h(px(8.0)))
                        .child(
                            div()
                                .text_xs()
                                .text_color(theme.muted_foreground)
                                .child("Name"),
                        )
                        .child(Input::new(&self.vault_dialog_name_input).small())
                        .child(div().h(px(8.0)))
                        .child(
                            div()
                                .text_xs()
                                .text_color(theme.muted_foreground)
                                .child("Path"),
                        )
                        .child(Input::new(&self.vault_dialog_path_input).small())
                        .child(div().h(px(8.0)))
                        .child(
                            Button::new("vault-create")
                                .label("Create vault")
                                .xsmall()
                                .primary()
                                .on_click(cx.listener(|this, _event, _window, cx| {
                                    this.create_vault(cx);
                                })),
                        ),
                )
                .into_any_element(),
        )
    }

    fn render_command_palette(&mut self, cx: &mut Context<Self>) -> Option<gpui::AnyElement> {
        if !self.palette_open {
            return None;
        }

        let theme = cx.theme();
        let commands = self.filtered_palette_items();
        let active_ix = self.palette_index;
        let list_active = theme.list_active;
        let list_bg = theme.colors.list;
        let list_hover = theme.list_hover;
        let foreground = theme.foreground;
        let muted = theme.muted_foreground;

        let list = if commands.is_empty() {
            div()
                .text_xs()
                .text_color(theme.muted_foreground)
                .child("No matches")
                .into_any_element()
        } else {
            let item_sizes = Rc::new(vec![
                size(px(0.), px(COMPACT_ROW_HEIGHT));
                commands.len()
            ]);
            v_virtual_list(
                cx.entity(),
                "palette-list",
                item_sizes,
                move |_this, range: std::ops::Range<usize>, _window, cx| {
                    range
                        .map(|idx| {
                            let item = commands[idx].clone();
                            let is_active = idx == active_ix;
                            let label = item.label.clone();
                            let hint = item.hint.clone();

                            let mut row = div()
                                .id(format!("palette-item-{}", item.id))
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
                                        .child(label),
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
                                this.run_palette_command(idx, window, cx);
                            }))
                        })
                        .collect::<Vec<_>>()
                },
            )
            .flex_1()
            .min_h_0()
            .into_any_element()
        };

        Some(
            div()
                .id("command-palette")
                .absolute()
                .inset_0()
                .bg(rgba(0x0000008c))
                .flex()
                .items_center()
                .justify_center()
                .key_context("CommandPalette")
                .child(
                    div()
                        .w(px(520.0))
                        .p_4()
                        .rounded_lg()
                        .bg(theme.popover)
                        .border_1()
                        .border_color(theme.border)
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .justify_between()
                                .child(
                                    div()
                                        .text_sm()
                                        .text_color(theme.foreground)
                                        .font_weight(gpui::FontWeight::SEMIBOLD)
                                        .child("Command palette"),
                                )
                                .child(
                                    Button::new("command-palette-close")
                                        .label("Close")
                                        .xsmall()
                                        .ghost()
                                        .on_click(cx.listener(|this, _event, _window, cx| {
                                            this.close_command_palette(cx);
                                        })),
                                ),
                        )
                        .child(div().h(px(8.0)))
                        .child(Input::new(&self.palette_input).small().cleanable(true))
                        .child(list),
                )
                .into_any_element(),
        )
    }
}

impl Focusable for SandpaperApp {
    fn focus_handle(&self, _cx: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl Render for SandpaperApp {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let mut root = div()
            .id("sandpaper-app")
            .key_context("Sandpaper")
            .on_action(cx.listener(Self::open_vaults))
            .on_action(cx.listener(Self::new_page))
            .on_action(cx.listener(Self::rename_page))
            .on_action(cx.listener(Self::toggle_mode_editor))
            .on_action(cx.listener(Self::toggle_mode_capture))
            .on_action(cx.listener(Self::toggle_mode_review))
            .on_action(cx.listener(Self::open_command_palette_action))
            .on_action(cx.listener(Self::close_command_palette_action))
            .on_action(cx.listener(Self::palette_move_up))
            .on_action(cx.listener(Self::palette_move_down))
            .on_action(cx.listener(Self::palette_run))
            .track_focus(&self.focus_handle)
            .flex()
            .flex_col()
            .size_full()
            .bg(cx.theme().background)
            .child(self.render_topbar(cx))
            .child(
                div()
                    .flex()
                    .flex_1()
                    .min_h_0()
                    .child(self.render_sidebar(cx))
                    .child(self.render_editor(cx)),
            );

        if let Some(dialog) = self.render_page_dialog(cx) {
            root = root.child(dialog);
        }

        if let Some(dialog) = self.render_vault_dialog(cx) {
            root = root.child(dialog);
        }

        if let Some(palette) = self.render_command_palette(cx) {
            root = root.child(palette);
        }

        root
    }
}
