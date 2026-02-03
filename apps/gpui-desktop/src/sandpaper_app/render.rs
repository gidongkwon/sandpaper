use super::*;
use super::helpers::format_snippet;

const SLASH_COMMANDS: &[(&str, &str)] = &[
    ("link", "Link to page"),
    ("date", "Insert date"),
    ("task", "Convert to task"),
];

impl SandpaperApp {
    fn render_topbar(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
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

        div()
            .h(px(44.0))
            .px_3()
            .flex()
            .items_center()
            .justify_between()
            .bg(rgb(0x0f111a))
            .border_b_1()
            .border_color(rgb(0x1b1e2b))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .child(
                        div()
                            .text_sm()
                            .text_color(rgb(0xcdd6f4))
                            .font_weight(gpui::FontWeight::SEMIBOLD)
                            .child(format!("Sandpaper · {mode_label}")),
                    )
                    .child(
                        div()
                            .ml_2()
                            .text_xs()
                            .text_color(rgb(0x9aa2c8))
                            .child(self.boot_status.clone()),
                    ),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_3()
                    .child(div().text_xs().text_color(rgb(0x9aa2c8)).child(save_label))
                    .child(
                        div()
                            .id("vaults-button")
                            .px_2()
                            .py_1()
                            .rounded_md()
                            .bg(rgb(0x1b1e2b))
                            .hover(|s| s.bg(rgb(0x23263a)).cursor_pointer())
                            .text_xs()
                            .text_color(rgb(0xcdd6f4))
                            .on_click(cx.listener(|this, _event, window, cx| {
                                this.open_vaults(&OpenVaults, window, cx);
                            }))
                            .child(vault_label),
                    ),
            )
    }

    fn render_sidebar(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let active_uid = self.active_page.as_ref().map(|page| page.uid.clone());
        let has_query = !self.sidebar_search_query.trim().is_empty();
        let list = if has_query {
            self.render_search_results(cx).into_any_element()
        } else {
            self.render_pages_list(cx, active_uid.clone())
                .into_any_element()
        };

        let mut sidebar = div()
            .w(px(280.0))
            .h_full()
            .bg(rgb(0x10121b))
            .border_r_1()
            .border_color(rgb(0x1b1e2b))
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
                            .text_color(rgb(0xcdd6f4))
                            .font_weight(gpui::FontWeight::SEMIBOLD)
                            .child("Pages"),
                    )
                    .child(
                        div()
                            .id("new-page")
                            .px_2()
                            .py_1()
                            .rounded_md()
                            .bg(rgb(0x1b1e2b))
                            .hover(|s| s.bg(rgb(0x23263a)).cursor_pointer())
                            .text_xs()
                            .text_color(rgb(0xcdd6f4))
                            .on_click(cx.listener(|this, _event, _window, cx| {
                                this.open_page_dialog(PageDialogMode::Create, cx);
                            }))
                            .child("New"),
                    ),
            )
            .child(div().px_3().pb_2().child(self.sidebar_search_input.clone()))
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
    ) -> impl IntoElement {
        if self.pages.is_empty() {
            return div()
                .id("pages-scroll")
                .flex_1()
                .min_h_0()
                .overflow_scroll()
                .child(
                    div()
                        .px_3()
                        .py_3()
                        .text_sm()
                        .text_color(rgb(0x9aa2c8))
                        .child("No pages yet"),
                );
        }

        div()
            .id("pages-scroll")
            .flex_1()
            .min_h_0()
            .overflow_scroll()
            .children(self.pages.iter().cloned().map(|page| {
                let is_active = active_uid.as_ref().is_some_and(|uid| uid == &page.uid);
                div()
                    .id(page.uid.clone())
                    .px_3()
                    .py_2()
                    .cursor_pointer()
                    .bg(if is_active { rgb(0x1b1e2b) } else { rgb(0x10121b) })
                    .hover(|s| s.bg(rgb(0x1b1e2b)))
                    .child(
                        div()
                            .text_sm()
                            .text_color(if is_active { rgb(0xffffff) } else { rgb(0xcdd6f4) })
                            .child(page.title.clone()),
                    )
                    .on_click(cx.listener(move |this, _event, window, cx| {
                        this.on_click_page(page.uid.clone(), window, cx);
                    }))
            }))
    }

    fn render_search_results(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
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
                    .text_color(rgb(0x9aa2c8))
                    .child("No results"),
            );
        }

        if !self.search_pages.is_empty() {
            content = content.child(
                div()
                    .px_3()
                    .pt_3()
                    .text_xs()
                    .text_color(rgb(0x9aa2c8))
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
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(rgb(0xe7e7ea))
                                    .child(page.title.clone()),
                            )
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_2()
                                    .child(
                                        div()
                                            .id(format!("search-open-{}", page_uid))
                                            .px_2()
                                            .py_1()
                                            .rounded_md()
                                            .bg(rgb(0x1b1e2b))
                                            .hover(|s| s.bg(rgb(0x23263a)).cursor_pointer())
                                            .text_xs()
                                            .text_color(rgb(0xcdd6f4))
                                            .on_click(cx.listener(
                                                move |this, _event, window, cx| {
                                                    this.on_click_page(open_uid.clone(), window, cx);
                                                },
                                            ))
                                            .child("Open"),
                                    )
                                    .child(
                                        div()
                                            .id(format!("search-split-{}", page_uid))
                                            .px_2()
                                            .py_1()
                                            .rounded_md()
                                            .bg(rgb(0x1b1e2b))
                                            .hover(|s| s.bg(rgb(0x23263a)).cursor_pointer())
                                            .text_xs()
                                            .text_color(rgb(0xcdd6f4))
                                            .on_click(cx.listener(
                                                move |this, _event, _window, cx| {
                                                    this.open_secondary_pane_for_page(&split_uid, cx);
                                                },
                                            ))
                                            .child("Split"),
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
                    .text_color(rgb(0x9aa2c8))
                    .child("Blocks"),
            );
            content = content.children(self.search_blocks.iter().cloned().map(|block| {
                let snippet = format_snippet(&block.text, 80);
                div()
                    .id(format!("search-block-{}", block.block_uid))
                    .px_3()
                    .py_2()
                    .cursor_pointer()
                    .hover(|s| s.bg(rgb(0x1b1e2b)))
                    .child(
                        div()
                            .text_sm()
                            .text_color(rgb(0xe7e7ea))
                            .child(snippet),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(rgb(0x9aa2c8))
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

        let references = self.unlinked_references.clone();
        if references.is_empty() {
            let panel = div()
                .flex()
                .flex_col()
                .gap_2()
                .px_3()
                .py_3()
                .border_t_1()
                .border_color(rgb(0x1b1e2b))
                .child(
                    div()
                        .text_xs()
                        .text_color(rgb(0x9aa2c8))
                        .child("Unlinked references"),
                )
                .child(
                    div()
                        .text_xs()
                        .text_color(rgb(0x7f87ad))
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
            .border_color(rgb(0x1b1e2b))
            .child(
                div()
                    .text_xs()
                    .text_color(rgb(0x9aa2c8))
                    .child("Unlinked references"),
            );

        panel = panel.children(references.iter().map(|entry| {
            let entry = entry.clone();
            let snippet = format_snippet(&entry.snippet, 100);
            div()
                .flex()
                .flex_col()
                .gap_2()
                .p_2()
                .rounded_md()
                .bg(rgb(0x0f111a))
                .child(
                    div()
                        .text_xs()
                        .text_color(rgb(0xe7e7ea))
                        .child(snippet),
                )
                .child(
                    div()
                        .text_xs()
                        .text_color(rgb(0x9aa2c8))
                        .child(entry.page_title.clone()),
                )
                .child(
                    div()
                        .id(format!("unlinked-link-{}", entry.block_uid))
                        .px_2()
                        .py_1()
                        .rounded_md()
                        .bg(rgb(0x1b1e2b))
                        .hover(|s| s.bg(rgb(0x23263a)).cursor_pointer())
                        .text_xs()
                        .text_color(rgb(0xcdd6f4))
                        .on_click(cx.listener(move |this, _event, _window, cx| {
                            this.link_unlinked_reference(&entry, cx);
                        }))
                        .child("Link"),
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
            .bg(rgb(0x0b0c10))
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

    fn render_placeholder(&mut self, label: &str, _cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .text_sm()
            .text_color(rgb(0x9aa2c8))
            .child(label.to_string())
    }

    fn render_blocks_list(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let state = self.blocks_list_state.clone();
        let list = if self.editor.is_some() {
            list(state, cx.processor(|this, ix: usize, window, cx| {
                this.render_block_row_for_pane(EditorPane::Primary, ix, window, cx)
                    .into_any_element()
            }))
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

        let mut container = div()
            .id("blocks")
            .flex_1()
            .min_w_0()
            .h_full()
            .flex()
            .flex_col()
            .p_4();

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
                    .text_color(rgb(0xe7e7ea))
                    .font_weight(gpui::FontWeight::SEMIBOLD)
                    .child(title.to_string()),
            )
            .child(
                div()
                    .text_xs()
                    .text_color(rgb(0x9aa2c8))
                    .child(format!("{block_count} blocks")),
            );

        if breadcrumbs.len() > 1 {
            let mut trail = div()
                .id("editor-breadcrumbs")
                .flex()
                .items_center()
                .gap_1();
            for (idx, item) in breadcrumbs.iter().enumerate() {
                let is_last = idx == breadcrumbs.len() - 1;
                let uid = item.uid.clone();
                let label = item.label.clone();
                let mut crumb = div()
                    .id(format!("breadcrumb-{}", uid))
                    .px_1()
                    .py(px(1.0))
                    .rounded_sm()
                    .bg(if is_last { rgb(0x1b1e2b) } else { rgb(0x0f111a) })
                    .hover(|s| s.bg(rgb(0x23263a)).cursor_pointer())
                    .text_xs()
                    .text_color(if is_last { rgb(0xe7e7ea) } else { rgb(0x9aa2c8) })
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
                            .text_color(rgb(0x50567a))
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
                div()
                    .id("editor-rename")
                    .px_2()
                    .py_1()
                    .rounded_md()
                    .bg(rgb(0x1b1e2b))
                    .hover(|s| s.bg(rgb(0x23263a)).cursor_pointer())
                    .text_xs()
                    .text_color(rgb(0xcdd6f4))
                    .on_click(cx.listener(|this, _event, _window, cx| {
                        this.open_page_dialog(PageDialogMode::Rename, cx);
                    }))
                    .child("Rename"),
            )
            .child(
                div()
                    .id("editor-split")
                    .px_2()
                    .py_1()
                    .rounded_md()
                    .bg(rgb(0x1b1e2b))
                    .hover(|s| s.bg(rgb(0x23263a)).cursor_pointer())
                    .text_xs()
                    .text_color(rgb(0xcdd6f4))
                    .on_click(cx.listener(|this, _event, _window, cx| {
                        this.toggle_split_pane(cx);
                    }))
                    .child(if self.secondary_pane.is_some() {
                        "Close split"
                    } else {
                        "Split"
                    }),
            );

        if self.secondary_pane.is_some() {
            actions = actions.child(
                div()
                    .id("editor-duplicate")
                    .px_2()
                    .py_1()
                    .rounded_md()
                    .bg(rgb(0x1b1e2b))
                    .hover(|s| s.bg(rgb(0x23263a)).cursor_pointer())
                    .text_xs()
                    .text_color(rgb(0xcdd6f4))
                    .on_click(cx.listener(|this, _event, _window, cx| {
                        this.copy_primary_to_secondary(cx);
                    }))
                    .child("Duplicate"),
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
        let mut toggle = div()
            .id("backlinks-toggle")
            .px_2()
            .py_1()
            .rounded_md()
            .bg(if is_open { rgb(0x22314d) } else { rgb(0x1b1e2b) })
            .hover(|s| s.bg(rgb(0x2a3a5c)).cursor_pointer())
            .text_xs()
            .text_color(rgb(0xcdd6f4))
            .on_click(cx.listener(|this, _event, _window, cx| {
                this.backlinks_open = !this.backlinks_open;
                cx.notify();
            }))
            .child(if is_open { "Hide backlinks" } else { "Show backlinks" });

        if total > 0 {
            toggle = toggle.child(
                div()
                    .ml_2()
                    .text_xs()
                    .text_color(rgb(0x9aa2c8))
                    .child(format!("{total}")),
            );
        }

        toggle.into_any_element()
    }

    fn render_selection_toolbar_for_pane(
        &mut self,
        pane: EditorPane,
        cx: &mut Context<Self>,
    ) -> Option<gpui::AnyElement> {
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
                .bg(rgb(0x11131f))
                .border_1()
                .border_color(rgb(0x23263a))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .child(
                            div()
                                .text_xs()
                                .text_color(rgb(0x9aa2c8))
                                .child("Selection"),
                        )
                        .child(
                            div()
                                .id(format!("{id_prefix}-duplicate"))
                                .px_2()
                                .py_1()
                                .rounded_md()
                                .bg(rgb(0x1b1e2b))
                                .hover(|s| s.bg(rgb(0x23263a)).cursor_pointer())
                                .text_xs()
                                .text_color(rgb(0xcdd6f4))
                                .on_click(cx.listener(move |this, _event, window, cx| {
                                    this.set_active_pane(pane, cx);
                                    this.duplicate_selection_in_pane(pane, window, cx);
                                }))
                                .child("Duplicate"),
                        )
                        .child(
                            div()
                                .id(format!("{id_prefix}-delete"))
                                .px_2()
                                .py_1()
                                .rounded_md()
                                .bg(rgb(0x1b1e2b))
                                .hover(|s| s.bg(rgb(0x23263a)).cursor_pointer())
                                .text_xs()
                                .text_color(rgb(0xcdd6f4))
                                .on_click(cx.listener(move |this, _event, _window, cx| {
                                    this.set_active_pane(pane, cx);
                                    this.delete_selection_in_pane(pane, cx);
                                }))
                                .child("Delete"),
                        )
                        .child(
                            div()
                                .id(format!("{id_prefix}-indent"))
                                .px_2()
                                .py_1()
                                .rounded_md()
                                .bg(rgb(0x1b1e2b))
                                .hover(|s| s.bg(rgb(0x23263a)).cursor_pointer())
                                .text_xs()
                                .text_color(rgb(0xcdd6f4))
                                .on_click(cx.listener(move |this, _event, _window, cx| {
                                    this.set_active_pane(pane, cx);
                                    this.indent_selection_in_pane(pane, cx);
                                }))
                                .child("Indent"),
                        )
                        .child(
                            div()
                                .id(format!("{id_prefix}-outdent"))
                                .px_2()
                                .py_1()
                                .rounded_md()
                                .bg(rgb(0x1b1e2b))
                                .hover(|s| s.bg(rgb(0x23263a)).cursor_pointer())
                                .text_xs()
                                .text_color(rgb(0xcdd6f4))
                                .on_click(cx.listener(move |this, _event, _window, cx| {
                                    this.set_active_pane(pane, cx);
                                    this.outdent_selection_in_pane(pane, cx);
                                }))
                                .child("Outdent"),
                        )
                        .child(
                            div()
                                .id(format!("{id_prefix}-move-up"))
                                .px_2()
                                .py_1()
                                .rounded_md()
                                .bg(rgb(0x1b1e2b))
                                .hover(|s| s.bg(rgb(0x23263a)).cursor_pointer())
                                .text_xs()
                                .text_color(rgb(0xcdd6f4))
                                .on_click(cx.listener(move |this, _event, window, cx| {
                                    this.set_active_pane(pane, cx);
                                    this.move_selection_in_pane(pane, -1, window, cx);
                                }))
                                .child("Move up"),
                        )
                        .child(
                            div()
                                .id(format!("{id_prefix}-move-down"))
                                .px_2()
                                .py_1()
                                .rounded_md()
                                .bg(rgb(0x1b1e2b))
                                .hover(|s| s.bg(rgb(0x23263a)).cursor_pointer())
                                .text_xs()
                                .text_color(rgb(0xcdd6f4))
                                .on_click(cx.listener(move |this, _event, window, cx| {
                                    this.set_active_pane(pane, cx);
                                    this.move_selection_in_pane(pane, 1, window, cx);
                                }))
                                .child("Move down"),
                        )
                        .child(
                            div()
                                .id(format!("{id_prefix}-clear"))
                                .px_2()
                                .py_1()
                                .rounded_md()
                                .bg(rgb(0x1b1e2b))
                                .hover(|s| s.bg(rgb(0x23263a)).cursor_pointer())
                                .text_xs()
                                .text_color(rgb(0xcdd6f4))
                                .on_click(cx.listener(move |this, _event, _window, cx| {
                                    this.clear_selection_for_pane(pane);
                                    cx.notify();
                                }))
                                .child("Clear"),
                        ),
                )
                .into_any_element(),
        )
    }

    fn render_slash_menu(&mut self, cx: &mut Context<Self>) -> Option<gpui::AnyElement> {
        if !self.slash_menu.open {
            return None;
        }

        let mut menu = div()
            .absolute()
            .top(px(72.0))
            .left(px(24.0))
            .w(px(220.0))
            .rounded_md()
            .bg(rgb(0x10121b))
            .border_1()
            .border_color(rgb(0x23263a))
            .child(
                div()
                    .px_3()
                    .py_2()
                    .text_xs()
                    .text_color(rgb(0x9aa2c8))
                    .child("Commands"),
            );

        for (id, label) in SLASH_COMMANDS.iter().copied() {
            menu = menu.child(
                div()
                    .id(format!("slash-{id}"))
                    .px_3()
                    .py_2()
                    .text_sm()
                    .text_color(rgb(0xe7e7ea))
                    .hover(|s| s.bg(rgb(0x1b1e2b)).cursor_pointer())
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

        let active_block_text = self
            .editor
            .as_ref()
            .map(|editor| editor.active().text.clone())
            .unwrap_or_default();

        let has_page_backlinks = !self.backlinks.is_empty();
        let has_block_backlinks = !self.block_backlinks.is_empty();

        let mut panel = div()
            .id("backlinks-panel")
            .w(px(320.0))
            .h_full()
            .border_l_1()
            .border_color(rgb(0x1b1e2b))
            .bg(rgb(0x0f111a))
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
                    .border_color(rgb(0x1b1e2b))
                    .child(
                        div()
                            .text_sm()
                            .text_color(rgb(0xe7e7ea))
                            .font_weight(gpui::FontWeight::SEMIBOLD)
                            .child("Backlinks"),
                    )
                    .child(
                        div()
                            .id("backlinks-close")
                            .px_2()
                            .py_1()
                            .rounded_md()
                            .bg(rgb(0x1b1e2b))
                            .hover(|s| s.bg(rgb(0x23263a)).cursor_pointer())
                            .text_xs()
                            .text_color(rgb(0xcdd6f4))
                            .on_click(cx.listener(|this, _event, _window, cx| {
                                this.backlinks_open = false;
                                cx.notify();
                            }))
                            .child("Close"),
                    ),
            );

        let mut body = div()
            .id("backlinks-body")
            .flex_1()
            .min_h_0()
            .overflow_scroll();

        if has_page_backlinks {
            body = body.child(
                div()
                    .px_3()
                    .pt_3()
                    .text_xs()
                    .text_color(rgb(0x9aa2c8))
                    .child("Page backlinks"),
            );
            body = body.child(div().h(px(6.0)));
            body = body.children(self.backlinks.iter().cloned().map(|entry| {
                let snippet = format_snippet(&entry.text, 90);
                div()
                    .id(format!("backlinks-page-{}", entry.block_uid))
                    .px_3()
                    .py_2()
                    .cursor_pointer()
                    .hover(|s| s.bg(rgb(0x1b1e2b)))
                    .child(
                        div()
                            .text_sm()
                            .text_color(rgb(0xe7e7ea))
                            .child(snippet),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(rgb(0x9aa2c8))
                            .child(entry.page_title.clone()),
                    )
                    .on_click(cx.listener(move |this, _event, window, cx| {
                        this.open_page_and_focus_block(
                            &entry.page_uid,
                            &entry.block_uid,
                            window,
                            cx,
                        );
                    }))
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
                    .text_color(rgb(0x9aa2c8))
                    .child("Block backlinks"),
            );
            body = body.child(
                div()
                    .px_3()
                    .pt_1()
                    .text_xs()
                    .text_color(rgb(0x7f87ad))
                    .child(format!("Linked to {block_label}")),
            );
            body = body.children(self.block_backlinks.iter().cloned().map(|entry| {
                let snippet = format_snippet(&entry.text, 90);
                div()
                    .id(format!("backlinks-block-{}", entry.block_uid))
                    .px_3()
                    .py_2()
                    .cursor_pointer()
                    .hover(|s| s.bg(rgb(0x1b1e2b)))
                    .child(
                        div()
                            .text_sm()
                            .text_color(rgb(0xe7e7ea))
                            .child(snippet),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(rgb(0x9aa2c8))
                            .child(entry.page_title.clone()),
                    )
                    .on_click(cx.listener(move |this, _event, window, cx| {
                        this.open_page_and_focus_block(
                            &entry.page_uid,
                            &entry.block_uid,
                            window,
                            cx,
                        );
                    }))
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
        let list = list(list_state, cx.processor(|this, ix: usize, window, cx| {
            this.render_block_row_for_pane(EditorPane::Secondary, ix, window, cx)
                .into_any_element()
        }))
        .flex_1()
        .min_h_0()
        .size_full();
        let breadcrumbs = self.build_breadcrumb_items_for_pane(EditorPane::Secondary);
        let is_active = self.active_pane == EditorPane::Secondary;

        let mut title_group = div()
            .flex()
            .flex_col()
            .gap_1()
            .child(
                div()
                    .text_sm()
                    .text_color(rgb(0xe7e7ea))
                    .font_weight(gpui::FontWeight::SEMIBOLD)
                    .child(title),
            )
            .child(
                div()
                    .text_xs()
                    .text_color(rgb(0x9aa2c8))
                    .child(format!("{block_count} blocks")),
            );

        if breadcrumbs.len() > 1 {
            let mut trail = div()
                .id("secondary-breadcrumbs")
                .flex()
                .items_center()
                .gap_1();
            for (idx, item) in breadcrumbs.iter().enumerate() {
                let is_last = idx == breadcrumbs.len() - 1;
                let uid = item.uid.clone();
                let label = item.label.clone();
                let mut crumb = div()
                    .id(format!("secondary-crumb-{}", uid))
                    .px_1()
                    .py(px(1.0))
                    .rounded_sm()
                    .bg(if is_last { rgb(0x1b1e2b) } else { rgb(0x0f111a) })
                    .hover(|s| s.bg(rgb(0x23263a)).cursor_pointer())
                    .text_xs()
                    .text_color(if is_last { rgb(0xe7e7ea) } else { rgb(0x9aa2c8) })
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
                            .text_color(rgb(0x50567a))
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

        if let Some(toolbar) = self.render_selection_toolbar_for_pane(EditorPane::Secondary, cx) {
            body = body.child(toolbar);
        }

        body = body.child(list);

        Some(
            div()
                .id("secondary-pane")
                .w(px(360.0))
                .h_full()
                .border_l_1()
                .border_color(if is_active { rgb(0x2d6cdf) } else { rgb(0x1b1e2b) })
                .bg(rgb(0x0f111a))
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
                        .border_color(rgb(0x1b1e2b))
                        .child(title_group)
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap_2()
                                .child(
                                    div()
                                        .id("secondary-open")
                                        .px_2()
                                        .py_1()
                                        .rounded_md()
                                        .bg(rgb(0x1b1e2b))
                                        .hover(|s| s.bg(rgb(0x23263a)).cursor_pointer())
                                        .text_xs()
                                        .text_color(rgb(0xcdd6f4))
                                        .on_click(cx.listener(move |this, _event, window, cx| {
                                            this.copy_secondary_to_primary(window, cx);
                                        }))
                                        .child("Open"),
                                )
                                .child(
                                    div()
                                        .id("secondary-swap")
                                        .px_2()
                                        .py_1()
                                        .rounded_md()
                                        .bg(rgb(0x1b1e2b))
                                        .hover(|s| s.bg(rgb(0x23263a)).cursor_pointer())
                                        .text_xs()
                                        .text_color(rgb(0xcdd6f4))
                                        .on_click(cx.listener(|this, _event, _window, cx| {
                                            this.swap_panes(cx);
                                        }))
                                        .child("Swap"),
                                )
                                .child(
                                    div()
                                        .id("secondary-close")
                                        .px_2()
                                        .py_1()
                                        .rounded_md()
                                        .bg(rgb(0x1b1e2b))
                                        .hover(|s| s.bg(rgb(0x23263a)).cursor_pointer())
                                        .text_xs()
                                        .text_color(rgb(0xcdd6f4))
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
                                                cx,
                                            );
                                            cx.notify();
                                        }))
                                        .child("Close"),
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
        let content = if show_input {
            self.block_input.clone().into_any_element()
        } else {
            div()
                .text_sm()
                .text_color(rgb(0xe7e7ea))
                .child(if block.text.is_empty() { " " } else { &block.text }.to_string())
                .into_any_element()
        };
        let actions = if show_input {
            self.render_block_actions_for_pane(pane, ix, cx)
                .into_any_element()
        } else {
            div().into_any_element()
        };

        let base_bg = if pane == EditorPane::Secondary {
            rgb(0x0f111a)
        } else {
            rgb(0x0b0c10)
        };

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
                rgb(0x1f2a44)
            } else if is_active {
                rgb(0x151826)
            } else if is_highlighted {
                rgb(0x1f2a44)
            } else {
                base_bg
            })
            .hover(|s| s.bg(rgb(0x151826)))
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
                    .bg(rgb(0x2c324c)),
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
                div()
                    .id(format!("{id_prefix}-insert-{ix}"))
                    .px_2()
                    .py_1()
                    .rounded_md()
                    .bg(rgb(0x1b1e2b))
                    .hover(|s| s.bg(rgb(0x23263a)).cursor_pointer())
                    .text_xs()
                    .text_color(rgb(0xcdd6f4))
                    .on_click(cx.listener(move |this, _event, window, cx| {
                        this.set_active_pane(pane, cx);
                        this.insert_block_after_in_pane(pane, insert_ix, window, cx);
                    }))
                    .child("Insert"),
            )
            .child(
                div()
                    .id(format!("{id_prefix}-review-{ix}"))
                    .px_2()
                    .py_1()
                    .rounded_md()
                    .bg(rgb(0x1b1e2b))
                    .hover(|s| s.bg(rgb(0x23263a)).cursor_pointer())
                    .text_xs()
                    .text_color(rgb(0xcdd6f4))
                    .on_click(cx.listener(move |this, _event, _window, cx| {
                        this.set_active_pane(pane, cx);
                        this.add_review_from_block_in_pane(pane, review_ix, cx);
                    }))
                    .child("Review"),
            )
            .child(
                div()
                    .id(format!("{id_prefix}-link-{ix}"))
                    .px_2()
                    .py_1()
                    .rounded_md()
                    .bg(rgb(0x1b1e2b))
                    .hover(|s| s.bg(rgb(0x23263a)).cursor_pointer())
                    .text_xs()
                    .text_color(rgb(0xcdd6f4))
                    .on_click(cx.listener(move |this, _event, window, cx| {
                        this.set_active_pane(pane, cx);
                        this.link_block_to_page_in_pane(pane, link_ix, window, cx);
                    }))
                    .child("Link"),
            )
            .child(
                div()
                    .id(format!("{id_prefix}-duplicate-{ix}"))
                    .px_2()
                    .py_1()
                    .rounded_md()
                    .bg(rgb(0x1b1e2b))
                    .hover(|s| s.bg(rgb(0x23263a)).cursor_pointer())
                    .text_xs()
                    .text_color(rgb(0xcdd6f4))
                    .on_click(cx.listener(move |this, _event, window, cx| {
                        this.set_active_pane(pane, cx);
                        this.duplicate_block_at_in_pane(pane, duplicate_ix, window, cx);
                    }))
                    .child("Duplicate"),
            )
    }

    fn render_capture_pane(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .flex_1()
            .h_full()
            .px_6()
            .py_4()
            .child(
                div()
                    .text_lg()
                    .text_color(rgb(0xe7e7ea))
                    .font_weight(gpui::FontWeight::SEMIBOLD)
                    .child("Quick Capture"),
            )
            .child(div().h(px(12.0)))
            .child(self.capture_input.clone())
            .child(div().h(px(12.0)))
            .child(
                div()
                    .id("capture-submit")
                    .px_2()
                    .py_1()
                    .rounded_md()
                    .bg(rgb(0x1b1e2b))
                    .hover(|s| s.bg(rgb(0x23263a)).cursor_pointer())
                    .text_xs()
                    .text_color(rgb(0xcdd6f4))
                    .on_click(cx.listener(|this, _event, window, cx| {
                        this.add_capture(window, cx);
                    }))
                    .child("Capture"),
            )
    }

    fn render_review_pane(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let mut body = div()
            .flex_1()
            .h_full()
            .px_6()
            .py_4()
            .child(
                div()
                    .text_lg()
                    .text_color(rgb(0xe7e7ea))
                    .font_weight(gpui::FontWeight::SEMIBOLD)
                    .child("Review Queue"),
            )
            .child(div().h(px(12.0)));

        if self.review_items.is_empty() {
            body = body.child(
                div()
                    .text_sm()
                    .text_color(rgb(0x9aa2c8))
                    .child("No review items due yet."),
            );
        } else {
            for item in self.review_items.iter() {
                let block_uid = item.block_uid.clone();
                let page_uid = item.page_uid.clone();
                let item_id = item.id;
                let snippet = format_snippet(&item.text, 80);
                let page_title = item.page_title.clone();

                body = body.child(
                    div()
                        .rounded_md()
                        .bg(rgb(0x10121b))
                        .border_1()
                        .border_color(rgb(0x23263a))
                        .px_3()
                        .py_3()
                        .mb_3()
                        .child(
                            div()
                                .text_sm()
                                .text_color(rgb(0xe7e7ea))
                                .child(snippet),
                        )
                        .child(
                            div()
                                .text_xs()
                                .text_color(rgb(0x9aa2c8))
                                .child(page_title),
                        )
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap_2()
                                .pt_2()
                                .child(
                                    div()
                                        .id(format!("review-open-{item_id}"))
                                        .px_2()
                                        .py_1()
                                        .rounded_md()
                                        .bg(rgb(0x1b1e2b))
                                        .hover(|s| s.bg(rgb(0x23263a)).cursor_pointer())
                                        .text_xs()
                                        .text_color(rgb(0xcdd6f4))
                                        .on_click(cx.listener(
                                            move |this, _event, window, cx| {
                                                this.open_page_and_focus_block(
                                                    &page_uid,
                                                    &block_uid,
                                                    window,
                                                    cx,
                                                );
                                            },
                                        ))
                                        .child("Open"),
                                )
                                .child(
                                    div()
                                        .id(format!("review-done-{item_id}"))
                                        .px_2()
                                        .py_1()
                                        .rounded_md()
                                        .bg(rgb(0x1b1e2b))
                                        .hover(|s| s.bg(rgb(0x23263a)).cursor_pointer())
                                        .text_xs()
                                        .text_color(rgb(0xcdd6f4))
                                        .on_click(cx.listener(move |this, _event, _window, cx| {
                                            this.review_mark_done(item_id, cx);
                                        }))
                                        .child("Done"),
                                )
                                .child(
                                    div()
                                        .id(format!("review-snooze-{item_id}"))
                                        .px_2()
                                        .py_1()
                                        .rounded_md()
                                        .bg(rgb(0x1b1e2b))
                                        .hover(|s| s.bg(rgb(0x23263a)).cursor_pointer())
                                        .text_xs()
                                        .text_color(rgb(0xcdd6f4))
                                        .on_click(cx.listener(move |this, _event, _window, cx| {
                                            this.review_snooze_day(item_id, cx);
                                        }))
                                        .child("Snooze"),
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
                        .bg(rgb(0x10121b))
                        .border_1()
                        .border_color(rgb(0x23263a))
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .justify_between()
                                .child(
                                    div()
                                        .text_sm()
                                        .text_color(rgb(0xe7e7ea))
                                        .font_weight(gpui::FontWeight::SEMIBOLD)
                                        .child(title),
                                )
                                .child(
                                    div()
                                        .id("page-dialog-close")
                                        .px_2()
                                        .py_1()
                                        .rounded_md()
                                        .bg(rgb(0x1b1e2b))
                                        .hover(|s| s.bg(rgb(0x23263a)).cursor_pointer())
                                        .text_xs()
                                        .text_color(rgb(0xcdd6f4))
                                        .on_click(cx.listener(|this, _event, _window, cx| {
                                            this.close_page_dialog(cx);
                                        }))
                                        .child("Close"),
                                ),
                        )
                        .child(div().h(px(8.0)))
                        .child(self.page_dialog_input.clone())
                        .child(div().h(px(8.0)))
                        .child(
                            div()
                                .id("page-dialog-confirm")
                                .px_2()
                                .py_1()
                                .rounded_md()
                                .bg(rgb(0x1b1e2b))
                                .hover(|s| s.bg(rgb(0x23263a)).cursor_pointer())
                                .text_xs()
                                .text_color(rgb(0xcdd6f4))
                                .on_click(cx.listener(|this, _event, _window, cx| {
                                    this.confirm_page_dialog(cx);
                                }))
                                .child(confirm_label),
                        ),
                )
                .into_any_element(),
        )
    }

    fn render_vault_dialog(&mut self, cx: &mut Context<Self>) -> Option<gpui::AnyElement> {
        if !self.vault_dialog_open {
            return None;
        }

        let vaults = self.vaults.clone();
        let active_id = self.active_vault_id.clone();
        let error = self.vault_dialog_error.clone();

        let mut list = div().flex().flex_col().gap_2().pb_3();
        if vaults.is_empty() {
            list = list.child(
                div()
                    .text_xs()
                    .text_color(rgb(0x9aa2c8))
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
                        .bg(if is_active { rgb(0x1f2a44) } else { rgb(0x0f111a) })
                        .hover(|s| s.bg(rgb(0x151826)).cursor_pointer())
                        .text_sm()
                        .text_color(if is_active { rgb(0xe7e7ea) } else { rgb(0x9aa2c8) })
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
                    .text_color(rgb(0xf38ba8))
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
                        .bg(rgb(0x10121b))
                        .border_1()
                        .border_color(rgb(0x23263a))
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .justify_between()
                                .child(
                                    div()
                                        .text_sm()
                                        .text_color(rgb(0xe7e7ea))
                                        .font_weight(gpui::FontWeight::SEMIBOLD)
                                        .child("Vaults"),
                                )
                                .child(
                                    div()
                                        .id("vault-dialog-close")
                                        .px_2()
                                        .py_1()
                                        .rounded_md()
                                        .bg(rgb(0x1b1e2b))
                                        .hover(|s| s.bg(rgb(0x23263a)).cursor_pointer())
                                        .text_xs()
                                        .text_color(rgb(0xcdd6f4))
                                        .on_click(cx.listener(|this, _event, _window, cx| {
                                            this.close_vault_dialog(cx);
                                        }))
                                        .child("Close"),
                                ),
                        )
                        .child(div().h(px(8.0)))
                        .child(list)
                        .child(
                            div()
                                .text_sm()
                                .text_color(rgb(0xe7e7ea))
                                .font_weight(gpui::FontWeight::SEMIBOLD)
                                .child("Create new vault"),
                        )
                        .child(div().h(px(8.0)))
                        .child(
                            div()
                                .text_xs()
                                .text_color(rgb(0x9aa2c8))
                                .child("Name"),
                        )
                        .child(self.vault_dialog_name_input.clone())
                        .child(div().h(px(8.0)))
                        .child(
                            div()
                                .text_xs()
                                .text_color(rgb(0x9aa2c8))
                                .child("Path"),
                        )
                        .child(self.vault_dialog_path_input.clone())
                        .child(div().h(px(8.0)))
                        .child(
                            div()
                                .id("vault-create")
                                .px_2()
                                .py_1()
                                .rounded_md()
                                .bg(rgb(0x1b1e2b))
                                .hover(|s| s.bg(rgb(0x23263a)).cursor_pointer())
                                .text_xs()
                                .text_color(rgb(0xcdd6f4))
                                .on_click(cx.listener(|this, _event, _window, cx| {
                                    this.create_vault(cx);
                                }))
                                .child("Create vault"),
                        ),
                )
                .into_any_element(),
        )
    }

    fn render_command_palette(&mut self, cx: &mut Context<Self>) -> Option<gpui::AnyElement> {
        if !self.palette_open {
            return None;
        }

        let commands = self.filtered_palette_items();
        let active_ix = self.palette_index;

        let mut list = div().flex().flex_col().gap_1();

        if commands.is_empty() {
            list = list.child(
                div()
                    .text_xs()
                    .text_color(rgb(0x9aa2c8))
                    .child("No matches"),
            );
        } else {
            for (idx, item) in commands.iter().enumerate() {
                let is_active = idx == active_ix;
                let label = item.label.clone();
                let hint = item.hint.clone();

                let mut row = div()
                    .id(format!("palette-item-{}", item.id))
                    .px_3()
                    .py_2()
                    .rounded_md()
                    .bg(if is_active { rgb(0x1f2a44) } else { rgb(0x0f111a) })
                    .hover(|s| s.bg(rgb(0x151826)).cursor_pointer())
                    .flex()
                    .items_center()
                    .justify_between()
                    .child(
                        div()
                            .text_sm()
                            .text_color(rgb(0xe7e7ea))
                            .child(label),
                    );

                if let Some(hint) = hint {
                    row = row.child(
                        div()
                            .text_xs()
                            .text_color(rgb(0x9aa2c8))
                            .child(hint),
                    );
                }

                list = list.child(
                    row.on_click(cx.listener(move |this, _event, window, cx| {
                        this.run_palette_command(idx, window, cx);
                    })),
                );
            }
        }

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
                        .bg(rgb(0x10121b))
                        .border_1()
                        .border_color(rgb(0x23263a))
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .justify_between()
                                .child(
                                    div()
                                        .text_sm()
                                        .text_color(rgb(0xe7e7ea))
                                        .font_weight(gpui::FontWeight::SEMIBOLD)
                                        .child("Command palette"),
                                )
                                .child(
                                    div()
                                        .id("command-palette-close")
                                        .px_2()
                                        .py_1()
                                        .rounded_md()
                                        .bg(rgb(0x1b1e2b))
                                        .hover(|s| s.bg(rgb(0x23263a)).cursor_pointer())
                                        .text_xs()
                                        .text_color(rgb(0xcdd6f4))
                                        .on_click(cx.listener(|this, _event, _window, cx| {
                                            this.close_command_palette(cx);
                                        }))
                                        .child("Close"),
                                ),
                        )
                        .child(div().h(px(8.0)))
                        .child(self.palette_input.clone())
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
            .bg(rgb(0x0b0c10))
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
