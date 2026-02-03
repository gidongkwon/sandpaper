mod prelude {
    pub(super) use crate::ui::text_input::{TextInput, TextInputEvent, TextInputStyle};
    pub(super) use chrono::Local;
    pub(super) use gpui::{
        actions, div, list, px, rgb, rgba, App, Context, Entity, FocusHandle, Focusable,
        KeyBinding, ListAlignment, ListState, MouseButton, MouseDownEvent, MouseMoveEvent,
        MouseUpEvent, Render, SharedString, StatefulInteractiveElement, Subscription, Window,
        prelude::*,
    };
    pub(super) use sandpaper_core::{
        app::{self, AppError},
        db::{BlockPageRecord, BlockSnapshot, Database, PageRecord},
        editor::EditorModel,
        links::{extract_block_refs, extract_wikilinks, strip_wikilinks},
        vaults::{VaultRecord, VaultStore},
    };
    pub(super) use std::collections::{HashMap, HashSet};
    pub(super) use std::mem;
    pub(super) use std::path::PathBuf;
    pub(super) use std::time::Duration;
    pub(super) use uuid::Uuid;
}

use prelude::*;

mod data;
mod editor;
mod helpers;
mod lifecycle;
mod palette;
mod render;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Mode {
    Editor,
    Capture,
    Review,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum EditorPane {
    Primary,
    Secondary,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum SaveState {
    Saved,
    Dirty,
    Saving,
    Error(String),
}

#[derive(Clone, Debug)]
struct BacklinkEntry {
    block_uid: String,
    page_uid: String,
    page_title: String,
    text: String,
}

#[derive(Clone, Debug)]
struct UnlinkedReference {
    block_uid: String,
    page_title: String,
    snippet: String,
}

#[derive(Clone, Debug)]
struct ReviewDisplayItem {
    id: i64,
    page_uid: String,
    block_uid: String,
    page_title: String,
    text: String,
}

#[derive(Clone, Debug)]
struct BreadcrumbItem {
    uid: String,
    label: String,
}

#[derive(Clone, Debug)]
struct PaneSelection {
    range: Option<(usize, usize)>,
    anchor: Option<usize>,
    dragging: bool,
    drag_completed: bool,
}

impl PaneSelection {
    fn new() -> Self {
        Self {
            range: None,
            anchor: None,
            dragging: false,
            drag_completed: false,
        }
    }

    fn clear(&mut self) {
        self.range = None;
        self.anchor = None;
        self.dragging = false;
        self.drag_completed = false;
    }

    fn set_range(&mut self, start: usize, end: usize) {
        if start == end {
            self.range = None;
        } else {
            let (lo, hi) = if start <= end { (start, end) } else { (end, start) };
            self.range = Some((lo, hi));
        }
    }

    fn contains(&self, ix: usize) -> bool {
        self.range
            .is_some_and(|(start, end)| ix >= start && ix <= end)
    }

    fn selected_range(&self) -> Option<std::ops::Range<usize>> {
        self.range.map(|(start, end)| start..end + 1)
    }

    fn has_range(&self) -> bool {
        self.range.is_some()
    }
}

#[derive(Clone, Copy, Debug)]
enum PaletteAction {
    OpenVaults,
    SwitchMode(Mode),
    FocusSearch,
    FocusEditor,
    NewPage,
    RenamePage,
    ToggleBacklinks,
    ToggleSplitPane,
    DuplicateToSplit,
    SwapSplitPanes,
}

#[derive(Clone, Debug)]
struct PaletteItem {
    id: String,
    label: String,
    hint: Option<String>,
    action: PaletteAction,
}

struct SecondaryPane {
    page: PageRecord,
    editor: EditorModel,
    list_state: ListState,
    selection: PaneSelection,
    dirty: bool,
}

#[derive(Clone, Debug)]
struct SlashMenuState {
    open: bool,
    pane: EditorPane,
    block_uid: Option<String>,
    block_ix: Option<usize>,
    slash_index: Option<usize>,
}

impl SlashMenuState {
    fn closed() -> Self {
        Self {
            open: false,
            pane: EditorPane::Primary,
            block_uid: None,
            block_ix: None,
            slash_index: None,
        }
    }
}

actions!(
    sandpaper_editor,
    [
        NewPage,
        RenamePage,
        OpenVaults,
        ToggleModeEditor,
        ToggleModeCapture,
        ToggleModeReview,
        InsertBlockBelow,
        IndentBlock,
        OutdentBlock,
        MoveBlockUp,
        MoveBlockDown,
        DuplicateBlock,
        DeleteSelection,
        ClearSelection,
        ToggleSplitPane,
        OpenCommandPalette,
        CloseCommandPalette,
        PaletteMoveUp,
        PaletteMoveDown,
        PaletteRun,
    ]
);

pub fn bind_keys(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("cmd-shift-v", OpenVaults, None),
        KeyBinding::new("cmd-n", NewPage, None),
        KeyBinding::new("cmd-r", RenamePage, None),
        KeyBinding::new("cmd-1", ToggleModeCapture, None),
        KeyBinding::new("cmd-2", ToggleModeEditor, None),
        KeyBinding::new("cmd-3", ToggleModeReview, None),
        KeyBinding::new("enter", InsertBlockBelow, Some("SandpaperEditor")),
        KeyBinding::new("tab", IndentBlock, Some("SandpaperEditor")),
        KeyBinding::new("shift-tab", OutdentBlock, Some("SandpaperEditor")),
        KeyBinding::new("alt-up", MoveBlockUp, Some("SandpaperEditor")),
        KeyBinding::new("alt-down", MoveBlockDown, Some("SandpaperEditor")),
        KeyBinding::new("alt-cmd-up", MoveBlockUp, Some("SandpaperEditor")),
        KeyBinding::new("alt-cmd-down", MoveBlockDown, Some("SandpaperEditor")),
        KeyBinding::new("cmd-d", DuplicateBlock, Some("SandpaperEditor")),
        KeyBinding::new("ctrl-d", DuplicateBlock, Some("SandpaperEditor")),
        KeyBinding::new("delete", DeleteSelection, Some("SandpaperEditor")),
        KeyBinding::new("backspace", DeleteSelection, Some("SandpaperEditor")),
        KeyBinding::new("escape", ClearSelection, Some("SandpaperEditor")),
        KeyBinding::new("cmd-\\", ToggleSplitPane, Some("SandpaperEditor")),
        KeyBinding::new("cmd-k", OpenCommandPalette, None),
        KeyBinding::new("ctrl-k", OpenCommandPalette, None),
        KeyBinding::new("escape", CloseCommandPalette, Some("CommandPalette")),
        KeyBinding::new("enter", PaletteRun, Some("CommandPalette")),
        KeyBinding::new("up", PaletteMoveUp, Some("CommandPalette")),
        KeyBinding::new("down", PaletteMoveDown, Some("CommandPalette")),
    ]);
}

