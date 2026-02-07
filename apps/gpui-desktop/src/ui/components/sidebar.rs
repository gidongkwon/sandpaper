use crate::app::prelude::*;
use crate::app::store::helpers::format_snippet;
use crate::app::store::*;
use crate::ui::tokens;
use gpui::{ease_in_out, Animation, AnimationExt as _};

impl AppStore {
    pub(super) fn render_sidebar(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let collapsed = self.settings.sidebar_collapsed;
        let sidebar_width = self.settings.sidebar_width;
        let epoch = self.ui.sidebar_collapse_epoch;
        let animating = epoch > 0;

        // Target and source widths for animation
        let rail_w = f32::from(tokens::SIDEBAR_RAIL_WIDTH);
        let full_w = sidebar_width;

        // Build the rail content (always rendered, visibility controlled by opacity)
        let rail_content = self.render_sidebar_rail_content(cx);

        // Build the full sidebar content (always rendered, visibility controlled by opacity)
        let full_content = self.render_sidebar_full_content(cx);

        let theme = cx.theme();
        let sidebar_bg = theme.sidebar;
        let sidebar_border = theme.sidebar_border;

        // Rail buttons layer (absolute, always rendered)
        let rail_layer = div()
            .absolute()
            .top_0()
            .left_0()
            .w(tokens::SIDEBAR_RAIL_WIDTH)
            .h_full()
            .flex()
            .flex_col()
            .items_center()
            .pt_3()
            .gap_2()
            .when(!animating && !collapsed, |el| el.opacity(0.0))
            .when(!animating && collapsed, |el| el.opacity(1.0))
            .children(rail_content);

        // Full sidebar content layer
        let content_layer = div()
            .w(px(full_w))
            .flex_1()
            .min_h_0()
            .flex()
            .flex_col()
            .when(!animating && collapsed, |el| el.opacity(0.0))
            .when(!animating && !collapsed, |el| el.opacity(1.0))
            .children(full_content);

        // Outer container
        let container = div()
            .id("sidebar-animated")
            .h_full()
            .bg(sidebar_bg)
            .border_r_1()
            .border_color(sidebar_border)
            .overflow_hidden()
            .flex()
            .flex_col()
            .relative()
            .when(collapsed, |el| el.w(tokens::SIDEBAR_RAIL_WIDTH))
            .when(!collapsed, |el| el.w(px(sidebar_width)));

        if animating {
            // Animated: apply width + opacity transitions triggered by epoch change
            container
                .child(rail_layer.with_animation(
                    format!("rail-opacity-{epoch}"),
                    Animation::new(tokens::DURATION_NORMAL).with_easing(ease_in_out),
                    move |el, delta| {
                        let opacity = if collapsed { delta } else { 1.0 - delta };
                        el.opacity(opacity)
                    },
                ))
                .child(content_layer.with_animation(
                    format!("sidebar-content-opacity-{epoch}"),
                    Animation::new(tokens::DURATION_NORMAL).with_easing(ease_in_out),
                    move |el, delta| {
                        let opacity = if collapsed { 1.0 - delta } else { delta };
                        el.opacity(opacity)
                    },
                ))
                .with_animation(
                    format!("sidebar-width-{epoch}"),
                    Animation::new(tokens::DURATION_NORMAL).with_easing(ease_in_out),
                    move |el, delta| {
                        let (from_w, to_w) = if collapsed {
                            (full_w, rail_w)
                        } else {
                            (rail_w, full_w)
                        };
                        let w = from_w + (to_w - from_w) * delta;
                        el.w(px(w))
                    },
                )
                .into_any_element()
        } else {
            // Static: no animation on initial render
            container
                .child(rail_layer)
                .child(content_layer)
                .into_any_element()
        }
    }

