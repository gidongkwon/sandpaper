use crate::app::prelude::*;
use crate::app::store::*;
use crate::ui::sandpaper_theme::SandpaperTheme;
use crate::ui::tokens;

impl AppStore {
    /// Render the inner row content based on block type.
    /// Returns the styled inner div that goes inside the outer container.
    pub(super) fn render_typed_block_inner(
        &mut self,
        block: &BlockSnapshot,
        content_container: gpui::Div,
        actions: gpui::AnyElement,
        indent_px: gpui::Pixels,
        has_children: bool,
        is_collapsed: bool,
        pane: EditorPane,
        actual_ix: usize,
        base_bg: gpui::Hsla,
        cx: &mut Context<Self>,
    ) -> gpui::Div {
        let theme = cx.theme();
        let toggle_hover_bg = theme.list_hover;
        let collapse_bg = theme.secondary;

        match block.block_type {
            BlockType::Heading1 | BlockType::Heading2 | BlockType::Heading3 => {
                self.render_heading_inner(block, content_container, actions, indent_px, base_bg, cx)
            }
            BlockType::Quote => {
                self.render_quote_inner(block, content_container, actions, indent_px, base_bg, cx)
            }
            BlockType::Callout => {
                self.render_callout_inner(block, content_container, actions, indent_px, base_bg, cx)
            }
            BlockType::Divider => self.render_divider_inner(indent_px, base_bg, cx),
            BlockType::Todo => self.render_todo_inner(
                block,
                content_container,
                actions,
                indent_px,
                has_children,
                is_collapsed,
                pane,
                actual_ix,
                base_bg,
                toggle_hover_bg,
                collapse_bg,
                cx,
            ),
            BlockType::Image => self.render_image_inner(actions, indent_px, base_bg),
            BlockType::Code => {
                self.render_code_block_inner(content_container, actions, indent_px, base_bg, cx)
            }
            BlockType::DatabaseView => self.render_database_view_inner(indent_px, base_bg, cx),
            BlockType::ColumnLayout => self.render_column_layout_inner(
                block,
                content_container,
                actions,
                indent_px,
                has_children,
                is_collapsed,
                pane,
                actual_ix,
                base_bg,
                cx,
            ),
            BlockType::Toggle => self.render_toggle_inner(
                block,
                content_container,
                actions,
                indent_px,
                has_children,
                is_collapsed,
                pane,
                actual_ix,
                base_bg,
                toggle_hover_bg,
                collapse_bg,
                cx,
            ),
            _ => self.render_text_inner(
                block,
                content_container,
                actions,
                indent_px,
                has_children,
                is_collapsed,
                pane,
                actual_ix,
                base_bg,
                toggle_hover_bg,
                collapse_bg,
                cx,
            ),
        }
    }

    /// Default text block: indent + collapse toggle + bullet dot + content + actions
    fn render_text_inner(
        &mut self,
        block: &BlockSnapshot,
        content_container: gpui::Div,
        actions: gpui::AnyElement,
        indent_px: gpui::Pixels,
        has_children: bool,
        is_collapsed: bool,
        pane: EditorPane,
        actual_ix: usize,
        base_bg: gpui::Hsla,
        toggle_hover_bg: gpui::Hsla,
        collapse_bg: gpui::Hsla,
        cx: &mut Context<Self>,
    ) -> gpui::Div {
        let foreground_faint = cx.global::<SandpaperTheme>().colors(cx).foreground_faint;
        let collapse = self.render_collapse_toggle(
            block,
            has_children,
            is_collapsed,
            pane,
            actual_ix,
            toggle_hover_bg,
            collapse_bg,
            cx,
        );
        div()
            .flex()
            .text_size(tokens::FONT_BASE)
            .items_center()
            .gap_2()
            .py_1()
            .px_2()
            .child(div().w(indent_px).h(px(1.0)).bg(base_bg))
            .child(collapse)
            .child(
                div()
                    .w(px(5.0))
                    .h(px(5.0))
                    .rounded_full()
                    .bg(foreground_faint),
            )
            .child(content_container)
            .child(actions)
    }

