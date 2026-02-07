use super::{
    AppStore, BacklinkEntry, BlockClipboard, BlockInputBinding, DiagramPreviewState, EditorPane,
    HistoryEntry, LayoutDensity, LinkPreviewCacheEntry, LinkPreviewState, Mode, NotificationItem,
    OutlineMenuState, PageDialogMode, PaneListState, PaneSelection, PluginBlockCacheEntry,
    PluginBlockPreviewState, PluginPanel, PluginPermissionInfo, PluginPermissionPrompt,
    PluginRuntimeStatus, QuickAddTarget, ReviewDisplayItem, SaveState, SecondaryPane, SettingsTab,
    SlashMenuState, ThemePreference, UnlinkedReference, WikilinkMenuState, WorkspacePanel,
};
use crate::app::prelude::*;

pub(crate) struct AppState {
    pub(crate) boot_status: SharedString,
    pub(crate) db: Option<Database>,
    pub(crate) vaults: Vec<VaultRecord>,
    pub(crate) active_vault_id: Option<String>,
    pub(crate) active_vault_root: Option<PathBuf>,
    pub(crate) mode: Mode,
    pub(crate) save_state: SaveState,
    pub(crate) autosave_epoch: u64,
    pub(crate) primary_dirty: bool,
}

impl AppState {
    pub(crate) fn new() -> Self {
        Self {
            boot_status: "Booting…".into(),
            db: None,
            vaults: Vec::new(),
            active_vault_id: None,
            active_vault_root: None,
            mode: Mode::Editor,
            save_state: SaveState::Saved,
            autosave_epoch: 0,
            primary_dirty: false,
        }
    }
}

pub(crate) struct EditorState {
    pub(crate) pages_loading: bool,
    pub(crate) pages: Vec<PageRecord>,
    pub(crate) active_page: Option<PageRecord>,
    pub(crate) editor: Option<EditorModel>,
    pub(crate) page_cursors: HashMap<String, super::helpers::PageCursor>,
    pub(crate) recent_pages: Vec<String>,
    pub(crate) highlighted_block_uid: Option<String>,
    pub(crate) highlight_epoch: u64,
    pub(crate) sidebar_search_query: String,
    pub(crate) sidebar_search_input: Entity<InputState>,
    pub(crate) search_pages: Vec<PageRecord>,
    pub(crate) search_blocks: Vec<BlockPageRecord>,
    pub(crate) backlinks: Vec<BacklinkEntry>,
    pub(crate) block_backlinks: Vec<BacklinkEntry>,
    pub(crate) unlinked_references: Vec<UnlinkedReference>,
    pub(crate) references_epoch: u64,
    pub(crate) secondary_pane: Option<SecondaryPane>,
    pub(crate) slash_menu: SlashMenuState,
    pub(crate) wikilink_menu: WikilinkMenuState,
    pub(crate) outline_menu: OutlineMenuState,
    pub(crate) popup_priority_counter: usize,
    pub(crate) primary_selection: PaneSelection,
    pub(crate) active_pane: EditorPane,
    pub(crate) blocks_list_state: PaneListState,
    pub(crate) block_input: Entity<InputState>,
    pub(crate) capture_input: Entity<InputState>,
    pub(crate) capture_move_destination_input: Entity<InputState>,
    pub(crate) review_items: Vec<ReviewDisplayItem>,
    pub(crate) review_selected_index: usize,
    pub(crate) link_preview: Option<LinkPreviewState>,
    pub(crate) link_preview_epoch: u64,
    pub(crate) link_preview_close_epoch: u64,
    pub(crate) link_preview_hovering_link: bool,
    pub(crate) link_preview_cache: HashMap<String, LinkPreviewCacheEntry>,
    pub(crate) diagram_preview_cache: HashMap<String, std::sync::Arc<gpui::Image>>,
    pub(crate) diagram_previews: HashMap<String, DiagramPreviewState>,
    pub(crate) collapsed_by_page_uid: HashMap<String, HashSet<String>>,
    pub(crate) plugin_block_view_cache: HashMap<String, PluginBlockCacheEntry>,
    pub(crate) plugin_block_view_cache_order: std::collections::VecDeque<(String, u64)>,
    pub(crate) plugin_block_view_cache_next_id: u64,
    pub(crate) plugin_block_previews: HashMap<String, PluginBlockPreviewState>,
    pub(crate) copied_block_uid: Option<String>,
    pub(crate) copied_epoch: u64,
    pub(crate) block_clipboard: Option<BlockClipboard>,
    pub(crate) block_input_binding: Option<BlockInputBinding>,
    pub(crate) related_pages: Vec<super::connections::RelatedPage>,
    pub(crate) random_pages: Vec<PageRecord>,
    pub(crate) connections_epoch: u64,
    pub(crate) page_properties: Vec<PagePropertyRecord>,
    pub(crate) properties_open: bool,
    // Capture mode state
    pub(crate) capture_move_item_uid: Option<String>,
    // Review mode / feed state
    pub(crate) feed_items: Vec<super::FeedItem>,
    pub(crate) feed_selected_index: usize,
    // Drag-and-drop state
    pub(crate) drag_source: Option<super::DragSource>,
    pub(crate) drag_target: Option<super::DragTarget>,
    pub(crate) hovered_block_uid: Option<String>,
    // Session history state (undo/redo)
    pub(crate) undo_stack: Vec<HistoryEntry>,
    pub(crate) redo_stack: Vec<HistoryEntry>,
    pub(crate) text_history_suppression_depth: usize,
    pub(crate) is_replaying_history: bool,
}

