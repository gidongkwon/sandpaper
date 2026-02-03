use super::*;
use super::helpers::{default_vault_path, expand_tilde};

impl SandpaperApp {
    pub fn new(cx: &mut Context<Self>) -> Self {
        let focus_handle = cx.focus_handle();

        let page_dialog_input = cx.new(|cx| TextInput::new(cx, "Page title"));
        let vault_dialog_name_input = cx.new(|cx| TextInput::new(cx, "Vault name"));
        let vault_dialog_path_input = cx.new(|cx| TextInput::new(cx, "Vault path"));
        let capture_input = cx.new(|cx| TextInput::new(cx, "Capture a thought, link, or task..."));
        let sidebar_search_input = cx.new(|cx| TextInput::new(cx, "Search"));
        let block_input = cx.new(|cx| TextInput::new(cx, "Write a block…"));
        let palette_input = cx.new(|cx| TextInput::new(cx, "Search commands..."));

        capture_input.update(cx, |input, _cx| {
            input.set_style(TextInputStyle {
                text_size: px(15.0),
                line_height: px(24.0),
                padding: px(8.0),
                allow_vertical_navigation: true,
            });
        });

        block_input.update(cx, |input, _cx| {
            input.set_style(TextInputStyle {
                text_size: px(15.0),
                line_height: px(24.0),
                padding: px(4.0),
                allow_vertical_navigation: true,
            });
        });

        palette_input.update(cx, |input, _cx| {
            input.set_style(TextInputStyle {
                text_size: px(14.0),
                line_height: px(22.0),
                padding: px(6.0),
                allow_vertical_navigation: false,
            });
        });

        let mut app = Self {
            focus_handle,
            boot_status: "Booting…".into(),
            db: None,
            vaults: Vec::new(),
            active_vault_id: None,
            vault_dialog_open: false,
            vault_dialog_name_input,
            vault_dialog_path_input,
            vault_dialog_error: None,
            pages: Vec::new(),
            active_page: None,
            editor: None,
            caret_offsets: HashMap::new(),
            highlighted_block_uid: None,
            highlight_epoch: 0,
            sidebar_search_query: String::new(),
            sidebar_search_input,
            search_pages: Vec::new(),
            search_blocks: Vec::new(),
            backlinks: Vec::new(),
            block_backlinks: Vec::new(),
            unlinked_references: Vec::new(),
            references_epoch: 0,
            backlinks_open: true,
            secondary_pane: None,
            slash_menu: SlashMenuState::closed(),
            primary_selection: PaneSelection::new(),
            active_pane: EditorPane::Primary,
            mode: Mode::Editor,
            save_state: SaveState::Saved,
            autosave_epoch: 0,
            primary_dirty: false,
            page_dialog_open: false,
            page_dialog_mode: PageDialogMode::Create,
            page_dialog_input,
            capture_input,
            review_items: Vec::new(),
            block_input,
            palette_input,
            palette_open: false,
            palette_query: String::new(),
            palette_index: 0,
            blocks_list_state: ListState::new(0, ListAlignment::Top, px(600.0)),
            _subscriptions: Vec::new(),
        };

        app.boot(cx);

        let sub_block_input = cx.observe(&app.block_input, |this, input, cx| {
            let (text, cursor) = {
                let input = input.read(cx);
                (input.text().to_string(), input.cursor_offset())
            };

            let pane = this.active_pane;
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

            this.caret_offsets.insert(uid.clone(), cursor);

            if text_changed {
                this.mark_dirty_for_pane(pane, cx);
                this.schedule_references_refresh(cx);
            }

            this.update_slash_menu(pane, &uid, active_ix, cursor, &text, cx);
        });

        app._subscriptions.push(sub_block_input);

        let sub_search_input = cx.observe(&app.sidebar_search_input, |this, input, cx| {
            this.sidebar_search_query = input.read(cx).text().to_string();
            this.refresh_search_results();
            cx.notify();
        });

        app._subscriptions.push(sub_search_input);

        let sub_palette_input = cx.observe(&app.palette_input, |this, input, cx| {
            this.palette_query = input.read(cx).text().to_string();
            this.palette_index = 0;
            cx.notify();
        });

        app._subscriptions.push(sub_palette_input);

        let sub_block_events = cx.subscribe(&app.block_input, |this, _input, event, cx| {
            this.on_block_input_event(event, cx);
        });

        app._subscriptions.push(sub_block_events);

        app
    }