pub struct SandpaperApp {
    focus_handle: FocusHandle,

    boot_status: SharedString,
    db: Option<Database>,
    vaults: Vec<VaultRecord>,
    active_vault_id: Option<String>,
    vault_dialog_open: bool,
    vault_dialog_name_input: Entity<TextInput>,
    vault_dialog_path_input: Entity<TextInput>,
    vault_dialog_error: Option<SharedString>,

    pages: Vec<PageRecord>,
    active_page: Option<PageRecord>,
    editor: Option<EditorModel>,
    caret_offsets: HashMap<String, usize>,
    highlighted_block_uid: Option<String>,
    highlight_epoch: u64,
    sidebar_search_query: String,
    sidebar_search_input: Entity<TextInput>,
    search_pages: Vec<PageRecord>,
    search_blocks: Vec<BlockPageRecord>,
    backlinks: Vec<BacklinkEntry>,
    block_backlinks: Vec<BacklinkEntry>,
    unlinked_references: Vec<UnlinkedReference>,
    references_epoch: u64,
    backlinks_open: bool,
    secondary_pane: Option<SecondaryPane>,
    slash_menu: SlashMenuState,
    primary_selection: PaneSelection,
    active_pane: EditorPane,

    mode: Mode,
    save_state: SaveState,
    autosave_epoch: u64,
    primary_dirty: bool,

    page_dialog_open: bool,
    page_dialog_mode: PageDialogMode,
    page_dialog_input: Entity<TextInput>,

    capture_input: Entity<TextInput>,

    review_items: Vec<ReviewDisplayItem>,

    block_input: Entity<TextInput>,
    palette_input: Entity<TextInput>,
    palette_open: bool,
    palette_query: String,
    palette_index: usize,

    blocks_list_state: ListState,

    _subscriptions: Vec<Subscription>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PageDialogMode {
    Create,
    Rename,
}

#[cfg(test)]
mod tests {
    use super::helpers::{fuzzy_score, resolve_cursor_for_blocks, PageCursor};
    use super::PaneSelection;
    use sandpaper_core::db::BlockSnapshot;

    #[test]
    fn selection_set_range_normalizes() {
        let mut selection = PaneSelection::new();
        selection.set_range(5, 2);
        assert_eq!(selection.selected_range(), Some(2..6));
    }

    #[test]
    fn selection_clears_when_single_index() {
        let mut selection = PaneSelection::new();
        selection.set_range(3, 3);
        assert!(selection.selected_range().is_none());
    }

    #[test]
    fn selection_contains_checks_range() {
        let mut selection = PaneSelection::new();
        selection.set_range(1, 4);
        assert!(selection.contains(2));
        assert!(!selection.contains(0));
    }

    #[test]
    fn fuzzy_score_requires_ordered_match() {
        assert!(fuzzy_score("abc", "alphabet soup").is_none());
        assert!(fuzzy_score("alp", "alphabet soup").is_some());
    }

    #[test]
    fn fuzzy_score_prefers_contiguous_matches() {
        let tight = fuzzy_score("note", "notebook").unwrap_or(0);
        let loose = fuzzy_score("note", "n o t e book").unwrap_or(0);
        assert!(tight > loose);
    }

    #[test]
    fn resolve_cursor_uses_saved_block_when_present() {
        let blocks = vec![
            BlockSnapshot {
                uid: "a".into(),
                text: "First".into(),
                indent: 0,
            },
            BlockSnapshot {
                uid: "b".into(),
                text: "Second".into(),
                indent: 0,
            },
        ];
        let cursor = PageCursor {
            block_uid: "b".into(),
            cursor_offset: 3,
        };
        let (ix, offset) = resolve_cursor_for_blocks(&blocks, Some(&cursor));
        assert_eq!(ix, 1);
        assert_eq!(offset, 3);
    }

    #[test]
    fn resolve_cursor_falls_back_when_missing() {
        let blocks = vec![BlockSnapshot {
            uid: "a".into(),
            text: "First".into(),
            indent: 0,
        }];
        let cursor = PageCursor {
            block_uid: "missing".into(),
            cursor_offset: 10,
        };
        let (ix, offset) = resolve_cursor_for_blocks(&blocks, Some(&cursor));
        assert_eq!(ix, 0);
        assert_eq!(offset, 5);
    }
}
