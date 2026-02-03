use super::*;

impl SandpaperApp {
    pub(super) fn open_command_palette(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.palette_open = true;
        self.palette_query.clear();
        self.palette_index = 0;
        self.palette_input.update(cx, |input, cx| {
            input.set_value("", window, cx);
            let position = input.text().offset_to_position(0);
            input.set_cursor_position(position, window, cx);
        });
        window.focus(&self.palette_input.focus_handle(cx), cx);
        cx.notify();
    }

    pub(super) fn close_command_palette(&mut self, cx: &mut Context<Self>) {
        self.palette_open = false;
        self.palette_query.clear();
        self.palette_index = 0;
        cx.notify();
    }

    pub(super) fn build_palette_items(&self) -> Vec<PaletteItem> {
        let mut items = Vec::new();

        items.push(PaletteItem {
            id: "open-vaults".to_string(),
            label: "Open vaults".to_string(),
            hint: None,
            action: PaletteAction::OpenVaults,
        });

        if self.mode != Mode::Editor {
            items.push(PaletteItem {
                id: "switch-editor".to_string(),
                label: "Switch to editor".to_string(),
                hint: None,
                action: PaletteAction::SwitchMode(Mode::Editor),
            });
        }
        if self.mode != Mode::Capture {
            items.push(PaletteItem {
                id: "switch-capture".to_string(),
                label: "Switch to quick capture".to_string(),
                hint: None,
                action: PaletteAction::SwitchMode(Mode::Capture),
            });
        }
        if self.mode != Mode::Review {
            items.push(PaletteItem {
                id: "switch-review".to_string(),
                label: "Switch to review".to_string(),
                hint: None,
                action: PaletteAction::SwitchMode(Mode::Review),
            });
        }

        if self.mode == Mode::Editor {
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
                label: if self.backlinks_open {
                    "Hide backlinks panel".to_string()
                } else {
                    "Show backlinks panel".to_string()
                },
                hint: None,
                action: PaletteAction::ToggleBacklinks,
            });
            items.push(PaletteItem {
                id: "toggle-split-pane".to_string(),
                label: if self.secondary_pane.is_some() {
                    "Close split pane".to_string()
                } else {
                    "Open split pane".to_string()
                },
                hint: None,
                action: PaletteAction::ToggleSplitPane,
            });
            items.push(PaletteItem {
                id: "duplicate-to-split".to_string(),
                label: if self.secondary_pane.is_some() {
                    "Duplicate to split".to_string()
                } else {
                    "Open split (duplicate)".to_string()
                },
                hint: None,
                action: PaletteAction::DuplicateToSplit,
            });
            if self.secondary_pane.is_some() {
                items.push(PaletteItem {
                    id: "swap-split-panes".to_string(),
                    label: "Swap panes".to_string(),
                    hint: None,
                    action: PaletteAction::SwapSplitPanes,
                });
            }
        }

        items
    }

    fn ordered_pages_for_palette(&self) -> Vec<PageRecord> {
        let mut ordered = Vec::new();
        let mut seen = HashSet::new();
        for uid in self.recent_pages.iter() {
            if let Some(page) = self.pages.iter().find(|page| &page.uid == uid) {
                ordered.push(page.clone());
                seen.insert(page.uid.clone());
            }
        }
        for page in self.pages.iter() {
            if !seen.contains(&page.uid) {
                ordered.push(page.clone());
            }
        }
        ordered
    }

    fn page_snippets_for_query(&self, query: &str) -> HashMap<String, String> {
        let Some(db) = self.db.as_ref() else {
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
        for page in self.pages.iter() {
            let title = page.title.trim();
            let label = if title.is_empty() {
                page.uid.clone()
            } else {
                page.title.clone()
            };
            let snippet = snippets.get(&page.uid).cloned().unwrap_or_default();
            let recent_rank = self.recent_pages.iter().position(|uid| uid == &page.uid);
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

    pub(super) fn filtered_palette_items(&self) -> Vec<PaletteItem> {
        let query = self.palette_query.trim();
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

    pub(super) fn move_palette_index(&mut self, delta: isize) {
        let commands = self.filtered_palette_items();
        if commands.is_empty() {
            self.palette_index = 0;
            return;
        }
        let len = commands.len() as isize;
        let current = self.palette_index as isize;
        let next = (current + delta + len) % len;
        self.palette_index = next as usize;
    }

    pub(super) fn run_palette_command(
        &mut self,
        index: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let commands = self.filtered_palette_items();
        let Some(item) = commands.get(index).cloned() else {
            return;
        };
        self.close_command_palette(cx);
        match item.action {
            PaletteAction::OpenVaults => self.open_vaults(&OpenVaults, window, cx),
            PaletteAction::SwitchMode(mode) => self.set_mode(mode, cx),
            PaletteAction::FocusSearch => {
                if self.mode != Mode::Editor {
                    self.set_mode(Mode::Editor, cx);
                }
                window.focus(&self.sidebar_search_input.focus_handle(cx), cx);
            }
            PaletteAction::FocusEditor => {
                if self.mode != Mode::Editor {
                    self.set_mode(Mode::Editor, cx);
                }
                self.set_active_pane(EditorPane::Primary, cx);
                self.sync_block_input_from_active_for_pane(EditorPane::Primary, Some(window), cx);
                window.focus(&self.block_input.focus_handle(cx), cx);
            }
            PaletteAction::NewPage => self.open_page_dialog(PageDialogMode::Create, cx),
            PaletteAction::RenamePage => self.open_page_dialog(PageDialogMode::Rename, cx),
            PaletteAction::ToggleBacklinks => {
                self.backlinks_open = !self.backlinks_open;
                cx.notify();
            }
            PaletteAction::ToggleSplitPane => self.toggle_split_pane(cx),
            PaletteAction::DuplicateToSplit => self.copy_primary_to_secondary(cx),
            PaletteAction::SwapSplitPanes => self.swap_panes(cx),
            PaletteAction::OpenPage(uid) => {
                self.set_mode(Mode::Editor, cx);
                self.open_page(&uid, cx);
                window.focus(&self.block_input.focus_handle(cx), cx);
            }
        }
    }

    pub(super) fn open_command_palette_action(
        &mut self,
        _: &OpenCommandPalette,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.open_command_palette(window, cx);
    }

    pub(super) fn close_command_palette_action(
        &mut self,
        _: &CloseCommandPalette,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.close_command_palette(cx);
    }

    pub(super) fn palette_move_up(
        &mut self,
        _: &PaletteMoveUp,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.move_palette_index(-1);
        cx.notify();
    }

    pub(super) fn palette_move_down(
        &mut self,
        _: &PaletteMoveDown,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.move_palette_index(1);
        cx.notify();
    }

    pub(super) fn palette_run(
        &mut self,
        _: &PaletteRun,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let index = self.palette_index;
        self.run_palette_command(index, window, cx);
    }
}
