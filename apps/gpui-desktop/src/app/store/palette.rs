use super::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PaletteSection {
    Suggested,
    Pages,
    Commands,
    Plugins,
    Settings,
}

impl PaletteSection {
    fn id(&self) -> &'static str {
        match self {
            PaletteSection::Suggested => "suggested",
            PaletteSection::Pages => "pages",
            PaletteSection::Commands => "commands",
            PaletteSection::Plugins => "plugins",
            PaletteSection::Settings => "settings",
        }
    }

    fn label(&self) -> &'static str {
        match self {
            PaletteSection::Suggested => "Suggested",
            PaletteSection::Pages => "Pages",
            PaletteSection::Commands => "Commands",
            PaletteSection::Plugins => "Plugins",
            PaletteSection::Settings => "Settings",
        }
    }
}

fn section_for_action(action: &PaletteAction) -> PaletteSection {
    match action {
        PaletteAction::OpenSettings => PaletteSection::Settings,
        PaletteAction::ReloadPlugins
        | PaletteAction::OpenPluginSettings
        | PaletteAction::RunPluginToolbarAction(_)
        | PaletteAction::RunPluginCommand(_)
        | PaletteAction::OpenPluginPanel(_)
        | PaletteAction::ClosePluginPanel => PaletteSection::Plugins,
        PaletteAction::OpenPage(_) => PaletteSection::Pages,
        _ => PaletteSection::Commands,
    }
}

