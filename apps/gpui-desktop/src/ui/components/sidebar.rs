use crate::app::prelude::*;
use crate::app::store::helpers::format_snippet;
use crate::app::store::*;

impl AppStore {
    pub(super) fn render_sidebar(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let active_uid = self
            .editor
            .active_page
            .as_ref()
            .map(|page| page.uid.clone());
        let has_query = !self.editor.sidebar_search_query.trim().is_empty();
        let list = if has_query {
            self.render_search_results(cx).into_any_element()
        } else {
            self.render_pages_list(cx, active_uid.clone())
        };
        let theme = cx.theme();

        let mut sidebar = div()
            .w(px(272.0))
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
                            .icon(IconName::Plus)
                            .on_click(cx.listener(|this, _event, _window, cx| {
                                this.open_page_dialog(PageDialogMode::Create, cx);
                            })),
                    ),
            )
            .child(
                div().px_3().pb_2().child(
                    Input::new(&self.editor.sidebar_search_input)
                        .small()
                        .cleanable(true)
                        .prefix(
                            Icon::new(IconName::Search)
                                .small()
                                .text_color(theme.muted_foreground),
                        ),
                ),
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
        if self.editor.pages.is_empty() {
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
            self.editor.pages.len()
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
                        let page = this.editor.pages[ix].clone();
                        let is_active = active_uid.as_ref().is_some_and(|uid| uid == &page.uid);
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
                        let hover_bg = theme.list_hover;

                        div()
                            .id(page.uid.clone())
                            .mx_2()
                            .px_2()
                            .py_2()
                            .cursor_pointer()
                            .rounded_md()
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

        if self.editor.search_pages.is_empty() && self.editor.search_blocks.is_empty() {
            return content.child(
                div()
                    .px_3()
                    .py_3()
                    .text_sm()
                    .text_color(theme.muted_foreground)
                    .child("No results"),
            );
        }

        if !self.editor.search_pages.is_empty() {
            content = content.child(
                div()
                    .px_3()
                    .pt_3()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .child("Pages"),
            );
            content = content.children(self.editor.search_pages.iter().cloned().map(|page| {
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
                                            .icon(IconName::ArrowRight)
                                            .on_click(cx.listener(
                                                move |this, _event, window, cx| {
                                                    this.on_click_page(
                                                        open_uid.clone(),
                                                        window,
                                                        cx,
                                                    );
                                                },
                                            )),
                                    )
                                    .child(
                                        Button::new(format!("search-split-{}", page_uid))
                                            .label("Split")
                                            .xsmall()
                                            .ghost()
                                            .icon(IconName::PanelRightOpen)
                                            .on_click(cx.listener(
                                                move |this, _event, _window, cx| {
                                                    this.open_secondary_pane_for_page(
                                                        &split_uid, cx,
                                                    );
                                                },
                                            )),
                                    ),
                            ),
                    )
            }));
        }

        if !self.editor.search_blocks.is_empty() {
            content = content.child(
                div()
                    .px_3()
                    .pt_3()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .child("Blocks"),
            );
            content = content.children(self.editor.search_blocks.iter().cloned().map(|block| {
                let snippet = format_snippet(&block.text, 80);
                div()
                    .id(format!("search-block-{}", block.block_uid))
                    .px_3()
                    .py_2()
                    .cursor_pointer()
                    .hover(move |s| s.bg(list_hover))
                    .child(div().text_sm().text_color(theme.foreground).child(snippet))
                    .child(
                        div()
                            .text_xs()
                            .text_color(theme.muted_foreground)
                            .child(block.page_title.clone()),
                    )
                    .on_click(cx.listener(move |this, _event, window, cx| {
                        this.open_page_and_focus_block(
                            &block.page_uid,
                            &block.block_uid,
                            window,
                            cx,
                        );
                    }))
            }));
        }

        content
    }

    fn render_sidebar_references(&mut self, cx: &mut Context<Self>) -> Option<gpui::AnyElement> {
        if self.editor.active_page.is_none() {
            return None;
        }

        let theme = cx.theme();
        let references = self.editor.unlinked_references.clone();
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
            .gap_1()
            .px_3()
            .py_2()
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
                .child(div().text_xs().text_color(theme.foreground).child(snippet))
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
}
