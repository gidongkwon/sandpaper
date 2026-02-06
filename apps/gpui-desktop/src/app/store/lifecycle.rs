use super::editor::update_wikilinks_in_db;
use super::helpers::{default_vault_path, expand_tilde};
use super::*;
use gpui_component::{Theme, ThemeMode};

fn daily_note_title(date: chrono::NaiveDate) -> String {
    date.format("%Y-%m-%d").to_string()
}

fn ensure_daily_note_in_db(db: &Database, date: chrono::NaiveDate) -> Result<bool, String> {
    let title = daily_note_title(date);
    let daily_uid = app::sanitize_kebab(&title);

    let pages = db.list_pages().map_err(|err| format!("{err:?}"))?;
    let exists = pages.iter().any(|page| {
        app::sanitize_kebab(&page.uid) == daily_uid || app::sanitize_kebab(&page.title) == daily_uid
    });
    if exists {
        return Ok(false);
    }

    db.insert_page(&daily_uid, &title)
        .map_err(|err| format!("{err:?}"))?;
    Ok(true)
}

impl AppStore {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let focus_handle = cx.focus_handle();
        let window_handle = window.window_handle();
        let editor = EditorState::new(window, cx);
        let ui = UiState::new(window, cx);
        let settings = SettingsState::new();
        let plugins = PluginsState::new();
        let app_state = AppState::new();

        let mut app = Self {
            focus_handle,
            window_handle,
            agent_debug: None,
            app: app_state,
            editor,
            plugins,
            settings,
            ui,
            _subscriptions: Vec::new(),
        };

        app.boot(cx);

        let sub_block_input = cx.subscribe(
            &app.editor.block_input,
            |this, input, event: &gpui_component::input::InputEvent, cx| {
                if !matches!(event, gpui_component::input::InputEvent::Change) {
                    return;
                }
                if this.editor.text_history_suppression_depth > 0
                    || this.editor.is_replaying_history
                {
                    return;
                }
                let Some(binding) = this.editor.block_input_binding.clone() else {
                    return;
                };
                let (text, cursor) = {
                    let input = input.read(cx);
                    (input.value().to_string(), input.cursor())
                };
                this.apply_block_input_change_for_binding(&binding, text, cursor, cx);
            },
        );

        app._subscriptions.push(sub_block_input);

        let sub_search_input = cx.observe(&app.editor.sidebar_search_input, |this, input, cx| {
            this.editor.sidebar_search_query = input.read(cx).value().to_string();
            this.refresh_search_results();
            cx.notify();
        });

        app._subscriptions.push(sub_search_input);

        let sub_palette_input = cx.observe(&app.ui.palette_input, |this, input, cx| {
            this.ui.palette_query = input.read(cx).value().to_string();
            this.ui.palette_index = 0;
            cx.notify();
        });

        app._subscriptions.push(sub_palette_input);
        let sub_capture_destination_input = cx.observe(
            &app.editor.capture_move_destination_input,
            |this, _input, cx| {
                if this.editor.capture_move_item_uid.is_some() {
                    cx.notify();
                }
            },
        );

        app._subscriptions.push(sub_capture_destination_input);
        app.init_agent_debug(cx);