    /// Renders the full sidebar content elements (search bar, page list, references).
    /// Returns a Vec of AnyElement to be used as children.
    fn render_sidebar_full_content(&mut self, cx: &mut Context<Self>) -> Vec<gpui::AnyElement> {
        let active_uid = self
            .editor
            .active_page
            .as_ref()
            .map(|page| page.uid.clone());
        let has_query = !self.editor.sidebar_search_query.trim().is_empty();
        let list = if has_query {
            self.render_search_results(cx).into_any_element()
        } else {
            self.render_pages_panel(cx, active_uid.clone())
        };
        let theme = cx.theme();

        let mut elements = Vec::new();

        elements.push(
            div()
                .px_3()
                .pt_3()
                .pb_2()
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .child(
                            div().flex_1().min_w_0().child(
                                Input::new(&self.editor.sidebar_search_input)
                                    .small()
                                    .cleanable(true)
                                    .prefix(
                                        Icon::new(SandpaperIcon::Search)
                                            .small()
                                            .text_color(theme.muted_foreground),
                                    ),
                            ),
                        )
                        .child(
                            Button::new("new-page")
                                .xsmall()
                                .ghost()
                                .icon(SandpaperIcon::Add)
                                .tooltip(format!(
                                    "New page ({})",
                                    shortcut_hint(ShortcutSpec::new("cmd-n", "ctrl-n"))
                                ))
                                .on_click(cx.listener(|this, _event, _window, cx| {
                                    this.open_page_dialog(PageDialogMode::Create, cx);
                                })),
                        ),
                )
                .into_any_element(),
        );

        elements.push(list);

        if let Some(references) = self.render_sidebar_references(cx) {
            elements.push(references);
        }