    fn render_image_inner(
        &self,
        actions: gpui::AnyElement,
        indent_px: gpui::Pixels,
        base_bg: gpui::Hsla,
    ) -> gpui::Div {
        div()
            .flex()
            .items_center()
            .gap_2()
            .px_2()
            .child(div().w(indent_px).h(px(1.0)).bg(base_bg))
            .child(actions)
    }

    /// Heading: no bullet, larger font
    fn render_heading_inner(
        &self,
        block: &BlockSnapshot,
        content_container: gpui::Div,
        actions: gpui::AnyElement,
        indent_px: gpui::Pixels,
        base_bg: gpui::Hsla,
        _cx: &mut Context<Self>,
    ) -> gpui::Div {
        let styled_content = match block.block_type {
            BlockType::Heading1 => content_container
                .text_size(tokens::FONT_2XL)
                .font_weight(gpui::FontWeight::MEDIUM),
            BlockType::Heading2 => content_container
                .text_size(tokens::FONT_XL)
                .font_weight(gpui::FontWeight::MEDIUM),
            _ => content_container
                .text_size(tokens::FONT_LG)
                .font_weight(gpui::FontWeight::MEDIUM),
        };

        let top_pad = match block.block_type {
            BlockType::Heading1 => tokens::FONT_XL,
            BlockType::Heading2 => tokens::ICON_SM,
            _ => tokens::SPACE_4,
        };

        div()
            .flex()
            .items_center()
            .gap_2()
            .mt(top_pad)
            .py_1()
            .px_2()
            .child(div().w(indent_px).h(px(1.0)).bg(base_bg))
            // Reserve space for collapse toggle + bullet (18+10 = 28px total)
            .child(div().w(px(28.0)).h(px(1.0)))
            .child(styled_content)
            .child(actions)
    }