impl EditorState {
    pub(crate) fn new(window: &mut Window, cx: &mut Context<AppStore>) -> Self {
        let sidebar_search_input = cx.new(|cx| InputState::new(window, cx).placeholder("Search…"));
        let block_input = cx.new(|cx| {
            InputState::new(window, cx)
                .placeholder("Type here…")
                .multi_line(true)
        });
        let capture_input = cx.new(|cx| {
            InputState::new(window, cx)
                .placeholder("Capture a thought, link, or task...")
                .multi_line(true)
        });
        let capture_move_destination_input =
            cx.new(|cx| InputState::new(window, cx).placeholder("Move to page..."));

        Self {
            pages_loading: true,
            pages: Vec::new(),
            active_page: None,
            editor: None,
            page_cursors: HashMap::new(),
            recent_pages: Vec::new(),
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
            secondary_pane: None,
            slash_menu: SlashMenuState::closed(),
            wikilink_menu: WikilinkMenuState::closed(),
            outline_menu: OutlineMenuState::closed(),
            popup_priority_counter: 0,
            primary_selection: PaneSelection::new(),
            active_pane: EditorPane::Primary,
            blocks_list_state: PaneListState::new(0, px(super::BLOCK_ROW_HEIGHT)),
            block_input,
            capture_input,
            capture_move_destination_input,
            review_items: Vec::new(),
            review_selected_index: 0,
            link_preview: None,
            link_preview_epoch: 0,
            link_preview_close_epoch: 0,
            link_preview_hovering_link: false,
            link_preview_cache: HashMap::new(),
            diagram_preview_cache: HashMap::new(),
            diagram_previews: HashMap::new(),
            collapsed_by_page_uid: HashMap::new(),
            plugin_block_view_cache: HashMap::new(),
            plugin_block_view_cache_order: std::collections::VecDeque::new(),
            plugin_block_view_cache_next_id: 0,
            plugin_block_previews: HashMap::new(),
            copied_block_uid: None,
            copied_epoch: 0,
            block_clipboard: None,
            block_input_binding: None,
            related_pages: Vec::new(),
            random_pages: Vec::new(),
            connections_epoch: 0,
            page_properties: Vec::new(),
            properties_open: false,
            capture_move_item_uid: None,
            feed_items: Vec::new(),
            feed_selected_index: 0,
            drag_source: None,
            drag_target: None,
            hovered_block_uid: None,
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
            text_history_suppression_depth: 0,
            is_replaying_history: false,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SettingsModalModel {
    pub(crate) open: bool,
    pub(crate) active_tab: SettingsTab,
    pub(crate) tabs: Vec<SettingsTab>,
}

pub(crate) struct SettingsState {
    pub(crate) open: bool,
    pub(crate) tab: SettingsTab,
    pub(crate) sync_scroll: bool,
    pub(crate) backlinks_open: bool,
    pub(crate) sidebar_width: f32,
    pub(crate) sidebar_collapsed: bool,
    pub(crate) focus_mode: bool,
    pub(crate) status_bar_visible: bool,
    pub(crate) status_bar_hints: bool,
    pub(crate) editor_max_width: f32,
    pub(crate) context_panel_open: bool,
    pub(crate) context_panel_tab: WorkspacePanel,
    pub(crate) theme_preference: ThemePreference,
    pub(crate) layout_density: LayoutDensity,
    pub(crate) quick_add_target: QuickAddTarget,
    pub(crate) plugin_settings_selected: Option<String>,
    pub(crate) last_mode: Mode,
}

impl SettingsState {
    pub(crate) const UI_SCHEMA_VERSION: i32 = 2;
    pub(crate) const SIDEBAR_WIDTH_MIN: f32 = 220.0;
    pub(crate) const SIDEBAR_WIDTH_MAX: f32 = 420.0;
    pub(crate) const EDITOR_MAX_WIDTH_MIN: f32 = 680.0;
    pub(crate) const EDITOR_MAX_WIDTH_MAX: f32 = 1040.0;

    pub(crate) fn new() -> Self {
        Self {
            open: false,
            tab: SettingsTab::General,
            sync_scroll: false,
            backlinks_open: true,
            sidebar_width: 272.0,
            sidebar_collapsed: false,
            focus_mode: false,
            status_bar_visible: false,
            status_bar_hints: false,
            editor_max_width: 860.0,
            context_panel_open: true,
            context_panel_tab: WorkspacePanel::Review,
            theme_preference: ThemePreference::System,
            layout_density: LayoutDensity::Comfortable,
            quick_add_target: QuickAddTarget::Inbox,
            plugin_settings_selected: None,
            last_mode: Mode::Editor,
        }
    }

    pub(crate) fn clamp_sidebar_width(value: f32) -> f32 {
        value.clamp(Self::SIDEBAR_WIDTH_MIN, Self::SIDEBAR_WIDTH_MAX)
    }

    pub(crate) fn clamp_editor_max_width(value: f32) -> f32 {
        value.clamp(Self::EDITOR_MAX_WIDTH_MIN, Self::EDITOR_MAX_WIDTH_MAX)
    }

    pub(crate) fn open(&mut self, tab: SettingsTab) {
        self.open = true;
        self.tab = tab;
    }

    pub(crate) fn close(&mut self) {
        self.open = false;
    }

    pub(crate) fn set_tab(&mut self, tab: SettingsTab) {
        self.tab = tab;
    }

    pub(crate) fn set_plugin_selection(&mut self, plugin_id: Option<String>) {
        self.plugin_settings_selected = plugin_id;
    }

    pub(crate) fn modal_model(&self) -> SettingsModalModel {
        SettingsModalModel {
            open: self.open,
            active_tab: self.tab,
            tabs: vec![
                SettingsTab::General,
                SettingsTab::Vault,
                SettingsTab::Plugins,
                SettingsTab::Permissions,
                SettingsTab::Import,
            ],
        }
    }

    pub(crate) fn load_from_db(&mut self, db: &Database) -> Result<bool, String> {
        let expected = Self::UI_SCHEMA_VERSION.to_string();
        let schema = db
            .get_kv("settings.ui_schema_version")
            .map_err(|err| format!("{err:?}"))?;
        if schema.as_deref() != Some(expected.as_str()) {
            *self = Self::new();
            return Ok(false);
        }

        if let Some(raw) = db
            .get_kv("settings.sync_scroll")
            .map_err(|err| format!("{err:?}"))?
        {
            self.sync_scroll = raw == "true";
        }
        if let Some(raw) = db
            .get_kv("settings.backlinks_open")
            .map_err(|err| format!("{err:?}"))?
        {
            self.backlinks_open = raw == "true";
        }
        if let Some(raw) = db
            .get_kv("settings.sidebar_width")
            .map_err(|err| format!("{err:?}"))?
        {
            if let Ok(value) = raw.parse::<f32>() {
                self.sidebar_width = Self::clamp_sidebar_width(value);
            }
        }
        if let Some(raw) = db
            .get_kv("settings.sidebar_collapsed")
            .map_err(|err| format!("{err:?}"))?
        {
            self.sidebar_collapsed = raw == "true";
        }
        if let Some(raw) = db
            .get_kv("settings.focus_mode")
            .map_err(|err| format!("{err:?}"))?
        {
            self.focus_mode = raw == "true";
        }
        if let Some(raw) = db
            .get_kv("settings.status_bar_visible")
            .map_err(|err| format!("{err:?}"))?
        {
            self.status_bar_visible = raw == "true";
        }
        if let Some(raw) = db
            .get_kv("settings.status_bar_hints")
            .map_err(|err| format!("{err:?}"))?
        {
            self.status_bar_hints = raw == "true";
        }
        if let Some(raw) = db
            .get_kv("settings.editor_max_width")
            .map_err(|err| format!("{err:?}"))?
        {
            if let Ok(value) = raw.parse::<f32>() {
                self.editor_max_width = Self::clamp_editor_max_width(value);
            }
        }
        if let Some(raw) = db
            .get_kv("settings.last_tab")
            .map_err(|err| format!("{err:?}"))?
        {
            if let Some(tab) = SettingsTab::from_str(&raw) {
                self.tab = tab;
            }
        }
        if let Some(raw) = db
            .get_kv("settings.context_panel_open")
            .map_err(|err| format!("{err:?}"))?
        {
            self.context_panel_open = raw == "true";
        }
        if let Some(raw) = db
            .get_kv("settings.context_panel_tab")
            .map_err(|err| format!("{err:?}"))?
        {
            if let Some(tab) = WorkspacePanel::from_str(&raw) {
                self.context_panel_tab = tab;
            }
        }
        if let Some(raw) = db
            .get_kv("settings.theme_preference")
            .map_err(|err| format!("{err:?}"))?
        {
            if let Some(preference) = ThemePreference::from_str(&raw) {
                self.theme_preference = preference;
            }
        }
        if let Some(raw) = db
            .get_kv("settings.layout_density")
            .map_err(|err| format!("{err:?}"))?
        {
            if let Some(density) = LayoutDensity::from_str(&raw) {
                self.layout_density = density;
            }
        }
        if let Some(raw) = db
            .get_kv("settings.quick_add_target")
            .map_err(|err| format!("{err:?}"))?
        {
            if let Some(target) = QuickAddTarget::from_str(&raw) {
                self.quick_add_target = target;
            }
        }
        if let Some(raw) = db
            .get_kv("settings.last_mode")
            .map_err(|err| format!("{err:?}"))?
        {
            if let Some(mode) = Mode::from_str(&raw) {
                self.last_mode = mode;
            }
        }
        Ok(true)
    }

    pub(crate) fn save_to_db(&self, db: &Database) -> Result<(), String> {
        db.set_kv(
            "settings.ui_schema_version",
            &Self::UI_SCHEMA_VERSION.to_string(),
        )
        .map_err(|err| format!("{err:?}"))?;
        db.set_kv(
            "settings.sync_scroll",
            if self.sync_scroll { "true" } else { "false" },
        )
        .map_err(|err| format!("{err:?}"))?;
        db.set_kv(
            "settings.backlinks_open",
            if self.backlinks_open { "true" } else { "false" },
        )
        .map_err(|err| format!("{err:?}"))?;
        db.set_kv(
            "settings.sidebar_width",
            &Self::clamp_sidebar_width(self.sidebar_width).to_string(),
        )
        .map_err(|err| format!("{err:?}"))?;
        db.set_kv(
            "settings.sidebar_collapsed",
            if self.sidebar_collapsed {
                "true"
            } else {
                "false"
            },
        )
        .map_err(|err| format!("{err:?}"))?;
        db.set_kv(
            "settings.focus_mode",
            if self.focus_mode { "true" } else { "false" },
        )
        .map_err(|err| format!("{err:?}"))?;
        db.set_kv(
            "settings.status_bar_visible",
            if self.status_bar_visible {
                "true"
            } else {
                "false"
            },
        )
        .map_err(|err| format!("{err:?}"))?;
        db.set_kv(
            "settings.status_bar_hints",
            if self.status_bar_hints {
                "true"
            } else {
                "false"
            },
        )
        .map_err(|err| format!("{err:?}"))?;
        db.set_kv(
            "settings.editor_max_width",
            &Self::clamp_editor_max_width(self.editor_max_width).to_string(),
        )
        .map_err(|err| format!("{err:?}"))?;
        db.set_kv(
            "settings.context_panel_open",
            if self.context_panel_open {
                "true"
            } else {
                "false"
            },
        )
        .map_err(|err| format!("{err:?}"))?;
        db.set_kv(
            "settings.context_panel_tab",
            self.context_panel_tab.as_str(),
        )
        .map_err(|err| format!("{err:?}"))?;
        db.set_kv("settings.theme_preference", self.theme_preference.as_str())
            .map_err(|err| format!("{err:?}"))?;
        db.set_kv("settings.layout_density", self.layout_density.as_str())
            .map_err(|err| format!("{err:?}"))?;
        db.set_kv("settings.quick_add_target", self.quick_add_target.as_str())
            .map_err(|err| format!("{err:?}"))?;
        db.set_kv("settings.last_tab", self.tab.as_str())
            .map_err(|err| format!("{err:?}"))?;
        db.set_kv("settings.last_mode", self.last_mode.as_str())
            .map_err(|err| format!("{err:?}"))?;
        Ok(())
    }
}

pub(crate) struct UiState {
    pub(crate) vault_dialog_open: bool,
    pub(crate) vault_dialog_name_input: Entity<InputState>,
    pub(crate) vault_dialog_path_input: Entity<InputState>,
    pub(crate) vault_dialog_error: Option<SharedString>,
    pub(crate) page_dialog_open: bool,
    pub(crate) page_dialog_mode: PageDialogMode,
    pub(crate) page_dialog_input: Entity<InputState>,
    pub(crate) page_dialog_error: Option<SharedString>,
    pub(crate) palette_input: Entity<InputState>,
    pub(crate) palette_open: bool,
    pub(crate) palette_query: String,
    pub(crate) palette_index: usize,
    pub(crate) capture_confirmation: Option<SharedString>,
    pub(crate) capture_confirmation_epoch: u64,
    pub(crate) shadow_write_pending: HashSet<String>,
    pub(crate) shadow_write_busy: bool,
    pub(crate) shadow_write_epoch: u64,
    pub(crate) shadow_write_last_error: Option<SharedString>,
    pub(crate) offline_export_busy: bool,
    pub(crate) offline_export_status: Option<SharedString>,
    pub(crate) offline_import_busy: bool,
    pub(crate) offline_import_status: Option<SharedString>,
    pub(crate) notifications_open: bool,
    pub(crate) notifications: Vec<NotificationItem>,
    pub(crate) sidebar_resize: Option<SidebarResizeState>,
    pub(crate) sidebar_collapse_epoch: u64,
    pub(crate) capture_overlay_open: bool,
    pub(crate) capture_overlay_target: QuickAddTarget,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct SidebarResizeState {
    pub(crate) start_x: f32,
    pub(crate) start_width: f32,
}

impl UiState {
    pub(crate) fn new(window: &mut Window, cx: &mut Context<AppStore>) -> Self {
        let page_dialog_input = cx.new(|cx| InputState::new(window, cx).placeholder("Page title"));
        let vault_dialog_name_input =
            cx.new(|cx| InputState::new(window, cx).placeholder("Vault name"));
        let vault_dialog_path_input =
            cx.new(|cx| InputState::new(window, cx).placeholder("Vault path"));
        let palette_input =
            cx.new(|cx| InputState::new(window, cx).placeholder("Type a command or page…"));

        Self {
            vault_dialog_open: false,
            vault_dialog_name_input,
            vault_dialog_path_input,
            vault_dialog_error: None,
            page_dialog_open: false,
            page_dialog_mode: PageDialogMode::Create,
            page_dialog_input,
            page_dialog_error: None,
            palette_input,
            palette_open: false,
            palette_query: String::new(),
            palette_index: 0,
            capture_confirmation: None,
            capture_confirmation_epoch: 0,
            shadow_write_pending: HashSet::new(),
            shadow_write_busy: false,
            shadow_write_epoch: 0,
            shadow_write_last_error: None,
            offline_export_busy: false,
            offline_export_status: None,
            offline_import_busy: false,
            offline_import_status: None,
            notifications_open: false,
            notifications: Vec::new(),
            sidebar_resize: None,
            sidebar_collapse_epoch: 0,
            capture_overlay_open: false,
            capture_overlay_target: QuickAddTarget::Inbox,
        }
    }
}

pub(crate) struct PluginSettingInputs {
    inputs: HashMap<String, Entity<InputState>>,
    subscriptions: HashMap<String, Subscription>,
}

impl PluginSettingInputs {
    pub(crate) fn new() -> Self {
        Self {
            inputs: HashMap::new(),
            subscriptions: HashMap::new(),
        }
    }

    pub(crate) fn get(&self, key: &str) -> Option<Entity<InputState>> {
        self.inputs.get(key).cloned()
    }

    pub(crate) fn insert(
        &mut self,
        key: String,
        input: Entity<InputState>,
        subscription: Subscription,
    ) {
        self.inputs.insert(key.clone(), input);
        self.subscriptions.insert(key, subscription);
    }

    pub(crate) fn clear(&mut self) {
        self.inputs.clear();
        self.subscriptions.clear();
    }

    pub(crate) fn prune_to_keys(&mut self, allowed: &HashSet<String>) {
        self.inputs.retain(|key, _| allowed.contains(key));
        self.subscriptions.retain(|key, _| allowed.contains(key));
    }
}

pub(crate) struct PluginsState {
    pub(crate) plugins: Vec<PluginPermissionInfo>,
    pub(crate) plugin_status: Option<PluginRuntimeStatus>,
    pub(crate) plugin_error: Option<SharedString>,
    pub(crate) plugin_error_details: Option<PluginRuntimeError>,
    pub(crate) plugin_busy: bool,
    pub(crate) plugin_runtime: Option<PluginRuntime>,
    pub(crate) plugin_active_panel: Option<PluginPanel>,
    pub(crate) plugin_permission_prompt: Option<PluginPermissionPrompt>,
    pub(crate) plugin_installing: bool,
    pub(crate) plugin_install_status: Option<SharedString>,
    pub(crate) plugin_manage_busy: HashSet<String>,
    pub(crate) plugin_manage_status: HashMap<String, SharedString>,
    pub(crate) plugin_settings_values: HashMap<String, Value>,
    pub(crate) plugin_settings_saved: HashMap<String, Value>,
    pub(crate) plugin_settings_dirty: HashSet<String>,
    pub(crate) plugin_settings_status: HashMap<String, SharedString>,
    pub(crate) plugin_setting_inputs: PluginSettingInputs,
}

impl PluginsState {
    pub(crate) fn new() -> Self {
        Self {
            plugins: Vec::new(),
            plugin_status: None,
            plugin_error: None,
            plugin_error_details: None,
            plugin_busy: false,
            plugin_runtime: None,
            plugin_active_panel: None,
            plugin_permission_prompt: None,
            plugin_installing: false,
            plugin_install_status: None,
            plugin_manage_busy: HashSet::new(),
            plugin_manage_status: HashMap::new(),
            plugin_settings_values: HashMap::new(),
            plugin_settings_saved: HashMap::new(),
            plugin_settings_dirty: HashSet::new(),
            plugin_settings_status: HashMap::new(),
            plugin_setting_inputs: PluginSettingInputs::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::TestAppContext;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    #[test]
    fn settings_modal_model_tracks_tabs() {
        let mut settings = SettingsState::new();
        let model = settings.modal_model();
        assert!(!model.open);
        assert_eq!(model.active_tab, SettingsTab::General);
        assert_eq!(
            model.tabs,
            vec![
                SettingsTab::General,
                SettingsTab::Vault,
                SettingsTab::Plugins,
                SettingsTab::Permissions,
                SettingsTab::Import,
            ]
        );

        settings.open(SettingsTab::Plugins);
        let model = settings.modal_model();
        assert!(model.open);
        assert_eq!(model.active_tab, SettingsTab::Plugins);

        settings.set_tab(SettingsTab::General);
        let model = settings.modal_model();
        assert_eq!(model.active_tab, SettingsTab::General);

        settings.close();
        let model = settings.modal_model();
        assert!(!model.open);
    }

    #[test]
    fn settings_persistence_roundtrip() {
        let db = Database::new_in_memory().expect("db init");
        db.run_migrations().expect("migrations");
        let mut settings = SettingsState::new();
        settings.sync_scroll = true;
        settings.backlinks_open = false;
        settings.sidebar_width = 312.0;
        settings.sidebar_collapsed = true;
        settings.focus_mode = true;
        settings.status_bar_visible = false;
        settings.status_bar_hints = false;
        settings.editor_max_width = 920.0;
        settings.context_panel_open = false;
        settings.context_panel_tab = WorkspacePanel::Plugins;
        settings.theme_preference = ThemePreference::Dark;
        settings.layout_density = LayoutDensity::Compact;
        settings.quick_add_target = QuickAddTarget::TaskInbox;
        settings.tab = SettingsTab::Plugins;
        settings.save_to_db(&db).expect("save settings");

        let mut loaded = SettingsState::new();
        let loaded_existing = loaded.load_from_db(&db).expect("load settings");
        assert!(loaded_existing);

        assert!(loaded.sync_scroll);
        assert!(!loaded.backlinks_open);
        assert_eq!(loaded.sidebar_width, 312.0);
        assert!(loaded.sidebar_collapsed);
        assert!(loaded.focus_mode);
        assert!(!loaded.status_bar_visible);
        assert!(!loaded.status_bar_hints);
        assert_eq!(loaded.editor_max_width, 920.0);
        assert!(!loaded.context_panel_open);
        assert_eq!(loaded.context_panel_tab, WorkspacePanel::Plugins);
        assert_eq!(loaded.theme_preference, ThemePreference::Dark);
        assert_eq!(loaded.layout_density, LayoutDensity::Compact);
        assert_eq!(loaded.quick_add_target, QuickAddTarget::TaskInbox);
        assert_eq!(loaded.tab, SettingsTab::Plugins);
    }

    #[test]
    fn settings_defaults_disable_status_bar_shortcut_hints() {
        let settings = SettingsState::new();
        assert!(!settings.status_bar_hints);
    }

    #[test]
    fn settings_load_clamps_width_preferences() {
        let db = Database::new_in_memory().expect("db init");
        db.run_migrations().expect("migrations");
        db.set_kv("settings.sidebar_width", "99999")
            .expect("kv set");
        db.set_kv("settings.editor_max_width", "1").expect("kv set");

        let mut loaded = SettingsState::new();
        let loaded_existing = loaded.load_from_db(&db).expect("load settings");
        assert!(!loaded_existing);

        assert_eq!(loaded.sidebar_width, 272.0);
        assert_eq!(loaded.editor_max_width, 860.0);
        assert_eq!(loaded.context_panel_tab, WorkspacePanel::Review);
        assert_eq!(loaded.theme_preference, ThemePreference::System);
    }

    #[test]
    fn settings_missing_schema_triggers_hard_reset() {
        let db = Database::new_in_memory().expect("db init");
        db.run_migrations().expect("migrations");
        db.set_kv("settings.sidebar_width", "312").expect("kv set");
        db.set_kv("settings.theme_preference", "dark")
            .expect("kv set");

        let mut loaded = SettingsState::new();
        loaded.sidebar_width = 240.0;
        loaded.theme_preference = ThemePreference::Light;
        let loaded_existing = loaded.load_from_db(&db).expect("load settings");

        assert!(!loaded_existing);
        assert_eq!(loaded.sidebar_width, 272.0);
        assert_eq!(loaded.theme_preference, ThemePreference::System);
    }

    #[gpui::test]
    fn plugin_setting_inputs_prune_removes_stale(cx: &mut TestAppContext) {
        cx.skip_drawing();

        struct DummyView;
        impl Render for DummyView {
            fn render(
                &mut self,
                _window: &mut Window,
                _cx: &mut Context<Self>,
            ) -> impl gpui::IntoElement {
                div()
            }
        }

        let window = cx.add_window(|_window, _cx| DummyView);
        window
            .update(cx, |_view, window, cx| {
                let input_a = cx.new(|cx| InputState::new(window, cx));
                let input_b = cx.new(|cx| InputState::new(window, cx));

                let dropped = Arc::new(AtomicUsize::new(0));
                let drop_a = dropped.clone();
                let drop_b = dropped.clone();

                let mut inputs = PluginSettingInputs::new();
                inputs.insert(
                    "alpha:one".to_string(),
                    input_a,
                    Subscription::new(move || {
                        drop_a.fetch_add(1, Ordering::SeqCst);
                    }),
                );
                inputs.insert(
                    "beta:two".to_string(),
                    input_b,
                    Subscription::new(move || {
                        drop_b.fetch_add(1, Ordering::SeqCst);
                    }),
                );

                let mut allowed = HashSet::new();
                allowed.insert("alpha:one".to_string());
                inputs.prune_to_keys(&allowed);

                assert!(inputs.get("alpha:one").is_some());
                assert!(inputs.get("beta:two").is_none());
                assert_eq!(dropped.load(Ordering::SeqCst), 1);
            })
            .unwrap();
    }
}