    pub(super) fn boot(&mut self, cx: &mut Context<Self>) {
        self.backlinks.clear();
        self.block_backlinks.clear();
        self.unlinked_references.clear();
        self.secondary_pane = None;
        self.primary_selection.clear();
        self.active_pane = EditorPane::Primary;
        self.primary_dirty = false;
        self.refresh_vaults();
        match app::open_active_database() {
            Ok((vault, db)) => {
                self.boot_status = format!("Vault: {}", vault.record.name).into();
                self.active_page = None;
                self.editor = None;
                self.blocks_list_state.reset(0);
                self.vault_dialog_open = false;
                self.vault_dialog_error = None;

                let pages = db.list_pages().unwrap_or_default();
                let active_uid = db.get_kv("active.page").ok().flatten();

                self.pages = pages;
                self.db = Some(db);
                self.refresh_search_results();

                if let Some(uid) = active_uid {
                    self.open_page(&uid, cx);
                } else if let Some(first) = self.pages.first().cloned() {
                    self.open_page(&first.uid, cx);
                } else {
                    self.open_page_dialog(PageDialogMode::Create, cx);
                }
            }
            Err(AppError::NoVaultConfigured) => {
                self.boot_status = "No vault configured. Create one to start writing.".into();
                self.db = None;
                self.active_page = None;
                self.editor = None;
                self.blocks_list_state.reset(0);
                self.vault_dialog_open = true;
            }
            Err(err) => {
                self.boot_status = format!("Boot error: {err:?}").into();
                self.db = None;
                self.active_page = None;
                self.editor = None;
                self.blocks_list_state.reset(0);
                self.vault_dialog_error = Some(format!("{err:?}").into());
                self.vault_dialog_open = true;
            }
        }

        cx.notify();
    }

    pub(super) fn refresh_vaults(&mut self) {
        let store = match VaultStore::default_store() {
            Ok(store) => store,
            Err(_) => return,
        };
        let config = match store.load() {
            Ok(config) => config,
            Err(_) => return,
        };
        self.active_vault_id = config.active_id.clone();
        self.vaults = config.vaults;
    }

    pub(super) fn open_vaults(
        &mut self,
        _: &OpenVaults,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.refresh_vaults();
        self.vault_dialog_error = None;
        self.vault_dialog_open = true;

        let default_name = "Vault".to_string();
        let default_path = default_vault_path(&default_name);

        self.vault_dialog_name_input.update(cx, |input, cx| {
            input.set_text(default_name, cx);
            input.reset_selection(cx);
        });
        self.vault_dialog_path_input.update(cx, |input, cx| {
            input.set_text(default_path, cx);
            input.reset_selection(cx);
        });

        cx.notify();
    }

    pub(super) fn close_vault_dialog(&mut self, cx: &mut Context<Self>) {
        self.vault_dialog_open = false;
        cx.notify();
    }

    pub(super) fn set_active_vault(&mut self, vault_id: String, cx: &mut Context<Self>) {
        if self.db.is_none() {
            return;
        }
        let store = match VaultStore::default_store() {
            Ok(store) => store,
            Err(_) => return,
        };
        if store.set_active_vault(&vault_id).is_err() {
            return;
        }
        self.active_vault_id = Some(vault_id.clone());
        self.boot(cx);
    }