fn push_palette_section(
    rows: &mut Vec<PaletteRow>,
    section: PaletteSection,
    items: Vec<PaletteItem>,
) {
    if items.is_empty() {
        return;
    }

    rows.push(PaletteRow::Header {
        id: format!("palette-section-{}", section.id()),
        label: section.label().to_string(),
    });

    rows.extend(items.into_iter().map(PaletteRow::Item));
}

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
                .w(px(640.0))
                .keyboard(false)
                .close_button(false)
                .p_0()
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

    pub(crate) fn dismiss_command_palette(&mut self, cx: &mut Context<Self>) {
        self.ui.palette_open = false;
        self.ui.palette_query.clear();
        self.ui.palette_index = 0;
        cx.notify();
    }

    pub(crate) fn close_command_palette(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.ui.palette_open {
            return;
        }
        window.close_dialog(cx);
        self.dismiss_command_palette(cx);
    }

    pub(crate) fn build_palette_items(&self) -> Vec<PaletteItem> {
        self.build_palette_items_with_debug(self.agent_debug.is_some())
    }

    fn build_palette_items_with_debug(&self, debug_tools_enabled: bool) -> Vec<PaletteItem> {
        let mut items = Vec::new();

        let open_vaults_hint =
            shortcut_hint(ShortcutSpec::new("cmd-shift-v", "ctrl-alt-v")).to_string();
        let sidebar_hint = shortcut_hint(ShortcutSpec::new("cmd-b", "ctrl-b")).to_string();
        let quick_add_hint = shortcut_hint(ShortcutSpec::new("cmd-l", "ctrl-l")).to_string();
        let review_hint =
            shortcut_hint(ShortcutSpec::new("cmd-shift-r", "ctrl-shift-r")).to_string();
        let panel_hint =
            shortcut_hint(ShortcutSpec::new("cmd-shift-p", "ctrl-shift-p")).to_string();

        items.push(PaletteItem {
            id: "open-vaults".to_string(),
            label: "Open vaults".to_string(),
            hint: Some(open_vaults_hint),
            action: PaletteAction::OpenVaults,
        });
        items.push(PaletteItem {
            id: "open-settings".to_string(),
            label: "Open settings".to_string(),
            hint: None,
            action: PaletteAction::OpenSettings,
        });
        items.push(PaletteItem {
            id: "toggle-sidebar".to_string(),
            label: if self.settings.sidebar_collapsed {
                "Show sidebar".to_string()
            } else {
                "Hide sidebar".to_string()
            },
            hint: Some(sidebar_hint),
            action: PaletteAction::ToggleSidebar,
        });
        items.push(PaletteItem {
            id: "focus-quick-add".to_string(),
            label: "Focus quick add".to_string(),
            hint: Some(quick_add_hint),
            action: PaletteAction::FocusQuickAdd,
        });
        items.push(PaletteItem {
            id: "toggle-context-panel".to_string(),
            label: if self.settings.context_panel_open {
                "Hide context panel".to_string()
            } else {
                "Show context panel".to_string()
            },
            hint: Some(panel_hint.clone()),
            action: PaletteAction::ToggleContextPanel,
        });
        items.push(PaletteItem {
            id: "open-review-panel".to_string(),
            label: "Open review panel".to_string(),
            hint: Some(review_hint),
            action: PaletteAction::OpenContextPanel(WorkspacePanel::Review),
        });
        items.push(PaletteItem {
            id: "open-backlinks-panel".to_string(),
            label: "Open backlinks panel".to_string(),
            hint: Some(panel_hint.clone()),
            action: PaletteAction::OpenContextPanel(WorkspacePanel::Backlinks),
        });
        items.push(PaletteItem {
            id: "open-plugins-panel".to_string(),
            label: "Open plugins panel".to_string(),
            hint: Some(panel_hint.clone()),
            action: PaletteAction::OpenContextPanel(WorkspacePanel::Plugins),
        });
        items.push(PaletteItem {
            id: "cycle-context-panel".to_string(),
            label: "Cycle context panel".to_string(),
            hint: Some(panel_hint),
            action: PaletteAction::CycleContextPanel,
        });

        let new_page_hint = shortcut_hint(ShortcutSpec::new("cmd-n", "ctrl-n")).to_string();
        let rename_page_hint = shortcut_hint(ShortcutSpec::new("cmd-r", "f2")).to_string();
        let split_hint = shortcut_hint(ShortcutSpec::new("cmd-\\", "ctrl-\\")).to_string();
        let undo_hint = shortcut_hint(ShortcutSpec::new("cmd-z", "ctrl-z")).to_string();
        let redo_hint = shortcut_hint(ShortcutSpec::new("cmd-shift-z", "ctrl-shift-z")).to_string();

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
            id: "undo-edit".to_string(),
            label: "Undo".to_string(),
            hint: Some(undo_hint),
            action: PaletteAction::UndoEdit,
        });
        items.push(PaletteItem {
            id: "redo-edit".to_string(),
            label: "Redo".to_string(),
            hint: Some(redo_hint),
            action: PaletteAction::RedoEdit,
        });
        items.push(PaletteItem {
            id: "new-page".to_string(),
            label: "Create new page".to_string(),
            hint: Some(new_page_hint),
            action: PaletteAction::NewPage,
        });
        if debug_tools_enabled {
            items.push(PaletteItem {
                id: "create-test-page".to_string(),
                label: "Create Test Page".to_string(),
                hint: Some("Debug".to_string()),
                action: PaletteAction::CreateTestPage,
            });
        }
        items.push(PaletteItem {
            id: "rename-page".to_string(),
            label: "Rename current page".to_string(),
            hint: Some(rename_page_hint),
            action: PaletteAction::RenamePage,
        });
        items.push(PaletteItem {
            id: "toggle-backlinks".to_string(),
            label: if self.settings.context_panel_tab == WorkspacePanel::Backlinks {
                "Close backlinks panel".to_string()
            } else {
                "Open backlinks panel".to_string()
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
            hint: Some(split_hint),
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
        items.push(PaletteItem {
            id: "toggle-focus-mode".to_string(),
            label: if self.settings.focus_mode {
                "Exit focus mode".to_string()
            } else {
                "Enter focus mode".to_string()
            },
            hint: Some(shortcut_hint(ShortcutSpec::new("cmd-shift-f", "ctrl-shift-f")).to_string()),
            action: PaletteAction::ToggleFocusMode,
        });
        items.push(PaletteItem {
            id: "quick-capture".to_string(),
            label: "Quick capture".to_string(),
            hint: Some(
                shortcut_hint(ShortcutSpec::new("cmd-shift-space", "ctrl-shift-space")).to_string(),
            ),
            action: PaletteAction::OpenQuickCapture,
        });

        let capture_hint = shortcut_hint(ShortcutSpec::new("cmd-1", "ctrl-1")).to_string();
        let edit_hint = shortcut_hint(ShortcutSpec::new("cmd-2", "ctrl-2")).to_string();
        let review_feed_hint = shortcut_hint(ShortcutSpec::new("cmd-3", "ctrl-3")).to_string();
        items.push(PaletteItem {
            id: "switch-capture".to_string(),
            label: "Switch to Capture mode".to_string(),
            hint: Some(capture_hint),
            action: PaletteAction::SwitchMode(Mode::Capture),
        });
        items.push(PaletteItem {
            id: "switch-edit".to_string(),
            label: "Switch to Edit mode".to_string(),
            hint: Some(edit_hint),
            action: PaletteAction::SwitchMode(Mode::Editor),
        });
        items.push(PaletteItem {
            id: "switch-review".to_string(),
            label: "Switch to Review mode".to_string(),
            hint: Some(review_feed_hint),
            action: PaletteAction::SwitchMode(Mode::Review),
        });

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
            for action in status.toolbar_actions.iter() {
                items.push(PaletteItem {
                    id: format!("plugin-toolbar-{}", action.id),
                    label: action.title.clone(),
                    hint: Some(format!("Toolbar · {}", action.plugin_id)),
                    action: PaletteAction::RunPluginToolbarAction(action.clone()),
                });
            }
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

    fn build_suggested_palette_items(&self) -> Vec<PaletteItem> {
        let mut items = Vec::new();

        let new_page_hint = shortcut_hint(ShortcutSpec::new("cmd-n", "ctrl-n")).to_string();
        let open_vaults_hint =
            shortcut_hint(ShortcutSpec::new("cmd-shift-v", "ctrl-alt-v")).to_string();
        let sidebar_hint = shortcut_hint(ShortcutSpec::new("cmd-b", "ctrl-b")).to_string();
        let quick_add_hint = shortcut_hint(ShortcutSpec::new("cmd-l", "ctrl-l")).to_string();
        let review_hint =
            shortcut_hint(ShortcutSpec::new("cmd-shift-r", "ctrl-shift-r")).to_string();

        items.push(PaletteItem {
            id: "new-page".to_string(),
            label: "Create new page".to_string(),
            hint: Some(new_page_hint),
            action: PaletteAction::NewPage,
        });
        items.push(PaletteItem {
            id: "open-vaults".to_string(),
            label: "Open vaults".to_string(),
            hint: Some(open_vaults_hint),
            action: PaletteAction::OpenVaults,
        });
        items.push(PaletteItem {
            id: "focus-quick-add".to_string(),
            label: "Focus quick add".to_string(),
            hint: Some(quick_add_hint),
            action: PaletteAction::FocusQuickAdd,
        });
        items.push(PaletteItem {
            id: "toggle-sidebar".to_string(),
            label: if self.settings.sidebar_collapsed {
                "Show sidebar".to_string()
            } else {
                "Hide sidebar".to_string()
            },
            hint: Some(sidebar_hint),
            action: PaletteAction::ToggleSidebar,
        });
        items.push(PaletteItem {
            id: "open-settings".to_string(),
            label: "Open settings".to_string(),
            hint: None,
            action: PaletteAction::OpenSettings,
        });
        items.push(PaletteItem {
            id: "open-review-panel".to_string(),
            label: "Open review panel".to_string(),
            hint: Some(review_hint),
            action: PaletteAction::OpenContextPanel(WorkspacePanel::Review),
        });

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
        let results = db
            .search_block_page_summaries(query, 50)
            .unwrap_or_default();
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
            let recent_rank = self
                .editor
                .recent_pages
                .iter()
                .position(|uid| uid == &page.uid);
            let Some(score) = helpers::score_palette_page(query, &label, &snippet, recent_rank)
            else {
                continue;
            };
            scored.push((
                score,
                PaletteItem {
                    id: format!("page-{}", page.uid),
                    label,
                    hint: if snippet.is_empty() {
                        None
                    } else {
                        Some(snippet)
                    },
                    action: PaletteAction::OpenPage(page.uid.clone()),
                },
            ));
        }
        scored.sort_by(|a, b| b.0.cmp(&a.0));
        scored
    }

    pub(crate) fn filtered_palette_rows(&self) -> Vec<PaletteRow> {
        let query = self.ui.palette_query.trim();
        let mut rows = Vec::new();

        if query.is_empty() {
            let suggested = self.build_suggested_palette_items();
            let excluded_ids: HashSet<String> =
                suggested.iter().map(|item| item.id.clone()).collect();
            push_palette_section(&mut rows, PaletteSection::Suggested, suggested);

            let mut pages = Vec::new();
            for page in self.ordered_pages_for_palette() {
                let label = if page.title.trim().is_empty() {
                    page.uid.clone()
                } else {
                    page.title.clone()
                };
                pages.push(PaletteItem {
                    id: format!("page-{}", page.uid),
                    label,
                    hint: None,
                    action: PaletteAction::OpenPage(page.uid),
                });
            }
            push_palette_section(&mut rows, PaletteSection::Pages, pages);

            let mut commands = Vec::new();
            let mut plugins = Vec::new();
            let mut settings = Vec::new();
            for item in self.build_palette_items() {
                if excluded_ids.contains(&item.id) {
                    continue;
                }
                match section_for_action(&item.action) {
                    PaletteSection::Plugins => plugins.push(item),
                    PaletteSection::Settings => settings.push(item),
                    _ => commands.push(item),
                }
            }

            push_palette_section(&mut rows, PaletteSection::Commands, commands);
            push_palette_section(&mut rows, PaletteSection::Plugins, plugins);
            push_palette_section(&mut rows, PaletteSection::Settings, settings);

            return rows;
        }

        let mut pages_scored = self.page_palette_items_for_query(query);
        let pages = pages_scored
            .drain(..)
            .map(|(_, item)| item)
            .collect::<Vec<_>>();
        push_palette_section(&mut rows, PaletteSection::Pages, pages);

        let mut commands_scored: Vec<(i64, PaletteItem)> = Vec::new();
        let mut plugins_scored: Vec<(i64, PaletteItem)> = Vec::new();
        let mut settings_scored: Vec<(i64, PaletteItem)> = Vec::new();

        for item in self.build_palette_items() {
            let label_score = helpers::fuzzy_score(query, &item.label);
            let hint_score = item
                .hint
                .as_ref()
                .and_then(|hint| helpers::fuzzy_score(query, hint));
            let score = match (label_score, hint_score) {
                (Some(label), Some(hint)) => label.max(hint.saturating_sub(2)),
                (Some(label), None) => label,
                (None, Some(hint)) => hint.saturating_sub(2),
                (None, None) => continue,
            };

            match section_for_action(&item.action) {
                PaletteSection::Plugins => plugins_scored.push((score, item)),
                PaletteSection::Settings => settings_scored.push((score, item)),
                _ => commands_scored.push((score, item)),
            }
        }

        commands_scored.sort_by(|a, b| b.0.cmp(&a.0));
        plugins_scored.sort_by(|a, b| b.0.cmp(&a.0));
        settings_scored.sort_by(|a, b| b.0.cmp(&a.0));

        push_palette_section(
            &mut rows,
            PaletteSection::Commands,
            commands_scored.into_iter().map(|(_, item)| item).collect(),
        );
        push_palette_section(
            &mut rows,
            PaletteSection::Plugins,
            plugins_scored.into_iter().map(|(_, item)| item).collect(),
        );
        push_palette_section(
            &mut rows,
            PaletteSection::Settings,
            settings_scored.into_iter().map(|(_, item)| item).collect(),
        );

        rows
    }

    fn palette_item_at_or_next(rows: &[PaletteRow], index: usize) -> Option<(usize, PaletteItem)> {
        if rows.is_empty() {
            return None;
        }

        if let Some(PaletteRow::Item(item)) = rows.get(index) {
            return Some((index, item.clone()));
        }

        for (idx, row) in rows.iter().enumerate().skip(index) {
            if let PaletteRow::Item(item) = row {
                return Some((idx, item.clone()));
            }
        }

        for (idx, row) in rows.iter().enumerate().take(index).rev() {
            if let PaletteRow::Item(item) = row {
                return Some((idx, item.clone()));
            }
        }

        None
    }

    pub(crate) fn move_palette_index(&mut self, delta: isize) {
        let rows = self.filtered_palette_rows();
        if rows.is_empty() {
            self.ui.palette_index = 0;
            return;
        }

        let len = rows.len() as isize;
        let mut next = (self.ui.palette_index as isize).clamp(0, len.saturating_sub(1));

        for _ in 0..len {
            next = (next + delta + len) % len;
            if matches!(rows.get(next as usize), Some(PaletteRow::Item(_))) {
                self.ui.palette_index = next as usize;
                return;
            }
        }

        self.ui.palette_index = 0;
    }

    pub(crate) fn run_palette_command(
        &mut self,
        index: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let rows = self.filtered_palette_rows();
        let Some((_ix, item)) = Self::palette_item_at_or_next(&rows, index) else {
            return;
        };
        self.close_command_palette(window, cx);
        match item.action {
            PaletteAction::OpenVaults => self.open_vaults(&OpenVaults, window, cx),
            PaletteAction::OpenSettings => self.open_settings(SettingsTab::General, window, cx),
            PaletteAction::FocusSearch => {
                window.focus(&self.editor.sidebar_search_input.focus_handle(cx), cx);
            }
            PaletteAction::FocusEditor => {
                self.set_active_pane(EditorPane::Primary, cx);
                self.sync_block_input_from_active_for_pane(EditorPane::Primary, Some(window), cx);
                window.focus(&self.editor.block_input.focus_handle(cx), cx);
            }
            PaletteAction::FocusQuickAdd => {
                window.focus(&self.editor.capture_input.focus_handle(cx), cx);
            }
            PaletteAction::CreateTestPage => self.create_test_page(window, cx),
            PaletteAction::NewPage => self.open_page_dialog(PageDialogMode::Create, cx),
            PaletteAction::RenamePage => self.open_page_dialog(PageDialogMode::Rename, cx),
            PaletteAction::ToggleSidebar => {
                self.settings.sidebar_collapsed = !self.settings.sidebar_collapsed;
                self.persist_settings();
                cx.notify();
            }
            PaletteAction::ToggleContextPanel => {
                self.settings.context_panel_open = !self.settings.context_panel_open;
                self.persist_settings();
                cx.notify();
            }
            PaletteAction::OpenContextPanel(tab) => {
                self.set_context_panel_tab(tab, cx);
            }
            PaletteAction::CycleContextPanel => {
                self.cycle_context_panel(cx);
            }
            PaletteAction::ToggleBacklinks => {
                if self.settings.context_panel_open
                    && self.settings.context_panel_tab == WorkspacePanel::Backlinks
                {
                    self.settings.context_panel_open = false;
                    self.persist_settings();
                    cx.notify();
                } else {
                    self.set_context_panel_tab(WorkspacePanel::Backlinks, cx);
                }
            }
            PaletteAction::ToggleSplitPane => self.toggle_split_pane(cx),
            PaletteAction::DuplicateToSplit => self.copy_primary_to_secondary(cx),
            PaletteAction::SwapSplitPanes => self.swap_panes(cx),
            PaletteAction::ReloadPlugins => self.load_plugins(Some(window), cx),
            PaletteAction::OpenPluginSettings => self.open_plugin_settings(window, cx),
            PaletteAction::RunPluginToolbarAction(action) => {
                self.run_plugin_toolbar_action(action, window, cx);
            }
            PaletteAction::RunPluginCommand(command) => {
                self.run_plugin_command(command, window, cx);
            }
            PaletteAction::OpenPluginPanel(panel) => {
                self.open_plugin_panel(panel, window, cx);
            }
            PaletteAction::ClosePluginPanel => {
                self.close_plugin_panel(cx);
            }
            PaletteAction::OpenPage(uid) => {
                self.open_page(&uid, cx);
                window.focus(&self.editor.block_input.focus_handle(cx), cx);
            }
            PaletteAction::ToggleFocusMode => {
                self.settings.focus_mode = !self.settings.focus_mode;
                self.persist_settings();
                cx.notify();
            }
            PaletteAction::OpenQuickCapture => {
                self.ui.capture_overlay_open = true;
                self.ui.capture_overlay_target = self.settings.quick_add_target;
                window.focus(&self.editor.capture_input.focus_handle(cx), cx);
                cx.notify();
            }
            PaletteAction::SwitchMode(mode) => {
                self.set_mode(mode, cx);
            }
            PaletteAction::UndoEdit => {
                self.undo_edit_action(&UndoEdit, window, cx);
            }
            PaletteAction::RedoEdit => {
                self.redo_edit_action(&RedoEdit, window, cx);
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

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::TestAppContext;
    use gpui_component::Root;
    use std::cell::RefCell;
    use std::rc::Rc;

    #[gpui::test]
    fn palette_includes_plugin_toolbar_actions(cx: &mut TestAppContext) {
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
        app.update(cx, |app, _cx| {
            let db = Database::new_in_memory().expect("db init");
            db.run_migrations().expect("migrations");
            app.app.db = Some(db);

            app.plugins.plugin_status = Some(PluginRuntimeStatus {
                loaded: Vec::new(),
                blocked: Vec::new(),
                commands: Vec::new(),
                panels: Vec::new(),
                toolbar_actions: vec![PluginToolbarAction {
                    plugin_id: "alpha".to_string(),
                    id: "alpha.toolbar".to_string(),
                    title: "Alpha".to_string(),
                    tooltip: Some("tip".to_string()),
                }],
                renderers: Vec::new(),
            });

            let items = app.build_palette_items();
            assert!(items.iter().any(|item| {
                matches!(
                    &item.action,
                    PaletteAction::RunPluginToolbarAction(action)
                        if action.id == "alpha.toolbar"
                )
            }));
        });

        cx.update_window(*window, |_root, _window, _cx| {}).unwrap();
    }

    #[gpui::test]
    fn palette_rows_include_suggested_toggles(cx: &mut TestAppContext) {
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
        app.update(cx, |app, _cx| {
            app.ui.palette_query.clear();
            let rows = app.filtered_palette_rows();

            assert!(rows.iter().any(|row| matches!(
                row,
                PaletteRow::Header { label, .. } if label == "Suggested"
            )));

            assert!(rows.iter().any(|row| matches!(
                row,
                PaletteRow::Item(item) if matches!(item.action, PaletteAction::ToggleSidebar)
            )));
            assert!(rows.iter().any(|row| matches!(
                row,
                PaletteRow::Item(item) if matches!(item.action, PaletteAction::FocusQuickAdd)
            )));
        });

        cx.update_window(*window, |_root, _window, _cx| {}).unwrap();
    }

    #[gpui::test]
    fn debug_create_test_page_command_is_debug_only(cx: &mut TestAppContext) {
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
        app.update(cx, |app, _cx| {
            let without_debug = app.build_palette_items_with_debug(false);
            assert!(!without_debug
                .iter()
                .any(|item| { matches!(item.action, PaletteAction::CreateTestPage) }));

            let with_debug = app.build_palette_items_with_debug(true);
            assert!(with_debug
                .iter()
                .any(|item| { matches!(item.action, PaletteAction::CreateTestPage) }));
        });

        cx.update_window(*window, |_root, _window, _cx| {}).unwrap();
    }
}
