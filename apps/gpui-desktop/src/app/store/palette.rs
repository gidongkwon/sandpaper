use super::*;

impl AppStore {
    pub(crate) fn open_command_palette(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let has_root = window.root::<Root>().flatten().is_some();
        if !has_root {
            return;
        }
        if has_root && self.ui.palette_open && window.has_active_dialog(cx) {
            window.focus(&self.ui.palette_input.focus_handle(cx), cx);
            return;
        }

        self.ui.palette_open = true;
        self.ui.palette_query.clear();
        self.ui.palette_index = 0;
        self.ui.palette_input.update(cx, |input, cx| {
            input.set_value("", window, cx);
            let position = input.text().offset_to_position(0);
            input.set_cursor_position(position, window, cx);
        });
        let app = cx.entity();
        let view = cx.new(|cx| crate::ui::dialogs::CommandPaletteDialogView::new(app.clone(), cx));

        window.open_dialog(cx, move |dialog, _window, _cx| {
            let app = app.clone();
            let view = view.clone();
            dialog
                .title("Command palette")
                .w(px(520.0))
                .keyboard(false)
                .child(view)
                .on_close(move |_event, _window, cx| {
                    app.update(cx, |app, cx| {
                        app.dismiss_command_palette(cx);
                    });
                })
        });

        window.focus(&self.ui.palette_input.focus_handle(cx), cx);
        cx.notify();
    }

    fn dismiss_command_palette(&mut self, cx: &mut Context<Self>) {
        self.ui.palette_open = false;
        self.ui.palette_query.clear();
        self.ui.palette_index = 0;
        cx.notify();
    }

    pub(crate) fn close_command_palette(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if !self.ui.palette_open {
            return;
        }
        window.close_dialog(cx);
        self.dismiss_command_palette(cx);
    }

    pub(crate) fn build_palette_items(&self) -> Vec<PaletteItem> {
        let mut items = Vec::new();

        items.push(PaletteItem {
            id: "open-vaults".to_string(),
            label: "Open vaults".to_string(),
            hint: None,
            action: PaletteAction::OpenVaults,
        });
        items.push(PaletteItem {
            id: "open-settings".to_string(),
            label: "Open settings".to_string(),
            hint: None,
            action: PaletteAction::OpenSettings,
        });

        if self.app.mode != Mode::Editor {
            items.push(PaletteItem {
                id: "switch-editor".to_string(),
                label: "Switch to editor".to_string(),
                hint: None,
                action: PaletteAction::SwitchMode(Mode::Editor),
            });
        }
        if self.app.mode != Mode::Capture {
            items.push(PaletteItem {
                id: "switch-capture".to_string(),
                label: "Switch to quick capture".to_string(),
                hint: None,
                action: PaletteAction::SwitchMode(Mode::Capture),
            });
        }
        if self.app.mode != Mode::Review {
            items.push(PaletteItem {
                id: "switch-review".to_string(),
                label: "Switch to review".to_string(),
                hint: None,
                action: PaletteAction::SwitchMode(Mode::Review),
            });
        }

        if self.app.mode == Mode::Editor {
            items.push(PaletteItem {
                id: "focus-search".to_string(),
                label: "Focus search".to_string(),
                hint: None,
                action: PaletteAction::FocusSearch,
            });
            items.push(PaletteItem {
                id: "focus-editor".to_string(),
                label: "Focus editor".to_string(),
                hint: None,
                action: PaletteAction::FocusEditor,
            });
            items.push(PaletteItem {
                id: "new-page".to_string(),
                label: "Create new page".to_string(),
                hint: None,
                action: PaletteAction::NewPage,
            });
            items.push(PaletteItem {
                id: "rename-page".to_string(),
                label: "Rename current page".to_string(),
                hint: None,
                action: PaletteAction::RenamePage,
            });
            items.push(PaletteItem {
                id: "toggle-backlinks".to_string(),
                label: if self.settings.backlinks_open {
                    "Hide backlinks panel".to_string()
                } else {
                    "Show backlinks panel".to_string()
                },
                hint: None,
                action: PaletteAction::ToggleBacklinks,
            });
            items.push(PaletteItem {
                id: "toggle-split-pane".to_string(),
                label: if self.editor.secondary_pane.is_some() {
                    "Close split pane".to_string()
                } else {
                    "Open split pane".to_string()
                },
                hint: None,
                action: PaletteAction::ToggleSplitPane,
            });
            items.push(PaletteItem {
                id: "duplicate-to-split".to_string(),
                label: if self.editor.secondary_pane.is_some() {
                    "Duplicate to split".to_string()
                } else {
                    "Open split (duplicate)".to_string()
                },
                hint: None,
                action: PaletteAction::DuplicateToSplit,
            });
            if self.editor.secondary_pane.is_some() {
                items.push(PaletteItem {
                    id: "swap-split-panes".to_string(),
                    label: "Swap panes".to_string(),
                    hint: None,
                    action: PaletteAction::SwapSplitPanes,
                });
            }
        }

        if self.app.db.is_some() {
            items.push(PaletteItem {
                id: "reload-plugins".to_string(),
                label: "Reload plugins".to_string(),
                hint: None,
                action: PaletteAction::ReloadPlugins,
            });
            items.push(PaletteItem {
                id: "open-plugin-settings".to_string(),
                label: "Open plugin settings".to_string(),
                hint: None,
                action: PaletteAction::OpenPluginSettings,
            });
        }

        if self.plugins.plugin_active_panel.is_some() {
            items.push(PaletteItem {
                id: "close-plugin-panel".to_string(),
                label: "Close plugin panel".to_string(),
                hint: None,
                action: PaletteAction::ClosePluginPanel,
            });
        }

        if let Some(status) = self.plugins.plugin_status.as_ref() {
            for command in status.commands.iter() {
                items.push(PaletteItem {
                    id: format!("plugin-command-{}", command.id),
                    label: command.title.clone(),
                    hint: Some(format!("Plugin · {}", command.plugin_id)),
                    action: PaletteAction::RunPluginCommand(command.clone()),
                });
            }
            for panel in status.panels.iter() {
                items.push(PaletteItem {
                    id: format!("plugin-panel-{}", panel.id),
                    label: panel.title.clone(),
                    hint: Some(format!("Panel · {}", panel.plugin_id)),
                    action: PaletteAction::OpenPluginPanel(panel.clone()),
                });
            }
        }

        items
    }

