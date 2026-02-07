use super::*;
use crate::services::agent_debug::bridge::{DebugActRequest, DebugRequestKind, DebugResponse};
use crate::services::agent_debug::screenshot::{PlatformScreenshotProvider, ScreenshotProvider};
use serde_json::{json, Value};
use std::sync::mpsc::TryRecvError;

pub(crate) trait DebugSnapshotProvider {
    fn build_debug_tree(&self, cx: &mut Context<AppStore>) -> Value;
}

pub(crate) trait ActionExecutor {
    fn execute_debug_action(
        &mut self,
        request: &DebugActRequest,
        cx: &mut Context<AppStore>,
    ) -> Result<Value, DebugResponse>;
}

impl DebugSnapshotProvider for AppStore {
    fn build_debug_tree(&self, cx: &mut Context<AppStore>) -> Value {
        let active_page_uid = self
            .editor
            .active_page
            .as_ref()
            .map(|page| page.uid.clone());
        let active_page_title = self
            .editor
            .active_page
            .as_ref()
            .map(|page| page.title.clone());
        let mode = self.app.mode.as_str();
        let context_panel_tab = self.settings.context_panel_tab.as_str();
        let active_pane = match self.editor.active_pane {
            EditorPane::Primary => "primary",
            EditorPane::Secondary => "secondary",
        };

        let ids = [
            ("sandpaper-app", "application"),
            ("sidebar-rail", "navigation"),
            ("pages-list", "list"),
            ("search-scroll", "region"),
            ("sidebar-search-input", "textbox"),
            ("editor-page-title", "heading"),
            ("topbar-left", "group"),
            ("topbar-center", "group"),
            ("topbar-mode-switcher", "group"),
            ("topbar-right", "group"),
            ("command-palette", "dialog"),
            ("command-palette-input", "textbox"),
            ("settings-sheet", "dialog"),
            ("open-command-palette-action", "button"),
            ("open-settings-action", "button"),
            ("review-panel", "region"),
            ("backlinks-panel", "region"),
            ("plugin-panel", "region"),
            ("capture-overlay-backdrop", "button"),
            ("quick-capture-input", "textbox"),
            ("page-dialog", "dialog"),
            ("page-dialog-input", "textbox"),
            ("vault-dialog", "dialog"),
            ("vault-dialog-name-input", "textbox"),
            ("vault-dialog-path-input", "textbox"),
            ("notifications-dialog", "dialog"),
            ("new-page-action", "button"),
            ("rename-page-action", "button"),
            ("toggle-sidebar-action", "button"),
            ("open-quick-capture-action", "button"),
            ("block-input", "textbox"),
            ("navigate-to-page", "action"),
            ("properties-toggle", "button"),
            ("connections-panel", "region"),
            ("focus-mode-toggle", "button"),
            ("slash-command", "action"),
            ("switch-mode", "action"),
        ];

        let elements: Vec<Value> = ids
            .into_iter()
            .map(|(id, role)| {
                let visible = self.debug_element_visible(id);
                let mut element = json!({
                    "id": id,
                    "role": role,
                    "visible": visible,
                    "enabled": true,
                    "actions": supported_actions(id),
                });
                if id == "review-panel"
                    || id == "backlinks-panel"
                    || id == "plugin-panel"
                    || id == "connections-panel"
                {
                    let selected = match id {
                        "review-panel" => context_panel_tab == "review",
                        "backlinks-panel" => context_panel_tab == "backlinks",
                        "plugin-panel" => context_panel_tab == "plugins",
                        "connections-panel" => context_panel_tab == "connections",
                        _ => false,
                    };
                    element["selected"] = Value::Bool(selected);
                }
                if let Some(value) = self.debug_input_value(id, cx) {
                    element["value"] = Value::String(value);
                }
                element
            })
            .collect();

        let pane = self.editor.active_pane;
        let (block_count, active_block_index, active_block_text, active_block_type) =
            match self.editor_for_pane(pane) {
                Some(editor) => {
                    let count = editor.blocks.len();
                    let idx = editor.active_ix;
                    let text = editor.blocks.get(idx).map(|b| b.text.clone());
                    let btype = editor
                        .blocks
                        .get(idx)
                        .map(|b| format!("{:?}", b.block_type));
                    (count, Some(idx), text, btype)
                }
                None => (0, None, None, None),
            };

        json!({
            "root_id": "sandpaper-app",
            "state": {
                "mode": mode,
                "active_page_uid": active_page_uid,
                "active_page_title": active_page_title,
                "active_pane": active_pane,
                "palette_open": self.ui.palette_open,
                "settings_open": self.settings.open,
                "context_panel_open": self.settings.context_panel_open,
                "context_panel_tab": context_panel_tab,
                "focus_mode": self.settings.focus_mode,
                "sidebar_collapsed": self.settings.sidebar_collapsed,
                "capture_overlay_open": self.ui.capture_overlay_open,
                "page_dialog_open": self.ui.page_dialog_open,
                "vault_dialog_open": self.ui.vault_dialog_open,
                "notifications_open": self.ui.notifications_open,
                "properties_open": self.editor.properties_open,
                "block_count": block_count,
                "active_block_index": active_block_index,
                "active_block_text": active_block_text,
                "active_block_type": active_block_type,
                "slash_menu_open": self.editor.slash_menu.open,
            },
            "elements": elements,
        })
    }
}

