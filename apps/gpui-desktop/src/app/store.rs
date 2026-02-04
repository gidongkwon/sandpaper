use crate::app::prelude::*;

pub(crate) mod constants;
mod data;
mod editor;
pub(crate) mod helpers;
mod lifecycle;
mod palette;
pub(crate) mod plugins;
mod state;

pub(crate) use state::{AppState, EditorState, PluginsState, SettingsState, UiState};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Mode {
    Editor,
    Capture,
    Review,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum EditorPane {
    Primary,
    Secondary,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum SaveState {
    Saved,
    Dirty,
    Saving,
    Error(String),
}

pub(crate) const BLOCK_ROW_HEIGHT: f32 = 32.0;
pub(crate) const COMPACT_ROW_HEIGHT: f32 = 30.0;
pub(crate) const BLOCK_INPUT_PADDING_X: f32 = 8.0;
pub(crate) const LINK_PREVIEW_CLOSE_DELAY_MS: u64 = 200;

pub(crate) const SLASH_COMMANDS: &[(&str, &str)] = &[
    ("link", "Link to page"),
    ("date", "Insert date"),
    ("task", "Convert to task"),
    ("h1", "Heading 1"),
    ("h2", "Heading 2"),
    ("h3", "Heading 3"),
    ("quote", "Quote"),
    ("code", "Inline code"),
    ("bold", "Bold"),
    ("italic", "Italic"),
    ("divider", "Divider"),
];

#[derive(Clone, Debug)]
pub(crate) struct BacklinkEntry {
    pub(crate) block_uid: String,
    pub(crate) page_uid: String,
    pub(crate) page_title: String,
    pub(crate) text: String,
}

#[derive(Clone, Debug)]
pub(crate) struct UnlinkedReference {
    pub(crate) block_uid: String,
    pub(crate) page_title: String,
    pub(crate) snippet: String,
    pub(crate) match_count: usize,
}

#[derive(Clone, Debug)]
pub(crate) struct ReviewDisplayItem {
    pub(crate) id: i64,
    pub(crate) page_uid: String,
    pub(crate) block_uid: String,
    pub(crate) page_title: String,
    pub(crate) text: String,
    pub(crate) due_at: i64,
}

#[derive(Clone, Debug)]
pub(crate) struct BreadcrumbItem {
    pub(crate) uid: String,
    pub(crate) label: String,
}

#[derive(Clone, Debug)]
pub(crate) struct PaneSelection {
    pub(crate) range: Option<(usize, usize)>,
    pub(crate) anchor: Option<usize>,
    pub(crate) dragging: bool,
    pub(crate) drag_completed: bool,
}

impl PaneSelection {
    pub(crate) fn new() -> Self {
        Self {
            range: None,
            anchor: None,
            dragging: false,
            drag_completed: false,
        }
    }

    pub(crate) fn clear(&mut self) {
        self.range = None;
        self.anchor = None;
        self.dragging = false;
        self.drag_completed = false;
    }

    pub(crate) fn set_range(&mut self, start: usize, end: usize) {
        if start == end {
            self.range = None;
        } else {
            let (lo, hi) = if start <= end {
                (start, end)
            } else {
                (end, start)
            };
            self.range = Some((lo, hi));
        }
    }

    pub(crate) fn contains(&self, ix: usize) -> bool {
        self.range
            .is_some_and(|(start, end)| ix >= start && ix <= end)
    }

    pub(crate) fn selected_range(&self) -> Option<std::ops::Range<usize>> {
        self.range.map(|(start, end)| start..end + 1)
    }

    pub(crate) fn has_range(&self) -> bool {
        self.range.is_some()
    }
}

#[derive(Clone, Debug)]
pub(crate) enum PaletteAction {
    OpenVaults,
    OpenSettings,
    SwitchMode(Mode),
    FocusSearch,
    FocusEditor,
    NewPage,
    RenamePage,
    ToggleBacklinks,
    ToggleSplitPane,
    DuplicateToSplit,
    SwapSplitPanes,
    ReloadPlugins,
    OpenPluginSettings,
    RunPluginCommand(PluginCommand),
    OpenPluginPanel(PluginPanel),
    ClosePluginPanel,
    OpenPage(String),
}

#[derive(Clone, Debug)]
pub(crate) struct PaletteItem {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) hint: Option<String>,
    pub(crate) action: PaletteAction,
}

pub(crate) struct SecondaryPane {
    pub(crate) page: PageRecord,
    pub(crate) editor: EditorModel,
    pub(crate) list_state: PaneListState,
    pub(crate) selection: PaneSelection,
    pub(crate) dirty: bool,
}

#[derive(Clone)]
pub(crate) struct PaneListState {
    pub(crate) scroll_handle: VirtualListScrollHandle,
    pub(crate) item_sizes: Rc<Vec<gpui::Size<gpui::Pixels>>>,
}

impl PaneListState {
    pub(crate) fn new(count: usize, row_height: gpui::Pixels) -> Self {
        Self {
            scroll_handle: VirtualListScrollHandle::new(),
            item_sizes: Rc::new(vec![size(px(0.), row_height); count]),
        }
    }

    pub(crate) fn reset(&mut self, count: usize, row_height: gpui::Pixels) {
        self.item_sizes = Rc::new(vec![size(px(0.), row_height); count]);
        self.scroll_handle
            .base_handle()
            .set_offset(point(px(0.), px(0.)));
    }

    pub(crate) fn set_count(&mut self, count: usize, row_height: gpui::Pixels) {
        self.item_sizes = Rc::new(vec![size(px(0.), row_height); count]);
    }
}

#[derive(Clone, Debug)]
pub(crate) struct SlashMenuState {
    pub(crate) open: bool,
    pub(crate) pane: EditorPane,
    pub(crate) block_uid: Option<String>,
    pub(crate) block_ix: Option<usize>,
    pub(crate) slash_index: Option<usize>,
    pub(crate) query: String,
    pub(crate) selected_index: usize,
}

impl SlashMenuState {
    pub(crate) fn closed() -> Self {
        Self {
            open: false,
            pane: EditorPane::Primary,
            block_uid: None,
            block_ix: None,
            slash_index: None,
            query: String::new(),
            selected_index: 0,
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct WikilinkMenuState {
    pub(crate) open: bool,
    pub(crate) pane: EditorPane,
    pub(crate) block_uid: Option<String>,
    pub(crate) block_ix: Option<usize>,
    pub(crate) range_start: Option<usize>,
    pub(crate) range_end: Option<usize>,
    pub(crate) has_closing: bool,
    pub(crate) query: String,
    pub(crate) selected_index: usize,
}

impl WikilinkMenuState {
    pub(crate) fn closed() -> Self {
        Self {
            open: false,
            pane: EditorPane::Primary,
            block_uid: None,
            block_ix: None,
            range_start: None,
            range_end: None,
            has_closing: false,
            query: String::new(),
            selected_index: 0,
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct LinkPreviewState {
    pub(crate) open: bool,
    pub(crate) page_uid: String,
    pub(crate) title: String,
    pub(crate) blocks: Vec<String>,
    pub(crate) position: Point<Pixels>,
    pub(crate) loading: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct LinkPreviewCacheEntry {
    pub(crate) title: String,
    pub(crate) blocks: Vec<String>,
}

#[derive(Clone, Debug)]
pub(crate) enum WikilinkMenuItem {
    Page(PageRecord),
    Create { label: String, query: String },
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub(crate) struct PluginPermissionInfo {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) version: String,
    pub(crate) description: Option<String>,
    pub(crate) permissions: Vec<String>,
    pub(crate) settings_schema: Option<PluginSettingsSchema>,
    pub(crate) enabled: bool,
    pub(crate) path: String,
    pub(crate) granted_permissions: Vec<String>,
    pub(crate) missing_permissions: Vec<String>,
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub(crate) struct PluginBlockInfo {
    pub(crate) id: String,
    pub(crate) reason: String,
    pub(crate) missing_permissions: Vec<String>,
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub(crate) struct PluginRuntimeStatus {
    pub(crate) loaded: Vec<String>,
    pub(crate) blocked: Vec<PluginBlockInfo>,
    pub(crate) commands: Vec<PluginCommand>,
    pub(crate) panels: Vec<PluginPanel>,
    pub(crate) toolbar_actions: Vec<PluginToolbarAction>,
    pub(crate) renderers: Vec<PluginRenderer>,
}

#[derive(Clone, Debug)]
pub(crate) enum PluginPermissionAction {
    RunCommand(PluginCommand),
    OpenPanel(PluginPanel),
}

#[derive(Clone, Debug)]
pub(crate) struct PluginPermissionPrompt {
    pub(crate) plugin_id: String,
    pub(crate) plugin_name: String,
    pub(crate) permission: String,
    pub(crate) action: Option<PluginPermissionAction>,
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

pub struct AppStore {
    focus_handle: FocusHandle,
    window_handle: AnyWindowHandle,

    pub(crate) app: AppState,
    pub(crate) editor: EditorState,
    pub(crate) plugins: PluginsState,
    pub(crate) settings: SettingsState,
    pub(crate) ui: UiState,

    _subscriptions: Vec<Subscription>,
}

impl AppStore {
    pub(crate) fn focus_handle(&self) -> &FocusHandle {
        &self.focus_handle
    }
}

impl Focusable for AppStore {
    fn focus_handle(&self, _cx: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl Render for AppStore {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.render_root(window, cx)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SettingsTab {
    General,
    Plugins,
}

impl SettingsTab {
    fn as_str(&self) -> &'static str {
        match self {
            SettingsTab::General => "general",
            SettingsTab::Plugins => "plugins",
        }
    }

    fn from_str(value: &str) -> Option<Self> {
        match value {
            "general" => Some(SettingsTab::General),
            "plugins" => Some(SettingsTab::Plugins),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PageDialogMode {
    Create,
    Rename,
}

#[cfg(test)]
mod tests {
    use super::helpers::{
        apply_slash_command_text, count_case_insensitive_occurrences, cycle_index,
        filter_slash_commands, find_slash_query, find_wikilink_query, fuzzy_score,
        link_first_unlinked_reference, parse_wikilink_tokens, resolve_cursor_for_blocks,
        score_palette_page, PageCursor, WikilinkToken,
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

    #[test]
    fn slash_query_finds_command_after_whitespace() {
        let text = "Note /da";
        let query = find_slash_query(text, text.len()).unwrap();
        assert_eq!(query.slash_index, 5);
        assert_eq!(query.query, "da");
    }

    #[test]
    fn slash_query_allows_empty_query() {
        let text = "/";
        let query = find_slash_query(text, 1).unwrap();
        assert_eq!(query.slash_index, 0);
        assert_eq!(query.query, "");
    }

    #[test]
    fn slash_query_rejects_mid_word_slash() {
        let text = "path/da";
        assert!(find_slash_query(text, text.len()).is_none());
    }

    #[test]
    fn slash_query_rejects_whitespace_in_query() {
        let text = "Note /da te";
        assert!(find_slash_query(text, text.len()).is_none());
    }

    #[test]
    fn filter_slash_commands_keeps_order_when_empty_query() {
        let commands = [
            ("link", "Link to page"),
            ("date", "Insert date"),
            ("task", "Convert to task"),
        ];
        let filtered = filter_slash_commands("", &commands);
        assert_eq!(filtered, commands);
    }

    #[test]
    fn filter_slash_commands_matches_labels() {
        let commands = [
            ("link", "Link to page"),
            ("h1", "Heading 1"),
            ("date", "Insert date"),
        ];
        let filtered = filter_slash_commands("heading", &commands);
        assert_eq!(filtered.first().map(|entry| entry.0), Some("h1"));
    }

    #[test]
    fn filter_slash_commands_skips_unmatched() {
        let commands = [("link", "Link to page"), ("date", "Insert date")];
        let filtered = filter_slash_commands("xyz", &commands);
        assert!(filtered.is_empty());
    }

    #[test]
    fn apply_slash_command_heading_sets_prefix() {
        let (next, cursor) = apply_slash_command_text("h2", "Note ", "", "2024-01-01");
        assert_eq!(next, "## Note");
        assert_eq!(cursor, next.len());
    }

    #[test]
    fn apply_slash_command_quote_sets_prefix() {
        let (next, cursor) = apply_slash_command_text("quote", "Note ", "", "2024-01-01");
        assert_eq!(next, "> Note");
        assert_eq!(cursor, next.len());
    }

    #[test]
    fn apply_slash_command_bold_wraps_text() {
        let (next, cursor) = apply_slash_command_text("bold", "Note ", "", "2024-01-01");
        assert_eq!(next, "**Note**");
        assert_eq!(cursor, next.len());
    }

    #[test]
    fn apply_slash_command_divider_ignores_content() {
        let (next, cursor) = apply_slash_command_text("divider", "Note ", "", "2024-01-01");
        assert_eq!(next, "---");
        assert_eq!(cursor, next.len());
    }

    #[test]
    fn cycle_index_wraps_forward() {
        assert_eq!(cycle_index(0, 3, true), 1);
        assert_eq!(cycle_index(2, 3, true), 0);
    }

    #[test]
    fn cycle_index_wraps_backward() {
        assert_eq!(cycle_index(0, 3, false), 2);
        assert_eq!(cycle_index(1, 3, false), 0);
    }

    #[test]
    fn wikilink_query_opens_for_unclosed_link() {
        let text = "See [[Project";
        let query = find_wikilink_query(text, text.len()).unwrap();
        assert_eq!(query.query, "Project");
        assert!(!query.has_closing);
    }

    #[test]
    fn wikilink_query_closes_after_end() {
        let text = "See [[Page]] later";
        assert!(find_wikilink_query(text, text.len()).is_none());
    }

    #[test]
    fn parse_wikilink_tokens_extracts_links() {
        let tokens = parse_wikilink_tokens("Go to [[Page|Alias]] and [[Other#Head]].");
        assert_eq!(
            tokens,
            vec![
                WikilinkToken::Text("Go to ".into()),
                WikilinkToken::Link {
                    target: "Page".into(),
                    label: "Alias".into()
                },
                WikilinkToken::Text(" and ".into()),
                WikilinkToken::Link {
                    target: "Other".into(),
                    label: "Other".into()
                },
                WikilinkToken::Text(".".into()),
            ]
        );
    }
}