    fn ordered_pages_for_palette(&self) -> Vec<PageRecord> {
        let mut ordered = Vec::new();
        let mut seen = HashSet::new();
        for uid in self.editor.recent_pages.iter() {
            if let Some(page) = self.editor.pages.iter().find(|page| &page.uid == uid) {
                ordered.push(page.clone());
                seen.insert(page.uid.clone());
            }
        }
        for page in self.editor.pages.iter() {
            if !seen.contains(&page.uid) {
                ordered.push(page.clone());
            }
        }
        ordered
    }

    fn page_snippets_for_query(&self, query: &str) -> HashMap<String, String> {
        let Some(db) = self.app.db.as_ref() else {
            return HashMap::new();
        };
        let mut snippets = HashMap::new();
        let results = db.search_block_page_summaries(query, 50).unwrap_or_default();
        for record in results {
            snippets
                .entry(record.page_uid)
                .or_insert_with(|| helpers::format_snippet(&record.text, 80));
        }
        snippets
    }

    fn page_palette_items_for_query(&self, query: &str) -> Vec<(i64, PaletteItem)> {
        let query = query.trim();
        let snippets = self.page_snippets_for_query(query);
        let mut scored: Vec<(i64, PaletteItem)> = Vec::new();
        for page in self.editor.pages.iter() {
            let title = page.title.trim();
            let label = if title.is_empty() {
                page.uid.clone()
            } else {
                page.title.clone()
            };
            let snippet = snippets.get(&page.uid).cloned().unwrap_or_default();
            let recent_rank = self.editor.recent_pages.iter().position(|uid| uid == &page.uid);
            let Some(score) = helpers::score_palette_page(query, &label, &snippet, recent_rank) else {
                continue;
            };
            scored.push((
                score,
                PaletteItem {
                    id: format!("page-{}", page.uid),
                    label,
                    hint: if snippet.is_empty() { None } else { Some(snippet) },
                    action: PaletteAction::OpenPage(page.uid.clone()),
                },
            ));
        }
        scored.sort_by(|a, b| b.0.cmp(&a.0));
        scored
    }