impl ActionExecutor for AppStore {
    fn execute_debug_action(
        &mut self,
        request: &DebugActRequest,
        cx: &mut Context<AppStore>,
    ) -> Result<Value, DebugResponse> {
        let element_id = request.element_id.trim();
        let action = request.action.trim().to_ascii_lowercase();

        if !supports_action(element_id, &action) {
            return Err(DebugResponse::error(
                422,
                "unsupported_action",
                "unsupported element_id/action pair",
            ));
        }

        if !self.debug_element_visible(element_id) {
            return Err(DebugResponse::error(
                409,
                "not_actionable",
                "element is not visible in current UI state",
            ));
        }

        match (element_id, action.as_str()) {
            ("sidebar-rail", "click") | ("toggle-sidebar-action", "click") => {
                self.settings.sidebar_collapsed = !self.settings.sidebar_collapsed;
                self.persist_settings();
                cx.notify();
            }
            ("command-palette", "click") => {
                self.ui.palette_open = true;
                self.ui.palette_query.clear();
                self.ui.palette_index = 0;
                let input = self.ui.palette_input.clone();
                self.with_window(cx, move |window, cx| {
                    input.update(cx, |input_state, cx| {
                        input_state.set_value(String::new(), window, cx);
                        let position = input_state.text().offset_to_position(0);
                        input_state.set_cursor_position(position, window, cx);
                    });
                    window.focus(&input.focus_handle(cx), cx);
                });
                cx.notify();
            }
            ("open-command-palette-action", "click") => {
                self.ui.palette_open = true;
                self.ui.palette_query.clear();
                self.ui.palette_index = 0;
                let input = self.ui.palette_input.clone();
                let app_entity = cx.entity().clone();
                let view = cx.new(|cx| {
                    crate::ui::dialogs::CommandPaletteDialogView::new(app_entity.clone(), cx)
                });
                let popover_bg = cx.theme().popover;
                self.with_window(cx, move |window, cx| {
                    input.update(cx, |input_state, cx| {
                        input_state.set_value(String::new(), window, cx);
                        let position = input_state.text().offset_to_position(0);
                        input_state.set_cursor_position(position, window, cx);
                    });
                    let app_for_close = app_entity.clone();
                    window.open_dialog(cx, move |dialog, _window, _cx| {
                        let app = app_for_close.clone();
                        let view = view.clone();
                        dialog
                            .w(gpui::px(640.0))
                            .keyboard(false)
                            .close_button(false)
                            .p_0()
                            .bg(popover_bg)
                            .child(view)
                            .on_close(move |_event, _window, cx| {
                                app.update(cx, |app, cx| {
                                    app.dismiss_command_palette(cx);
                                });
                            })
                    });
                    window.focus(&input.focus_handle(cx), cx);
                });
                cx.notify();
            }
            ("command-palette", "close") => {
                self.ui.palette_open = false;
                self.ui.palette_query.clear();
                self.ui.palette_index = 0;
                self.with_window(cx, move |window, cx| {
                    window.close_dialog(cx);
                });
                cx.notify();
            }
            ("settings-sheet", "click") | ("open-settings-action", "click") => {
                self.settings.open(SettingsTab::General);
                self.persist_settings();
                let app_entity = cx.entity().clone();
                let view = cx.new(|cx| {
                    crate::ui::dialogs::SettingsSheetView::new(app_entity.clone(), cx)
                });
                self.with_window(cx, move |window, cx| {
                    let app_for_close = app_entity.clone();
                    window.open_sheet(cx, move |sheet, _window, _cx| {
                        let app = app_for_close.clone();
                        let view = view.clone();
                        sheet
                            .title("Settings")
                            .size(gpui::px(760.0))
                            .child(view)
                            .on_close(move |_event, _window, cx| {
                                app.update(cx, |app, cx| {
                                    app.close_settings(cx);
                                });
                            })
                    });
                });
                cx.notify();
            }
            ("review-panel", "click") => {
                self.set_context_panel_tab(WorkspacePanel::Review, cx);
            }
            ("backlinks-panel", "click") => {
                self.set_context_panel_tab(WorkspacePanel::Backlinks, cx);
            }
            ("plugin-panel", "click") => {
                self.set_context_panel_tab(WorkspacePanel::Plugins, cx);
            }
            ("capture-overlay-backdrop", "click") => {
                self.dismiss_quick_capture(cx);
            }
            ("editor-page-title", "click") => {
                self.set_active_pane(EditorPane::Primary, cx);
                self.sync_block_input_from_active_for_pane(EditorPane::Primary, None, cx);
                let input = self.editor.block_input.clone();
                self.with_window(cx, move |window, cx| {
                    window.focus(&input.focus_handle(cx), cx);
                });
            }
            ("sidebar-search-input", "focus") => {
                let input = self.editor.sidebar_search_input.clone();
                self.with_window(cx, move |window, cx| {
                    window.focus(&input.focus_handle(cx), cx);
                });
            }
            ("sidebar-search-input", "set_text") => {
                let text = read_text_arg(&request.args)?;
                let input = self.editor.sidebar_search_input.clone();
                let text_for_input = text.clone();
                self.with_window(cx, move |window, cx| {
                    input.update(cx, |input_state, cx| {
                        input_state.set_value(text_for_input.clone(), window, cx);
                        let position = input_state.text().offset_to_position(text_for_input.len());
                        input_state.set_cursor_position(position, window, cx);
                    });
                });
                self.editor.sidebar_search_query = text;
                self.refresh_search_results();
                cx.notify();
            }
            ("command-palette-input", "set_text") => {
                let text = read_text_arg(&request.args)?;
                let input = self.ui.palette_input.clone();
                let text_for_input = text.clone();
                self.with_window(cx, move |window, cx| {
                    input.update(cx, |input_state, cx| {
                        input_state.set_value(text_for_input.clone(), window, cx);
                        let position = input_state.text().offset_to_position(text_for_input.len());
                        input_state.set_cursor_position(position, window, cx);
                    });
                });
                self.ui.palette_query = text;
                self.ui.palette_index = 0;
                cx.notify();
            }
            ("quick-capture-input", "focus") => {
                let input = self.editor.capture_input.clone();
                self.with_window(cx, move |window, cx| {
                    window.focus(&input.focus_handle(cx), cx);
                });
            }
            ("quick-capture-input", "set_text") => {
                let text = read_text_arg(&request.args)?;
                let input = self.editor.capture_input.clone();
                self.with_window(cx, move |window, cx| {
                    input.update(cx, |input_state, cx| {
                        input_state.set_value(text.clone(), window, cx);
                        let position = input_state.text().offset_to_position(text.len());
                        input_state.set_cursor_position(position, window, cx);
                    });
                });
            }
            ("open-quick-capture-action", "click") => {
                self.ui.capture_overlay_open = true;
                self.ui.capture_overlay_epoch += 1;
                self.ui.capture_overlay_target = self.settings.quick_add_target;
                let input = self.editor.capture_input.clone();
                self.with_window(cx, move |window, cx| {
                    window.focus(&input.focus_handle(cx), cx);
                });
                cx.notify();
            }
            ("block-input", "focus") => {
                let pane = self.editor.active_pane;
                self.sync_block_input_from_active_for_pane(pane, None, cx);
                let input = self.editor.block_input.clone();
                self.with_window(cx, move |window, cx| {
                    window.focus(&input.focus_handle(cx), cx);
                });
            }
            ("block-input", "set_text") => {
                let text = read_text_arg(&request.args)?;
                let pane = self.editor.active_pane;
                if let Some(editor) = self.editor_for_pane_mut(pane) {
                    let idx = editor.active_ix;
                    if idx < editor.blocks.len() {
                        editor.blocks[idx].text = text.clone();
                    }
                }
                let input = self.editor.block_input.clone();
                let text_for_input = text.clone();
                self.with_window(cx, move |window, cx| {
                    input.update(cx, |input_state, cx| {
                        input_state.set_value(text_for_input.clone(), window, cx);
                        let position = input_state.text().offset_to_position(text_for_input.len());
                        input_state.set_cursor_position(position, window, cx);
                    });
                });
                self.mark_dirty_for_pane(pane, cx);
                cx.notify();
            }
            ("block-input", "insert_block_below") => {
                let pane = self.editor.active_pane;
                if let Some(editor) = self.editor_for_pane_mut(pane) {
                    let text_len = editor.active().text.len();
                    editor.split_active_and_insert_after(text_len);
                }
                self.update_block_list_for_pane(pane);
                self.sync_block_input_from_active_for_pane(pane, None, cx);
                let input = self.editor.block_input.clone();
                self.with_window(cx, move |window, cx| {
                    window.focus(&input.focus_handle(cx), cx);
                });
                self.mark_dirty_for_pane(pane, cx);
                cx.notify();
            }
            ("navigate-to-page", "click") => {
                let title = request
                    .args
                    .as_ref()
                    .and_then(|v| v.get("title"))
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        DebugResponse::error(
                            422,
                            "invalid_args",
                            "args.title is required and must be a string",
                        )
                    })?;
                let db = self.app.db.as_ref().ok_or_else(|| {
                    DebugResponse::error(503, "no_database", "database not available")
                })?;
                let pages = db
                    .list_pages()
                    .map_err(|_| DebugResponse::error(500, "db_error", "failed to list pages"))?;
                let page = pages.iter().find(|p| p.title == title).ok_or_else(|| {
                    DebugResponse::error(
                        404,
                        "page_not_found",
                        &format!("no page with title '{title}'"),
                    )
                })?;
                let uid = page.uid.clone();
                self.open_page(&uid, cx);
                cx.notify();
            }
            ("properties-toggle", "click") => {
                self.editor.properties_open = !self.editor.properties_open;
                cx.notify();
            }
            ("connections-panel", "click") => {
                self.set_context_panel_tab(WorkspacePanel::Connections, cx);
            }
            ("focus-mode-toggle", "click") => {
                self.settings.focus_mode = !self.settings.focus_mode;
                self.persist_settings();
                cx.notify();
            }
            ("switch-mode", "click") => {
                let mode_str = request
                    .args
                    .as_ref()
                    .and_then(|v| v.get("mode"))
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        DebugResponse::error(
                            422,
                            "invalid_args",
                            "args.mode is required (capture, editor, review)",
                        )
                    })?;
                let mode = Mode::from_str(mode_str).ok_or_else(|| {
                    DebugResponse::error(
                        422,
                        "invalid_args",
                        &format!("unknown mode '{mode_str}' — use capture, editor, or review"),
                    )
                })?;
                self.set_mode(mode, cx);
            }
            ("slash-command", "execute") => {
                let cmd_name = request
                    .args
                    .as_ref()
                    .and_then(|v| v.get("command"))
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        DebugResponse::error(
                            422,
                            "invalid_args",
                            "args.command is required and must be a string",
                        )
                    })?;
                let cmd = SLASH_COMMANDS
                    .iter()
                    .find(|c| c.id == cmd_name)
                    .ok_or_else(|| {
                        DebugResponse::error(
                            404,
                            "unknown_command",
                            &format!("unknown slash command '{cmd_name}'"),
                        )
                    })?;
                let pane = self.editor.active_pane;
                match cmd.action {
                    SlashAction::SetBlockType(block_type) => {
                        if let Some(editor) = self.editor_for_pane_mut(pane) {
                            let idx = editor.active_ix;
                            if idx < editor.blocks.len() {
                                let cleaned = helpers::clean_text_for_block_type(
                                    &editor.blocks[idx].text,
                                    block_type,
                                );
                                editor.blocks[idx].text = cleaned.clone();
                                editor.blocks[idx].block_type = block_type;
                            }
                        }
                        self.sync_block_input_from_active_for_pane(pane, None, cx);
                        self.update_block_list_for_pane(pane);
                        self.mark_dirty_for_pane(pane, cx);
                        cx.notify();
                    }
                    SlashAction::InsertImage => {
                        if let Some(editor) = self.editor_for_pane_mut(pane) {
                            let idx = editor.active_ix;
                            if idx < editor.blocks.len() {
                                let cleaned = helpers::clean_text_for_block_type(
                                    &editor.blocks[idx].text,
                                    BlockType::Image,
                                );
                                editor.blocks[idx].text = cleaned;
                                editor.blocks[idx].block_type = BlockType::Image;
                            }
                        }
                        self.sync_block_input_from_active_for_pane(pane, None, cx);
                        self.update_block_list_for_pane(pane);
                        self.mark_dirty_for_pane(pane, cx);
                        cx.notify();
                    }
                    SlashAction::TextTransform => {
                        return Err(DebugResponse::error(
                            422,
                            "unsupported_command",
                            "text transform commands are not supported via debug API",
                        ));
                    }
                }
            }
            ("page-dialog", "click") | ("new-page-action", "click") => {
                self.open_page_dialog(PageDialogMode::Create, cx);
            }
            ("rename-page-action", "click") => {
                self.open_page_dialog(PageDialogMode::Rename, cx);
            }
            ("page-dialog-input", "set_text") => {
                let text = read_text_arg(&request.args)?;
                let input = self.ui.page_dialog_input.clone();
                self.with_window(cx, move |window, cx| {
                    input.update(cx, |input_state, cx| {
                        input_state.set_value(text.clone(), window, cx);
                        let position = input_state.text().offset_to_position(text.len());
                        input_state.set_cursor_position(position, window, cx);
                    });
                });
            }
            ("vault-dialog-name-input", "set_text") => {
                let text = read_text_arg(&request.args)?;
                let input = self.ui.vault_dialog_name_input.clone();
                self.with_window(cx, move |window, cx| {
                    input.update(cx, |input_state, cx| {
                        input_state.set_value(text.clone(), window, cx);
                        let position = input_state.text().offset_to_position(text.len());
                        input_state.set_cursor_position(position, window, cx);
                    });
                });
            }
            ("vault-dialog-path-input", "set_text") => {
                let text = read_text_arg(&request.args)?;
                let input = self.ui.vault_dialog_path_input.clone();
                self.with_window(cx, move |window, cx| {
                    input.update(cx, |input_state, cx| {
                        input_state.set_value(text.clone(), window, cx);
                        let position = input_state.text().offset_to_position(text.len());
                        input_state.set_cursor_position(position, window, cx);
                    });
                });
            }
            _ => {
                return Err(DebugResponse::error(
                    422,
                    "unsupported_action",
                    "unsupported element_id/action pair",
                ));
            }
        }

        Ok(json!({
            "ok": true,
            "applied_action": {
                "element_id": element_id,
                "action": action,
            }
        }))
    }
}

