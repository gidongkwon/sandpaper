use super::*;

impl SandpaperApp {
    pub(super) fn open_command_palette(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.palette_open = true;
        self.palette_query.clear();
        self.palette_index = 0;
        self.palette_input.update(cx, |input, cx| {
            input.set_text("", cx);
            input.reset_selection(cx);
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

    pub(super) fn filtered_palette_items(&self) -> Vec<PaletteItem> {
        let query = self.palette_query.trim().to_lowercase();
        if query.is_empty() {
            return self.build_palette_items();
        }
        self.build_palette_items()
            .into_iter()
            .filter(|item| {
                let label = item.label.to_lowercase();
                let hint = item.hint.as_ref().map(|value| value.to_lowercase());
                label.contains(&query) || hint.is_some_and(|value| value.contains(&query))
            })
            .collect()
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
                self.sync_block_input_from_active_for_pane(EditorPane::Primary, cx);
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
