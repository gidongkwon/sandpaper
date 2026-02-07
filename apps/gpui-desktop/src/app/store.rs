use crate::app::prelude::*;

mod agent_debug;
pub(crate) mod connections;
pub(crate) mod constants;
mod data;
mod diagram;
mod editor;
pub(crate) mod helpers;
mod lifecycle;
pub(crate) mod markdown;
mod notifications;
mod offline_archive;
pub(crate) mod outline;
mod palette;
mod plugin_blocks;
pub(crate) mod plugins;
mod shadow_writer;
mod state;

pub(crate) use notifications::{NotificationItem, NotificationKind};
pub(crate) use state::{
    AppState, EditorState, PluginsState, SettingsState, SidebarResizeState, UiState,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Mode {
    Capture,
    Editor,
    Review,
}

impl Mode {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            Mode::Capture => "capture",
            Mode::Editor => "editor",
            Mode::Review => "review",
        }
    }

    pub(crate) fn from_str(value: &str) -> Option<Self> {
        match value {
            "capture" => Some(Mode::Capture),
            "editor" => Some(Mode::Editor),
            "review" => Some(Mode::Review),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum WorkspacePanel {
    Review,
    Backlinks,
    Plugins,
    Connections,
}

impl WorkspacePanel {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            WorkspacePanel::Review => "review",
            WorkspacePanel::Backlinks => "backlinks",
            WorkspacePanel::Plugins => "plugins",
            WorkspacePanel::Connections => "connections",
        }
    }

    pub(crate) fn from_str(value: &str) -> Option<Self> {
        match value {
            "review" => Some(WorkspacePanel::Review),
            "backlinks" => Some(WorkspacePanel::Backlinks),
            "plugins" => Some(WorkspacePanel::Plugins),
            "connections" => Some(WorkspacePanel::Connections),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ThemePreference {
    System,
    Light,
    Dark,
}

impl ThemePreference {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            ThemePreference::System => "system",
            ThemePreference::Light => "light",
            ThemePreference::Dark => "dark",
        }
    }

    pub(crate) fn from_str(value: &str) -> Option<Self> {
        match value {
            "system" => Some(ThemePreference::System),
            "light" => Some(ThemePreference::Light),
            "dark" => Some(ThemePreference::Dark),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum LayoutDensity {
    Comfortable,
    Compact,
}

impl LayoutDensity {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            LayoutDensity::Comfortable => "comfortable",
            LayoutDensity::Compact => "compact",
        }
    }

    pub(crate) fn from_str(value: &str) -> Option<Self> {
        match value {
            "comfortable" => Some(LayoutDensity::Comfortable),
            "compact" => Some(LayoutDensity::Compact),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum QuickAddTarget {
    Inbox,
    CurrentPage,
    TaskInbox,
    DailyNote,
}

impl QuickAddTarget {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            QuickAddTarget::Inbox => "inbox",
            QuickAddTarget::CurrentPage => "current-page",
            QuickAddTarget::TaskInbox => "task-inbox",
            QuickAddTarget::DailyNote => "daily-note",
        }
    }

    pub(crate) fn from_str(value: &str) -> Option<Self> {
        match value {
            "inbox" => Some(QuickAddTarget::Inbox),
            "current-page" => Some(QuickAddTarget::CurrentPage),
            "task-inbox" => Some(QuickAddTarget::TaskInbox),
            "daily-note" => Some(QuickAddTarget::DailyNote),
            _ => None,
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct CaptureQueueItem {
    pub(crate) uid: String,
    pub(crate) text: String,
}

#[derive(Clone, Debug)]
pub(crate) enum FeedItem {
    ReviewDue(ReviewDisplayItem),
    RelatedPage(connections::RelatedPage),
    RecentEdit {
        page: PageRecord,
        #[allow(dead_code)] // Used in feed sorting logic planned for future
        edited_at: i64,
    },
    RandomDiscovery(PageRecord),
    SectionHeader(SharedString),
}

#[derive(Clone, Debug)]
pub(crate) struct DragSource {
    pub(crate) pane: EditorPane,
    pub(crate) block_ix: usize,
    pub(crate) block_uid: String,
}

#[derive(Clone, Debug)]
pub(crate) struct DragTarget {
    pub(crate) pane: EditorPane,
    pub(crate) insert_before_ix: usize,
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

pub(crate) const BLOCK_ROW_CORE_HEIGHT: f32 = 24.0;
pub(crate) const BLOCK_ROW_VERTICAL_PADDING: f32 = 8.0;
pub(crate) const BLOCK_ROW_RENDER_BUFFER: f32 = 2.0;
pub(crate) const BLOCK_ROW_HEIGHT: f32 =
    BLOCK_ROW_CORE_HEIGHT + BLOCK_ROW_VERTICAL_PADDING + BLOCK_ROW_RENDER_BUFFER;
pub(crate) const COMPACT_ROW_HEIGHT: f32 = 30.0;
pub(crate) const BLOCK_INPUT_PADDING_X: f32 = 8.0;
pub(crate) const BLOCK_SELECTION_DRAG_THRESHOLD_PX: f32 = 5.0;
pub(crate) const LINK_PREVIEW_CLOSE_DELAY_MS: u64 = 200;
pub(crate) const POPUP_STACK_PRIORITY_BASE: usize = 100;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SlashAction {
    TextTransform,
    SetBlockType(BlockType),
    InsertImage,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct SlashCommandDef {
    pub(crate) id: &'static str,
    pub(crate) label: &'static str,
    pub(crate) action: SlashAction,
}

pub(crate) const SLASH_COMMANDS: &[SlashCommandDef] = &[
    SlashCommandDef {
        id: "link",
        label: "Link to page",
        action: SlashAction::TextTransform,
    },
    SlashCommandDef {
        id: "date",
        label: "Insert date",
        action: SlashAction::TextTransform,
    },
    SlashCommandDef {
        id: "todo",
        label: "To-do",
        action: SlashAction::SetBlockType(BlockType::Todo),
    },
    SlashCommandDef {
        id: "h1",
        label: "Heading 1",
        action: SlashAction::SetBlockType(BlockType::Heading1),
    },
    SlashCommandDef {
        id: "h2",
        label: "Heading 2",
        action: SlashAction::SetBlockType(BlockType::Heading2),
    },
    SlashCommandDef {
        id: "h3",
        label: "Heading 3",
        action: SlashAction::SetBlockType(BlockType::Heading3),
    },
    SlashCommandDef {
        id: "quote",
        label: "Quote",
        action: SlashAction::SetBlockType(BlockType::Quote),
    },
    SlashCommandDef {
        id: "callout",
        label: "Callout",
        action: SlashAction::SetBlockType(BlockType::Callout),
    },
    SlashCommandDef {
        id: "toggle",
        label: "Toggle list",
        action: SlashAction::SetBlockType(BlockType::Toggle),
    },
    SlashCommandDef {
        id: "code",
        label: "Code block",
        action: SlashAction::SetBlockType(BlockType::Code),
    },
    SlashCommandDef {
        id: "divider",
        label: "Divider",
        action: SlashAction::SetBlockType(BlockType::Divider),
    },
    SlashCommandDef {
        id: "database",
        label: "Database view",
        action: SlashAction::SetBlockType(BlockType::DatabaseView),
    },
    SlashCommandDef {
        id: "image",
        label: "Image",
        action: SlashAction::InsertImage,
    },
    SlashCommandDef {
        id: "bold",
        label: "Bold",
        action: SlashAction::TextTransform,
    },
    SlashCommandDef {
        id: "italic",
        label: "Italic",
        action: SlashAction::TextTransform,
    },
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

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PaneSelection {
    pub(crate) range: Option<(usize, usize)>,
    pub(crate) anchor: Option<usize>,
    pub(crate) dragging: bool,
    pub(crate) drag_completed: bool,
    pub(crate) pointer_origin: Option<(i32, i32)>,
}

impl PaneSelection {
    pub(crate) fn new() -> Self {
        Self {
            range: None,
            anchor: None,
            dragging: false,
            drag_completed: false,
            pointer_origin: None,
        }
    }

    pub(crate) fn clear(&mut self) {
        self.range = None;
        self.anchor = None;
        self.dragging = false;
        self.drag_completed = false;
        self.pointer_origin = None;
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

    #[cfg(test)]
    pub(crate) fn selected_range(&self) -> Option<std::ops::Range<usize>> {
        self.range.map(|(start, end)| start..end + 1)
    }

    pub(crate) fn has_range(&self) -> bool {
        self.range.is_some()
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct PaneHistorySnapshot {
    pub(crate) page: PageRecord,
    pub(crate) editor: EditorModel,
    pub(crate) selection: PaneSelection,
    pub(crate) dirty: bool,
    pub(crate) cursor: usize,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct StructuralHistoryEntry {
    pub(crate) pane: EditorPane,
    pub(crate) before: PaneHistorySnapshot,
    pub(crate) after: PaneHistorySnapshot,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct TextHistoryEntry {
    pub(crate) pane: EditorPane,
    pub(crate) page_uid: String,
    pub(crate) block_uid: String,
    pub(crate) before_text: String,
    pub(crate) after_text: String,
    pub(crate) before_cursor: usize,
    pub(crate) after_cursor: usize,
    pub(crate) edited_at_ms: i64,
}

pub(crate) struct TextHistoryChange {
    pub(crate) page_uid: String,
    pub(crate) block_uid: String,
    pub(crate) before_text: String,
    pub(crate) after_text: String,
    pub(crate) before_cursor: usize,
    pub(crate) after_cursor: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct BlockInputBinding {
    pub(crate) pane: EditorPane,
    pub(crate) page_uid: String,
    pub(crate) block_uid: String,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum HistoryEntry {
    Structural(StructuralHistoryEntry),
    Text(TextHistoryEntry),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct BlockClipboardItem {
    pub(crate) text: String,
    pub(crate) indent: i64,
    pub(crate) block_type: BlockType,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct BlockClipboard {
    pub(crate) items: Vec<BlockClipboardItem>,
}

#[derive(Clone, Debug)]
pub(crate) enum PaletteAction {
    OpenVaults,
    OpenSettings,
    FocusSearch,
    FocusEditor,
    FocusQuickAdd,
    CreateTestPage,
    NewPage,
    RenamePage,
    ToggleSidebar,
    ToggleContextPanel,
    OpenContextPanel(WorkspacePanel),
    CycleContextPanel,
    ToggleBacklinks,
    ToggleSplitPane,
    DuplicateToSplit,
    SwapSplitPanes,
    ReloadPlugins,
    OpenPluginSettings,
    RunPluginToolbarAction(PluginToolbarAction),
    RunPluginCommand(PluginCommand),
    OpenPluginPanel(PluginPanel),
    ClosePluginPanel,
    OpenPage(String),
    ToggleFocusMode,
    OpenQuickCapture,
    SwitchMode(Mode),
    UndoEdit,
    RedoEdit,
    OpenKeyboardShortcuts,
}

#[derive(Clone, Debug)]
pub(crate) struct PaletteItem {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) hint: Option<String>,
    pub(crate) action: PaletteAction,
}

#[derive(Clone, Debug)]
pub(crate) enum PaletteRow {
    Header { id: String, label: String },
    Item(PaletteItem),
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
    pub(crate) visible_to_actual: Rc<Vec<usize>>,
    pub(crate) actual_to_visible: Rc<Vec<Option<usize>>>,
    pub(crate) has_children_by_actual: Rc<Vec<bool>>,
    pub(crate) parent_by_actual: Rc<Vec<Option<usize>>>,
}

impl PaneListState {
    pub(crate) fn new(count: usize, row_height: gpui::Pixels) -> Self {
        let visible_to_actual: Vec<usize> = (0..count).collect();
        let actual_to_visible: Vec<Option<usize>> = (0..count).map(Some).collect();
        Self {
            scroll_handle: VirtualListScrollHandle::new(),
            item_sizes: Rc::new(vec![size(px(0.), row_height); count]),
            visible_to_actual: Rc::new(visible_to_actual),
            actual_to_visible: Rc::new(actual_to_visible),
            has_children_by_actual: Rc::new(vec![false; count]),
            parent_by_actual: Rc::new(vec![None; count]),
        }
    }

    pub(crate) fn reset(&mut self, count: usize, row_height: gpui::Pixels) {
        self.item_sizes = Rc::new(vec![size(px(0.), row_height); count]);
        self.visible_to_actual = Rc::new((0..count).collect());
        self.actual_to_visible = Rc::new((0..count).map(Some).collect());
        self.has_children_by_actual = Rc::new(vec![false; count]);
        self.parent_by_actual = Rc::new(vec![None; count]);
        self.scroll_handle
            .base_handle()
            .set_offset(point(px(0.), px(0.)));
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
    pub(crate) layer_priority: usize,
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
            layer_priority: 0,
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
    pub(crate) layer_priority: usize,
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
            layer_priority: 0,
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct OutlineMenuState {
    pub(crate) open: bool,
    pub(crate) pane: EditorPane,
    #[allow(dead_code)] // Reserved for z-index layering
    pub(crate) layer_priority: usize,
}

impl OutlineMenuState {
    pub(crate) fn closed() -> Self {
        Self {
            open: false,
            pane: EditorPane::Primary,
            layer_priority: 0,
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
    #[allow(dead_code)] // Reserved for z-index layering
    pub(crate) layer_priority: usize,
}

#[derive(Clone, Debug)]
pub(crate) struct LinkPreviewCacheEntry {
    pub(crate) title: String,
    pub(crate) blocks: Vec<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct DiagramPreviewState {
    pub(crate) key: String,
    pub(crate) loading: bool,
    pub(crate) error: Option<SharedString>,
    pub(crate) image: Option<std::sync::Arc<gpui::Image>>,
    pub(crate) epoch: u64,
}

#[derive(Clone, Debug)]
pub(crate) struct PluginBlockCacheEntry {
    pub(crate) view: PluginBlockView,
    pub(crate) fetched_at_ms: i64,
    pub(crate) ttl_ms: i64,
    pub(crate) id: u64,
}

#[derive(Clone, Debug)]
pub(crate) struct PluginBlockPreviewState {
    pub(crate) key: String,
    pub(crate) loading: bool,
    pub(crate) error: Option<SharedString>,
    pub(crate) view: Option<PluginBlockView>,
    pub(crate) epoch: u64,
    pub(crate) skip_next_key: Option<String>,
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
    RunToolbarAction(PluginToolbarAction),
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
        ToggleSidebar,
        ToggleContextPanel,
        OpenReviewPanel,
        CycleContextPanel,
        FocusQuickAdd,
        InsertBlockBelow,
        IndentBlock,
        OutdentBlock,
        MoveBlockUp,
        MoveBlockDown,
        DuplicateBlock,
        SelectAllBlocks,
        DeleteSelection,
        ClearSelection,
        ToggleSplitPane,
        OpenCommandPalette,
        CloseCommandPalette,
        PaletteMoveUp,
        PaletteMoveDown,
        PaletteRun,
        ToggleFocusMode,
        OpenQuickCapture,
        SwitchToCapture,
        SwitchToEdit,
        SwitchToReview,
        UndoEdit,
        RedoEdit,
        OpenKeyboardShortcuts,
    ]
);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Platform {
    Mac,
    Other,
}

impl Platform {
    pub(crate) fn current() -> Self {
        if cfg!(target_os = "macos") {
            Self::Mac
        } else {
            Self::Other
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ShortcutSpec {
    pub(crate) mac: &'static str,
    pub(crate) other: &'static str,
}

impl ShortcutSpec {
    pub(crate) const fn new(mac: &'static str, other: &'static str) -> Self {
        Self { mac, other }
    }

    pub(crate) fn for_platform(&self, platform: Platform) -> &'static str {
        match platform {
            Platform::Mac => self.mac,
            Platform::Other => self.other,
        }
    }

    pub(crate) fn for_current_platform(&self) -> &'static str {
        self.for_platform(Platform::current())
    }
}

pub(crate) fn shortcut_hint(spec: ShortcutSpec) -> SharedString {
    format_shortcut_hint(spec.for_current_platform())
}

pub(crate) fn format_shortcut_hint(binding: &str) -> SharedString {
    format_shortcut_hint_for_platform(Platform::current(), binding).into()
}

pub(crate) fn format_shortcut_hint_for_platform(platform: Platform, binding: &str) -> String {
    let parts: Vec<&str> = binding.split('-').filter(|part| !part.is_empty()).collect();
    if parts.is_empty() {
        return binding.to_string();
    }

    let mut rendered: Vec<String> = Vec::with_capacity(parts.len());
    for (idx, token) in parts.iter().enumerate() {
        let is_last = idx == parts.len() - 1;
        if is_last {
            rendered.push(format_key_token(platform, token));
        } else {
            rendered.push(format_modifier_token(platform, token));
        }
    }

    match platform {
        Platform::Mac => rendered.join(""),
        Platform::Other => rendered.join("+"),
    }
}

fn format_modifier_token(platform: Platform, token: &str) -> String {
    match (platform, token) {
        (Platform::Mac, "cmd") => "⌘".to_string(),
        (Platform::Mac, "shift") => "⇧".to_string(),
        (Platform::Mac, "alt") => "⌥".to_string(),
        (Platform::Mac, "ctrl") => "⌃".to_string(),
        (Platform::Other, "cmd") => "Cmd".to_string(),
        (Platform::Other, "shift") => "Shift".to_string(),
        (Platform::Other, "alt") => "Alt".to_string(),
        (Platform::Other, "ctrl") => "Ctrl".to_string(),
        _ => token.to_string(),
    }
}

fn format_key_token(platform: Platform, token: &str) -> String {
    match (platform, token) {
        (Platform::Mac, "enter") => "↩".to_string(),
        (_, "enter") => "Enter".to_string(),
        (_, "escape") => "Esc".to_string(),
        (_, "tab") => "Tab".to_string(),
        (Platform::Mac, "backspace") => "⌫".to_string(),
        (_, "backspace") => "Backspace".to_string(),
        (Platform::Mac, "delete") => "⌦".to_string(),
        (_, "delete") => "Del".to_string(),
        (_, "up") => "↑".to_string(),
        (_, "down") => "↓".to_string(),
        (_, "left") => "←".to_string(),
        (_, "right") => "→".to_string(),
        (_, token) if token.len() == 1 => token.to_ascii_uppercase(),
        (_, token) => token.to_string(),
    }
}

pub fn bind_keys(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("enter", InsertBlockBelow, Some("SandpaperEditor")),
        KeyBinding::new("tab", IndentBlock, Some("SandpaperEditor")),
        KeyBinding::new("shift-tab", OutdentBlock, Some("SandpaperEditor")),
        KeyBinding::new("alt-up", MoveBlockUp, Some("SandpaperEditor")),
        KeyBinding::new("alt-down", MoveBlockDown, Some("SandpaperEditor")),
        KeyBinding::new("delete", DeleteSelection, Some("SandpaperEditor")),
        KeyBinding::new("backspace", DeleteSelection, Some("SandpaperEditor")),
        KeyBinding::new("escape", ClearSelection, Some("SandpaperEditor")),
        KeyBinding::new("escape", CloseCommandPalette, Some("CommandPalette")),
        KeyBinding::new("enter", PaletteRun, Some("CommandPalette")),
        KeyBinding::new("up", PaletteMoveUp, Some("CommandPalette")),
        KeyBinding::new("down", PaletteMoveDown, Some("CommandPalette")),
    ]);

    #[cfg(target_os = "macos")]
    cx.bind_keys([
        KeyBinding::new("cmd-z", UndoEdit, Some("SandpaperEditor")),
        KeyBinding::new("cmd-shift-z", RedoEdit, Some("SandpaperEditor")),
        KeyBinding::new("cmd-shift-v", OpenVaults, None),
        KeyBinding::new("cmd-n", NewPage, None),
        KeyBinding::new("cmd-r", RenamePage, None),
        KeyBinding::new("cmd-b", ToggleSidebar, None),
        KeyBinding::new("cmd-shift-r", OpenReviewPanel, None),
        KeyBinding::new("cmd-shift-p", CycleContextPanel, None),
        KeyBinding::new("cmd-l", FocusQuickAdd, None),
        KeyBinding::new("cmd-\\", ToggleSplitPane, Some("SandpaperEditor")),
        KeyBinding::new("cmd-k", OpenCommandPalette, None),
        KeyBinding::new("cmd-d", DuplicateBlock, Some("SandpaperEditor")),
        KeyBinding::new("cmd-shift-a", SelectAllBlocks, Some("SandpaperEditor")),
        KeyBinding::new("alt-cmd-up", MoveBlockUp, Some("SandpaperEditor")),
        KeyBinding::new("alt-cmd-down", MoveBlockDown, Some("SandpaperEditor")),
        KeyBinding::new("cmd-shift-f", ToggleFocusMode, None),
        KeyBinding::new("cmd-shift-space", OpenQuickCapture, None),
        KeyBinding::new("cmd-1", SwitchToCapture, None),
        KeyBinding::new("cmd-2", SwitchToEdit, None),
        KeyBinding::new("cmd-3", SwitchToReview, None),
        KeyBinding::new("cmd-/", OpenKeyboardShortcuts, None),
    ]);

    #[cfg(not(target_os = "macos"))]
    cx.bind_keys([
        KeyBinding::new("ctrl-z", UndoEdit, Some("SandpaperEditor")),
        KeyBinding::new("ctrl-shift-z", RedoEdit, Some("SandpaperEditor")),
        KeyBinding::new("ctrl-y", RedoEdit, Some("SandpaperEditor")),
        KeyBinding::new("ctrl-alt-v", OpenVaults, None),
        KeyBinding::new("ctrl-n", NewPage, None),
        KeyBinding::new("f2", RenamePage, None),
        KeyBinding::new("ctrl-b", ToggleSidebar, None),
        KeyBinding::new("ctrl-shift-r", OpenReviewPanel, None),
        KeyBinding::new("ctrl-shift-p", CycleContextPanel, None),
        KeyBinding::new("ctrl-l", FocusQuickAdd, None),
        KeyBinding::new("ctrl-\\", ToggleSplitPane, Some("SandpaperEditor")),
        KeyBinding::new("ctrl-k", OpenCommandPalette, None),
        KeyBinding::new("ctrl-d", DuplicateBlock, Some("SandpaperEditor")),
        KeyBinding::new("ctrl-shift-a", SelectAllBlocks, Some("SandpaperEditor")),
        KeyBinding::new("alt-ctrl-up", MoveBlockUp, Some("SandpaperEditor")),
        KeyBinding::new("alt-ctrl-down", MoveBlockDown, Some("SandpaperEditor")),
        KeyBinding::new("ctrl-shift-f", ToggleFocusMode, None),
        KeyBinding::new("ctrl-shift-space", OpenQuickCapture, None),
        KeyBinding::new("ctrl-1", SwitchToCapture, None),
        KeyBinding::new("ctrl-2", SwitchToEdit, None),
        KeyBinding::new("ctrl-3", SwitchToReview, None),
        KeyBinding::new("ctrl-/", OpenKeyboardShortcuts, None),
    ]);
}

pub struct AppStore {
    focus_handle: FocusHandle,
    window_handle: AnyWindowHandle,
    pub(crate) agent_debug: Option<crate::services::agent_debug::bridge::AgentDebugBridge>,

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
    Vault,
    Plugins,
    Permissions,
    Import,
}

impl SettingsTab {
    fn as_str(&self) -> &'static str {
        match self {
            SettingsTab::General => "general",
            SettingsTab::Vault => "vault",
            SettingsTab::Plugins => "plugins",
            SettingsTab::Permissions => "permissions",
            SettingsTab::Import => "import",
        }
    }

    fn from_str(value: &str) -> Option<Self> {
        match value {
            "general" => Some(SettingsTab::General),
            "vault" => Some(SettingsTab::Vault),
            "plugins" => Some(SettingsTab::Plugins),
            "permissions" => Some(SettingsTab::Permissions),
            "import" => Some(SettingsTab::Import),
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
        apply_slash_command_text, count_case_insensitive_occurrences,
        count_case_insensitive_occurrences_outside_wikilinks, cycle_index, filter_slash_commands,
        find_slash_query, find_wikilink_query, fuzzy_score, link_first_unlinked_reference,
        parse_wikilink_tokens, resolve_cursor_for_blocks, score_palette_page, PageCursor,
        WikilinkToken,
    };
    use super::PaneSelection;
    use super::{format_shortcut_hint_for_platform, Platform};
    use super::{SlashAction, SlashCommandDef, SLASH_COMMANDS};
    use sandpaper_core::blocks::BlockType;
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
                block_type: BlockType::Text,
            },
            BlockSnapshot {
                uid: "b".into(),
                text: "Second".into(),
                indent: 0,
                block_type: BlockType::Text,
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
            block_type: BlockType::Text,
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
    fn count_unlinked_occurrences_ignores_wikilinks() {
        let count =
            count_case_insensitive_occurrences_outside_wikilinks("See [[Note]] and Note", "Note");
        assert_eq!(count, 1);
    }

    #[test]
    fn link_first_unlinked_reference_skips_already_linked() {
        let text = "See [[Note]] and Note";
        let (next, _cursor) = link_first_unlinked_reference(text, "Note", text.len()).unwrap();
        assert_eq!(next, "See [[Note]] and [[Note]]");
    }

    #[test]
    fn link_first_unlinked_reference_returns_none_when_only_linked() {
        let text = "See [[Note]]";
        assert!(link_first_unlinked_reference(text, "Note", text.len()).is_none());
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
            SlashCommandDef {
                id: "link",
                label: "Link to page",
                action: SlashAction::TextTransform,
            },
            SlashCommandDef {
                id: "date",
                label: "Insert date",
                action: SlashAction::TextTransform,
            },
            SlashCommandDef {
                id: "todo",
                label: "To-do",
                action: SlashAction::SetBlockType(BlockType::Todo),
            },
        ];
        let filtered = filter_slash_commands("", &commands);
        assert_eq!(filtered.len(), 3);
        assert_eq!(filtered[0].id, "link");
    }

    #[test]
    fn filter_slash_commands_matches_labels() {
        let commands = [
            SlashCommandDef {
                id: "link",
                label: "Link to page",
                action: SlashAction::TextTransform,
            },
            SlashCommandDef {
                id: "h1",
                label: "Heading 1",
                action: SlashAction::SetBlockType(BlockType::Heading1),
            },
            SlashCommandDef {
                id: "date",
                label: "Insert date",
                action: SlashAction::TextTransform,
            },
        ];
        let filtered = filter_slash_commands("heading", &commands);
        assert_eq!(filtered.first().map(|cmd| cmd.id), Some("h1"));
    }

    #[test]
    fn filter_slash_commands_skips_unmatched() {
        let commands = [
            SlashCommandDef {
                id: "link",
                label: "Link to page",
                action: SlashAction::TextTransform,
            },
            SlashCommandDef {
                id: "date",
                label: "Insert date",
                action: SlashAction::TextTransform,
            },
        ];
        let filtered = filter_slash_commands("xyz", &commands);
        assert!(filtered.is_empty());
    }

    #[test]
    fn slash_commands_include_image_insert_action() {
        let image = SLASH_COMMANDS
            .iter()
            .find(|command| command.id == "image")
            .expect("image slash command");
        assert_eq!(image.label, "Image");
        assert_eq!(image.action, SlashAction::InsertImage);
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

    #[test]
    fn format_shortcut_hint_mac_uses_symbols() {
        assert_eq!(
            format_shortcut_hint_for_platform(Platform::Mac, "cmd-shift-v"),
            "⌘⇧V"
        );
        assert_eq!(
            format_shortcut_hint_for_platform(Platform::Mac, "cmd-enter"),
            "⌘↩"
        );
    }

    #[test]
    fn format_shortcut_hint_other_uses_plus() {
        assert_eq!(
            format_shortcut_hint_for_platform(Platform::Other, "ctrl-shift-v"),
            "Ctrl+Shift+V"
        );
        assert_eq!(
            format_shortcut_hint_for_platform(Platform::Other, "ctrl-enter"),
            "Ctrl+Enter"
        );
    }
}