impl AppStore {
    pub(crate) fn init_agent_debug(&mut self, cx: &mut Context<Self>) {
        match crate::services::agent_debug::start_from_env() {
            Ok(Some(bridge)) => {
                self.agent_debug = Some(bridge);
                self.schedule_agent_debug_pump(cx);
            }
            Ok(None) => {}
            Err(err) => {
                panic!("failed to start agent debug server: {err}");
            }
        }
    }

    fn schedule_agent_debug_pump(&self, cx: &mut Context<Self>) {
        cx.spawn(async move |this, cx| loop {
            cx.background_executor()
                .timer(Duration::from_millis(16))
                .await;
            if this
                .update(cx, |this, cx| this.process_agent_debug_requests(cx))
                .is_err()
            {
                break;
            }
        })
        .detach();
    }

    pub(crate) fn process_agent_debug_requests(&mut self, cx: &mut Context<Self>) {
        if self.agent_debug.is_none() {
            return;
        }

        let mut disconnected = false;
        for _ in 0..64 {
            let envelope = match self.agent_debug.as_mut() {
                Some(bridge) => match bridge.request_rx.try_recv() {
                    Ok(envelope) => envelope,
                    Err(TryRecvError::Empty) => break,
                    Err(TryRecvError::Disconnected) => {
                        disconnected = true;
                        break;
                    }
                },
                None => break,
            };

            let response = self.handle_agent_debug_request(envelope.kind, cx);
            let _ = envelope.respond_to.send(response);
        }

        if disconnected {
            self.agent_debug = None;
        }
    }