        app
    }

    pub(crate) fn boot(&mut self, cx: &mut Context<Self>) {
        self.editor.backlinks.clear();
        self.editor.block_backlinks.clear();
        self.editor.unlinked_references.clear();
        self.editor.secondary_pane = None;
        self.editor.primary_selection.clear();
        self.editor.active_pane = EditorPane::Primary;
        self.app.primary_dirty = false;
        self.editor.wikilink_menu = WikilinkMenuState::closed();
        self.editor.link_preview = None;
        self.editor.link_preview_epoch = 0;
        self.editor.link_preview_close_epoch = 0;
        self.editor.link_preview_hovering_link = false;
        self.editor.link_preview_cache.clear();
        self.editor.page_cursors.clear();
        self.editor.recent_pages.clear();
        self.editor.undo_stack.clear();
        self.editor.redo_stack.clear();
        self.editor.text_history_suppression_depth = 0;
        self.editor.is_replaying_history = false;
        self.editor.block_clipboard = None;
        self.editor.block_input_binding = None;
        self.ui.capture_confirmation = None;
        self.app.active_vault_root = None;
        self.reset_plugins_state();
        self.refresh_vaults();
        match app::open_active_database() {
            Ok((vault, db)) => {
                self.app.boot_status = format!("Vault: {}", vault.record.name).into();
                self.editor.active_page = None;
                self.editor.editor = None;
                self.editor.blocks_list_state.reset(0, px(BLOCK_ROW_HEIGHT));
                self.ui.vault_dialog_open = false;
                self.ui.vault_dialog_error = None;

                let pages = db.list_pages().unwrap_or_default();
                let active_uid = db.get_kv("active.page").ok().flatten();

                self.editor.pages = pages;
                self.app.db = Some(db);
                self.app.active_vault_root = Some(vault.root.clone());
                self.on_vault_changed(cx);

                if let Some(uid) = active_uid {
                    self.open_page(&uid, cx);
                } else if self.editor.pages.iter().any(|page| page.uid == "inbox") {
                    self.open_page("inbox", cx);
                } else if let Some(first) = self.editor.pages.first().cloned() {
                    self.open_page(&first.uid, cx);
                } else {
                    self.open_page("Inbox", cx);
                }

                if let Some(db) = self.app.db.as_ref() {
                    if ensure_daily_note_in_db(db, Local::now().date_naive()).unwrap_or(false) {
                        self.editor.pages = db.list_pages().unwrap_or_default();
                        self.refresh_search_results();
                    }
                }
            }
            Err(AppError::NoVaultConfigured) => {
                self.app.boot_status = "No vault configured. Create one to start writing.".into();
                self.app.db = None;
                self.editor.active_page = None;
                self.editor.editor = None;
                self.editor.blocks_list_state.reset(0, px(BLOCK_ROW_HEIGHT));
                self.ui.vault_dialog_open = true;

                let default_name = "Vault".to_string();
                let default_path = default_vault_path(&default_name);
                let name_input = self.ui.vault_dialog_name_input.clone();
                let path_input = self.ui.vault_dialog_path_input.clone();

                let app = cx.entity();
                let view = cx.new(|cx| crate::ui::dialogs::VaultDialogView::new(app.clone(), cx));

                self.with_window(cx, move |window, cx| {
                    name_input.update(cx, |input, cx| {
                        input.set_value(default_name.clone(), window, cx);
                        let position = input.text().offset_to_position(0);
                        input.set_cursor_position(position, window, cx);
                    });
                    path_input.update(cx, |input, cx| {
                        input.set_value(default_path.clone(), window, cx);
                        let position = input.text().offset_to_position(0);
                        input.set_cursor_position(position, window, cx);
                    });

                    if window.root::<Root>().flatten().is_none() {
                        return;
                    }

                    window.open_dialog(cx, move |dialog, _window, _cx| {
                        let app = app.clone();
                        let view = view.clone();
                        dialog.title("Vaults").w(px(560.0)).child(view).on_close(
                            move |_event, _window, cx| {
                                app.update(cx, |app, cx| {
                                    app.close_vault_dialog(cx);
                                });
                            },
                        )
                    });
                    window.focus(&name_input.focus_handle(cx), cx);
                });
            }
            Err(err) => {
                self.app.boot_status = format!("Boot error: {err:?}").into();
                self.app.db = None;
                self.editor.active_page = None;
                self.editor.editor = None;
                self.editor.blocks_list_state.reset(0, px(BLOCK_ROW_HEIGHT));
                self.ui.vault_dialog_error = Some(format!("{err:?}").into());
                self.ui.vault_dialog_open = true;

                let default_name = "Vault".to_string();
                let default_path = default_vault_path(&default_name);
                let name_input = self.ui.vault_dialog_name_input.clone();
                let path_input = self.ui.vault_dialog_path_input.clone();

                let app = cx.entity();
                let view = cx.new(|cx| crate::ui::dialogs::VaultDialogView::new(app.clone(), cx));

                self.with_window(cx, move |window, cx| {
                    name_input.update(cx, |input, cx| {
                        input.set_value(default_name.clone(), window, cx);
                        let position = input.text().offset_to_position(0);
                        input.set_cursor_position(position, window, cx);
                    });
                    path_input.update(cx, |input, cx| {
                        input.set_value(default_path.clone(), window, cx);
                        let position = input.text().offset_to_position(0);
                        input.set_cursor_position(position, window, cx);
                    });

                    if window.root::<Root>().flatten().is_none() {
                        return;
                    }

                    window.open_dialog(cx, move |dialog, _window, _cx| {
                        let app = app.clone();
                        let view = view.clone();
                        dialog.title("Vaults").w(px(560.0)).child(view).on_close(
                            move |_event, _window, cx| {
                                app.update(cx, |app, cx| {
                                    app.close_vault_dialog(cx);
                                });
                            },
                        )
                    });
                    window.focus(&name_input.focus_handle(cx), cx);
                });
            }
        }

        cx.notify();
    }

    fn on_vault_changed(&mut self, cx: &mut Context<Self>) {
        if let Some(db) = self.app.db.as_ref() {
            let loaded_existing = self.settings.load_from_db(db).unwrap_or(false);
            if !loaded_existing {
                self.persist_settings();
                self.with_window(cx, |window, cx| {
                    if window.root::<Root>().flatten().is_none() {
                        return;
                    }
                    window.push_notification(
                        (
                            gpui_component::notification::NotificationType::Success,
                            "Interface updated to new defaults.",
                        ),
                        cx,
                    );
                });
            }
        }
        // Restore persisted mode
        let restored_mode = self.settings.last_mode;
        if restored_mode != self.app.mode {
            self.set_mode(restored_mode, cx);
        }
        self.apply_theme_preference(cx);
        self.refresh_search_results();
        self.load_review_items(cx);
        self.load_plugins(None, cx);
    }

    pub(crate) fn apply_theme_preference(&mut self, cx: &mut Context<Self>) {
        let mode = match self.settings.theme_preference {
            ThemePreference::System => Theme::global(cx).mode,
            ThemePreference::Light => ThemeMode::Light,
            ThemePreference::Dark => ThemeMode::Dark,
        };
        Theme::change(mode, None, cx);
        cx.refresh_windows();
    }

    pub(crate) fn set_theme_preference(
        &mut self,
        preference: ThemePreference,
        cx: &mut Context<Self>,
    ) {
        if self.settings.theme_preference == preference {
            return;
        }
        self.settings.theme_preference = preference;
        self.persist_settings();
        self.apply_theme_preference(cx);
        cx.notify();
    }

    pub(crate) fn set_context_panel_tab(&mut self, tab: WorkspacePanel, cx: &mut Context<Self>) {
        self.settings.context_panel_open = true;
        self.settings.context_panel_tab = tab;
        if tab == WorkspacePanel::Review {
            self.load_review_items(cx);
        }
        self.persist_settings();
        cx.notify();
    }

    pub(crate) fn cycle_context_panel(&mut self, cx: &mut Context<Self>) {
        let next = match self.settings.context_panel_tab {
            WorkspacePanel::Review => WorkspacePanel::Backlinks,
            WorkspacePanel::Backlinks => WorkspacePanel::Connections,
            WorkspacePanel::Connections => WorkspacePanel::Plugins,
            WorkspacePanel::Plugins => WorkspacePanel::Review,
        };
        self.set_context_panel_tab(next, cx);
    }

    pub(crate) fn refresh_vaults(&mut self) {
        let store = match VaultStore::default_store() {
            Ok(store) => store,
            Err(_) => return,
        };
        let config = match store.load() {
            Ok(config) => config,
            Err(_) => return,
        };
        self.app.active_vault_id = config.active_id.clone();
        self.app.vaults = config.vaults;
    }

    pub(crate) fn open_vaults(
        &mut self,
        _: &OpenVaults,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let has_root = window.root::<Root>().flatten().is_some();
        if has_root && self.ui.vault_dialog_open && window.has_active_dialog(cx) {
            window.focus(&self.ui.vault_dialog_name_input.focus_handle(cx), cx);
            return;
        }

        self.refresh_vaults();
        self.ui.vault_dialog_error = None;
        self.ui.vault_dialog_open = true;

        let default_name = "Vault".to_string();
        let default_path = default_vault_path(&default_name);

        self.ui.vault_dialog_name_input.update(cx, |input, cx| {
            input.set_value(default_name.clone(), window, cx);
            let position = input.text().offset_to_position(0);
            input.set_cursor_position(position, window, cx);
        });
        self.ui.vault_dialog_path_input.update(cx, |input, cx| {
            input.set_value(default_path.clone(), window, cx);
            let position = input.text().offset_to_position(0);
            input.set_cursor_position(position, window, cx);
        });

        if !has_root {
            cx.notify();
            return;
        }

        let app = cx.entity();
        let view = cx.new(|cx| crate::ui::dialogs::VaultDialogView::new(app.clone(), cx));

        window.open_dialog(cx, move |dialog, _window, _cx| {
            let app = app.clone();
            let view = view.clone();
            dialog
                .title("Vaults")
                .w(px(560.0))
                .child(view)
                .on_close(move |_event, _window, cx| {
                    app.update(cx, |app, cx| {
                        app.close_vault_dialog(cx);
                    });
                })
        });

        window.focus(&self.ui.vault_dialog_name_input.focus_handle(cx), cx);
        cx.notify();
    }

    pub(crate) fn close_vault_dialog(&mut self, cx: &mut Context<Self>) {
        self.ui.vault_dialog_open = false;
        cx.notify();
    }

    pub(crate) fn set_active_vault(&mut self, vault_id: String, cx: &mut Context<Self>) {
        let store = match VaultStore::default_store() {
            Ok(store) => store,
            Err(_) => return,
        };
        if store.set_active_vault(&vault_id).is_err() {
            return;
        }
        self.app.active_vault_id = Some(vault_id.clone());
        self.boot(cx);
    }

    pub(crate) fn create_vault(&mut self, cx: &mut Context<Self>) {
        let name = self
            .ui
            .vault_dialog_name_input
            .read(cx)
            .value()
            .trim()
            .to_string();
        let raw_path = self
            .ui
            .vault_dialog_path_input
            .read(cx)
            .value()
            .trim()
            .to_string();
        if name.is_empty() || raw_path.is_empty() {
            self.ui.vault_dialog_error = Some("Name and path are required.".into());
            cx.notify();
            return;
        }
        let path = expand_tilde(&raw_path);
        let store = match VaultStore::default_store() {
            Ok(store) => store,
            Err(_) => return,
        };
        match store.create_vault(&name, path.as_path()) {
            Ok(record) => {
                let _ = store.set_active_vault(&record.id);
                self.app.active_vault_id = Some(record.id);
                self.ui.vault_dialog_open = false;
                self.boot(cx);
            }
            Err(err) => {
                self.ui.vault_dialog_error = Some(format!("{err:?}").into());
            }
        }
        cx.notify();
    }

    pub(crate) fn mark_dirty_for_pane(&mut self, pane: EditorPane, cx: &mut Context<Self>) {
        match pane {
            EditorPane::Primary => {
                if !self.app.primary_dirty {
                    self.app.primary_dirty = true;
                    self.update_save_state_from_dirty();
                }
            }
            EditorPane::Secondary => {
                if let Some(secondary) = self.editor.secondary_pane.as_mut() {
                    if !secondary.dirty {
                        secondary.dirty = true;
                        self.update_save_state_from_dirty();
                    }
                }
            }
        }
        self.queue_shadow_write_for_pane(pane);
        self.schedule_autosave(cx);
    }

    pub(crate) fn update_save_state_from_dirty(&mut self) {
        let secondary_dirty = self
            .editor
            .secondary_pane
            .as_ref()
            .is_some_and(|pane| pane.dirty);
        self.app.save_state = if self.app.primary_dirty || secondary_dirty {
            SaveState::Dirty
        } else {
            SaveState::Saved
        };
    }

    pub(crate) fn schedule_autosave(&mut self, cx: &mut Context<Self>) {
        self.app.autosave_epoch += 1;
        let epoch = self.app.autosave_epoch;

        cx.spawn(async move |this, cx| {
            cx.background_executor()
                .timer(Duration::from_millis(1200))
                .await;
            this.update(cx, |this, cx| {
                if this.app.autosave_epoch != epoch {
                    return;
                }
                if matches!(this.app.save_state, SaveState::Dirty) {
                    this.save(cx);
                }
            })
            .ok();
        })
        .detach();
    }

    pub(crate) fn save(&mut self, cx: &mut Context<Self>) {
        self.flush_bound_block_input(cx);

        let Some(db) = self.app.db.as_mut() else {
            self.app.save_state = SaveState::Error("Database not available.".into());
            cx.notify();
            return;
        };

        self.app.save_state = SaveState::Saving;
        cx.notify();

        let mut saved_any = false;
        let mut error: Option<String> = None;

        if self.app.primary_dirty {
            match (self.editor.active_page.clone(), self.editor.editor.as_ref()) {
                (Some(active_page), Some(editor)) => {
                    match db.replace_blocks_for_page(active_page.id, &editor.blocks) {
                        Ok(_) => {
                            self.app.primary_dirty = false;
                            saved_any = true;
                        }
                        Err(err) => {
                            error = Some(format!("{err:?}"));
                        }
                    }
                }
                _ => {
                    error = Some("No active page to save.".to_string());
                }
            }
        }

        if let Some(pane) = self.editor.secondary_pane.as_mut() {
            if pane.dirty {
                match db.replace_blocks_for_page(pane.page.id, &pane.editor.blocks) {
                    Ok(_) => {
                        pane.dirty = false;
                        saved_any = true;
                    }
                    Err(err) => {
                        if error.is_none() {
                            error = Some(format!("{err:?}"));
                        }
                    }
                }
            }
        }

        if let Some(err) = error {
            self.app.save_state = SaveState::Error(err);
        } else if saved_any {
            self.app.save_state = SaveState::Saved;
            self.refresh_references();
        } else {
            self.app.save_state = SaveState::Saved;
        }

        if saved_any {
            self.schedule_shadow_write_flush(cx);
        }

        cx.notify();
    }

    pub(crate) fn open_page(&mut self, uid: &str, cx: &mut Context<Self>) {
        let Some(db) = self.app.db.as_ref() else {
            return;
        };

        let normalized = app::sanitize_kebab(uid);
        let page = match db.get_page_by_uid(&normalized) {
            Ok(Some(page)) => page,
            Ok(None) => {
                let title = uid.trim();
                let title = if title.is_empty() { "Untitled" } else { title };
                let id = match app::ensure_page(db, &normalized, title) {
                    Ok(id) => id,
                    Err(_) => return,
                };
                PageRecord {
                    id,
                    uid: normalized.clone(),
                    title: title.to_string(),
                }
            }
            Err(_) => return,
        };

        let blocks = db
            .load_blocks_for_page(page.id)
            .unwrap_or_else(|_| Vec::new());
        let mut editor = EditorModel::new(blocks);

        let _ = db.set_kv("active.page", &page.uid);
        self.load_collapsed_state_for_page(&page.uid);

        self.editor.active_page = Some(page.clone());
        self.app.primary_dirty = false;
        self.update_save_state_from_dirty();
        self.editor
            .blocks_list_state
            .reset(editor.blocks.len(), px(BLOCK_ROW_HEIGHT));
        self.editor.active_pane = EditorPane::Primary;

        let page_cursor = self.editor.page_cursors.get(&page.uid);
        let (active_ix, cursor) = helpers::resolve_cursor_for_blocks(&editor.blocks, page_cursor);
        editor.active_ix = active_ix;
        self.record_recent_page(&page.uid);

        self.editor.editor = Some(editor);
        self.update_block_list_for_pane(EditorPane::Primary);
        self.clear_selection_for_pane(EditorPane::Primary);
        self.sync_block_input_from_active_with_cursor(cursor, None, cx);
        self.close_slash_menu();
        self.close_wikilink_menu();
        self.close_outline_menu();
        self.refresh_references();
        self.load_page_properties();
        self.schedule_connections_refresh(cx);
        cx.notify();
    }

    pub(crate) fn open_page_dialog(&mut self, mode: PageDialogMode, cx: &mut Context<Self>) {
        let already_open = self.ui.page_dialog_open;

        self.ui.page_dialog_open = true;
        self.ui.page_dialog_mode = mode;
        self.ui.page_dialog_error = None;

        let initial: String = match mode {
            PageDialogMode::Create => "".to_string(),
            PageDialogMode::Rename => self
                .editor
                .active_page
                .as_ref()
                .map(|page| page.title.clone())
                .unwrap_or_default(),
        };

        let app = cx.entity();
        let view = cx.new(|cx| crate::ui::dialogs::PageDialogView::new(app.clone(), cx));
        let page_dialog_input = self.ui.page_dialog_input.clone();
        let initial_clone = initial.clone();
        self.with_window(cx, move |window, cx| {
            page_dialog_input.update(cx, |input, cx| {
                input.set_value(initial_clone.clone(), window, cx);
                let position = input.text().offset_to_position(0);
                input.set_cursor_position(position, window, cx);
            });

            let has_root = window.root::<Root>().flatten().is_some();
            if already_open && has_root && window.has_active_dialog(cx) {
                window.focus(&page_dialog_input.focus_handle(cx), cx);
                return;
            }

            if !has_root {
                return;
            }

            let app = app.clone();
            let view = view.clone();
            window.open_dialog(cx, move |dialog, _window, cx| {
                let (title, ok_text) = match app.read(cx).ui.page_dialog_mode {
                    PageDialogMode::Create => ("Create Page", "Create"),
                    PageDialogMode::Rename => ("Rename Page", "Rename"),
                };

                dialog
                    .title(title)
                    .confirm()
                    .button_props(
                        gpui_component::dialog::DialogButtonProps::default()
                            .ok_text(ok_text)
                            .cancel_text("Cancel"),
                    )
                    .child(view.clone())
                    .on_ok({
                        let app = app.clone();
                        move |_event, window, cx| {
                            app.update(cx, |app, cx| app.confirm_page_dialog(window, cx))
                        }
                    })
                    .on_cancel({
                        let app = app.clone();
                        move |_event, _window, cx| {
                            app.update(cx, |app, cx| app.close_page_dialog(cx));
                            true
                        }
                    })
                    .on_close({
                        let app = app.clone();
                        move |_event, _window, cx| {
                            app.update(cx, |app, cx| app.close_page_dialog(cx));
                        }
                    })
            });

            window.focus(&page_dialog_input.focus_handle(cx), cx);
        });

        cx.notify();
    }

    pub(crate) fn close_page_dialog(&mut self, cx: &mut Context<Self>) {
        self.ui.page_dialog_open = false;
        self.ui.page_dialog_error = None;
        cx.notify();
    }

    pub(crate) fn confirm_page_dialog(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        let title = self
            .ui
            .page_dialog_input
            .read(cx)
            .value()
            .trim()
            .to_string();
        if title.is_empty() {
            self.ui.page_dialog_error = Some("Page title is required.".into());
            cx.notify();
            return false;
        }
        match self.ui.page_dialog_mode {
            PageDialogMode::Create => {
                let (uid, pages) = {
                    let Some(db) = self.app.db.as_ref() else {
                        self.ui.page_dialog_error = Some("Database not available.".into());
                        cx.notify();
                        return false;
                    };
                    let uid = match app::resolve_unique_page_uid(db, &title) {
                        Ok(value) => value,
                        Err(err) => {
                            self.ui.page_dialog_error =
                                Some(format!("Failed to create page: {err:?}").into());
                            cx.notify();
                            return false;
                        }
                    };
                    if db.insert_page(&uid, &title).is_err() {
                        self.ui.page_dialog_error = Some("Failed to create page.".into());
                        cx.notify();
                        return false;
                    }
                    let pages = db.list_pages().unwrap_or_default();
                    (uid, pages)
                };
                self.editor.pages = pages;
                self.refresh_search_results();
                self.open_page(&uid, cx);
                self.close_page_dialog(cx);
                window.push_notification(
                    (
                        gpui_component::notification::NotificationType::Success,
                        "Page created.",
                    ),
                    cx,
                );
                true
            }
            PageDialogMode::Rename => {
                let Some(active) = self.editor.active_page.clone() else {
                    self.ui.page_dialog_error = Some("No active page.".into());
                    cx.notify();
                    return false;
                };
                let old_title = active.title.clone();
                let (updated_blocks, pages, active_page) = {
                    let Some(db) = self.app.db.as_ref() else {
                        self.ui.page_dialog_error = Some("Database not available.".into());
                        cx.notify();
                        return false;
                    };
                    if db.update_page_title(active.id, &title).is_err() {
                        self.ui.page_dialog_error = Some("Failed to rename page.".into());
                        cx.notify();
                        return false;
                    }
                    let updated_blocks = update_wikilinks_in_db(db, &old_title, &title);
                    let pages = db.list_pages().unwrap_or_default();
                    let active_page = db.get_page_by_uid(&active.uid).ok().flatten();
                    (updated_blocks, pages, active_page)
                };

                self.apply_wikilink_updates(&updated_blocks, cx);
                self.editor.pages = pages;
                self.editor.active_page = active_page;
                if let Some(pane) = self.editor.secondary_pane.as_mut() {
                    if pane.page.id == active.id {
                        pane.page.title = title.clone();
                    }
                }
                self.refresh_search_results();
                self.refresh_references();
                self.close_page_dialog(cx);
                window.push_notification(
                    (
                        gpui_component::notification::NotificationType::Success,
                        "Page renamed.",
                    ),
                    cx,
                );
                cx.notify();
                true
            }
        }
    }

    fn test_page_blocks() -> Vec<BlockSnapshot> {
        fn block(block_type: BlockType, indent: i64, text: &str) -> BlockSnapshot {
            BlockSnapshot {
                uid: Uuid::new_v4().to_string(),
                text: text.to_string(),
                indent,
                block_type,
            }
        }

        vec![
            block(
                BlockType::Text,
                0,
                "Text block: plain content for cursor, selection, and link testing [[Inbox]].",
            ),
            block(BlockType::Heading1, 0, "Heading 1 block"),
            block(BlockType::Heading2, 0, "Heading 2 block"),
            block(BlockType::Heading3, 0, "Heading 3 block"),
            block(
                BlockType::Quote,
                0,
                "Quote block: quoted content for visual and copy checks.",
            ),
            block(
                BlockType::Callout,
                0,
                "Callout block: highlighted note content for renderer checks.",
            ),
            block(
                BlockType::Todo,
                0,
                "- [ ] Todo block: toggle this checkbox to verify state changes.",
            ),
            block(
                BlockType::Code,
                0,
                "fn main() {\n  println!(\"code block sample\");\n}",
            ),
            block(BlockType::Divider, 0, ""),
            block(
                BlockType::Toggle,
                0,
                "Toggle block: expand/collapse child content",
            ),
            block(
                BlockType::Text,
                1,
                "Toggle child text: nested content for collapse behavior.",
            ),
            block(
                BlockType::DatabaseView,
                0,
                "Database view block: table should render from page properties.",
            ),
            block(
                BlockType::Image,
                0,
                "https://images.example/cat.png",
            ),
            block(BlockType::ColumnLayout, 0, "Two-column layout"),
            block(BlockType::Column, 1, "Left column"),
            block(
                BlockType::Text,
                2,
                "Left column child text for indentation and ordering checks.",
            ),
            block(BlockType::Column, 1, "Right column"),
            block(
                BlockType::Text,
                2,
                "Right column child text for indentation and ordering checks.",
            ),
        ]
    }

    pub(crate) fn create_test_page(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let title = format!("Test Page {}", Local::now().format("%Y-%m-%d %H:%M:%S"));
        let blocks = Self::test_page_blocks();

        let (uid, pages) = {
            let Some(db) = self.app.db.as_mut() else {
                return;
            };

            let uid = match app::resolve_unique_page_uid(db, &title) {
                Ok(uid) => uid,
                Err(_) => return,
            };

            let page_id = match db.insert_page(&uid, &title) {
                Ok(page_id) => page_id,
                Err(_) => return,
            };

            if db.replace_blocks_for_page(page_id, &blocks).is_err() {
                return;
            }

            let pages = db.list_pages().unwrap_or_default();
            (uid, pages)
        };

        self.editor.pages = pages;
        self.refresh_search_results();
        self.set_mode(Mode::Editor, cx);
        self.open_page(&uid, cx);
        window.focus(&self.editor.block_input.focus_handle(cx), cx);
        window.push_notification(
            (
                gpui_component::notification::NotificationType::Success,
                "Test page created.",
            ),
            cx,
        );
        cx.notify();
    }

    pub(crate) fn set_mode(&mut self, mode: Mode, cx: &mut Context<Self>) {
        let prev = self.app.mode;
        self.app.mode = mode;
        if mode != Mode::Capture {
            self.editor.capture_move_item_uid = None;
        }

        // Teardown for leaving Editor mode
        if prev == Mode::Editor && mode != Mode::Editor {
            if matches!(self.app.save_state, SaveState::Dirty) {
                self.save(cx);
            }
            self.close_slash_menu();
            self.clear_all_selections();
            self.editor.active_pane = EditorPane::Primary;
            self.plugins.plugin_active_panel = None;
        }

        // Setup for entering modes
        match mode {
            Mode::Capture => {
                // Will be focused by render_capture_mode
            }
            Mode::Editor => {}
            Mode::Review => {
                self.refresh_feed(cx);
            }
        }

        // Persist mode across sessions
        self.settings.last_mode = mode;
        self.persist_settings();

        cx.notify();
    }

    pub(crate) fn switch_to_capture_action(
        &mut self,
        _: &SwitchToCapture,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.set_mode(Mode::Capture, cx);
    }

    pub(crate) fn switch_to_edit_action(
        &mut self,
        _: &SwitchToEdit,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.set_mode(Mode::Editor, cx);
    }

    pub(crate) fn switch_to_review_action(
        &mut self,
        _: &SwitchToReview,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.set_mode(Mode::Review, cx);
    }

    pub(crate) fn new_page(&mut self, _: &NewPage, _window: &mut Window, cx: &mut Context<Self>) {
        self.open_page_dialog(PageDialogMode::Create, cx);
    }

    pub(crate) fn rename_page(
        &mut self,
        _: &RenamePage,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.open_page_dialog(PageDialogMode::Rename, cx);
    }

    pub(crate) fn toggle_sidebar_action(
        &mut self,
        _: &ToggleSidebar,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.settings.sidebar_collapsed = !self.settings.sidebar_collapsed;
        self.persist_settings();
        cx.notify();
    }

    pub(crate) fn begin_sidebar_resize(&mut self, start_x: f32, cx: &mut Context<Self>) {
        if self.settings.focus_mode || self.settings.sidebar_collapsed {
            return;
        }
        self.ui.sidebar_resize = Some(SidebarResizeState {
            start_x,
            start_width: self.settings.sidebar_width,
        });
        cx.notify();
    }

    pub(crate) fn update_sidebar_resize(&mut self, current_x: f32, cx: &mut Context<Self>) {
        let Some(state) = self.ui.sidebar_resize else {
            return;
        };
        let next_width = state.start_width + (current_x - state.start_x);
        self.settings.sidebar_width = SettingsState::clamp_sidebar_width(next_width);
        cx.notify();
    }

    pub(crate) fn end_sidebar_resize(&mut self, cx: &mut Context<Self>) {
        if self.ui.sidebar_resize.take().is_some() {
            self.settings.sidebar_width =
                SettingsState::clamp_sidebar_width(self.settings.sidebar_width);
            self.persist_settings();
            cx.notify();
        }
    }

    pub(crate) fn toggle_context_panel_action(
        &mut self,
        _: &ToggleContextPanel,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.settings.context_panel_open = !self.settings.context_panel_open;
        self.persist_settings();
        cx.notify();
    }

    pub(crate) fn open_review_panel_action(
        &mut self,
        _: &OpenReviewPanel,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.set_context_panel_tab(WorkspacePanel::Review, cx);
    }

    pub(crate) fn cycle_context_panel_action(
        &mut self,
        _: &CycleContextPanel,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.cycle_context_panel(cx);
    }

    pub(crate) fn focus_quick_add_action(
        &mut self,
        _: &FocusQuickAdd,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        window.focus(&self.editor.capture_input.focus_handle(cx), cx);
    }

    pub(crate) fn load_page_properties(&mut self) {
        let Some(db) = self.app.db.as_ref() else {
            self.editor.page_properties.clear();
            return;
        };
        let Some(page) = self.editor.active_page.as_ref() else {
            self.editor.page_properties.clear();
            return;
        };
        self.editor.page_properties = db.get_page_properties(page.id).unwrap_or_default();
    }

    pub(crate) fn set_page_property(
        &mut self,
        key: &str,
        value: &str,
        value_type: &str,
        cx: &mut Context<Self>,
    ) {
        let Some(db) = self.app.db.as_ref() else {
            return;
        };
        let Some(page) = self.editor.active_page.as_ref() else {
            return;
        };
        let _ = db.set_page_property(page.id, key, value, value_type);
        self.load_page_properties();
        cx.notify();
    }

    pub(crate) fn delete_page_property(&mut self, key: &str, cx: &mut Context<Self>) {
        let Some(db) = self.app.db.as_ref() else {
            return;
        };
        let Some(page) = self.editor.active_page.as_ref() else {
            return;
        };
        let _ = db.delete_page_property(page.id, key);
        self.load_page_properties();
        cx.notify();
    }

    pub(crate) fn toggle_focus_mode_action(
        &mut self,
        _: &ToggleFocusMode,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.settings.focus_mode = !self.settings.focus_mode;
        self.persist_settings();
        cx.notify();
    }

    pub(crate) fn open_quick_capture_action(
        &mut self,
        _: &OpenQuickCapture,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.ui.capture_overlay_open = true;
        self.ui.capture_overlay_target = self.settings.quick_add_target;
        window.focus(&self.editor.capture_input.focus_handle(cx), cx);
        cx.notify();
    }

    pub(crate) fn dismiss_quick_capture(&mut self, cx: &mut Context<Self>) {
        self.ui.capture_overlay_open = false;
        cx.notify();
    }

    pub(crate) fn submit_quick_capture(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let raw_text = self
            .editor
            .capture_input
            .read(cx)
            .value()
            .trim()
            .to_string();
        if raw_text.is_empty() {
            return;
        }

        if self.enqueue_capture_queue_item(&raw_text, cx).is_err() {
            return;
        }

        // Clear the capture input and close overlay
        self.editor.capture_input.update(cx, |input, cx| {
            input.set_value("", window, cx);
        });
        self.ui.capture_overlay_open = false;
        self.ui.capture_confirmation = Some("Captured".into());
        self.schedule_capture_confirmation_clear(cx);
        cx.notify();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::px;
    use gpui::TestAppContext;
    use gpui_component::Root;
    use sandpaper_core::blocks::BlockType;
    use sandpaper_core::db::BlockSnapshot;
    use std::cell::RefCell;
    use std::rc::Rc;

    #[gpui::test]
    fn page_dialog_opens_as_dialog(cx: &mut TestAppContext) {
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
        app.update(cx, |app, cx| {
            app.open_page_dialog(PageDialogMode::Create, cx);
        });

        cx.update_window(*window, |_root, window, cx| {
            assert!(window.has_active_dialog(cx));
        })
        .unwrap();
    }

    #[test]
    fn ensure_daily_note_creates_page_without_changing_active() {
        let db = Database::new_in_memory().expect("db init");
        db.run_migrations().expect("migrations");
        db.insert_page("inbox", "Inbox").expect("insert inbox");
        db.set_kv("active.page", "inbox").expect("set active");

        let date = chrono::NaiveDate::from_ymd_opt(2026, 1, 31).expect("date");
        let created = ensure_daily_note_in_db(&db, date).expect("ensure");
        assert!(created);

        let active = db.get_kv("active.page").expect("get kv");
        assert_eq!(active.as_deref(), Some("inbox"));

        let daily = db
            .get_page_by_uid("2026-01-31")
            .expect("get daily page")
            .expect("daily page exists");
        assert_eq!(daily.title, "2026-01-31");
    }

    #[test]
    fn ensure_daily_note_is_noop_when_title_matches() {
        let db = Database::new_in_memory().expect("db init");
        db.run_migrations().expect("migrations");
        db.insert_page("inbox", "Inbox").expect("insert inbox");
        db.insert_page("custom", "2026-01-31")
            .expect("insert daily by title");

        let before = db.list_pages().expect("list pages").len();
        let date = chrono::NaiveDate::from_ymd_opt(2026, 1, 31).expect("date");
        let created = ensure_daily_note_in_db(&db, date).expect("ensure");
        assert!(!created);

        let after = db.list_pages().expect("list pages").len();
        assert_eq!(before, after);
    }

    #[gpui::test]
    fn submit_quick_capture_routes_daily_target_to_inbox_queue(cx: &mut TestAppContext) {
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
        cx.update_window(*window, |_root, window, cx| {
            app.update(cx, |app, cx| {
                let db = Database::new_in_memory().expect("db init");
                db.run_migrations().expect("migrations");
                db.insert_page("inbox", "Inbox").expect("insert inbox");
                db.insert_page("project", "Project")
                    .expect("insert project");

                app.app.db = Some(db);
                app.editor.pages = app
                    .app
                    .db
                    .as_ref()
                    .expect("db")
                    .list_pages()
                    .expect("list pages");
                app.open_page("project", cx);

                app.ui.capture_overlay_target = QuickAddTarget::DailyNote;
                app.editor.capture_input.update(cx, |input, cx| {
                    input.set_value("queue me".to_string(), window, cx);
                });

                app.submit_quick_capture(window, cx);

                let active_uid = app
                    .editor
                    .active_page
                    .as_ref()
                    .map(|page| page.uid.as_str())
                    .unwrap_or_default();
                assert_eq!(active_uid, "project");
                assert_eq!(app.editor.capture_input.read(cx).value(), "");

                let db = app.app.db.as_ref().expect("db");
                let inbox_page = db
                    .get_page_by_uid("inbox")
                    .expect("inbox lookup")
                    .expect("inbox exists");
                let inbox_blocks = db
                    .load_blocks_for_page(inbox_page.id)
                    .expect("load inbox blocks");
                assert_eq!(inbox_blocks.len(), 1);
                assert_eq!(inbox_blocks[0].text, "queue me");
                assert_eq!(inbox_blocks[0].block_type, BlockType::Text);

                let today_uid = chrono::Local::now().format("%Y-%m-%d").to_string();
                assert!(
                    db.get_page_by_uid(&today_uid)
                        .expect("daily lookup")
                        .is_none(),
                    "daily note should not be created from quick capture target",
                );
            });
        })
        .unwrap();
    }

    #[gpui::test]
    fn submit_quick_capture_task_target_keeps_plain_text_in_queue(cx: &mut TestAppContext) {
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
        cx.update_window(*window, |_root, window, cx| {
            app.update(cx, |app, cx| {
                let db = Database::new_in_memory().expect("db init");
                db.run_migrations().expect("migrations");
                db.insert_page("inbox", "Inbox").expect("insert inbox");
                app.app.db = Some(db);
                app.editor.pages = app
                    .app
                    .db
                    .as_ref()
                    .expect("db")
                    .list_pages()
                    .expect("list pages");

                app.ui.capture_overlay_target = QuickAddTarget::TaskInbox;
                app.editor.capture_input.update(cx, |input, cx| {
                    input.set_value("buy milk".to_string(), window, cx);
                });

                app.submit_quick_capture(window, cx);

                let db = app.app.db.as_ref().expect("db");
                let inbox_page = db
                    .get_page_by_uid("inbox")
                    .expect("inbox lookup")
                    .expect("inbox exists");
                let inbox_blocks = db
                    .load_blocks_for_page(inbox_page.id)
                    .expect("load inbox blocks");
                assert_eq!(inbox_blocks.len(), 1);
                assert_eq!(inbox_blocks[0].text, "buy milk");
                assert_eq!(inbox_blocks[0].block_type, BlockType::Text);
            });
        })
        .unwrap();
    }

    #[gpui::test]
    fn create_test_page_builds_all_block_types(cx: &mut TestAppContext) {
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
        cx.update_window(*window, |_root, window, cx| {
            app.update(cx, |app, cx| {
                let db = Database::new_in_memory().expect("db init");
                db.run_migrations().expect("migrations");
                app.app.db = Some(db);

                app.create_test_page(window, cx);

                let active_page = app.editor.active_page.clone().expect("active page");
                assert!(active_page.title.starts_with("Test Page"));

                let editor = app.editor.editor.as_ref().expect("editor");
                let blocks = &editor.blocks;

                let expected = [
                    BlockType::Text,
                    BlockType::Heading1,
                    BlockType::Heading2,
                    BlockType::Heading3,
                    BlockType::Quote,
                    BlockType::Callout,
                    BlockType::Code,
                    BlockType::Divider,
                    BlockType::Toggle,
                    BlockType::Todo,
                    BlockType::Image,
                    BlockType::ColumnLayout,
                    BlockType::Column,
                    BlockType::DatabaseView,
                ];

                for block_type in expected {
                    assert!(
                        blocks.iter().any(|block| block.block_type == block_type),
                        "missing block type {:?}",
                        block_type
                    );
                }

                let text_block = blocks
                    .iter()
                    .find(|block| block.block_type == BlockType::Text)
                    .expect("text block");
                assert!(!text_block.text.is_empty());

                let todo_block = blocks
                    .iter()
                    .find(|block| block.block_type == BlockType::Todo)
                    .expect("todo block");
                assert!(todo_block.text.contains("[ ]"));

                let code_block = blocks
                    .iter()
                    .find(|block| block.block_type == BlockType::Code)
                    .expect("code block");
                assert!(code_block.text.contains("fn main"));
            });
        })
        .unwrap();
    }

    #[gpui::test]
    fn suppressed_programmatic_input_does_not_mutate_active_block(cx: &mut TestAppContext) {
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
        cx.update_window(*window, |_root, window, cx| {
            app.update(cx, |app, cx| {
                app.app.mode = Mode::Editor;
                app.editor.active_page = Some(PageRecord {
                    id: 1,
                    uid: "page-a".to_string(),
                    title: "Page A".to_string(),
                });
                app.editor.editor = Some(EditorModel::new(vec![
                    BlockSnapshot {
                        uid: "a1".to_string(),
                        text: "Alpha".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a2".to_string(),
                        text: "Beta".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                ]));
                if let Some(editor) = app.editor.editor.as_mut() {
                    editor.active_ix = 1;
                }
                app.editor.blocks_list_state.reset(2, px(BLOCK_ROW_HEIGHT));
                app.update_block_list_for_pane(EditorPane::Primary);

                app.editor.text_history_suppression_depth = 1;
                app.editor.block_input.update(cx, |input, cx| {
                    input.set_value("WRONG".to_string(), window, cx);
                });
                app.editor.text_history_suppression_depth = 0;

                let editor = app.editor.editor.as_ref().expect("editor");
                assert_eq!(editor.blocks[0].text, "Alpha");
                assert_eq!(editor.blocks[1].text, "Beta");
            });
        })
        .unwrap();

        cx.run_until_parked();

        cx.update_window(*window, |_root, _window, cx| {
            app.update(cx, |app, _cx| {
                let editor = app.editor.editor.as_ref().expect("editor");
                assert_eq!(editor.blocks[0].text, "Alpha");
                assert_eq!(editor.blocks[1].text, "Beta");
                assert!(app.editor.undo_stack.is_empty());
            });
        })
        .unwrap();
    }
}
