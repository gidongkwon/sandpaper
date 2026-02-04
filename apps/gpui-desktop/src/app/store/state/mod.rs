use super::{
    AppStore, BacklinkEntry, EditorPane, LinkPreviewCacheEntry, LinkPreviewState, Mode,
    PageDialogMode, PaneListState, PaneSelection, PluginPanel, PluginPermissionInfo,
    PluginPermissionPrompt, PluginRuntimeStatus, ReviewDisplayItem, SaveState, SecondaryPane,
    SettingsTab, SlashMenuState, UnlinkedReference, WikilinkMenuState,
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
    pub(crate) primary_selection: PaneSelection,
    pub(crate) active_pane: EditorPane,
    pub(crate) blocks_list_state: PaneListState,
    pub(crate) block_input: Entity<InputState>,
    pub(crate) capture_input: Entity<InputState>,
    pub(crate) review_items: Vec<ReviewDisplayItem>,
    pub(crate) link_preview: Option<LinkPreviewState>,
    pub(crate) link_preview_epoch: u64,
    pub(crate) link_preview_close_epoch: u64,
    pub(crate) link_preview_hovering_link: bool,
    pub(crate) link_preview_cache: HashMap<String, LinkPreviewCacheEntry>,
}

impl EditorState {
    pub(crate) fn new(window: &mut Window, cx: &mut Context<AppStore>) -> Self {
        let sidebar_search_input = cx.new(|cx| InputState::new(window, cx).placeholder("Search"));
        let block_input = cx.new(|cx| InputState::new(window, cx).placeholder("Write a block…"));
        let capture_input = cx.new(|cx| {
            InputState::new(window, cx)
                .placeholder("Capture a thought, link, or task...")
                .multi_line(true)
        });

        Self {
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
            primary_selection: PaneSelection::new(),
            active_pane: EditorPane::Primary,
            blocks_list_state: PaneListState::new(0, px(super::BLOCK_ROW_HEIGHT)),
            block_input,
            capture_input,
            review_items: Vec::new(),
            link_preview: None,
            link_preview_epoch: 0,
            link_preview_close_epoch: 0,
            link_preview_hovering_link: false,
            link_preview_cache: HashMap::new(),
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
    pub(crate) plugin_settings_selected: Option<String>,
}

impl SettingsState {
    pub(crate) fn new() -> Self {
        Self {
            open: false,
            tab: SettingsTab::General,
            sync_scroll: false,
            backlinks_open: true,
            plugin_settings_selected: None,
        }
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
            tabs: vec![SettingsTab::General, SettingsTab::Plugins],
        }
    }

    pub(crate) fn load_from_db(&mut self, db: &Database) -> Result<(), String> {
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
            .get_kv("settings.last_tab")
            .map_err(|err| format!("{err:?}"))?
        {
            if let Some(tab) = SettingsTab::from_str(&raw) {
                self.tab = tab;
            }
        }
        Ok(())
    }

    pub(crate) fn save_to_db(&self, db: &Database) -> Result<(), String> {
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
        db.set_kv("settings.last_tab", self.tab.as_str())
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
}

impl UiState {
    pub(crate) fn new(window: &mut Window, cx: &mut Context<AppStore>) -> Self {
        let page_dialog_input = cx.new(|cx| InputState::new(window, cx).placeholder("Page title"));
        let vault_dialog_name_input =
            cx.new(|cx| InputState::new(window, cx).placeholder("Vault name"));
        let vault_dialog_path_input =
            cx.new(|cx| InputState::new(window, cx).placeholder("Vault path"));
        let palette_input =
            cx.new(|cx| InputState::new(window, cx).placeholder("Search commands..."));

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
        settings.tab = SettingsTab::Plugins;
        settings.save_to_db(&db).expect("save settings");

        let mut loaded = SettingsState::new();
        loaded.load_from_db(&db).expect("load settings");

        assert!(loaded.sync_scroll);
        assert!(!loaded.backlinks_open);
        assert_eq!(loaded.tab, SettingsTab::Plugins);
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
