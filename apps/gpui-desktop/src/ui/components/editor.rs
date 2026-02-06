use crate::app::prelude::*;
use crate::app::store::helpers::format_snippet;
use crate::app::store::*;
use gpui_component::{popover::Popover, Anchor};
impl AppStore {
    pub(super) fn render_editor(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let mut editor_body = div()
            .flex()
            .flex_1()
            .min_h_0()
            .child(self.render_blocks_list(cx));
        if let Some(pane) = self.render_secondary_pane(cx) {
            editor_body = editor_body.child(pane);
        }
        let editor_body = editor_body.into_any_element();

        let container = div()
            .flex_1()
            .min_w_0()
            .min_h_0()
            .h_full()
            .flex()
            .flex_col()
            .bg(cx.theme().background)
            .key_context("SandpaperEditor")
            .capture_key_down(cx.listener(|this, event: &KeyDownEvent, window, cx| {
                if this.handle_selection_clipboard_key_down(event, window, cx) {
                    cx.stop_propagation();
                }
            }))
            .on_action(cx.listener(Self::insert_block_below))
            .on_action(cx.listener(Self::indent_block))
            .on_action(cx.listener(Self::outdent_block))
            .on_action(cx.listener(Self::move_block_up))
            .on_action(cx.listener(Self::move_block_down))
            .on_action(cx.listener(Self::duplicate_block))
            .on_action(cx.listener(Self::select_all_blocks_action))
            .on_action(cx.listener(Self::delete_selection_action))
            .on_action(cx.listener(Self::clear_selection_action))
            .on_action(cx.listener(Self::toggle_split_pane_action))
            .on_action(cx.listener(Self::undo_edit_action))
            .on_action(cx.listener(Self::redo_edit_action))
            .child(editor_body);

        container
    }