    pub(crate) fn filtered_palette_items(&self) -> Vec<PaletteItem> {
        let query = self.ui.palette_query.trim();
        if query.is_empty() {
            let mut items = Vec::new();
            for page in self.ordered_pages_for_palette() {
                let label = if page.title.trim().is_empty() {
                    page.uid.clone()
                } else {
                    page.title.clone()
                };
                items.push(PaletteItem {
                    id: format!("page-{}", page.uid),
                    label,
                    hint: None,
                    action: PaletteAction::OpenPage(page.uid),
                });
            }
            items.extend(self.build_palette_items());
            return items;
        }

        let mut scored: Vec<(i64, PaletteItem)> = Vec::new();
        for item in self.build_palette_items() {
            let label_score = helpers::fuzzy_score(query, &item.label);
            let hint_score = item.hint.as_ref().and_then(|hint| helpers::fuzzy_score(query, hint));
            let score = match (label_score, hint_score) {
                (Some(label), Some(hint)) => label.max(hint.saturating_sub(2)),
                (Some(label), None) => label,
                (None, Some(hint)) => hint.saturating_sub(2),
                (None, None) => continue,
            };
            scored.push((score, item));
        }

        scored.extend(self.page_palette_items_for_query(query));

        scored.sort_by(|a, b| b.0.cmp(&a.0));
        scored.into_iter().map(|(_, item)| item).collect()
    }

    pub(crate) fn move_palette_index(&mut self, delta: isize) {
        let commands = self.filtered_palette_items();
        if commands.is_empty() {
            self.ui.palette_index = 0;
            return;
        }
        let len = commands.len() as isize;
        let current = self.ui.palette_index as isize;
        let next = (current + delta + len) % len;
        self.ui.palette_index = next as usize;
    }

    pub(crate) fn run_palette_command(
        &mut self,
        index: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let commands = self.filtered_palette_items();
        let Some(item) = commands.get(index).cloned() else {
            return;
        };
        self.close_command_palette(window, cx);
        match item.action {
            PaletteAction::OpenVaults => self.open_vaults(&OpenVaults, window, cx),
            PaletteAction::OpenSettings => self.open_settings(SettingsTab::General, window, cx),
            PaletteAction::SwitchMode(mode) => self.set_mode(mode, cx),
            PaletteAction::FocusSearch => {
                if self.app.mode != Mode::Editor {
                    self.set_mode(Mode::Editor, cx);
                }
                window.focus(&self.editor.sidebar_search_input.focus_handle(cx), cx);
            }
            PaletteAction::FocusEditor => {
                if self.app.mode != Mode::Editor {
                    self.set_mode(Mode::Editor, cx);
                }
                self.set_active_pane(EditorPane::Primary, cx);
                self.sync_block_input_from_active_for_pane(EditorPane::Primary, Some(window), cx);
                window.focus(&self.editor.block_input.focus_handle(cx), cx);
            }
            PaletteAction::NewPage => self.open_page_dialog(PageDialogMode::Create, cx),
            PaletteAction::RenamePage => self.open_page_dialog(PageDialogMode::Rename, cx),
            PaletteAction::ToggleBacklinks => {
                self.settings.backlinks_open = !self.settings.backlinks_open;
                self.persist_settings();
                cx.notify();
            }
            PaletteAction::ToggleSplitPane => self.toggle_split_pane(cx),
            PaletteAction::DuplicateToSplit => self.copy_primary_to_secondary(cx),
            PaletteAction::SwapSplitPanes => self.swap_panes(cx),
            PaletteAction::ReloadPlugins => self.load_plugins(Some(window), cx),
            PaletteAction::OpenPluginSettings => self.open_plugin_settings(window, cx),
            PaletteAction::RunPluginCommand(command) => {
                self.run_plugin_command(command, window, cx);
            }
            PaletteAction::OpenPluginPanel(panel) => {
                self.open_plugin_panel(panel, cx);
            }
            PaletteAction::ClosePluginPanel => {
                self.close_plugin_panel(cx);
            }
            PaletteAction::OpenPage(uid) => {
                self.set_mode(Mode::Editor, cx);
                self.open_page(&uid, cx);
                window.focus(&self.editor.block_input.focus_handle(cx), cx);
            }
        }
    }

    pub(crate) fn open_command_palette_action(
        &mut self,
        _: &OpenCommandPalette,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.open_command_palette(window, cx);
    }

    pub(crate) fn close_command_palette_action(
        &mut self,
        _: &CloseCommandPalette,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.close_command_palette(window, cx);
    }

    pub(crate) fn palette_move_up(
        &mut self,
        _: &PaletteMoveUp,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.move_palette_index(-1);
        cx.notify();
    }

    pub(crate) fn palette_move_down(
        &mut self,
        _: &PaletteMoveDown,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.move_palette_index(1);
        cx.notify();
    }

    pub(crate) fn palette_run(
        &mut self,
        _: &PaletteRun,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let index = self.ui.palette_index;
        self.run_palette_command(index, window, cx);
    }
}