    fn handle_agent_debug_request(
        &mut self,
        kind: DebugRequestKind,
        cx: &mut Context<Self>,
    ) -> DebugResponse {
        match kind {
            DebugRequestKind::Tree => DebugResponse::ok(json!({
                "ok": true,
                "tree": self.build_debug_tree(cx),
            })),
            DebugRequestKind::Snapshot => {
                let screenshot_provider = PlatformScreenshotProvider;
                let screenshot = match screenshot_provider.capture_png() {
                    Ok(path) => json!({
                        "available": true,
                        "path": path,
                    }),
                    Err(reason) => json!({
                        "available": false,
                        "reason": reason,
                    }),
                };
                DebugResponse::ok(json!({
                    "ok": true,
                    "tree": self.build_debug_tree(cx),
                    "snapshot": {
                        "timestamp_ms": chrono::Local::now().timestamp_millis(),
                        "screenshot": screenshot,
                    }
                }))
            }
            DebugRequestKind::Act(request) => match self.execute_debug_action(&request, cx) {
                Ok(body) => DebugResponse::ok(body),
                Err(response) => response,
            },
        }
    }

    fn debug_element_visible(&self, id: &str) -> bool {
        match id {
            "sandpaper-app" => true,
            "sidebar-rail" | "toggle-sidebar-action" => !self.settings.focus_mode,
            "topbar-left" | "topbar-center" | "topbar-mode-switcher" | "topbar-right" => {
                !self.settings.focus_mode
            }
            "pages-list" | "search-scroll" | "sidebar-search-input" => {
                !self.settings.focus_mode && !self.settings.sidebar_collapsed
            }
            "editor-page-title" => {
                self.app.mode == Mode::Editor && self.editor.active_page.is_some()
            }
            "command-palette" | "command-palette-input" => self.ui.palette_open,
            "settings-sheet" => self.settings.open,
            "open-command-palette-action" | "open-settings-action" => true,
            "review-panel" | "backlinks-panel" | "plugin-panel" => {
                !self.settings.focus_mode && self.settings.context_panel_open
            }
            "capture-overlay-backdrop" | "quick-capture-input" => self.ui.capture_overlay_open,
            "page-dialog" | "page-dialog-input" => self.ui.page_dialog_open,
            "vault-dialog" | "vault-dialog-name-input" | "vault-dialog-path-input" => {
                self.ui.vault_dialog_open
            }
            "notifications-dialog" => self.ui.notifications_open,
            "new-page-action" | "rename-page-action" | "open-quick-capture-action" => true,
            "block-input" => self.app.mode == Mode::Editor && self.editor.active_page.is_some(),
            "navigate-to-page" | "slash-command" | "switch-mode" => true,
            "properties-toggle" => {
                self.app.mode == Mode::Editor && self.editor.active_page.is_some()
            }
            "connections-panel" => !self.settings.focus_mode && self.settings.context_panel_open,
            "focus-mode-toggle" => true,
            _ => false,
        }
    }