    /// Quote: left accent border, italic styling
    fn render_quote_inner(
        &self,
        _block: &BlockSnapshot,
        content_container: gpui::Div,
        actions: gpui::AnyElement,
        indent_px: gpui::Pixels,
        base_bg: gpui::Hsla,
        cx: &mut Context<Self>,
    ) -> gpui::Div {
        let theme = cx.theme();
        div()
            .flex()
            .text_size(tokens::FONT_BASE)
            .items_start()
            .gap_2()
            .py_1()
            .px_2()
            .child(div().w(indent_px).h(px(1.0)).bg(base_bg))
            .child(div().w(px(23.0)).h(px(1.0)))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .border_l_2()
                    .border_color(theme.accent.opacity(0.6))
                    .pl_3()
                    .py(tokens::SPACE_1)
                    .child(content_container.text_color(theme.muted_foreground)),
            )
            .child(actions)
    }

    /// Callout: colored background card
    fn render_callout_inner(
        &self,
        _block: &BlockSnapshot,
        content_container: gpui::Div,
        actions: gpui::AnyElement,
        indent_px: gpui::Pixels,
        base_bg: gpui::Hsla,
        cx: &mut Context<Self>,
    ) -> gpui::Div {
        let theme = cx.theme();
        div()
            .flex()
            .text_size(tokens::FONT_BASE)
            .items_start()
            .gap_2()
            .py_1()
            .px_2()
            .child(div().w(indent_px).h(px(1.0)).bg(base_bg))
            .child(div().w(px(23.0)).h(px(1.0)))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .rounded_md()
                    .bg(theme.warning.opacity(0.5))
                    .border_l_2()
                    .border_color(theme.warning_foreground.opacity(0.4))
                    .px_3()
                    .py_2()
                    .flex()
                    .items_center()
                    .gap_2()
                    .child(
                        Icon::new(SandpaperIcon::Warning)
                            .small()
                            .text_color(theme.warning_foreground),
                    )
                    .child(content_container),
            )
            .child(actions)
    }

    /// Divider: horizontal rule
    fn render_divider_inner(
        &self,
        indent_px: gpui::Pixels,
        base_bg: gpui::Hsla,
        cx: &mut Context<Self>,
    ) -> gpui::Div {
        let theme = cx.theme();
        div()
            .flex()
            .items_center()
            .gap_2()
            .py_3()
            .px_2()
            .child(div().w(indent_px).h(px(1.0)).bg(base_bg))
            .child(div().w(px(28.0)).h(px(1.0)))
            .child(div().flex_1().min_w_0().h(px(1.0)).bg(theme.border))
    }

    /// Todo: checkbox before text
    fn render_todo_inner(
        &mut self,
        block: &BlockSnapshot,
        content_container: gpui::Div,
        actions: gpui::AnyElement,
        indent_px: gpui::Pixels,
        has_children: bool,
        is_collapsed: bool,
        pane: EditorPane,
        actual_ix: usize,
        base_bg: gpui::Hsla,
        toggle_hover_bg: gpui::Hsla,
        collapse_bg: gpui::Hsla,
        cx: &mut Context<Self>,
    ) -> gpui::Div {
        let checked = block.text.starts_with("- [x] ") || block.text.starts_with("[x] ");

        let (check_border, check_bg, check_fg, todo_muted) = {
            let theme = cx.theme();
            let semantic = cx.global::<SandpaperTheme>().colors(cx);
            (
                if checked {
                    theme.accent
                } else {
                    semantic.foreground_faint
                },
                if checked {
                    semantic.accent_subtle
                } else {
                    gpui::transparent_black()
                },
                theme.accent,
                theme.muted_foreground,
            )
        };
        let collapse = self.render_collapse_toggle(
            block,
            has_children,
            is_collapsed,
            pane,
            actual_ix,
            toggle_hover_bg,
            collapse_bg,
            cx,
        );
        let styled_content = if checked {
            content_container.text_color(todo_muted)
        } else {
            content_container
        };
        div()
            .flex()
            .text_size(tokens::FONT_BASE)
            .items_center()
            .gap_2()
            .py_1()
            .px_2()
            .child(div().w(indent_px).h(px(1.0)).bg(base_bg))
            .child(collapse)
            .child(
                div()
                    .id(format!("todo-check-{}", block.uid))
                    .w(tokens::ICON_MD)
                    .h(tokens::ICON_MD)
                    .rounded(px(3.0))
                    .border_1()
                    .border_color(check_border)
                    .bg(check_bg)
                    .flex()
                    .items_center()
                    .justify_center()
                    .hover(move |s| s.cursor_pointer())
                    .on_click(cx.listener(move |this, _event, _window, cx| {
                        this.toggle_todo_checked(pane, actual_ix);
                        cx.notify();
                    }))
                    .when(checked, |this| {
                        this.child(
                            Icon::new(SandpaperIcon::Checkmark)
                                .size(tokens::FONT_SM)
                                .text_color(check_fg),
                        )
                    }),
            )
            .child(styled_content)
            .child(actions)
    }

    /// Code block: monospace background
    fn render_code_block_inner(
        &self,
        content_container: gpui::Div,
        actions: gpui::AnyElement,
        indent_px: gpui::Pixels,
        base_bg: gpui::Hsla,
        cx: &mut Context<Self>,
    ) -> gpui::Div {
        let theme = cx.theme();
        div()
            .flex()
            .text_size(tokens::FONT_BASE)
            .items_start()
            .gap_2()
            .py_1()
            .px_2()
            .child(div().w(indent_px).h(px(1.0)).bg(base_bg))
            .child(div().w(px(23.0)).h(px(1.0)))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .rounded_md()
                    .bg(theme.secondary)
                    .border_1()
                    .border_color(theme.border)
                    .px_3()
                    .py_2()
                    .child(content_container),
            )
            .child(actions)
    }

    /// Toggle: always shows collapse chevron, bold header
    fn render_toggle_inner(
        &mut self,
        block: &BlockSnapshot,
        content_container: gpui::Div,
        actions: gpui::AnyElement,
        indent_px: gpui::Pixels,
        _has_children: bool,
        is_collapsed: bool,
        pane: EditorPane,
        actual_ix: usize,
        base_bg: gpui::Hsla,
        toggle_hover_bg: gpui::Hsla,
        collapse_bg: gpui::Hsla,
        cx: &mut Context<Self>,
    ) -> gpui::Div {
        // Toggles always show the collapse arrow, even without children
        div()
            .flex()
            .text_size(tokens::FONT_BASE)
            .items_center()
            .gap_2()
            .py_1()
            .px_2()
            .child(div().w(indent_px).h(px(1.0)).bg(base_bg))
            .child(self.render_collapse_toggle(
                block,
                true, // always show
                is_collapsed,
                pane,
                actual_ix,
                toggle_hover_bg,
                collapse_bg,
                cx,
            ))
            .child(div().w(px(5.0)).h(px(1.0)))
            .child(content_container.font_weight(gpui::FontWeight::MEDIUM))
            .child(actions)
    }

    /// Shared collapse toggle widget
    fn render_collapse_toggle(
        &mut self,
        block: &BlockSnapshot,
        has_children: bool,
        is_collapsed: bool,
        pane: EditorPane,
        actual_ix: usize,
        toggle_hover_bg: gpui::Hsla,
        collapse_bg: gpui::Hsla,
        cx: &mut Context<Self>,
    ) -> gpui::AnyElement {
        if has_children {
            let label = if is_collapsed { "▸" } else { "▾" };
            let uid = block.uid.clone();
            div()
                .id(format!("collapse-toggle-{}", uid))
                .w(tokens::FONT_XL)
                .h(tokens::FONT_XL)
                .rounded_sm()
                .flex()
                .items_center()
                .justify_center()
                .hover(move |s| s.bg(toggle_hover_bg).cursor_pointer())
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
                .on_click(cx.listener(move |this, _event, window, cx| {
                    this.toggle_collapse_for_block(pane, actual_ix, Some(window), cx);
                    cx.stop_propagation();
                }))
                .child(label.to_string())
                .into_any_element()
        } else {
            div().w(tokens::FONT_XL).h(tokens::FONT_XL).into_any_element()
        }
    }

    /// Database view: inline table of pages with properties
    fn render_database_view_inner(
        &mut self,
        indent_px: gpui::Pixels,
        base_bg: gpui::Hsla,
        cx: &mut Context<Self>,
    ) -> gpui::Div {
        let theme = cx.theme();
        let border = theme.border;
        let border_subtle = cx.global::<SandpaperTheme>().colors(cx).border_subtle;
        let muted = theme.muted_foreground;
        let fg = theme.foreground;
        let header_bg = theme.secondary;
        let hover_bg = theme.list_hover;

        // Collect property definitions for column headers
        let prop_defs: Vec<PropertyDefinition> = self
            .app
            .db
            .as_ref()
            .and_then(|db| db.list_property_definitions().ok())
            .unwrap_or_default();

        // Query all pages with properties
        let pages_with_props: Vec<(PageRecord, Vec<PagePropertyRecord>)> = self
            .app
            .db
            .as_ref()
            .and_then(|db| db.query_pages_with_properties(None, None).ok())
            .unwrap_or_default();

        // Column keys: "title" is always first, then property definitions
        let col_keys: Vec<(String, String)> =
            std::iter::once(("__title".to_string(), "Title".to_string()))
                .chain(prop_defs.iter().map(|d| (d.key.clone(), d.label.clone())))
                .collect();

        // Header row
        let mut header_row = div()
            .flex()
            .items_center()
            .border_b_1()
            .border_color(border)
            .bg(header_bg)
            .px_2()
            .py_1();

        for (_, label) in &col_keys {
            header_row = header_row.child(
                div()
                    .flex_1()
                    .min_w(px(80.0))
                    .text_size(tokens::FONT_SM)
                    .font_weight(gpui::FontWeight::MEDIUM)
                    .text_color(muted)
                    .child(label.clone()),
            );
        }

        // Data rows
        let mut data_rows = div().flex().flex_col();
        for (page, props) in &pages_with_props {
            let page_uid = page.uid.clone();
            let mut row = div()
                .id(SharedString::from(format!("db-row-{}", page.uid)))
                .flex()
                .items_center()
                .px_2()
                .py(px(3.0))
                .border_b_1()
                .border_color(border_subtle)
                .cursor_pointer()
                .hover(move |s| s.bg(hover_bg))
                .on_click(cx.listener(move |this, _event, _window, cx| {
                    this.open_page(&page_uid, cx);
                }));

            for (key, _) in &col_keys {
                let cell_text = if key == "__title" {
                    page.title.clone()
                } else {
                    props
                        .iter()
                        .find(|p| &p.key == key)
                        .map(|p| p.value.clone())
                        .unwrap_or_default()
                };
                let cell_text = crate::app::store::helpers::single_line_text(&cell_text);
                row = row.child(
                    div()
                        .flex_1()
                        .min_w(px(80.0))
                        .text_size(tokens::FONT_SM)
                        .text_color(fg)
                        .overflow_hidden()
                        .child(cell_text),
                );
            }

            data_rows = data_rows.child(row);
        }

        let empty_state = if pages_with_props.is_empty() {
            Some(
                div()
                    .p_4()
                    .text_size(tokens::FONT_SM)
                    .text_color(muted)
                    .child("No pages found. Add pages to see them here."),
            )
        } else {
            None
        };

        let table = div()
            .w_full()
            .border_1()
            .border_color(border)
            .rounded_md()
            .overflow_hidden()
            .child(header_row)
            .child(data_rows)
            .when_some(empty_state, |this, empty| this.child(empty));

        let label = div()
            .flex()
            .items_center()
            .justify_between()
            .mb_1()
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_1()
                    .child(Icon::new(SandpaperIcon::Grid).size_3p5().text_color(muted))
                    .child(
                        div()
                            .text_size(tokens::FONT_SM)
                            .font_weight(gpui::FontWeight::MEDIUM)
                            .text_color(muted)
                            .child("Database View"),
                    ),
            )
            .child(
                TabBar::new("db-view-layout-tabs")
                    .xsmall()
                    .pill()
                    .selected_index(0)
                    .child(Tab::new().label("Table"))
                    .child(Tab::new().label("Kanban"))
                    .child(Tab::new().label("Gallery")),
            );

        div()
            .flex()
            .flex_col()
            .py_2()
            .px_2()
            .child(div().w(indent_px).h(px(1.0)).bg(base_bg))
            .child(label)
            .child(table)
    }

    /// Column layout: render child Column blocks side-by-side
    fn render_column_layout_inner(
        &mut self,
        block: &BlockSnapshot,
        _content_container: gpui::Div,
        _actions: gpui::AnyElement,
        indent_px: gpui::Pixels,
        _has_children: bool,
        _is_collapsed: bool,
        pane: EditorPane,
        actual_ix: usize,
        base_bg: gpui::Hsla,
        cx: &mut Context<Self>,
    ) -> gpui::Div {
        #[derive(Clone)]
        struct ColumnRowPreview {
            uid: String,
            actual_ix: usize,
            text: SharedString,
            depth: i64,
        }

        #[derive(Clone)]
        struct ColumnPreview {
            actual_ix: usize,
            label: SharedString,
            rows: Vec<ColumnRowPreview>,
        }

        let theme = cx.theme();
        let border_subtle = cx.global::<SandpaperTheme>().colors(cx).border_subtle;
        let muted = theme.muted_foreground;
        let fg = theme.foreground;
        let hover_bg = theme.list_hover;
        let active_bg = theme.list_active;
        let is_active_pane = self.editor.active_pane == pane;

        let (columns_data, active_ix) = {
            let editor = match pane {
                EditorPane::Primary => self.editor.editor.as_ref(),
                EditorPane::Secondary => self.editor.secondary_pane.as_ref().map(|p| &p.editor),
            };
            let Some(editor) = editor else {
                return div()
                    .pl(indent_px)
                    .bg(base_bg)
                    .child("Column layout (no editor)");
            };

            let mut columns: Vec<ColumnPreview> = Vec::new();
            let parent_indent = block.indent;
            let mut ix = actual_ix + 1;
            while ix < editor.blocks.len() {
                let current = &editor.blocks[ix];
                if current.indent <= parent_indent {
                    break;
                }

                if current.indent == parent_indent + 1
                    && matches!(current.block_type, BlockType::Column)
                {
                    let label_raw = crate::app::store::helpers::single_line_text(&current.text);
                    let label = if label_raw.trim().is_empty() {
                        format!("Column {}", columns.len() + 1).into()
                    } else {
                        label_raw.into()
                    };

                    let column_indent = current.indent;
                    let mut rows: Vec<ColumnRowPreview> = Vec::new();
                    let mut row_ix = ix + 1;
                    while row_ix < editor.blocks.len() {
                        let child = &editor.blocks[row_ix];
                        if child.indent <= column_indent {
                            break;
                        }

                        let raw = crate::app::store::helpers::clean_text_for_block_type(
                            &child.text,
                            child.block_type,
                        );
                        let mut line = crate::app::store::helpers::format_snippet(&raw, 120);
                        if matches!(child.block_type, BlockType::Divider) {
                            line = "—".to_string();
                        }
                        if line.trim().is_empty() {
                            row_ix += 1;
                            continue;
                        }
                        if matches!(child.block_type, BlockType::Todo) {
                            let checked =
                                child.text.starts_with("- [x] ") || child.text.starts_with("[x] ");
                            line = if checked {
                                format!("✓ {line}")
                            } else {
                                format!("☐ {line}")
                            };
                        }

                        rows.push(ColumnRowPreview {
                            uid: child.uid.clone(),
                            actual_ix: row_ix,
                            text: line.into(),
                            depth: (child.indent - column_indent - 1).max(0),
                        });
                        row_ix += 1;
                    }

                    columns.push(ColumnPreview {
                        actual_ix: ix,
                        label,
                        rows,
                    });
                    ix = row_ix;
                    continue;
                }

                ix += 1;
            }

            (columns, editor.active_ix)
        };

        let num_cols = columns_data.len();
        let mut columns = div().flex().gap_2().w_full();

        for column in columns_data {
            let mut rows = div().flex().flex_col().gap(tokens::SPACE_2);
            if column.rows.is_empty() {
                rows = rows.child(div().text_size(tokens::FONT_BASE).text_color(muted).child("Empty column"));
            } else {
                for row in column.rows {
                    let row_uid = row.uid.clone();
                    let row_id = format!("column-row-{}", row_uid);
                    let row_uid_for_click = row_uid.clone();
                    let row_depth = row.depth;
                    let is_row_active = is_active_pane && active_ix == row.actual_ix;
                    let row_content = if is_row_active {
                        let input = Input::new(&self.editor.block_input)
                            .appearance(false)
                            .bordered(false)
                            .focus_bordered(false)
                            .small();
                        div()
                            .capture_action(cx.listener(
                                |this, _: &gpui_component::input::Undo, window, cx| {
                                    this.undo_edit_action(&UndoEdit, window, cx);
                                    cx.stop_propagation();
                                },
                            ))
                            .capture_action(cx.listener(
                                |this, _: &gpui_component::input::Redo, window, cx| {
                                    this.redo_edit_action(&RedoEdit, window, cx);
                                    cx.stop_propagation();
                                },
                            ))
                            .capture_key_down(cx.listener(move |this, event, window, cx| {
                                if this.handle_block_input_key_down(pane, event, window, cx) {
                                    cx.stop_propagation();
                                }
                            }))
                            .child(input)
                            .into_any_element()
                    } else {
                        div()
                            .text_size(tokens::FONT_BASE)
                            .text_color(fg)
                            .child(row.text)
                            .into_any_element()
                    };

                    rows = rows.child(
                        div()
                            .id(row_id)
                            .px_1()
                            .py(tokens::SPACE_1)
                            .rounded_sm()
                            .bg(if is_row_active {
                                active_bg.opacity(0.7)
                            } else {
                                gpui::transparent_black()
                            })
                            .hover(move |style| {
                                if is_row_active {
                                    style
                                } else {
                                    style.bg(hover_bg).cursor_text()
                                }
                            })
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
                            .on_click(cx.listener(move |this, _event, window, cx| {
                                this.focus_block_by_uid_in_pane(
                                    pane,
                                    &row_uid_for_click,
                                    Some(window),
                                    cx,
                                );
                                cx.stop_propagation();
                            }))
                            .child(
                                div()
                                    .pl(px(row_depth as f32 * 12.0))
                                    .min_w_0()
                                    .child(row_content),
                            ),
                    );
                }
            }

            let add_block_column_ix = column.actual_ix;
            let add_block_btn_id = format!(
                "column-layout-add-block-{}-{add_block_column_ix}",
                block.uid
            );
            columns = columns.child(
                div()
                    .flex_1()
                    .min_w(px(220.0))
                    .border_1()
                    .border_color(border_subtle)
                    .rounded_md()
                    .p_2()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .mb_1()
                            .child(
                                div()
                                    .text_size(tokens::FONT_SM)
                                    .font_weight(gpui::FontWeight::MEDIUM)
                                    .text_color(muted)
                                    .child(column.label),
                            )
                            .child(
                                Button::new(add_block_btn_id)
                                    .xsmall()
                                    .ghost()
                                    .label("Add block")
                                    .on_click(cx.listener(move |this, _event, window, cx| {
                                        this.set_active_pane(pane, cx);
                                        this.add_block_to_column_in_pane(
                                            pane,
                                            add_block_column_ix,
                                            window,
                                            cx,
                                        );
                                        cx.stop_propagation();
                                    })),
                            ),
                    )
                    .child(rows),
            );
        }

        let add_column_btn_id = format!("column-layout-add-column-{}", block.uid);
        let layout_ix = actual_ix;

        div()
            .flex()
            .flex_col()
            .py_1()
            .pl(indent_px)
            .pr_2()
            .bg(base_bg)
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap_2()
                    .mb_1()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_1()
                            .child(Icon::new(SandpaperIcon::Grid).size_3p5().text_color(muted))
                            .child(
                                div()
                                    .text_size(tokens::FONT_SM)
                                    .font_weight(gpui::FontWeight::MEDIUM)
                                    .text_color(muted)
                                    .child(format!("{num_cols}-column layout")),
                            ),
                    )
                    .child(
                        Button::new(add_column_btn_id)
                            .xsmall()
                            .ghost()
                            .label("Add column")
                            .on_click(cx.listener(move |this, _event, window, cx| {
                                this.set_active_pane(pane, cx);
                                this.add_column_to_layout_in_pane(pane, layout_ix, window, cx);
                                cx.stop_propagation();
                            })),
                    ),
            )
            .child(columns)
    }

    /// Toggle a todo block's checked state
    pub(crate) fn toggle_todo_checked(&mut self, pane: EditorPane, block_ix: usize) {
        let Some(editor) = self.editor_for_pane_mut(pane) else {
            return;
        };
        if block_ix >= editor.blocks.len() {
            return;
        }
        let text = &mut editor.blocks[block_ix].text;
        if text.starts_with("- [x] ") {
            *text = format!("- [ ] {}", &text[6..]);
        } else if text.starts_with("- [ ] ") {
            *text = format!("- [x] {}", &text[6..]);
        } else if text.starts_with("[x] ") {
            *text = format!("[ ] {}", &text[4..]);
        } else if text.starts_with("[ ] ") {
            *text = format!("[x] {}", &text[4..]);
        }
    }
}