    fn render_editor_empty_state(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let new_page_hint = shortcut_hint(ShortcutSpec::new("cmd-n", "ctrl-n"));
        let open_vaults_hint = shortcut_hint(ShortcutSpec::new("cmd-shift-v", "ctrl-alt-v"));
        let command_hint = shortcut_hint(ShortcutSpec::new("cmd-k", "ctrl-k"));
        let quick_add_hint = shortcut_hint(ShortcutSpec::new("cmd-l", "ctrl-l"));
        let fg = theme.foreground;
        let muted_fg = theme.muted_foreground;
        let card_border = theme.border;

        div()
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .child(
                div()
                    .w_full()
                    .max_w(px(400.0))
                    .mx_auto()
                    .p_6()
                    .rounded_lg()
                    .border_1()
                    .border_color(card_border)
                    .flex()
                    .flex_col()
                    .gap_3()
                    .child(
                        div()
                            .text_base()
                            .text_color(fg)
                            .font_weight(gpui::FontWeight::MEDIUM)
                            .child("Start writing"),
                    )
                    .child(div().text_sm().text_color(muted_fg).child(
                        "Create a page to get started, or use the command palette to explore.",
                    ))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .mt_1()
                            .child(
                                Button::new("empty-new-page")
                                    .label(format!("New page ({new_page_hint})"))
                                    .small()
                                    .primary()
                                    .on_click(cx.listener(|this, _event, _window, cx| {
                                        this.open_page_dialog(PageDialogMode::Create, cx);
                                    })),
                            )
                            .child(
                                Button::new("empty-open-vaults")
                                    .label(format!("Open vaults ({open_vaults_hint})"))
                                    .small()
                                    .ghost()
                                    .on_click(cx.listener(|this, _event, window, cx| {
                                        this.open_vaults(&OpenVaults, window, cx);
                                    })),
                            ),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(muted_fg.opacity(0.7))
                            .child(format!(
                                "{command_hint} commands  ·  {quick_add_hint} quick add"
                            )),
                    ),
            )
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
                .child(self.render_editor_empty_state(cx))
                .into_any_element()
        };

        let theme = cx.theme();
        let is_active = self.editor.active_pane == EditorPane::Primary;
        let has_split = self.editor.secondary_pane.is_some();
        let mut container = div()
            .id("blocks")
            .flex_1()
            .min_w_0()
            .h_full()
            .flex()
            .flex_col()
            .p_6();

        if has_split {
            container = container
                .border_1()
                .rounded_lg()
                .border_color(if is_active { theme.ring } else { theme.border });
        }

        if self.editor.secondary_pane.is_none() {
            let max_width = self.settings.editor_max_width;
            let max_width = SettingsState::clamp_editor_max_width(max_width);
            container = container.w_full().max_w(px(max_width)).mx_auto();
        }

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
        let fg = theme.foreground;
        let muted_fg = theme.muted_foreground;
        let list_hover = theme.list_hover;
        let border_color = theme.border;
        let _block_count = self
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
        let mut breadcrumbs = self.build_breadcrumb_items();
        if breadcrumbs.len() > 4 {
            let first = breadcrumbs.first().cloned();
            let tail = breadcrumbs[breadcrumbs.len() - 2..].to_vec();
            breadcrumbs.clear();
            if let Some(first) = first {
                breadcrumbs.push(first);
            }
            breadcrumbs.push(BreadcrumbItem {
                uid: "__ellipsis".to_string(),
                label: "…".to_string(),
            });
            breadcrumbs.extend(tail);
        }

        let mut title_group = div().flex().flex_col().gap(px(2.0)).child(
            div()
                .id("editor-page-title")
                .text_lg()
                .text_color(fg)
                .font_weight(gpui::FontWeight::MEDIUM)
                .cursor_pointer()
                .hover(move |s| s.bg(list_hover).rounded_sm().cursor_pointer())
                .on_click(cx.listener(|this, _event, _window, cx| {
                    this.open_page_dialog(PageDialogMode::Rename, cx);
                }))
                .child(title.to_string()),
        );

        if breadcrumbs.len() > 1 {
            let mut trail = div().id("editor-breadcrumbs").flex().items_center().gap_1();
            for (idx, item) in breadcrumbs.iter().enumerate() {
                let is_last = idx == breadcrumbs.len() - 1;
                let uid = item.uid.clone();
                let label = item.label.clone();
                let is_ellipsis = uid == "__ellipsis";
                let mut crumb = div()
                    .id(format!("breadcrumb-{}", uid))
                    .px_1()
                    .py(px(1.0))
                    .rounded_sm()
                    .text_xs()
                    .text_color(if is_last { fg } else { muted_fg })
                    .when(is_last, |this| this.font_weight(gpui::FontWeight::MEDIUM))
                    .child(label);

                if !is_last && !is_ellipsis {
                    crumb = crumb
                        .hover(move |s| s.bg(list_hover).cursor_pointer())
                        .on_click(cx.listener(move |this, _event, window, cx| {
                            this.focus_block_by_uid(&uid, Some(window), cx);
                            cx.notify();
                        }));
                }
                if !is_last {
                    crumb = crumb.child(div().ml_1().text_xs().text_color(border_color).child("/"));
                }
                trail = trail.child(crumb);
            }
            title_group = title_group.child(trail);
        }

        let actions = div()
            .flex()
            .items_center()
            .gap_1()
            .child({
                let mut container = div().relative().child(
                    Button::new("editor-outline")
                        .with_size(px(22.0))
                        .ghost()
                        .icon(SandpaperIcon::Menu)
                        .tooltip("Outline")
                        .on_click(cx.listener(|this, _event, _window, cx| {
                            this.toggle_outline_menu(EditorPane::Primary, cx);
                        })),
                );
                if self.editor.outline_menu.open
                    && self.editor.outline_menu.pane == EditorPane::Primary
                {
                    let menu = self.render_outline_menu_for_pane(EditorPane::Primary, cx);
                    container = container.child(menu);
                }
                container
            })
            .child(
                Button::new("editor-split")
                    .with_size(px(22.0))
                    .ghost()
                    .icon(SandpaperIcon::SplitVertical)
                    .tooltip(if self.editor.secondary_pane.is_some() {
                        "Close split"
                    } else {
                        "Split pane"
                    })
                    .on_click(cx.listener(|this, _event, _window, cx| {
                        this.toggle_split_pane(cx);
                    })),
            )
            .child(self.render_backlinks_toggle(cx));

        let header_row = div()
            .flex()
            .items_center()
            .justify_between()
            .child(title_group)
            .child(actions);

        let mut container = div()
            .id("editor-header")
            .mb_4()
            .pb_3()
            .border_b_1()
            .border_color(border_color.opacity(0.5))
            .flex()
            .flex_col()
            .gap_2()
            .child(header_row);

        if let Some(props_section) = self.render_page_properties(cx) {
            container = container.child(props_section);
        }

        Some(container.into_any_element())
    }

    fn render_page_properties(&mut self, cx: &mut Context<Self>) -> Option<gpui::AnyElement> {
        if self.editor.active_page.is_none() {
            return None;
        }
        let theme = cx.theme();
        let is_open = self.editor.properties_open;
        let prop_count = self.editor.page_properties.len();

        // Toggle header
        let toggle_label = if prop_count > 0 {
            format!("Properties ({prop_count})")
        } else {
            "Properties".to_string()
        };
        let toggle_icon = if is_open {
            SandpaperIcon::ChevronDown
        } else {
            SandpaperIcon::ChevronRight
        };
        let toggle_color = theme.muted_foreground;

        let header = div()
            .id("properties-toggle")
            .w_full()
            .flex()
            .items_center()
            .gap_1()
            .py(px(3.0))
            .px_1()
            .rounded_sm()
            .cursor_pointer()
            .hover(move |s| s.bg(theme.list_hover))
            .on_click(cx.listener(|this, _event, _window, cx| {
                this.editor.properties_open = !this.editor.properties_open;
                cx.notify();
            }))
            .child(Icon::new(toggle_icon).size_3().text_color(toggle_color))
            .child(div().text_xs().text_color(toggle_color).child(toggle_label));

        if !is_open {
            return Some(header.into_any_element());
        }

        // Build property rows
        let mut rows = div().flex().flex_col().gap_1().pl_4();
        let muted = theme.muted_foreground;
        let fg = theme.foreground;
        let row_hover = theme.list_hover;

        for prop in &self.editor.page_properties {
            let key = prop.key.clone();
            let value = prop.value.clone();
            let value_type = prop.value_type.clone();
            let delete_key = key.clone();

            let value_display = match value_type.as_str() {
                "checkbox" => {
                    let checked = value == "true";
                    div()
                        .child(
                            Icon::new(if checked {
                                SandpaperIcon::Checkmark
                            } else {
                                SandpaperIcon::Subtract
                            })
                            .size_3p5()
                            .text_color(if checked {
                                theme.accent
                            } else {
                                muted
                            }),
                        )
                        .into_any_element()
                }
                _ => div()
                    .text_xs()
                    .text_color(fg)
                    .child(value.clone())
                    .into_any_element(),
            };

            let row = div()
                .id(SharedString::from(format!("prop-{}", key)))
                .flex()
                .items_center()
                .gap_2()
                .py(px(2.0))
                .px_1()
                .rounded_sm()
                .hover(move |s| s.bg(row_hover))
                .child(
                    div()
                        .w(px(100.0))
                        .text_xs()
                        .text_color(muted)
                        .overflow_hidden()
                        .child(key),
                )
                .child(div().flex_1().child(value_display))
                .child(
                    div().opacity(0.0).hover(|s| s.opacity(1.0)).child(
                        Button::new(SharedString::from(format!("del-prop-{}", delete_key)))
                            .with_size(px(16.0))
                            .ghost()
                            .icon(SandpaperIcon::Dismiss)
                            .on_click(cx.listener(move |this, _event, _window, cx| {
                                this.delete_page_property(&delete_key, cx);
                            })),
                    ),
                );

            rows = rows.child(row);
        }

        // Add property button
        let add_btn = div().pt_1().child(
            Button::new("add-property")
                .label("+ Add property")
                .ghost()
                .xsmall()
                .on_click(cx.listener(|this, _event, _window, cx| {
                    // Add a default text property with a generated key
                    let key = format!("property-{}", this.editor.page_properties.len() + 1);
                    this.set_page_property(&key, "", "text", cx);
                })),
        );

        let section = div()
            .flex()
            .flex_col()
            .gap_1()
            .child(header)
            .child(rows)
            .child(add_btn);

        Some(section.into_any_element())
    }

    fn render_backlinks_toggle(&mut self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let total = self.editor.backlinks.len() + self.editor.block_backlinks.len();
        let is_open = self.settings.context_panel_open
            && self.settings.context_panel_tab == WorkspacePanel::Backlinks;
        let tooltip = if total > 0 {
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

        let theme = cx.theme();
        let mut button = div().flex().items_center().gap_1().child(
            Button::new("backlinks-toggle")
                .with_size(px(22.0))
                .ghost()
                .icon(SandpaperIcon::LinkMultiple)
                .tooltip(tooltip)
                .on_click(cx.listener(|this, _event, _window, cx| {
                    if this.settings.context_panel_open
                        && this.settings.context_panel_tab == WorkspacePanel::Backlinks
                    {
                        this.settings.context_panel_open = false;
                    } else {
                        this.settings.context_panel_open = true;
                        this.settings.context_panel_tab = WorkspacePanel::Backlinks;
                    }
                    this.persist_settings();
                    cx.notify();
                })),
        );
        if total > 0 {
            button = button.child(
                div()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .child(format!("{total}")),
            );
        }
        button.into_any_element()
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
                .px_3()
                .py(px(10.0))
                .rounded_lg()
                .bg(theme.colors.list)
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
                            Button::new(format!("{id_prefix}-copy"))
                                .label("Copy")
                                .xsmall()
                                .ghost()
                                .on_click(cx.listener(move |this, _event, _window, cx| {
                                    this.set_active_pane(pane, cx);
                                    this.copy_selection_blocks_in_pane(pane, cx);
                                })),
                        )
                        .child(
                            Button::new(format!("{id_prefix}-cut"))
                                .label("Cut")
                                .xsmall()
                                .ghost()
                                .on_click(cx.listener(move |this, _event, _window, cx| {
                                    this.set_active_pane(pane, cx);
                                    this.cut_selection_blocks_in_pane(pane, cx);
                                })),
                        )
                        .child(
                            Button::new(format!("{id_prefix}-paste"))
                                .label("Paste")
                                .xsmall()
                                .ghost()
                                .on_click(cx.listener(move |this, _event, window, cx| {
                                    this.set_active_pane(pane, cx);
                                    this.paste_selection_blocks_in_pane(pane, window, cx);
                                })),
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
        pane: EditorPane,
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
            .w(px(240.0))
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
                    .py(px(10.0))
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
                    .py(px(10.0))
                    .text_sm()
                    .text_color(theme.muted_foreground)
                    .child("No matches"),
            );
        } else {
            for (ix, cmd) in commands.into_iter().enumerate() {
                let id = cmd.id;
                let label = cmd.label;
                let action = cmd.action;
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
                        .py(px(10.0))
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
                            this.apply_slash_command(id, action, window, cx);
                        }))
                        .child(label),
                );
            }
        }

        let pane_id = match pane {
            EditorPane::Primary => "primary",
            EditorPane::Secondary => "secondary",
        };
        let popover_id = format!("slash-menu-popover-{pane_id}");
        let trigger_id = format!("slash-menu-trigger-{pane_id}");

        Popover::new(popover_id)
            .absolute()
            .left(origin.x)
            .top(origin.y)
            .w(px(1.0))
            .h(px(1.0))
            .anchor(Anchor::TopLeft)
            .appearance(false)
            .open(self.editor.slash_menu.open && self.editor.slash_menu.pane == pane)
            .on_open_change(cx.listener(|this, open: &bool, _window, cx| {
                if !*open {
                    this.close_slash_menu();
                    cx.notify();
                }
            }))
            .trigger(Self::popover_anchor_trigger(trigger_id))
            .child(menu)
            .into_any_element()
    }

    fn render_wikilink_menu_at(
        &mut self,
        pane: EditorPane,
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
            .w(px(280.0))
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
                    .py(px(10.0))
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

        let pane_id = match pane {
            EditorPane::Primary => "primary",
            EditorPane::Secondary => "secondary",
        };
        let popover_id = format!("wikilink-menu-popover-{pane_id}");
        let trigger_id = format!("wikilink-menu-trigger-{pane_id}");

        Popover::new(popover_id)
            .absolute()
            .left(origin.x)
            .top(origin.y)
            .w(px(1.0))
            .h(px(1.0))
            .anchor(Anchor::TopLeft)
            .appearance(false)
            .open(self.editor.wikilink_menu.open && self.editor.wikilink_menu.pane == pane)
            .on_open_change(cx.listener(|this, open: &bool, _window, cx| {
                if !*open {
                    this.close_wikilink_menu();
                    cx.notify();
                }
            }))
            .trigger(Self::popover_anchor_trigger(trigger_id))
            .child(menu)
            .into_any_element()
    }

    fn render_outline_menu_for_pane(
        &mut self,
        pane: EditorPane,
        cx: &mut Context<Self>,
    ) -> gpui::AnyElement {
        let theme = cx.theme();
        let Some(editor) = self.editor_for_pane(pane) else {
            return div().into_any_element();
        };
        let Some(list_state) = self.list_state_for_pane(pane) else {
            return div().into_any_element();
        };

        let hover_bg = theme.list_hover;
        let selected_bg = theme.list_active;
        let menu_bg = theme.popover;

        let id_prefix = match pane {
            EditorPane::Primary => "outline-menu",
            EditorPane::Secondary => "secondary-outline-menu",
        };

        let mut menu = div()
            .id(id_prefix)
            .w(px(300.0))
            .rounded_md()
            .bg(menu_bg)
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
                    .child("Outline"),
            )
            .child(
                div()
                    .px_2()
                    .pb_2()
                    .flex()
                    .flex_col()
                    .gap_1()
                    .child(
                        div()
                            .id(format!("{id_prefix}-fold-all"))
                            .px_3()
                            .py_2()
                            .rounded_sm()
                            .text_sm()
                            .text_color(theme.foreground)
                            .bg(menu_bg)
                            .hover(move |s| s.bg(hover_bg).cursor_pointer())
                            .on_mouse_down(
                                MouseButton::Left,
                                cx.listener(|_this, _event, _window, cx| {
                                    cx.stop_propagation();
                                }),
                            )
                            .on_click(cx.listener(move |this, _event, window, cx| {
                                this.fold_outline_to_level(pane, 0, Some(window), cx);
                                this.close_outline_menu();
                                cx.notify();
                            }))
                            .child("Fold all"),
                    )
                    .child(
                        div()
                            .id(format!("{id_prefix}-fold-1"))
                            .px_3()
                            .py_2()
                            .rounded_sm()
                            .text_sm()
                            .text_color(theme.foreground)
                            .bg(menu_bg)
                            .hover(move |s| s.bg(hover_bg).cursor_pointer())
                            .on_mouse_down(
                                MouseButton::Left,
                                cx.listener(|_this, _event, _window, cx| {
                                    cx.stop_propagation();
                                }),
                            )
                            .on_click(cx.listener(move |this, _event, window, cx| {
                                this.fold_outline_to_level(pane, 1, Some(window), cx);
                                this.close_outline_menu();
                                cx.notify();
                            }))
                            .child("Fold to level 1"),
                    )
                    .child(
                        div()
                            .id(format!("{id_prefix}-fold-2"))
                            .px_3()
                            .py_2()
                            .rounded_sm()
                            .text_sm()
                            .text_color(theme.foreground)
                            .bg(menu_bg)
                            .hover(move |s| s.bg(hover_bg).cursor_pointer())
                            .on_mouse_down(
                                MouseButton::Left,
                                cx.listener(|_this, _event, _window, cx| {
                                    cx.stop_propagation();
                                }),
                            )
                            .on_click(cx.listener(move |this, _event, window, cx| {
                                this.fold_outline_to_level(pane, 2, Some(window), cx);
                                this.close_outline_menu();
                                cx.notify();
                            }))
                            .child("Fold to level 2"),
                    )
                    .child(
                        div()
                            .id(format!("{id_prefix}-unfold-all"))
                            .px_3()
                            .py_2()
                            .rounded_sm()
                            .text_sm()
                            .text_color(theme.foreground)
                            .bg(menu_bg)
                            .hover(move |s| s.bg(hover_bg).cursor_pointer())
                            .on_mouse_down(
                                MouseButton::Left,
                                cx.listener(|_this, _event, _window, cx| {
                                    cx.stop_propagation();
                                }),
                            )
                            .on_click(cx.listener(move |this, _event, window, cx| {
                                this.unfold_all_outline(pane, Some(window), cx);
                                this.close_outline_menu();
                                cx.notify();
                            }))
                            .child("Unfold all"),
                    ),
            );

        let mut list = div()
            .id(format!("{id_prefix}-list"))
            .h(px(320.0))
            .overflow_scroll();
        for (ix, actual_ix) in list_state.visible_to_actual.iter().copied().enumerate() {
            let Some(block) = editor.blocks.get(actual_ix) else {
                continue;
            };
            let label = if block.text.trim().is_empty() {
                "Untitled".to_string()
            } else {
                format_snippet(&block.text, 36)
            };
            let item_bg = if editor.active_ix == actual_ix {
                selected_bg
            } else {
                menu_bg
            };
            let indent_px = px(8.0 + (block.indent.max(0) as f32) * 12.0);
            let uid = block.uid.clone();
            list = list.child(
                div()
                    .id(format!("{id_prefix}-item-{ix}"))
                    .px_2()
                    .py(px(6.0))
                    .rounded_sm()
                    .bg(item_bg)
                    .hover(move |s| s.bg(hover_bg).cursor_pointer())
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(|_this, _event, _window, cx| {
                            cx.stop_propagation();
                        }),
                    )
                    .on_click(cx.listener(move |this, _event, window, cx| {
                        this.focus_block_by_uid_in_pane(pane, &uid, Some(window), cx);
                        this.close_outline_menu();
                        cx.notify();
                    }))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .child(div().w(indent_px).h(px(1.0)).bg(menu_bg))
                            .child(div().text_sm().text_color(theme.foreground).child(label)),
                    ),
            );
        }

        menu = menu.child(div().border_t_1().border_color(theme.border).child(list));

        let trigger_id = format!("{id_prefix}-trigger");
        let popover_id = format!("{id_prefix}-popover");
        Popover::new(popover_id)
            .absolute()
            .top(px(24.0))
            .right(px(0.0))
            .w(px(1.0))
            .h(px(1.0))
            .anchor(Anchor::TopRight)
            .appearance(false)
            .open(self.editor.outline_menu.open && self.editor.outline_menu.pane == pane)
            .on_open_change(cx.listener(|this, open: &bool, _window, cx| {
                if !*open {
                    this.close_outline_menu();
                    cx.notify();
                }
            }))
            .trigger(Self::popover_anchor_trigger(trigger_id))
            .child(menu)
            .into_any_element()
    }

    pub(super) fn render_link_preview(
        &mut self,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<gpui::AnyElement> {
        let preview = self.editor.link_preview.clone()?;
        if !preview.open {
            return None;
        }

        let theme = cx.theme();

        let open_title = preview.title.clone();
        let preview_title = preview.title.clone();
        let preview_blocks = preview.blocks.clone();
        let preview_loading = preview.loading;

        let mut panel = div()
            .id("link-preview-panel")
            .w(px(280.0))
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
                            .font_weight(gpui::FontWeight::MEDIUM)
                            .child(preview_title),
                    )
                    .child(
                        Button::new("link-preview-open")
                            .xsmall()
                            .ghost()
                            .icon(SandpaperIcon::ArrowRight)
                            .tooltip("Open page")
                            .on_click(cx.listener(move |this, _event, _window, cx| {
                                this.open_page(&open_title, cx);
                                this.close_link_preview();
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
                let snippet = crate::app::store::helpers::format_snippet(block_text, 140);
                panel = panel.child(
                    div()
                        .id(format!("link-preview-block-{ix}"))
                        .px_3()
                        .py_2()
                        .text_xs()
                        .text_color(theme.foreground)
                        .child(snippet),
                );
            }
        }

        Some(
            Popover::new("link-preview-popover")
                .absolute()
                .left(preview.position.x)
                .top(preview.position.y)
                .w(px(1.0))
                .h(px(1.0))
                .anchor(Anchor::TopLeft)
                .appearance(false)
                .open(true)
                .on_open_change(cx.listener(|this, open: &bool, _window, cx| {
                    if !*open {
                        this.close_link_preview();
                        cx.notify();
                    }
                }))
                .trigger(Self::popover_anchor_trigger("link-preview-trigger"))
                .child(panel)
                .into_any_element(),
        )
    }

    fn popover_anchor_trigger(id: impl Into<String>) -> Button {
        Button::new(id.into())
            .label("")
            .ghost()
            .xsmall()
            .tab_stop(false)
            .w(px(1.0))
            .h(px(1.0))
            .opacity(0.0)
    }

    fn render_inline_markdown_text(
        &mut self,
        pane: EditorPane,
        block_uid: &str,
        text: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> gpui::AnyElement {
        if text.contains('\n') || text.contains('\r') {
            let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
            let foreground = {
                let theme = cx.theme();
                theme.foreground
            };
            let mut body = div().flex().flex_col().gap(px(2.0));
            for (line_ix, line) in normalized.split('\n').enumerate() {
                let line_id = format!("{block_uid}-line-{line_ix}");
                let line_text = if line.is_empty() { " " } else { line };
                body = body
                    .child(self.render_inline_markdown_text(pane, &line_id, line_text, window, cx));
            }

            return div().text_color(foreground).child(body).into_any_element();
        }

        if let Some(list) = crate::app::store::markdown::parse_markdown_list(text) {
            let (foreground, muted_foreground) = {
                let theme = cx.theme();
                (theme.foreground, theme.muted_foreground)
            };
            let mut body = div().flex().flex_col().gap_1();
            for (ix, item) in list.items.iter().enumerate() {
                let prefix: SharedString = match list.kind {
                    crate::app::store::markdown::MarkdownListKind::Ordered => {
                        format!("{}.", ix + 1).into()
                    }
                    crate::app::store::markdown::MarkdownListKind::Unordered => "•".into(),
                };
                let item_id = format!("{block_uid}-mdlist-{ix}");
                body = body.child(
                    div()
                        .flex()
                        .items_start()
                        .gap_2()
                        .child(
                            div()
                                .w(px(18.0))
                                .text_sm()
                                .text_color(muted_foreground)
                                .child(prefix),
                        )
                        .child(div().flex_1().min_w_0().child(
                            self.render_inline_markdown_text(pane, &item_id, item, window, cx),
                        )),
                );
            }

            return div()
                .text_sm()
                .text_color(foreground)
                .child(body)
                .into_any_element();
        }

        let theme = cx.theme();
        let tokens = crate::app::store::markdown::parse_inline_markdown_tokens(text);
        let mut display = String::new();
        let mut highlight_ranges: Vec<(std::ops::Range<usize>, HighlightStyle)> = Vec::new();
        let mut interactive_ranges: Vec<std::ops::Range<usize>> = Vec::new();

        enum InlineAction {
            Wikilink(String),
            External(String),
        }

        let mut actions: Vec<InlineAction> = Vec::new();

        let link_color = theme.accent;
        let underline = UnderlineStyle {
            thickness: px(1.0),
            color: Some(link_color),
            wavy: false,
        };
        let strike = gpui::StrikethroughStyle {
            thickness: px(1.0),
            color: Some(theme.muted_foreground),
        };
        let code_bg = theme.secondary.opacity(0.9);

        for token in tokens {
            match token {
                crate::app::store::markdown::InlineMarkdownToken::Text(value) => {
                    display.push_str(&value);
                }
                crate::app::store::markdown::InlineMarkdownToken::Wikilink { target, label } => {
                    let start = display.len();
                    display.push_str(&label);
                    let end = display.len();
                    if start < end {
                        interactive_ranges.push(start..end);
                        actions.push(InlineAction::Wikilink(target));
                        highlight_ranges.push((
                            start..end,
                            HighlightStyle {
                                color: Some(link_color),
                                underline: Some(underline),
                                ..Default::default()
                            },
                        ));
                    }
                }
                crate::app::store::markdown::InlineMarkdownToken::Link { href, label } => {
                    let start = display.len();
                    display.push_str(&label);
                    let end = display.len();
                    if start < end {
                        interactive_ranges.push(start..end);
                        actions.push(InlineAction::External(href));
                        highlight_ranges.push((
                            start..end,
                            HighlightStyle {
                                color: Some(link_color),
                                underline: Some(underline),
                                ..Default::default()
                            },
                        ));
                    }
                }
                crate::app::store::markdown::InlineMarkdownToken::Code(value) => {
                    let start = display.len();
                    display.push_str(&value);
                    let end = display.len();
                    if start < end {
                        highlight_ranges.push((
                            start..end,
                            HighlightStyle {
                                background_color: Some(code_bg),
                                ..Default::default()
                            },
                        ));
                    }
                }
                crate::app::store::markdown::InlineMarkdownToken::Bold(value) => {
                    let start = display.len();
                    display.push_str(&value);
                    let end = display.len();
                    if start < end {
                        highlight_ranges.push((
                            start..end,
                            HighlightStyle {
                                font_weight: Some(gpui::FontWeight::BOLD),
                                ..Default::default()
                            },
                        ));
                    }
                }
                crate::app::store::markdown::InlineMarkdownToken::Italic(value) => {
                    let start = display.len();
                    display.push_str(&value);
                    let end = display.len();
                    if start < end {
                        highlight_ranges.push((
                            start..end,
                            HighlightStyle {
                                font_style: Some(gpui::FontStyle::Italic),
                                ..Default::default()
                            },
                        ));
                    }
                }
                crate::app::store::markdown::InlineMarkdownToken::Strike(value) => {
                    let start = display.len();
                    display.push_str(&value);
                    let end = display.len();
                    if start < end {
                        highlight_ranges.push((
                            start..end,
                            HighlightStyle {
                                strikethrough: Some(strike),
                                ..Default::default()
                            },
                        ));
                    }
                }
            }
        }

        if display.is_empty() {
            display.push(' ');
        }

        if interactive_ranges.is_empty() {
            let mut styled = StyledText::new(display);
            if !highlight_ranges.is_empty() {
                highlight_ranges.sort_by_key(|(range, _)| range.start);
                styled = styled.with_highlights(highlight_ranges);
            }
            return div()
                .text_color(theme.foreground)
                .child(styled)
                .into_any_element();
        }

        let mut styled = StyledText::new(display);
        if !highlight_ranges.is_empty() {
            highlight_ranges.sort_by_key(|(range, _)| range.start);
            styled = styled.with_highlights(highlight_ranges);
        }

        let entity = cx.entity();
        let click_entity = entity.clone();
        let hover_entity = entity.clone();
        let actions = Rc::new(actions);
        let hover_actions = actions.clone();
        let click_actions = actions.clone();
        let hover_ranges = Rc::new(interactive_ranges);
        let click_ranges = hover_ranges.as_ref().clone();
        let hover_ranges_clone = hover_ranges.clone();
        let id_prefix = match pane {
            EditorPane::Primary => "primary",
            EditorPane::Secondary => "secondary",
        };

        let interactive =
            InteractiveText::new(format!("inline-md-{id_prefix}-{block_uid}"), styled)
                .on_click(click_ranges, move |idx, _window, cx| {
                    if let Some(action) = click_actions.get(idx) {
                        match action {
                            InlineAction::Wikilink(target) => {
                                let target = target.clone();
                                click_entity.update(cx, |this, cx| {
                                    this.open_page(&target, cx);
                                    this.close_link_preview();
                                });
                            }
                            InlineAction::External(url) => {
                                cx.open_url(url.as_str());
                            }
                        }
                    }
                    cx.stop_propagation();
                })
                .on_hover(move |hover_ix, event, _window, cx| {
                    let mut hovered_wikilink_target = None;
                    if let Some(ix) = hover_ix {
                        for (range_ix, range) in hover_ranges_clone.iter().enumerate() {
                            if range.contains(&ix) {
                                if let Some(action) = hover_actions.get(range_ix) {
                                    if let InlineAction::Wikilink(target) = action {
                                        hovered_wikilink_target = Some(target.clone());
                                    }
                                }
                                break;
                            }
                        }
                    }

                    hover_entity.update(cx, |this, cx| {
                        if let Some(target) = hovered_wikilink_target {
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
            .text_color(theme.foreground)
            .child(interactive)
            .into_any_element()
    }

    fn render_code_preview(
        &mut self,
        block_uid: &str,
        text: &str,
        cx: &mut Context<Self>,
    ) -> Option<gpui::AnyElement> {
        let fence = crate::app::store::markdown::parse_inline_fence(text)?;
        if matches!(fence.lang.as_str(), "mermaid" | "diagram") {
            return None;
        }

        let theme = cx.theme();
        let copied = self
            .editor
            .copied_block_uid
            .as_ref()
            .is_some_and(|uid| uid == block_uid);
        let copy_label: SharedString = if copied {
            "Copied".into()
        } else {
            "Copy".into()
        };
        let badge: SharedString = fence.lang.to_uppercase().into();
        let renderer_title: SharedString = self
            .plugins
            .plugin_status
            .as_ref()
            .and_then(|status| {
                status
                    .renderers
                    .iter()
                    .find(|renderer| renderer.kind == "code")
                    .map(|renderer| renderer.title.clone())
            })
            .unwrap_or_else(|| "Code renderer".to_string())
            .into();

        let uid = block_uid.to_string();
        let content = fence.content.clone();
        let copy_button = Button::new(format!("code-preview-copy-{uid}"))
            .label(copy_label)
            .xsmall()
            .ghost()
            .on_click(cx.listener(move |this, _event, _window, cx| {
                this.copy_block_text_to_clipboard(&uid, &content, cx);
                cx.stop_propagation();
            }));

        let monospace = {
            let mut font = gpui::font("SF Mono");
            font.fallbacks = Some(gpui::FontFallbacks::from_fonts(vec![
                "Menlo".to_string(),
                "Monaco".to_string(),
                "Consolas".to_string(),
                "Liberation Mono".to_string(),
                "Courier New".to_string(),
                "monospace".to_string(),
            ]));
            font
        };
        let content_text: SharedString = fence.content.clone().into();
        let run = TextRun {
            len: content_text.len(),
            font: monospace,
            color: theme.foreground,
            background_color: None,
            underline: None,
            strikethrough: None,
        };
        let code_block = StyledText::new(content_text).with_runs(vec![run]);

        let header = div()
            .flex()
            .items_center()
            .justify_between()
            .gap_2()
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_0()
                    .child(
                        div()
                            .text_sm()
                            .text_color(theme.foreground)
                            .font_weight(gpui::FontWeight::MEDIUM)
                            .child("Code preview"),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .child(
                                div()
                                    .px_2()
                                    .py(px(1.0))
                                    .rounded_sm()
                                    .bg(theme.secondary)
                                    .text_xs()
                                    .text_color(theme.foreground)
                                    .child(badge),
                            )
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(theme.muted_foreground)
                                    .child(renderer_title),
                            ),
                    ),
            )
            .child(copy_button);

        Some(
            div()
                .mt_2()
                .p_3()
                .rounded_md()
                .border_1()
                .border_color(theme.border)
                .bg(theme.colors.list)
                .child(header)
                .child(
                    div()
                        .mt_2()
                        .p_2()
                        .rounded_sm()
                        .bg(theme.background)
                        .overflow_hidden()
                        .text_xs()
                        .text_color(theme.foreground)
                        .child(code_block),
                )
                .into_any_element(),
        )
    }

    fn render_plugin_block_preview(
        &mut self,
        pane: EditorPane,
        block_uid: &str,
        text: &str,
        cx: &mut Context<Self>,
    ) -> Option<gpui::AnyElement> {
        let fence = crate::app::store::markdown::parse_inline_fence(text)?;
        let renderer = self.plugins.plugin_status.as_ref().and_then(|status| {
            status
                .renderers
                .iter()
                .find(|renderer| {
                    renderer.kind == "block"
                        && renderer
                            .languages
                            .iter()
                            .any(|lang| lang.eq_ignore_ascii_case(&fence.lang))
                })
                .cloned()
        })?;

        self.ensure_plugin_block_preview(pane, block_uid, text, &renderer, cx);

        let preview_key = Self::plugin_preview_state_key(pane, block_uid);
        let (loading, error, view) = self
            .editor
            .plugin_block_previews
            .get(&preview_key)
            .map(|state| (state.loading, state.error.clone(), state.view.clone()))
            .unwrap_or((true, None, None));

        let theme = cx.theme();
        let id_prefix = match pane {
            EditorPane::Primary => "primary",
            EditorPane::Secondary => "secondary",
        };

        let header = div()
            .flex()
            .items_center()
            .justify_between()
            .gap_2()
            .child(
                div()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .font_weight(gpui::FontWeight::MEDIUM)
                    .child(renderer.title.clone()),
            )
            .child(
                div()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .child(if loading { "Loading..." } else { "" }),
            );

        let mut card = div()
            .mt_2()
            .p_3()
            .rounded_md()
            .border_1()
            .border_color(theme.border)
            .bg(theme.colors.list)
            .child(header);

        if let Some(error) = error {
            card = card.child(
                div()
                    .mt_2()
                    .text_xs()
                    .text_color(theme.danger_foreground)
                    .child(error.to_string()),
            );
        }

        if let Some(view) = view {
            if view.body.is_none() {
                if let Some(message) = view.message.clone().or(view.summary.clone()) {
                    let color = if view.status.as_deref() == Some("error") {
                        theme.danger_foreground
                    } else {
                        theme.muted_foreground
                    };
                    card = card.child(div().mt_2().text_xs().text_color(color).child(message));
                }
            }

            if let Some(body) = view.body.as_ref() {
                let kind = body.get("kind").and_then(Value::as_str).unwrap_or("");
                if kind == "text" {
                    if let Some(text) = body.get("text").and_then(Value::as_str) {
                        card = card.child(
                            div()
                                .mt_2()
                                .text_sm()
                                .text_color(theme.muted_foreground)
                                .child(text.to_string()),
                        );
                    }
                } else if kind == "list" {
                    let items = body
                        .get("items")
                        .and_then(Value::as_array)
                        .cloned()
                        .unwrap_or_default();
                    if !items.is_empty() {
                        let mut list = div().mt_2().flex().flex_col().gap_1();
                        for (ix, item) in items.iter().enumerate() {
                            let Some(text) = item.as_str() else {
                                continue;
                            };
                            list = list.child(
                                div()
                                    .id(format!("{id_prefix}-plugin-block-{block_uid}-item-{ix}"))
                                    .flex()
                                    .items_start()
                                    .gap_2()
                                    .child(
                                        div()
                                            .w(px(12.0))
                                            .text_sm()
                                            .text_color(theme.muted_foreground)
                                            .child("•"),
                                    )
                                    .child(
                                        div()
                                            .flex_1()
                                            .min_w_0()
                                            .text_sm()
                                            .text_color(theme.muted_foreground)
                                            .child(text.to_string()),
                                    ),
                            );
                        }
                        card = card.child(list);
                    }
                } else if kind == "stats" {
                    let items = body
                        .get("items")
                        .and_then(Value::as_array)
                        .cloned()
                        .unwrap_or_default();
                    if !items.is_empty() {
                        let mut stats = div().mt_2().flex().flex_col().gap_1();
                        for (ix, item) in items.iter().enumerate() {
                            let Some(obj) = item.as_object() else {
                                continue;
                            };
                            let label = obj
                                .get("label")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_string();
                            let value = obj
                                .get("value")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_string();
                            stats = stats.child(
                                div()
                                    .id(format!("{id_prefix}-plugin-block-{block_uid}-stat-{ix}"))
                                    .flex()
                                    .items_center()
                                    .justify_between()
                                    .gap_2()
                                    .child(
                                        div()
                                            .text_xs()
                                            .text_color(theme.muted_foreground)
                                            .child(label),
                                    )
                                    .child(
                                        div().text_xs().text_color(theme.foreground).child(value),
                                    ),
                            );
                        }
                        card = card.child(stats);
                    }
                } else {
                    let pretty =
                        serde_json::to_string_pretty(body).unwrap_or_else(|_| body.to_string());
                    card = card.child(
                        div()
                            .mt_2()
                            .p_2()
                            .rounded_sm()
                            .bg(theme.background)
                            .overflow_hidden()
                            .text_xs()
                            .text_color(theme.muted_foreground)
                            .child(pretty),
                    );
                }
            }

            if !view.controls.is_empty() {
                let mut controls = div().mt_2().flex().flex_wrap().gap_2();
                for (control_ix, control) in view.controls.iter().enumerate() {
                    let Some(obj) = control.as_object() else {
                        continue;
                    };
                    let control_type = obj.get("type").and_then(Value::as_str).unwrap_or("");
                    let control_id = obj.get("id").and_then(Value::as_str).unwrap_or("");
                    let label = obj.get("label").and_then(Value::as_str).unwrap_or("");
                    if control_type == "button" {
                        let uid = block_uid.to_string();
                        let action_id = control_id.to_string();
                        let renderer = renderer.clone();
                        controls = controls.child(
                            Button::new(format!(
                                "{id_prefix}-plugin-block-{uid}-control-{control_ix}"
                            ))
                            .label(label.to_string())
                            .xsmall()
                            .ghost()
                            .on_click(cx.listener(
                                move |this, _event, _window, cx| {
                                    this.run_plugin_block_action(
                                        pane, &uid, &renderer, &action_id, None, cx,
                                    );
                                    cx.stop_propagation();
                                },
                            )),
                        );
                    } else if control_type == "select" {
                        let selected = obj
                            .get("value")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string();
                        let options = obj
                            .get("options")
                            .and_then(Value::as_array)
                            .cloned()
                            .unwrap_or_default();
                        if options.is_empty() {
                            continue;
                        }

                        let mut group = div().flex().flex_col().gap_1();
                        if !label.is_empty() {
                            group = group.child(
                                div()
                                    .text_xs()
                                    .text_color(theme.muted_foreground)
                                    .child(label.to_string()),
                            );
                        }
                        let mut option_buttons = div().flex().flex_wrap().gap_1();
                        for (option_ix, option) in options.iter().enumerate() {
                            let Some(opt) = option.as_object() else {
                                continue;
                            };
                            let opt_value = opt
                                .get("value")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_string();
                            let opt_label = opt
                                .get("label")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_string();
                            let is_selected = !opt_value.is_empty() && opt_value == selected;
                            let uid = block_uid.to_string();
                            let action_id = control_id.to_string();
                            let renderer = renderer.clone();
                            let value = opt_value.clone();
                            let mut button = Button::new(format!(
                                "{id_prefix}-plugin-block-{uid}-select-{control_ix}-{option_ix}"
                            ))
                            .label(opt_label)
                            .xsmall();
                            button = if is_selected {
                                button.primary()
                            } else {
                                button.ghost()
                            };
                            option_buttons = option_buttons.child(button.on_click(cx.listener(
                                move |this, _event, _window, cx| {
                                    this.run_plugin_block_action(
                                        pane,
                                        &uid,
                                        &renderer,
                                        &action_id,
                                        Some(&value),
                                        cx,
                                    );
                                    cx.stop_propagation();
                                },
                            )));
                        }
                        group = group.child(option_buttons);
                        controls = controls.child(group);
                    } else if control_type == "clipboard" {
                        let text = obj.get("text").and_then(Value::as_str).unwrap_or("");
                        let copy_text = text.to_string();
                        controls = controls.child(
                            Button::new(format!(
                                "{id_prefix}-plugin-block-{block_uid}-clip-{control_ix}"
                            ))
                            .label(label.to_string())
                            .xsmall()
                            .ghost()
                            .on_click(cx.listener(
                                move |_this, _event, _window, cx| {
                                    cx.write_to_clipboard(gpui::ClipboardItem::new_string(
                                        copy_text.clone(),
                                    ));
                                    cx.stop_propagation();
                                },
                            )),
                        );
                    }
                }
                card = card.child(controls);
            }
        }

        Some(card.into_any_element())
    }

    fn render_diagram_preview(
        &mut self,
        block_uid: &str,
        text: &str,
        cx: &mut Context<Self>,
    ) -> Option<gpui::AnyElement> {
        let fence = crate::app::store::markdown::parse_inline_fence(text)?;
        if !matches!(fence.lang.as_str(), "mermaid" | "diagram") {
            return None;
        }

        self.ensure_diagram_preview(block_uid, &fence.content, cx);

        let theme = cx.theme();
        let badge: SharedString = fence.lang.to_uppercase().into();
        let renderer_title: SharedString = self
            .plugins
            .plugin_status
            .as_ref()
            .and_then(|status| {
                status
                    .renderers
                    .iter()
                    .find(|renderer| renderer.kind == "diagram")
                    .map(|renderer| renderer.title.clone())
            })
            .unwrap_or_else(|| "Diagram renderer".to_string())
            .into();

        let (loading, error, image) = self
            .editor
            .diagram_previews
            .get(block_uid)
            .map(|state| (state.loading, state.error.clone(), state.image.clone()))
            .unwrap_or((true, None, None));

        let header = div().flex().items_center().justify_between().gap_2().child(
            div()
                .flex()
                .flex_col()
                .gap_0()
                .child(
                    div()
                        .text_sm()
                        .text_color(theme.foreground)
                        .font_weight(gpui::FontWeight::MEDIUM)
                        .child("Diagram preview"),
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .child(
                            div()
                                .px_2()
                                .py(px(1.0))
                                .rounded_sm()
                                .bg(theme.secondary)
                                .text_xs()
                                .text_color(theme.foreground)
                                .child(badge),
                        )
                        .child(
                            div()
                                .text_xs()
                                .text_color(theme.muted_foreground)
                                .child(renderer_title),
                        ),
                ),
        );

        let diagram_area = if let Some(image) = image {
            div()
                .mt_2()
                .h(px(180.0))
                .w_full()
                .rounded_sm()
                .border_1()
                .border_color(theme.border)
                .bg(theme.background)
                .child(gpui::img(image).size_full())
                .into_any_element()
        } else if loading {
            div()
                .mt_2()
                .h(px(180.0))
                .w_full()
                .rounded_sm()
                .border_1()
                .border_color(theme.border)
                .bg(theme.background)
                .flex()
                .items_center()
                .justify_center()
                .text_xs()
                .text_color(theme.muted_foreground)
                .child("Rendering diagram...")
                .into_any_element()
        } else {
            div()
                .mt_2()
                .h(px(180.0))
                .w_full()
                .rounded_sm()
                .border_1()
                .border_color(theme.border)
                .bg(theme.background)
                .flex()
                .items_center()
                .justify_center()
                .text_xs()
                .text_color(theme.danger_foreground)
                .child(
                    error
                        .unwrap_or_else(|| "Unable to render diagram preview.".into())
                        .to_string(),
                )
                .into_any_element()
        };

        let monospace = {
            let mut font = gpui::font("SF Mono");
            font.fallbacks = Some(gpui::FontFallbacks::from_fonts(vec![
                "Menlo".to_string(),
                "Monaco".to_string(),
                "Consolas".to_string(),
                "Liberation Mono".to_string(),
                "Courier New".to_string(),
                "monospace".to_string(),
            ]));
            font
        };
        let content_text: SharedString = fence.content.clone().into();
        let run = TextRun {
            len: content_text.len(),
            font: monospace,
            color: theme.foreground,
            background_color: None,
            underline: None,
            strikethrough: None,
        };
        let code_block = StyledText::new(content_text).with_runs(vec![run]);

        Some(
            div()
                .mt_2()
                .p_3()
                .rounded_md()
                .border_1()
                .border_color(theme.border)
                .bg(theme.colors.list)
                .child(header)
                .child(diagram_area)
                .child(
                    div()
                        .mt_2()
                        .p_2()
                        .rounded_sm()
                        .bg(theme.background)
                        .overflow_hidden()
                        .text_xs()
                        .text_color(theme.foreground)
                        .child(code_block),
                )
                .into_any_element(),
        )
    }

    pub(super) fn render_backlinks_panel(
        &mut self,
        cx: &mut Context<Self>,
    ) -> Option<gpui::AnyElement> {
        if !self.settings.context_panel_open {
            return None;
        }
        if self.editor.active_page.is_none() {
            return None;
        }
        let border = cx.theme().border;
        let sidebar_bg = cx.theme().sidebar;
        let list_hover = cx.theme().list_hover;
        let muted = cx.theme().muted_foreground;
        let foreground = cx.theme().foreground;

        let active_block_text = self
            .editor
            .editor
            .as_ref()
            .map(|editor| editor.active().text.clone())
            .unwrap_or_default();

        let has_page_backlinks = !self.editor.backlinks.is_empty();
        let has_block_backlinks = !self.editor.block_backlinks.is_empty();

        let header = self.render_context_panel_header("Backlinks", cx);

        let mut panel = div()
            .id("backlinks-panel")
            .w(px(360.0))
            .h_full()
            .border_l_1()
            .border_color(border)
            .bg(sidebar_bg)
            .flex()
            .flex_col()
            .min_h_0()
            .child(header);

        let mut body = div()
            .id("backlinks-body")
            .flex_1()
            .min_h_0()
            .overflow_scroll();

        if !has_page_backlinks && !has_block_backlinks {
            body = body.child(
                div()
                    .px_3()
                    .py_4()
                    .flex()
                    .flex_col()
                    .gap_1()
                    .child(
                        div()
                            .text_sm()
                            .text_color(foreground)
                            .font_weight(gpui::FontWeight::MEDIUM)
                            .child("No backlinks yet"),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(muted)
                            .child("Link pages with [[wikilinks]] to see backlinks here."),
                    ),
            );
        }

        if has_page_backlinks {
            body = body.child(
                div()
                    .px_3()
                    .pt_3()
                    .pb_1()
                    .text_xs()
                    .font_weight(gpui::FontWeight::MEDIUM)
                    .text_color(muted)
                    .child("PAGE BACKLINKS"),
            );
            body = body.children(self.editor.backlinks.iter().cloned().map(|entry| {
                let snippet = format_snippet(&entry.text, 90);
                let page_uid = entry.page_uid.clone();
                let block_uid = entry.block_uid.clone();
                let open_block_uid = block_uid.clone();
                let split_page_uid = entry.page_uid.clone();
                let split_block_uid = block_uid.clone();
                div()
                    .id(format!("backlinks-page-{}", entry.block_uid))
                    .mx_3()
                    .px_2()
                    .py_2()
                    .mb_1()
                    .rounded_md()
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
                                    .flex_1()
                                    .min_w_0()
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
                                    .opacity(0.0)
                                    .hover(move |s| s.opacity(1.0))
                                    .child(
                                        Button::new(format!("backlinks-open-{}", block_uid))
                                            .xsmall()
                                            .ghost()
                                            .icon(SandpaperIcon::ArrowRight)
                                            .tooltip("Open")
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
                                            .xsmall()
                                            .ghost()
                                            .icon(SandpaperIcon::SplitVertical)
                                            .tooltip("Open in split")
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
                    .pt_4()
                    .pb_1()
                    .flex()
                    .flex_col()
                    .gap(px(2.0))
                    .child(
                        div()
                            .text_xs()
                            .font_weight(gpui::FontWeight::MEDIUM)
                            .text_color(muted)
                            .child("BLOCK BACKLINKS"),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(muted.opacity(0.7))
                            .child(format!("Linked to {block_label}")),
                    ),
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
                    .mx_3()
                    .px_2()
                    .py_2()
                    .mb_1()
                    .rounded_md()
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
                                    .flex_1()
                                    .min_w_0()
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
                                    .opacity(0.0)
                                    .hover(move |s| s.opacity(1.0))
                                    .child(
                                        Button::new(format!("backlinks-block-open-{}", block_uid))
                                            .xsmall()
                                            .ghost()
                                            .icon(SandpaperIcon::ArrowRight)
                                            .tooltip("Open")
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
                                            .xsmall()
                                            .ghost()
                                            .icon(SandpaperIcon::SplitVertical)
                                            .tooltip("Open in split")
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
        let (title, list_state) = {
            let pane = self.editor.secondary_pane.as_ref()?;
            let title = if pane.page.title.trim().is_empty() {
                "Untitled".to_string()
            } else {
                pane.page.title.clone()
            };
            let list_state = pane.list_state.clone();
            (title, list_state)
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

        let mut title_group = div().flex().flex_col().gap(px(2.0)).child(
            div()
                .text_sm()
                .text_color(theme.foreground)
                .font_weight(gpui::FontWeight::MEDIUM)
                .child(title),
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
                    .hover(move |s| s.bg(crumb_hover).cursor_pointer())
                    .text_xs()
                    .text_color(if is_last {
                        theme.foreground
                    } else {
                        theme.muted_foreground
                    })
                    .when(is_last, |this| this.font_weight(gpui::FontWeight::MEDIUM))
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
                    crumb = crumb.child(div().ml_1().text_xs().text_color(theme.border).child("/"));
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
                                .child({
                                    let mut container = div().relative().child(
                                        Button::new("secondary-outline")
                                            .icon(SandpaperIcon::Menu)
                                            .with_size(px(20.0))
                                            .ghost()
                                            .tooltip("Outline")
                                            .on_click(cx.listener(|this, _event, _window, cx| {
                                                this.toggle_outline_menu(EditorPane::Secondary, cx);
                                            })),
                                    );
                                    if self.editor.outline_menu.open
                                        && self.editor.outline_menu.pane == EditorPane::Secondary
                                    {
                                        let menu = self.render_outline_menu_for_pane(
                                            EditorPane::Secondary,
                                            cx,
                                        );
                                        container = container.child(menu);
                                    }
                                    container
                                })
                                .child(
                                    Button::new("secondary-open")
                                        .xsmall()
                                        .ghost()
                                        .icon(SandpaperIcon::ArrowLeft)
                                        .tooltip("Open in primary")
                                        .on_click(cx.listener(move |this, _event, window, cx| {
                                            this.copy_secondary_to_primary(window, cx);
                                        })),
                                )
                                .child(
                                    Button::new("secondary-swap")
                                        .xsmall()
                                        .ghost()
                                        .icon(SandpaperIcon::ArrowSwap)
                                        .tooltip("Swap panes")
                                        .on_click(cx.listener(|this, _event, _window, cx| {
                                            this.swap_panes(cx);
                                        })),
                                )
                                .child(
                                    Button::new("secondary-close")
                                        .xsmall()
                                        .ghost()
                                        .icon(SandpaperIcon::Dismiss)
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
        visible_ix: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> gpui::AnyElement {
        let Some(editor) = self.editor_for_pane(pane) else {
            return div().into_any_element();
        };
        let Some(list_state) = self.list_state_for_pane(pane) else {
            return div().into_any_element();
        };
        let Some(actual_ix) = list_state.visible_to_actual.get(visible_ix).copied() else {
            return div().into_any_element();
        };
        if actual_ix >= editor.blocks.len() {
            return div().into_any_element();
        }
        let next_visible_actual_ix = list_state
            .visible_to_actual
            .get(visible_ix.saturating_add(1))
            .copied()
            .unwrap_or(editor.blocks.len());

        let block = editor.blocks[actual_ix].clone();
        let is_active = editor.active_ix == actual_ix;
        let selection = self.selection_for_pane(pane);
        let is_selected = selection.is_some_and(|selection| selection.contains(visible_ix));
        let has_selection = selection.is_some_and(|selection| selection.has_range());
        let is_highlighted = pane == EditorPane::Primary
            && self
                .editor
                .highlighted_block_uid
                .as_ref()
                .is_some_and(|uid| uid == &block.uid);
        let indent_px = px(12.0 + (block.indent.max(0) as f32) * 18.0);
        let has_children = list_state
            .has_children_by_actual
            .get(actual_ix)
            .copied()
            .unwrap_or(false);
        let is_collapsed = has_children
            && self
                .page_for_pane(pane)
                .and_then(|page| self.editor.collapsed_by_page_uid.get(&page.uid))
                .is_some_and(|collapsed| collapsed.contains(&block.uid));

        let show_input = is_active && !has_selection && self.editor.active_pane == pane;
        let is_drag_source = self
            .editor
            .drag_source
            .as_ref()
            .is_some_and(|source| source.pane == pane && source.block_uid == block.uid);
        let drop_insert_before_ix = self
            .editor
            .drag_target
            .as_ref()
            .filter(|target| target.pane == pane)
            .map(|target| target.insert_before_ix);
        let is_drop_target_before_row = drop_insert_before_ix == Some(actual_ix);
        let is_drop_target_end = drop_insert_before_ix == Some(editor.blocks.len())
            && next_visible_actual_ix == editor.blocks.len();
        let handle_visible = is_drag_source
            || is_active
            || is_selected
            || self.editor.hovered_block_uid.as_deref() == Some(block.uid.as_str());
        let drag_active_in_pane = self
            .editor
            .drag_source
            .as_ref()
            .is_some_and(|source| source.pane == pane);
        let actions = if show_input {
            self.render_block_actions_for_pane(pane, actual_ix, cx)
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
                .capture_action(
                    cx.listener(|this, _: &gpui_component::input::Undo, window, cx| {
                        this.undo_edit_action(&UndoEdit, window, cx);
                        cx.stop_propagation();
                    }),
                )
                .capture_action(
                    cx.listener(|this, _: &gpui_component::input::Redo, window, cx| {
                        this.redo_edit_action(&RedoEdit, window, cx);
                        cx.stop_propagation();
                    }),
                )
                .capture_key_down(cx.listener(move |this, event, window, cx| {
                    if this.handle_block_input_key_down(pane, event, window, cx) {
                        cx.stop_propagation();
                    }
                }))
                .child(input)
                .into_any_element()
        } else {
            let display_text = match block.block_type {
                BlockType::Heading1
                | BlockType::Heading2
                | BlockType::Heading3
                | BlockType::Quote
                | BlockType::Todo
                | BlockType::Divider => crate::app::store::helpers::clean_text_for_block_type(
                    &block.text,
                    block.block_type,
                ),
                _ => block.text.clone(),
            };
            self.render_inline_markdown_text(pane, &block.uid, &display_text, window, cx)
        };

        let mut content_container = div().flex_1().min_w_0().relative().child(content);
        if show_input
            && self.editor.slash_menu.open
            && self.editor.slash_menu.pane == pane
            && self.editor.slash_menu.block_ix == Some(actual_ix)
        {
            let cursor_x = self.block_input_cursor_x(window, cx) + px(BLOCK_INPUT_PADDING_X);
            let menu_origin = point(cursor_x.max(px(0.0)), px(BLOCK_ROW_HEIGHT));
            let menu = self.render_slash_menu_at(pane, menu_origin, cx);
            content_container = content_container.child(menu);
        }
        if show_input
            && self.editor.wikilink_menu.open
            && self.editor.wikilink_menu.pane == pane
            && self.editor.wikilink_menu.block_ix == Some(actual_ix)
        {
            let cursor_x = self.block_input_cursor_x(window, cx) + px(BLOCK_INPUT_PADDING_X);
            let menu_origin = point(cursor_x.max(px(0.0)), px(BLOCK_ROW_HEIGHT));
            let menu = self.render_wikilink_menu_at(pane, menu_origin, cx);
            content_container = content_container.child(menu);
        }

        let (base_bg, selected_bg, active_bg, hover_bg, highlight_bg, muted_fg, drop_line_color) = {
            let theme = cx.theme();
            (
                if pane == EditorPane::Secondary {
                    theme.sidebar
                } else {
                    theme.background
                },
                theme.selection,
                theme.list_hover,
                theme.list_hover,
                theme.accent.opacity(0.25),
                theme.muted_foreground,
                theme.foreground.opacity(0.85),
            )
        };
        let drag_handle_id = match pane {
            EditorPane::Primary => format!("block-drag-handle-{}", block.uid),
            EditorPane::Secondary => format!("secondary-block-drag-handle-{}", block.uid),
        };
        let drag_handle = div()
            .w(px(18.0))
            .flex()
            .items_start()
            .justify_center()
            .pt(px(4.0))
            .child(
                div()
                    .id(drag_handle_id)
                    .w(px(14.0))
                    .h(px(18.0))
                    .rounded_sm()
                    .flex()
                    .items_center()
                    .justify_center()
                    .opacity(if handle_visible { 1.0 } else { 0.0 })
                    .hover(move |s| s.bg(hover_bg).opacity(1.0).cursor_pointer())
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(move |this, _event: &MouseDownEvent, _window, cx| {
                            this.begin_block_drag_in_pane(pane, visible_ix, cx);
                            cx.stop_propagation();
                        }),
                    )
                    .on_mouse_move(cx.listener(
                        move |this, _event: &MouseMoveEvent, _window, cx| {
                            this.update_block_drag_target_for_visible_row_in_pane(
                                pane, visible_ix, cx,
                            );
                            cx.stop_propagation();
                        },
                    ))
                    .on_mouse_up(
                        MouseButton::Left,
                        cx.listener(move |this, _event: &MouseUpEvent, _window, cx| {
                            if this
                                .editor
                                .drag_source
                                .as_ref()
                                .is_some_and(|source| source.pane == pane)
                            {
                                let _ = this.commit_block_drag_for_pane(pane, cx);
                                cx.stop_propagation();
                            }
                        }),
                    )
                    .child(
                        Icon::new(SandpaperIcon::DragHandle)
                            .size(px(12.0))
                            .text_color(muted_fg),
                    ),
            );

        let mut container = div()
            .id(match pane {
                EditorPane::Primary => block.uid.clone(),
                EditorPane::Secondary => format!("secondary-{}", block.uid),
            })
            .w_full()
            .flex()
            .flex_col()
            .gap_0()
            .relative()
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
                    this.update_block_drag_target_for_visible_row_in_pane(pane, visible_ix, cx);
                    this.begin_block_pointer_selection_in_pane(
                        pane,
                        visible_ix,
                        event.position,
                        event.modifiers.shift,
                    );
                }),
            )
            .on_mouse_move(
                cx.listener(move |this, event: &MouseMoveEvent, _window, cx| {
                    if this
                        .editor
                        .drag_source
                        .as_ref()
                        .is_some_and(|source| source.pane == pane)
                    {
                        return;
                    }
                    this.update_block_drag_target_for_visible_row_in_pane(pane, visible_ix, cx);
                    this.update_block_pointer_selection_in_pane(
                        pane,
                        visible_ix,
                        event.position,
                        cx,
                    );
                }),
            )
            .on_mouse_up(
                MouseButton::Left,
                cx.listener(move |this, _event: &MouseUpEvent, _window, cx| {
                    if this
                        .editor
                        .drag_source
                        .as_ref()
                        .is_some_and(|source| source.pane == pane)
                    {
                        let _ = this.commit_block_drag_for_pane(pane, cx);
                        cx.stop_propagation();
                        return;
                    }
                    this.end_block_pointer_selection_in_pane(pane, cx);
                }),
            )
            .on_mouse_up_out(
                MouseButton::Left,
                cx.listener(move |this, _event: &MouseUpEvent, _window, cx| {
                    if this
                        .editor
                        .drag_source
                        .as_ref()
                        .is_some_and(|source| source.pane == pane)
                    {
                        let _ = this.commit_block_drag_for_pane(pane, cx);
                        cx.stop_propagation();
                        return;
                    }
                    this.end_block_pointer_selection_in_pane(pane, cx);
                }),
            )
            .on_click(cx.listener(move |this, event, window, cx| {
                this.on_click_block_with_event_in_pane(pane, visible_ix, event, window, cx);
            }))
            .child(
                div()
                    .w_full()
                    .flex()
                    .items_start()
                    .gap_1()
                    .child(drag_handle)
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .child(self.render_typed_block_inner(
                                &block,
                                content_container,
                                actions,
                                indent_px,
                                has_children,
                                is_collapsed,
                                pane,
                                actual_ix,
                                base_bg,
                                cx,
                            )),
                    ),
            );

        if is_drag_source {
            container = container.opacity(0.55);
        }
        let show_drop_line = self
            .editor
            .drag_source
            .as_ref()
            .is_some_and(|source| source.pane == pane && source.block_uid != block.uid);
        if show_drop_line && is_drop_target_before_row {
            container = container.child(
                div()
                    .absolute()
                    .top(px(0.0))
                    .left(px(0.0))
                    .right(px(0.0))
                    .h(px(2.0))
                    .bg(drop_line_color),
            );
        }
        if show_drop_line && is_drop_target_end {
            container = container.child(
                div()
                    .absolute()
                    .bottom(px(0.0))
                    .left(px(0.0))
                    .right(px(0.0))
                    .h(px(2.0))
                    .bg(drop_line_color),
            );
        }
        if drag_active_in_pane {
            container = container.child(
                div()
                    .absolute()
                    .inset_0()
                    .flex()
                    .flex_col()
                    .child(
                        div()
                            .flex_1()
                            .on_mouse_move(cx.listener(
                                move |this, _event: &MouseMoveEvent, _window, cx| {
                                    this.update_block_drag_target_for_visible_drop_slot_in_pane(
                                        pane, visible_ix, false, cx,
                                    );
                                    cx.stop_propagation();
                                },
                            ))
                            .on_mouse_up(
                                MouseButton::Left,
                                cx.listener(move |this, _event: &MouseUpEvent, _window, cx| {
                                    let _ = this.commit_block_drag_for_pane(pane, cx);
                                    cx.stop_propagation();
                                }),
                            ),
                    )
                    .child(
                        div()
                            .flex_1()
                            .on_mouse_move(cx.listener(
                                move |this, _event: &MouseMoveEvent, _window, cx| {
                                    this.update_block_drag_target_for_visible_drop_slot_in_pane(
                                        pane, visible_ix, true, cx,
                                    );
                                    cx.stop_propagation();
                                },
                            ))
                            .on_mouse_up(
                                MouseButton::Left,
                                cx.listener(move |this, _event: &MouseUpEvent, _window, cx| {
                                    let _ = this.commit_block_drag_for_pane(pane, cx);
                                    cx.stop_propagation();
                                }),
                            ),
                    ),
            );
        }

        let preview = self
            .render_plugin_block_preview(pane, &block.uid, &block.text, cx)
            .or_else(|| self.render_code_preview(&block.uid, &block.text, cx))
            .or_else(|| self.render_diagram_preview(&block.uid, &block.text, cx));
        if let Some(preview) = preview {
            container = container.child(
                div()
                    .flex()
                    .gap_2()
                    .px_2()
                    .pb_2()
                    .child(div().w(px(18.0)).h(px(1.0)).bg(base_bg))
                    // Reserve space for indent + collapse toggle + bullet
                    .child(div().w(indent_px).h(px(1.0)).bg(base_bg))
                    .child(div().w(px(28.0)).h(px(1.0)))
                    .child(div().flex_1().min_w_0().child(preview)),
            );
        }

        // Focus mode: dim non-active blocks
        if self.settings.focus_mode {
            let active_ix = self.editor_for_pane(pane).map(|e| e.active_ix).unwrap_or(0);
            let distance = (actual_ix as isize - active_ix as isize).unsigned_abs();
            let opacity = match distance {
                0 => 1.0,
                1 => 0.6,
                _ => 0.25,
            };
            container = container.opacity(opacity);
        }

        container.into_any_element()
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
            .gap(px(2.0))
            .opacity(0.0)
            .hover(|s| s.opacity(1.0))
            .child(
                Button::new(format!("{id_prefix}-insert-{ix}"))
                    .icon(SandpaperIcon::Add)
                    .with_size(px(18.0))
                    .ghost()
                    .tooltip("Insert below")
                    .on_click(cx.listener(move |this, _event, window, cx| {
                        this.set_active_pane(pane, cx);
                        this.insert_block_after_in_pane(pane, insert_ix, window, cx);
                    })),
            )
            .child(
                Button::new(format!("{id_prefix}-review-{ix}"))
                    .icon(SandpaperIcon::Eye)
                    .with_size(px(18.0))
                    .ghost()
                    .tooltip("Add to review")
                    .on_click(cx.listener(move |this, _event, _window, cx| {
                        this.set_active_pane(pane, cx);
                        this.add_review_from_block_in_pane(pane, review_ix, cx);
                    })),
            )
            .child(
                Button::new(format!("{id_prefix}-link-{ix}"))
                    .icon(SandpaperIcon::Open)
                    .with_size(px(18.0))
                    .ghost()
                    .tooltip("Link to page")
                    .on_click(cx.listener(move |this, _event, window, cx| {
                        this.set_active_pane(pane, cx);
                        this.link_block_to_page_in_pane(pane, link_ix, window, cx);
                    })),
            )
            .child(
                Button::new(format!("{id_prefix}-duplicate-{ix}"))
                    .icon(SandpaperIcon::Copy)
                    .with_size(px(18.0))
                    .ghost()
                    .tooltip("Duplicate block")
                    .on_click(cx.listener(move |this, _event, window, cx| {
                        this.set_active_pane(pane, cx);
                        this.duplicate_block_at_in_pane(pane, duplicate_ix, window, cx);
                    })),
            )
    }

    pub(super) fn render_review_pane(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let border = cx.theme().border;
        let sidebar_bg = cx.theme().sidebar;
        let muted = cx.theme().muted_foreground;
        let foreground = cx.theme().foreground;
        let list_active = cx.theme().list_active;
        let list_hover = cx.theme().list_hover;
        let count = self.editor.review_items.len();
        let header = self.render_context_panel_header("Review Queue", cx);
        let selected_ix = if count == 0 {
            0
        } else {
            self.editor.review_selected_index.min(count - 1)
        };

        let mut list = div().id("review-list").flex_1().min_h_0().overflow_scroll();

        if self.editor.review_items.is_empty() {
            list = list.child(
                div()
                    .py_4()
                    .text_sm()
                    .text_color(muted)
                    .child("No review items due yet."),
            );
        } else {
            for (ix, item) in self.editor.review_items.iter().enumerate() {
                let is_selected = ix == selected_ix;
                let block_uid = item.block_uid.clone();
                let page_uid = item.page_uid.clone();
                let item_id = item.id;
                let snippet = format_snippet(&item.text, 96);
                let page_title = item.page_title.clone();
                let due_label = chrono::Local
                    .timestamp_millis_opt(item.due_at)
                    .single()
                    .map(|dt| dt.format("%b %d, %H:%M").to_string())
                    .unwrap_or_else(|| "Due soon".to_string());

                list = list.child(
                    div()
                        .id(format!("review-row-{item_id}"))
                        .px_3()
                        .py_2()
                        .rounded_md()
                        .when(is_selected, |this| {
                            this.bg(list_active).border_1().border_color(border)
                        })
                        .hover(move |s| s.bg(list_hover).cursor_pointer())
                        .flex()
                        .flex_col()
                        .gap_1()
                        .child(div().text_sm().text_color(foreground).child(snippet))
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .justify_between()
                                .child(
                                    div()
                                        .text_xs()
                                        .text_color(muted)
                                        .child(format!("{page_title}  ·  {due_label}")),
                                )
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap(px(2.0))
                                        .child(
                                            Button::new(format!("review-done-{item_id}"))
                                                .icon(SandpaperIcon::Checkmark)
                                                .with_size(px(18.0))
                                                .ghost()
                                                .tooltip("Done (D)")
                                                .on_click(cx.listener(
                                                    move |this, _event, _window, cx| {
                                                        this.review_mark_done(item_id, cx);
                                                    },
                                                )),
                                        )
                                        .child(
                                            Button::new(format!("review-snooze-day-{item_id}"))
                                                .icon(SandpaperIcon::Subtract)
                                                .with_size(px(18.0))
                                                .ghost()
                                                .tooltip("Snooze 1 day (S)")
                                                .on_click(cx.listener(
                                                    move |this, _event, _window, cx| {
                                                        this.review_snooze_day(item_id, cx);
                                                    },
                                                )),
                                        )
                                        .child(
                                            Button::new(format!("review-snooze-week-{item_id}"))
                                                .label("1w")
                                                .xsmall()
                                                .ghost()
                                                .tooltip("Snooze 1 week (W)")
                                                .on_click(cx.listener(
                                                    move |this, _event, _window, cx| {
                                                        this.review_snooze_week(item_id, cx);
                                                    },
                                                )),
                                        ),
                                ),
                        )
                        .on_click(cx.listener(move |this, _event, window, cx| {
                            this.editor.review_selected_index = ix;
                            this.open_page_and_focus_block(&page_uid, &block_uid, window, cx);
                            cx.notify();
                        })),
                );
            }
        }

        div()
            .id("review-panel")
            .w(px(360.0))
            .h_full()
            .border_l_1()
            .border_color(border)
            .bg(sidebar_bg)
            .flex()
            .flex_col()
            .min_h_0()
            .capture_key_down(cx.listener(|this, event: &KeyDownEvent, window, cx| {
                if event.keystroke.modifiers.modified() {
                    return;
                }
                let count = this.editor.review_items.len();
                if count == 0 {
                    return;
                }
                let selected = this.editor.review_selected_index.min(count - 1);
                match event.keystroke.key.as_str() {
                    "j" | "down" => {
                        this.editor.review_selected_index = (selected + 1).min(count - 1);
                        cx.notify();
                        cx.stop_propagation();
                    }
                    "k" | "up" => {
                        this.editor.review_selected_index = selected.saturating_sub(1);
                        cx.notify();
                        cx.stop_propagation();
                    }
                    "enter" => {
                        if let Some(item) = this.editor.review_items.get(selected).cloned() {
                            this.open_page_and_focus_block(
                                &item.page_uid,
                                &item.block_uid,
                                window,
                                cx,
                            );
                            cx.stop_propagation();
                        }
                    }
                    "d" => {
                        if let Some(item) = this.editor.review_items.get(selected) {
                            this.review_mark_done(item.id, cx);
                            cx.stop_propagation();
                        }
                    }
                    "s" => {
                        if let Some(item) = this.editor.review_items.get(selected) {
                            this.review_snooze_day(item.id, cx);
                            cx.stop_propagation();
                        }
                    }
                    "w" => {
                        if let Some(item) = this.editor.review_items.get(selected) {
                            this.review_snooze_week(item.id, cx);
                            cx.stop_propagation();
                        }
                    }
                    _ => {}
                }
            }))
            .child(header)
            .child(
                div()
                    .px_3()
                    .py(px(6.0))
                    .text_xs()
                    .text_color(muted.opacity(0.7))
                    .child(format!(
                        "{count} due  ·  j/k navigate  ·  d done  ·  s snooze"
                    )),
            )
            .child(div().px_3().pb_3().flex_1().min_h_0().child(list))
    }
}