    fn debug_input_value(&self, id: &str, cx: &mut Context<Self>) -> Option<String> {
        match id {
            "sidebar-search-input" => Some(
                self.editor
                    .sidebar_search_input
                    .read(cx)
                    .value()
                    .to_string(),
            ),
            "command-palette-input" => Some(self.ui.palette_input.read(cx).value().to_string()),
            "quick-capture-input" => Some(self.editor.capture_input.read(cx).value().to_string()),
            "page-dialog-input" => Some(self.ui.page_dialog_input.read(cx).value().to_string()),
            "vault-dialog-name-input" => {
                Some(self.ui.vault_dialog_name_input.read(cx).value().to_string())
            }
            "vault-dialog-path-input" => {
                Some(self.ui.vault_dialog_path_input.read(cx).value().to_string())
            }
            _ => None,
        }
    }
}

fn supported_actions(id: &str) -> Vec<&'static str> {
    match id {
        "sidebar-rail" | "toggle-sidebar-action" => vec!["click"],
        "command-palette" => vec!["click", "close"],
        "open-command-palette-action" | "open-settings-action" => vec!["click"],
        "command-palette-input"
        | "page-dialog-input"
        | "vault-dialog-name-input"
        | "vault-dialog-path-input" => vec!["set_text"],
        "sidebar-search-input" => vec!["focus", "set_text"],
        "quick-capture-input" => vec!["focus", "set_text"],
        "block-input" => vec!["focus", "set_text", "insert_block_below"],
        "navigate-to-page" => vec!["click"],
        "properties-toggle" | "connections-panel" | "focus-mode-toggle" | "switch-mode" => {
            vec!["click"]
        }
        "slash-command" => vec!["execute"],
        "settings-sheet"
        | "review-panel"
        | "backlinks-panel"
        | "plugin-panel"
        | "capture-overlay-backdrop"
        | "editor-page-title"
        | "page-dialog"
        | "new-page-action"
        | "rename-page-action"
        | "open-quick-capture-action" => vec!["click"],
        _ => Vec::new(),
    }
}

