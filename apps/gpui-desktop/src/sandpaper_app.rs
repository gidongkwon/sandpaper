mod prelude {
    pub(super) use chrono::{Local, TimeZone};
    pub(super) use gpui_component::{
        ActiveTheme as _, RopeExt as _, Sizable, VirtualListScrollHandle, v_virtual_list,
    };
    pub(super) use gpui_component::button::{Button, ButtonVariants as _};
    pub(super) use gpui_component::input::{Input, InputState};
    pub(super) use gpui::{
        actions, div, point, px, rgba, size, AnyWindowHandle, App, Context, Entity, FocusHandle,
        Focusable, KeyBinding, KeyDownEvent, MouseButton, MouseDownEvent, MouseMoveEvent,
        MouseUpEvent, Render,
        ScrollStrategy, SharedString, StatefulInteractiveElement, Subscription, Window,
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
    pub(super) use std::rc::Rc;
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

const BLOCK_ROW_HEIGHT: f32 = 32.0;
const COMPACT_ROW_HEIGHT: f32 = 30.0;

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
    match_count: usize,
}

#[derive(Clone, Debug)]
struct ReviewDisplayItem {
    id: i64,
    page_uid: String,
    block_uid: String,
    page_title: String,
    text: String,
    due_at: i64,
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

#[derive(Clone, Debug)]
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
    OpenPage(String),
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
    list_state: PaneListState,
    selection: PaneSelection,
    dirty: bool,
}

#[derive(Clone)]
struct PaneListState {
    scroll_handle: VirtualListScrollHandle,
    item_sizes: Rc<Vec<gpui::Size<gpui::Pixels>>>,
}

impl PaneListState {
    fn new(count: usize, row_height: gpui::Pixels) -> Self {
        Self {
            scroll_handle: VirtualListScrollHandle::new(),
            item_sizes: Rc::new(vec![size(px(0.), row_height); count]),
        }
    }

    fn reset(&mut self, count: usize, row_height: gpui::Pixels) {
        self.item_sizes = Rc::new(vec![size(px(0.), row_height); count]);
        self.scroll_handle
            .base_handle()
            .set_offset(point(px(0.), px(0.)));
    }

    fn set_count(&mut self, count: usize, row_height: gpui::Pixels) {
        self.item_sizes = Rc::new(vec![size(px(0.), row_height); count]);
    }
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
    window_handle: AnyWindowHandle,

    boot_status: SharedString,
    db: Option<Database>,
    vaults: Vec<VaultRecord>,
    active_vault_id: Option<String>,
    vault_dialog_open: bool,
    vault_dialog_name_input: Entity<InputState>,
    vault_dialog_path_input: Entity<InputState>,
    vault_dialog_error: Option<SharedString>,

    pages: Vec<PageRecord>,
    active_page: Option<PageRecord>,
    editor: Option<EditorModel>,
    page_cursors: HashMap<String, helpers::PageCursor>,
    recent_pages: Vec<String>,
    highlighted_block_uid: Option<String>,
    highlight_epoch: u64,
    sidebar_search_query: String,
    sidebar_search_input: Entity<InputState>,
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
    page_dialog_input: Entity<InputState>,

    capture_input: Entity<InputState>,

    review_items: Vec<ReviewDisplayItem>,

    block_input: Entity<InputState>,
    palette_input: Entity<InputState>,
    palette_open: bool,
    palette_query: String,
    palette_index: usize,

    blocks_list_state: PaneListState,
    sync_scroll: bool,
    capture_confirmation: Option<SharedString>,
    capture_confirmation_epoch: u64,

    _subscriptions: Vec<Subscription>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PageDialogMode {
    Create,
    Rename,
}

#[cfg(test)]
mod tests {
    use super::helpers::{
        count_case_insensitive_occurrences, fuzzy_score, link_first_unlinked_reference,
        resolve_cursor_for_blocks, score_palette_page, PageCursor,
    };
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

    #[test]
    fn count_case_insensitive_occurrences_counts_matches() {
        let count = count_case_insensitive_occurrences("Hello hello HELLO", "hello");
        assert_eq!(count, 3);
    }

    #[test]
    fn link_unlinked_reference_preserves_cursor_before_match() {
        let text = "Note here";
        let (next, cursor) = link_first_unlinked_reference(text, "Note", 0).unwrap();
        assert_eq!(next, "[[Note]] here");
        assert_eq!(cursor, 0);
    }

    #[test]
    fn link_unlinked_reference_advances_cursor_after_match() {
        let text = "See Note later";
        let (next, cursor) = link_first_unlinked_reference(text, "Note", text.len()).unwrap();
        assert_eq!(next, "See [[Note]] later");
        assert_eq!(cursor, text.len() + 4);
    }

    #[test]
    fn score_palette_page_prioritizes_recency_when_query_empty() {
        let recent = score_palette_page("", "Title", "", Some(0)).unwrap();
        let older = score_palette_page("", "Title", "", Some(4)).unwrap();
        assert!(recent > older);
    }

    #[test]
    fn score_palette_page_filters_non_matches() {
        assert!(score_palette_page("foo", "Bar", "", Some(0)).is_none());
    }
}
