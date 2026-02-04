use super::*;
use super::editor::update_wikilinks_in_db;
use super::helpers::{default_vault_path, expand_tilde};

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
            app: app_state,
            editor,
            plugins,
            settings,
            ui,
            _subscriptions: Vec::new(),
        };

        app.boot(cx);

        let sub_block_input = cx.observe(&app.editor.block_input, |this, input, cx| {
            let (text, cursor) = {
                let input = input.read(cx);
                (input.value().to_string(), input.cursor())
            };

            let pane = this.editor.active_pane;
            let (uid, active_ix, text_changed) = {
                let Some(editor) = this.editor_for_pane_mut(pane) else {
                    return;
                };
                if editor.active_ix >= editor.blocks.len() {
                    return;
                }

                let uid = editor.blocks[editor.active_ix].uid.clone();
                let active_ix = editor.active_ix;
                let text_changed = editor.blocks[active_ix].text != text;
                if text_changed {
                    editor.blocks[active_ix].text = text.clone();
                }
                (uid, active_ix, text_changed)
            };

            this.record_page_cursor_for_pane(pane, &uid, cursor);

            if text_changed {
                this.mark_dirty_for_pane(pane, cx);
                this.schedule_references_refresh(cx);
            }

            this.update_slash_menu(pane, &uid, active_ix, cursor, &text, cx);
            this.update_wikilink_menu(pane, &uid, active_ix, cursor, &text, cx);
        });

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
                } else if let Some(first) = self.editor.pages.first().cloned() {
                    self.open_page(&first.uid, cx);
                } else {
                    self.open_page_dialog(PageDialogMode::Create, cx);
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
                    window.focus(&name_input.focus_handle(cx), cx);
                });
            }
        }

        cx.notify();
    }

    fn on_vault_changed(&mut self, cx: &mut Context<Self>) {
        if let Some(db) = self.app.db.as_ref() {
            let _ = self.settings.load_from_db(db);
        }
        self.refresh_search_results();
        self.load_plugins(None, cx);
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

        self.editor.active_page = Some(page.clone());
        self.app.primary_dirty = false;
        self.update_save_state_from_dirty();
        self.editor.blocks_list_state
            .reset(editor.blocks.len(), px(BLOCK_ROW_HEIGHT));
        self.editor.active_pane = EditorPane::Primary;

        let page_cursor = self.editor.page_cursors.get(&page.uid);
        let (active_ix, cursor) =
            helpers::resolve_cursor_for_blocks(&editor.blocks, page_cursor);
        editor.active_ix = active_ix;
        self.record_recent_page(&page.uid);

        self.editor.editor = Some(editor);
        self.clear_selection_for_pane(EditorPane::Primary);
        self.sync_block_input_from_active_with_cursor(cursor, None, cx);
        self.close_slash_menu();
        self.refresh_references();
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

    pub(crate) fn confirm_page_dialog(&mut self, window: &mut Window, cx: &mut Context<Self>) -> bool {
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
                        self.ui.page_dialog_error =
                            Some("Failed to create page.".into());
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
                        self.ui.page_dialog_error =
                            Some("Failed to rename page.".into());
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

    pub(crate) fn set_mode(&mut self, mode: Mode, cx: &mut Context<Self>) {
        self.app.mode = mode;
        if self.app.mode != Mode::Editor {
            self.close_slash_menu();
            self.clear_all_selections();
            self.editor.active_pane = EditorPane::Primary;
            self.plugins.plugin_active_panel = None;
        }
        cx.notify();
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

    pub(crate) fn toggle_mode_editor(
        &mut self,
        _: &ToggleModeEditor,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.set_mode(Mode::Editor, cx);
    }

    pub(crate) fn toggle_mode_capture(
        &mut self,
        _: &ToggleModeCapture,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.set_mode(Mode::Capture, cx);
        window.focus(&self.editor.capture_input.focus_handle(cx), cx);
    }

    pub(crate) fn toggle_mode_review(
        &mut self,
        _: &ToggleModeReview,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.set_mode(Mode::Review, cx);
        self.load_review_items(cx);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::TestAppContext;
    use gpui_component::Root;
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
}