    pub(super) fn create_vault(&mut self, cx: &mut Context<Self>) {
        let name = self.vault_dialog_name_input.read(cx).text().trim().to_string();
        let raw_path = self.vault_dialog_path_input.read(cx).text().trim().to_string();
        if name.is_empty() || raw_path.is_empty() {
            self.vault_dialog_error = Some("Name and path are required.".into());
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
                self.active_vault_id = Some(record.id);
                self.vault_dialog_open = false;
                self.boot(cx);
            }
            Err(err) => {
                self.vault_dialog_error = Some(format!("{err:?}").into());
            }
        }
        cx.notify();
    }

    pub(super) fn mark_dirty_for_pane(&mut self, pane: EditorPane, cx: &mut Context<Self>) {
        match pane {
            EditorPane::Primary => {
                if !self.primary_dirty {
                    self.primary_dirty = true;
                    self.update_save_state_from_dirty();
                }
            }
            EditorPane::Secondary => {
                if let Some(secondary) = self.secondary_pane.as_mut() {
                    if !secondary.dirty {
                        secondary.dirty = true;
                        self.update_save_state_from_dirty();
                    }
                }
            }
        }
        self.schedule_autosave(cx);
    }

    pub(super) fn update_save_state_from_dirty(&mut self) {
        let secondary_dirty = self
            .secondary_pane
            .as_ref()
            .is_some_and(|pane| pane.dirty);
        self.save_state = if self.primary_dirty || secondary_dirty {
            SaveState::Dirty
        } else {
            SaveState::Saved
        };
    }

    pub(super) fn schedule_autosave(&mut self, cx: &mut Context<Self>) {
        self.autosave_epoch += 1;
        let epoch = self.autosave_epoch;

        cx.spawn(async move |this, cx| {
            cx.background_executor()
                .timer(Duration::from_millis(1200))
                .await;
            this.update(cx, |this, cx| {
                if this.autosave_epoch != epoch {
                    return;
                }
                if matches!(this.save_state, SaveState::Dirty) {
                    this.save(cx);
                }
            })
            .ok();
        })
        .detach();
    }

    pub(super) fn save(&mut self, cx: &mut Context<Self>) {
        let Some(db) = self.db.as_mut() else {
            self.save_state = SaveState::Error("Database not available.".into());
            cx.notify();
            return;
        };

        self.save_state = SaveState::Saving;
        cx.notify();

        let mut saved_any = false;
        let mut error: Option<String> = None;

        if self.primary_dirty {
            match (self.active_page.clone(), self.editor.as_ref()) {
                (Some(active_page), Some(editor)) => {
                    match db.replace_blocks_for_page(active_page.id, &editor.blocks) {
                        Ok(_) => {
                            self.primary_dirty = false;
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

        if let Some(pane) = self.secondary_pane.as_mut() {
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
            self.save_state = SaveState::Error(err);
        } else if saved_any {
            self.save_state = SaveState::Saved;
            self.refresh_references();
        } else {
            self.save_state = SaveState::Saved;
        }

        cx.notify();
    }

    pub(super) fn open_page(&mut self, uid: &str, cx: &mut Context<Self>) {
        let Some(db) = self.db.as_mut() else {
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
        let editor = EditorModel::new(blocks);

        let _ = db.set_kv("active.page", &page.uid);

        self.active_page = Some(page);
        self.primary_dirty = false;
        self.update_save_state_from_dirty();
        self.blocks_list_state.reset(editor.blocks.len());
        self.active_pane = EditorPane::Primary;

        let active_uid = editor.active().uid.clone();
        let active_len = editor.active().text.len();
        let cursor = self
            .caret_offsets
            .get(&active_uid)
            .copied()
            .unwrap_or(active_len);

        self.editor = Some(editor);
        self.clear_selection_for_pane(EditorPane::Primary);
        self.sync_block_input_from_active_with_cursor(cursor, cx);
        self.close_slash_menu();
        self.refresh_references();
        cx.notify();
    }

    pub(super) fn open_page_dialog(&mut self, mode: PageDialogMode, cx: &mut Context<Self>) {
        self.page_dialog_open = true;
        self.page_dialog_mode = mode;

        let initial: String = match mode {
            PageDialogMode::Create => "".to_string(),
            PageDialogMode::Rename => self
                .active_page
                .as_ref()
                .map(|page| page.title.clone())
                .unwrap_or_default(),
        };

        self.page_dialog_input.update(cx, |input, cx| {
            input.set_text(initial, cx);
            input.reset_selection(cx);
        });

        cx.notify();
    }

    pub(super) fn close_page_dialog(&mut self, cx: &mut Context<Self>) {
        self.page_dialog_open = false;
        cx.notify();
    }

    pub(super) fn confirm_page_dialog(&mut self, cx: &mut Context<Self>) {
        let title = self.page_dialog_input.read(cx).text().trim().to_string();
        if title.is_empty() {
            return;
        }
        let Some(db) = self.db.as_mut() else {
            return;
        };

        match self.page_dialog_mode {
            PageDialogMode::Create => {
                let uid = match app::resolve_unique_page_uid(db, &title) {
                    Ok(value) => value,
                    Err(_) => return,
                };
                if db.insert_page(&uid, &title).is_ok() {
                    self.pages = db.list_pages().unwrap_or_default();
                    self.refresh_search_results();
                    self.open_page(&uid, cx);
                    self.close_page_dialog(cx);
                }
            }
            PageDialogMode::Rename => {
                let Some(active) = self.active_page.clone() else {
                    return;
                };
                if db.update_page_title(active.id, &title).is_ok() {
                    self.pages = db.list_pages().unwrap_or_default();
                    self.active_page = db.get_page_by_uid(&active.uid).ok().flatten();
                    if let Some(pane) = self.secondary_pane.as_mut() {
                        if pane.page.id == active.id {
                            pane.page.title = title.clone();
                        }
                    }
                    self.refresh_search_results();
                    self.refresh_references();
                    self.close_page_dialog(cx);
                    cx.notify();
                }
            }
        }
    }

    pub(super) fn set_mode(&mut self, mode: Mode, cx: &mut Context<Self>) {
        self.mode = mode;
        if self.mode != Mode::Editor {
            self.close_slash_menu();
            self.clear_all_selections();
            self.active_pane = EditorPane::Primary;
        }
        cx.notify();
    }

    pub(super) fn new_page(&mut self, _: &NewPage, _window: &mut Window, cx: &mut Context<Self>) {
        self.open_page_dialog(PageDialogMode::Create, cx);
    }

    pub(super) fn rename_page(
        &mut self,
        _: &RenamePage,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.open_page_dialog(PageDialogMode::Rename, cx);
    }

    pub(super) fn toggle_mode_editor(
        &mut self,
        _: &ToggleModeEditor,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.set_mode(Mode::Editor, cx);
    }

    pub(super) fn toggle_mode_capture(
        &mut self,
        _: &ToggleModeCapture,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.set_mode(Mode::Capture, cx);
        window.focus(&self.capture_input.focus_handle(cx), cx);
    }

    pub(super) fn toggle_mode_review(
        &mut self,
        _: &ToggleModeReview,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.set_mode(Mode::Review, cx);
        self.load_review_items(cx);
    }
}