        elements
    }

    /// Renders the rail button elements (expand, search, new page).
    /// Returns a Vec of AnyElement to be used as children.
    fn render_sidebar_rail_content(&mut self, cx: &mut Context<Self>) -> Vec<gpui::AnyElement> {
        let sidebar_hint = shortcut_hint(ShortcutSpec::new("cmd-b", "ctrl-b"));
        let new_page_hint = shortcut_hint(ShortcutSpec::new("cmd-n", "ctrl-n"));

        vec![
            Button::new("rail-expand")
                .xsmall()
                .ghost()
                .icon(SandpaperIcon::PanelLeftExpand)
                .tooltip(format!("Show sidebar ({sidebar_hint})"))
                .on_click(cx.listener(|this, _event, _window, cx| {
                    this.settings.sidebar_collapsed = false;
                    this.ui.sidebar_collapse_epoch += 1;
                    this.persist_settings();
                    cx.notify();
                }))
                .into_any_element(),
            Button::new("rail-search")
                .xsmall()
                .ghost()
                .icon(SandpaperIcon::Search)
                .tooltip("Search")
                .on_click(cx.listener(|this, _event, window, cx| {
                    this.settings.sidebar_collapsed = false;
                    this.ui.sidebar_collapse_epoch += 1;
                    this.persist_settings();
                    window.focus(&this.editor.sidebar_search_input.focus_handle(cx), cx);
                    cx.notify();
                }))
                .into_any_element(),
            Button::new("rail-new-page")
                .xsmall()
                .ghost()
                .icon(SandpaperIcon::Add)
                .tooltip(format!("New page ({new_page_hint})"))
                .on_click(cx.listener(|this, _event, _window, cx| {
                    this.settings.sidebar_collapsed = false;
                    this.ui.sidebar_collapse_epoch += 1;
                    this.persist_settings();
                    this.open_page_dialog(PageDialogMode::Create, cx);
                    cx.notify();
                }))
                .into_any_element(),
        ]
    }

    fn render_page_row(
        &mut self,
        page: PageRecord,
        is_active: bool,
        cx: &mut Context<Self>,
    ) -> gpui::AnyElement {
        let theme = cx.theme();
        let text_color = if is_active {
            theme.foreground
        } else {
            theme.sidebar_foreground
        };
        let bg = if is_active {
            theme.list_active
        } else {
            theme.sidebar
        };
        let hover_bg = theme.list_hover;
        let label = if page.title.trim().is_empty() {
            "Untitled".to_string()
        } else {
            page.title.clone()
        };

        let row = div()
            .id(page.uid.clone())
            .mx_2()
            .px_3()
            .py(tokens::SPACE_3)
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
                    .text_size(tokens::FONT_BASE)
                    .text_color(text_color)
                    .when(is_active, |this| this.font_weight(gpui::FontWeight::MEDIUM))
                    .child(label),
            )
            .on_click(cx.listener(move |this, _event, window, cx| {
                this.on_click_page(page.uid.clone(), window, cx);
            }));

        row.into_any_element()
    }

    fn render_pages_panel(
        &mut self,
        cx: &mut Context<Self>,
        active_uid: Option<String>,
    ) -> gpui::AnyElement {
        if self.editor.pages_loading {
            use crate::ui::components::skeleton::Skeleton;
            return div()
                .id("pages-list")
                .flex_1()
                .min_h_0()
                .p_2()
                .flex()
                .flex_col()
                .gap_2()
                .child(Skeleton::new(px(180.0), px(COMPACT_ROW_HEIGHT)))
                .child(Skeleton::new(px(140.0), px(COMPACT_ROW_HEIGHT)))
                .child(Skeleton::new(px(200.0), px(COMPACT_ROW_HEIGHT)))
                .child(Skeleton::new(px(160.0), px(COMPACT_ROW_HEIGHT)))
                .child(Skeleton::new(px(120.0), px(COMPACT_ROW_HEIGHT)))
                .into_any_element();
        }

        if self.editor.pages.is_empty() {
            use crate::ui::components::empty_state::EmptyState;
            use gpui_component::IconName;
            let new_page_hint = shortcut_hint(ShortcutSpec::new("cmd-n", "ctrl-n"));
            return div()
                .id("pages-list")
                .flex_1()
                .min_h_0()
                .child(
                    EmptyState::new("No pages yet", "Create your first page to get started.")
                        .icon(IconName::File)
                        .action(
                            format!("New page ({new_page_hint})"),
                            cx.listener(|this, _event, _window, cx| {
                                this.open_page_dialog(PageDialogMode::Create, cx);
                            }),
                        ),
                )
                .into_any_element();
        }

        let muted = cx.theme().muted_foreground;
        let active_uid = active_uid.clone();

        let mut recent_pages: Vec<PageRecord> = Vec::new();
        for uid in self.editor.recent_pages.iter() {
            if let Some(page) = self.editor.pages.iter().find(|page| &page.uid == uid) {
                recent_pages.push(page.clone());
            }
            if recent_pages.len() >= 5 {
                break;
            }
        }

        let item_sizes = Rc::new(vec![
            size(px(0.), px(COMPACT_ROW_HEIGHT));
            self.editor.pages.len()
        ]);

        let active_uid_for_list = active_uid.clone();
        let list = v_virtual_list(
            cx.entity(),
            "pages-list",
            item_sizes,
            move |this, range: std::ops::Range<usize>, _window, cx| {
                range
                    .map(|ix| {
                        let page = this.editor.pages[ix].clone();
                        let is_active = active_uid_for_list
                            .as_ref()
                            .is_some_and(|uid| uid == &page.uid);
                        this.render_page_row(page, is_active, cx)
                    })
                    .collect()
            },
        )
        .flex_1()
        .min_h_0()
        .size_full()
        .into_any_element();

        let mut panel = div().id("pages-panel").flex().flex_col().flex_1().min_h_0();

        if !recent_pages.is_empty() {
            let recent_rows: Vec<gpui::AnyElement> = recent_pages
                .into_iter()
                .map(|page| {
                    let is_active = active_uid.as_ref().is_some_and(|uid| uid == &page.uid);
                    self.render_page_row(page, is_active, cx)
                })
                .collect();
            panel = panel
                .child(
                    div()
                        .px_4()
                        .pt_2()
                        .pb_1()
                        .text_size(tokens::FONT_SM)
                        .font_weight(gpui::FontWeight::MEDIUM)
                        .text_color(muted)
                        .child("RECENT"),
                )
                .children(recent_rows)
                .child(div().h(tokens::SPACE_4));
        }

        panel = panel.child(
            div()
                .px_4()
                .pt_2()
                .pb_1()
                .text_size(tokens::FONT_SM)
                .font_weight(gpui::FontWeight::MEDIUM)
                .text_color(muted)
                .child("ALL PAGES"),
        );

        panel.child(list).into_any_element()
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
            use crate::ui::components::empty_state::EmptyState;
            use gpui_component::IconName;
            return content.child(
                EmptyState::new("No results", "Try a different search term.")
                    .icon(IconName::Search),
            );
        }

        if !self.editor.search_pages.is_empty() {
            content = content.child(
                div()
                    .px_4()
                    .pt_2()
                    .pb_1()
                    .text_size(tokens::FONT_SM)
                    .font_weight(gpui::FontWeight::MEDIUM)
                    .text_color(theme.muted_foreground)
                    .child("PAGES"),
            );
            content = content.children(self.editor.search_pages.iter().cloned().map(|page| {
                let page_uid = page.uid.clone();
                let open_uid = page.uid.clone();
                let split_uid = page.uid.clone();
                div()
                    .id(format!("search-page-{}", page_uid))
                    .px_3()
                    .py(tokens::SPACE_5)
                    .hover(move |s| s.bg(list_hover))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .child(
                                div()
                                    .text_size(tokens::FONT_BASE)
                                    .text_color(theme.foreground)
                                    .child(page.title.clone()),
                            )
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_2()
                                    .opacity(0.0)
                                    .hover(move |s| s.opacity(1.0))
                                    .child(
                                        Button::new(format!("search-open-{}", page_uid))
                                            .xsmall()
                                            .ghost()
                                            .icon(SandpaperIcon::ArrowRight)
                                            .tooltip("Open")
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
                                            .xsmall()
                                            .ghost()
                                            .icon(SandpaperIcon::SplitVertical)
                                            .tooltip("Open in split")
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
                    .px_4()
                    .pt_2()
                    .pb_1()
                    .text_size(tokens::FONT_SM)
                    .font_weight(gpui::FontWeight::MEDIUM)
                    .text_color(theme.muted_foreground)
                    .child("BLOCKS"),
            );
            content = content.children(self.editor.search_blocks.iter().cloned().map(|block| {
                let snippet = format_snippet(&block.text, 80);
                div()
                    .id(format!("search-block-{}", block.block_uid))
                    .px_3()
                    .py(tokens::SPACE_5)
                    .cursor_pointer()
                    .hover(move |s| s.bg(list_hover))
                    .child(
                        div()
                            .text_size(tokens::FONT_BASE)
                            .text_color(theme.foreground)
                            .child(snippet),
                    )
                    .child(
                        div()
                            .text_size(tokens::FONT_SM)
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
            use crate::ui::components::empty_state::EmptyState;
            use gpui_component::IconName;
            let panel = div()
                .flex()
                .flex_col()
                .mx_3()
                .mt_auto()
                .mb_3()
                .p_3()
                .rounded_md()
                .border_1()
                .border_color(theme.sidebar_border)
                .child(
                    div()
                        .text_size(tokens::FONT_SM)
                        .font_weight(gpui::FontWeight::MEDIUM)
                        .text_color(theme.muted_foreground)
                        .child("UNLINKED REFERENCES"),
                )
                .child(
                    EmptyState::new(
                        "No unlinked references",
                        "Link pages with [[wikilinks]] to see references here.",
                    )
                    .icon(IconName::ExternalLink),
                );
            return Some(panel.into_any_element());
        }

        let list_hover = theme.list_hover;
        let mut panel = div()
            .flex()
            .flex_col()
            .gap_1()
            .mx_3()
            .mt_auto()
            .mb_3()
            .p_3()
            .rounded_md()
            .border_1()
            .border_color(theme.sidebar_border)
            .child(
                div()
                    .text_size(tokens::FONT_SM)
                    .font_weight(gpui::FontWeight::MEDIUM)
                    .text_color(theme.muted_foreground)
                    .child("UNLINKED REFERENCES"),
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
                .p_2()
                .rounded_md()
                .hover(move |s| s.bg(list_hover))
                .flex()
                .items_start()
                .justify_between()
                .gap_3()
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_1()
                        .flex_1()
                        .min_w_0()
                        .child(
                            div()
                                .text_size(tokens::FONT_SM)
                                .text_color(theme.foreground)
                                .child(snippet),
                        )
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap_2()
                                .child(
                                    div()
                                        .text_size(tokens::FONT_SM)
                                        .text_color(theme.muted_foreground)
                                        .child(entry.page_title.clone()),
                                )
                                .child(
                                    div()
                                        .text_size(tokens::FONT_SM)
                                        .text_color(theme.muted_foreground)
                                        .child(count_label),
                                ),
                        ),
                )
                .child(
                    Button::new(format!("unlinked-link-{}", entry.block_uid))
                        .xsmall()
                        .ghost()
                        .icon(SandpaperIcon::Open)
                        .tooltip("Create link")
                        .on_click(cx.listener(move |this, _event, _window, cx| {
                            this.link_unlinked_reference(&entry, cx);
                        })),
                )
        }));

        Some(panel.into_any_element())
    }
}