fn supports_action(id: &str, action: &str) -> bool {
    supported_actions(id)
        .iter()
        .any(|candidate| candidate == &action)
}

fn read_text_arg(args: &Option<Value>) -> Result<String, DebugResponse> {
    let text = args
        .as_ref()
        .and_then(|value| value.get("text"))
        .and_then(Value::as_str)
        .ok_or_else(|| {
            DebugResponse::error(
                422,
                "invalid_args",
                "args.text is required and must be a string",
            )
        })?;
    Ok(text.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::TestAppContext;
    use gpui_component::Root;
    use std::cell::RefCell;
    use std::rc::Rc;

    fn find_tree_element<'a>(tree: &'a Value, id: &str) -> &'a Value {
        tree.get("elements")
            .and_then(Value::as_array)
            .and_then(|elements| {
                elements
                    .iter()
                    .find(|element| element.get("id").and_then(Value::as_str) == Some(id))
            })
            .expect("element in debug tree")
    }

    #[test]
    fn supported_actions_lists_known_ids() {
        assert_eq!(supported_actions("sidebar-rail"), vec!["click"]);
        assert_eq!(supported_actions("command-palette"), vec!["click", "close"]);
        assert_eq!(supported_actions("unknown"), Vec::<&str>::new());
    }

    #[test]
    fn supports_action_checks_pair() {
        assert!(supports_action("sidebar-rail", "click"));
        assert!(!supports_action("sidebar-rail", "set_text"));
        assert!(!supports_action("unknown", "click"));
    }

    #[test]
    fn read_text_arg_rejects_missing_text() {
        let error = read_text_arg(&None).expect_err("missing args should fail");
        assert_eq!(error.status_code, 422);
        assert_eq!(error.body["error"]["code"], "invalid_args");
    }

    #[gpui::test]
    fn debug_tree_tracks_topbar_mode_switcher_visibility(cx: &mut TestAppContext) {
        cx.skip_drawing();
        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        cx.update_window(*window, |_root, _window, cx| {
            app.update(cx, |app, cx| {
                app.settings.focus_mode = false;
                let tree = app.build_debug_tree(cx);
                let mode_switcher = find_tree_element(&tree, "topbar-mode-switcher");
                assert_eq!(mode_switcher["visible"], Value::Bool(true));

                app.settings.focus_mode = true;
                let focus_tree = app.build_debug_tree(cx);
                let hidden_mode_switcher = find_tree_element(&focus_tree, "topbar-mode-switcher");
                assert_eq!(hidden_mode_switcher["visible"], Value::Bool(false));
            });
        })
        .expect("window update");
    }
}
