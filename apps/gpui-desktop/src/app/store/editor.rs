use super::helpers::now_millis;
use super::*;

pub(crate) fn update_wikilinks_in_db(
    db: &Database,
    from_title: &str,
    to_title: &str,
) -> HashMap<String, String> {
    let from = from_title.trim();
    let to = to_title.trim();
    if from.is_empty() || to.is_empty() {
        return HashMap::new();
    }
    if app::sanitize_kebab(from) == app::sanitize_kebab(to) {
        return HashMap::new();
    }

    let Ok(records) = db.list_blocks_with_wikilinks() else {
        return HashMap::new();
    };

    let mut updated_blocks = HashMap::new();
    for record in records {
        let next = replace_wikilinks_in_text(&record.text, from, to);
        if next == record.text {
            continue;
        }
        if db
            .update_block_text_by_uid(&record.block_uid, &next)
            .is_ok()
        {
            updated_blocks.insert(record.block_uid, next);
        }
    }

    updated_blocks
}

impl AppStore {
    pub(crate) fn with_window(
        &self,
        cx: &mut Context<Self>,
        f: impl FnOnce(&mut Window, &mut App),
    ) {
        let _ = cx.update_window(self.window_handle, |_, window, cx| f(window, cx));
    }

    pub(crate) fn record_page_cursor_for_pane(
        &mut self,
        pane: EditorPane,
        block_uid: &str,
        cursor: usize,
    ) {
        let Some(page) = self.page_for_pane(pane) else {
            return;
        };
        self.editor.page_cursors.insert(
            page.uid.clone(),
            helpers::PageCursor {
                block_uid: block_uid.to_string(),
                cursor_offset: cursor,
            },
        );
    }

    pub(crate) fn record_recent_page(&mut self, page_uid: &str) {
        self.editor.recent_pages.retain(|uid| uid != page_uid);
        self.editor.recent_pages.insert(0, page_uid.to_string());
        if self.editor.recent_pages.len() > 24 {
            self.editor.recent_pages.truncate(24);
        }
    }

    pub(crate) fn selection_for_pane(&self, pane: EditorPane) -> Option<&PaneSelection> {
        match pane {
            EditorPane::Primary => Some(&self.editor.primary_selection),
            EditorPane::Secondary => self
                .editor
                .secondary_pane
                .as_ref()
                .map(|pane| &pane.selection),
        }
    }

    pub(crate) fn selection_for_pane_mut(
        &mut self,
        pane: EditorPane,
    ) -> Option<&mut PaneSelection> {
        match pane {
            EditorPane::Primary => Some(&mut self.editor.primary_selection),
            EditorPane::Secondary => self
                .editor
                .secondary_pane
                .as_mut()
                .map(|pane| &mut pane.selection),
        }
    }

    pub(crate) fn clear_selection_for_pane(&mut self, pane: EditorPane) {
        if let Some(selection) = self.selection_for_pane_mut(pane) {
            selection.clear();
        }
    }

    pub(crate) fn clear_all_selections(&mut self) {
        self.editor.primary_selection.clear();
        if let Some(pane) = self.editor.secondary_pane.as_mut() {
            pane.selection.clear();
        }
    }

    pub(crate) fn set_selection_range_for_pane(
        &mut self,
        pane: EditorPane,
        start: usize,
        end: usize,
    ) {
        if let Some(selection) = self.selection_for_pane_mut(pane) {
            selection.set_range(start, end);
        }
    }

    pub(crate) fn selected_range_for_pane(
        &self,
        pane: EditorPane,
    ) -> Option<std::ops::Range<usize>> {
        self.selection_for_pane(pane)
            .and_then(|selection| selection.selected_range())
    }

    pub(crate) fn editor_for_pane(&self, pane: EditorPane) -> Option<&EditorModel> {
        match pane {
            EditorPane::Primary => self.editor.editor.as_ref(),
            EditorPane::Secondary => self.editor.secondary_pane.as_ref().map(|pane| &pane.editor),
        }
    }

    pub(crate) fn editor_for_pane_mut(&mut self, pane: EditorPane) -> Option<&mut EditorModel> {
        match pane {
            EditorPane::Primary => self.editor.editor.as_mut(),
            EditorPane::Secondary => self
                .editor
                .secondary_pane
                .as_mut()
                .map(|pane| &mut pane.editor),
        }
    }

    pub(crate) fn list_state_for_pane_mut(
        &mut self,
        pane: EditorPane,
    ) -> Option<&mut PaneListState> {
        match pane {
            EditorPane::Primary => Some(&mut self.editor.blocks_list_state),
            EditorPane::Secondary => self
                .editor
                .secondary_pane
                .as_mut()
                .map(|pane| &mut pane.list_state),
        }
    }

    pub(crate) fn update_block_list_for_pane(&mut self, pane: EditorPane) {
        let count = match self.editor_for_pane(pane) {
            Some(editor) => editor.blocks.len(),
            None => return,
        };
        if let Some(list_state) = self.list_state_for_pane_mut(pane) {
            list_state.set_count(count, px(BLOCK_ROW_HEIGHT));
        }
    }

    pub(crate) fn scroll_active_block_into_view(&mut self, pane: EditorPane) {
        let active_ix = match self.editor_for_pane(pane) {
            Some(editor) => editor.active_ix,
            None => return,
        };
        if let Some(list_state) = self.list_state_for_pane_mut(pane) {
            list_state
                .scroll_handle
                .scroll_to_item(active_ix, ScrollStrategy::Nearest);
        }
        if self.settings.sync_scroll {
            let other = match pane {
                EditorPane::Primary => EditorPane::Secondary,
                EditorPane::Secondary => EditorPane::Primary,
            };
            if let Some(list_state) = self.list_state_for_pane_mut(other) {
                list_state
                    .scroll_handle
                    .scroll_to_item(active_ix, ScrollStrategy::Nearest);
            }
        }
    }

    pub(crate) fn page_for_pane(&self, pane: EditorPane) -> Option<&PageRecord> {
        match pane {
            EditorPane::Primary => self.editor.active_page.as_ref(),
            EditorPane::Secondary => self.editor.secondary_pane.as_ref().map(|pane| &pane.page),
        }
    }

    pub(crate) fn set_active_pane(&mut self, pane: EditorPane, cx: &mut Context<Self>) {
        let next = if pane == EditorPane::Secondary && self.editor.secondary_pane.is_none() {
            EditorPane::Primary
        } else {
            pane
        };
        if self.editor.active_pane != next {
            self.editor.active_pane = next;
            self.close_slash_menu();
            cx.notify();
        }
    }

    pub(crate) fn sync_block_input_from_active_with_cursor(
        &mut self,
        cursor: usize,
        window: Option<&mut Window>,
        cx: &mut Context<Self>,
    ) {
        self.sync_block_input_from_active_with_cursor_for_pane(
            EditorPane::Primary,
            cursor,
            window,
            cx,
        );
    }

    pub(crate) fn sync_block_input_from_active_for_pane(
        &mut self,
        pane: EditorPane,
        window: Option<&mut Window>,
        cx: &mut Context<Self>,
    ) {
        let cursor = self
            .editor_for_pane(pane)
            .and_then(|editor| editor.blocks.get(editor.active_ix))
            .map(|block| block.text.len())
            .unwrap_or(0);
        self.sync_block_input_from_active_with_cursor_for_pane(pane, cursor, window, cx);
    }

    pub(crate) fn sync_block_input_from_active_with_cursor_for_pane(
        &mut self,
        pane: EditorPane,
        cursor: usize,
        window: Option<&mut Window>,
        cx: &mut Context<Self>,
    ) {
        let Some(editor) = self.editor_for_pane(pane) else {
            return;
        };
        if editor.active_ix >= editor.blocks.len() {
            return;
        }
        let block = &editor.blocks[editor.active_ix];
        let text = block.text.clone();
        let cursor = cursor.min(text.len());
        let block_uid = block.uid.clone();
        let input = self.editor.block_input.clone();
        let update_input = move |window: &mut Window, cx: &mut App| {
            input.update(cx, |input, cx| {
                input.set_value(text.clone(), window, cx);
                let position = input.text().offset_to_position(cursor);
                input.set_cursor_position(position, window, cx);
            });
        };
        if let Some(window) = window {
            update_input(window, cx);
        } else {
            self.with_window(cx, update_input);
        }
        self.record_page_cursor_for_pane(pane, &block_uid, cursor);
        self.scroll_active_block_into_view(pane);
        self.refresh_block_backlinks();
    }

    pub(crate) fn toggle_split_pane(&mut self, cx: &mut Context<Self>) {
        if self.editor.secondary_pane.is_some() {
            if self
                .editor
                .secondary_pane
                .as_ref()
                .is_some_and(|pane| pane.dirty)
            {
                self.save(cx);
            }
            self.editor.secondary_pane = None;
            if self.editor.active_pane == EditorPane::Secondary {
                self.editor.active_pane = EditorPane::Primary;
                self.sync_block_input_from_active_for_pane(EditorPane::Primary, None, cx);
            }
            cx.notify();
            return;
        }
        let Some(active_page) = self.editor.active_page.clone() else {
            return;
        };
        self.open_secondary_pane_for_page(&active_page.uid, cx);
    }

    pub(crate) fn open_secondary_pane_for_page(&mut self, page_uid: &str, cx: &mut Context<Self>) {
        if self
            .editor
            .secondary_pane
            .as_ref()
            .is_some_and(|pane| pane.dirty)
        {
            self.save(cx);
        }
        let Some(db) = self.app.db.as_ref() else {
            return;
        };
        let normalized = app::sanitize_kebab(page_uid);
        let Some(page) = db.get_page_by_uid(&normalized).ok().flatten() else {
            return;
        };
        let blocks = db.load_blocks_for_page(page.id).unwrap_or_default();
        let editor = EditorModel::new(blocks);
        let list_state = PaneListState::new(editor.blocks.len(), px(BLOCK_ROW_HEIGHT));
        self.editor.secondary_pane = Some(SecondaryPane {
            page,
            editor,
            list_state,
            selection: PaneSelection::new(),
            dirty: false,
        });
        self.record_recent_page(page_uid);
        if self.editor.active_pane == EditorPane::Secondary {
            self.sync_block_input_from_active_for_pane(EditorPane::Secondary, None, cx);
        }
        cx.notify();
    }

    pub(crate) fn copy_primary_to_secondary(&mut self, cx: &mut Context<Self>) {
        if self
            .editor
            .secondary_pane
            .as_ref()
            .is_some_and(|pane| pane.dirty)
        {
            self.save(cx);
        }
        let Some(active_page) = self.editor.active_page.clone() else {
            return;
        };
        let Some(editor) = self.editor.editor.as_ref() else {
            return;
        };
        let editor = editor.clone();
        let list_state = PaneListState::new(editor.blocks.len(), px(BLOCK_ROW_HEIGHT));
        let selection = PaneSelection::new();
        let dirty = self.app.primary_dirty;

        match self.editor.secondary_pane.as_mut() {
            Some(pane) => {
                pane.page = active_page;
                pane.editor = editor;
                pane.list_state = list_state;
                pane.selection = selection;
                pane.dirty = dirty;
            }
            None => {
                self.editor.secondary_pane = Some(SecondaryPane {
                    page: active_page,
                    editor,
                    list_state,
                    selection,
                    dirty,
                });
            }
        }

        self.update_save_state_from_dirty();
        self.close_slash_menu();
        if self.editor.active_pane == EditorPane::Secondary {
            self.sync_block_input_from_active_for_pane(EditorPane::Secondary, None, cx);
        }
        cx.notify();
    }

    pub(crate) fn copy_secondary_to_primary(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.app.primary_dirty {
            self.save(cx);
        }

        let (page, editor, selection, dirty) = {
            let Some(pane) = self.editor.secondary_pane.as_ref() else {
                return;
            };
            (
                pane.page.clone(),
                pane.editor.clone(),
                pane.selection.clone(),
                pane.dirty,
            )
        };

        self.editor.active_page = Some(page.clone());
        self.editor.editor = Some(editor);
        self.editor.primary_selection = selection;
        self.app.primary_dirty = dirty;
        self.editor.blocks_list_state.reset(
            self.editor
                .editor
                .as_ref()
                .map(|e| e.blocks.len())
                .unwrap_or(0),
            px(BLOCK_ROW_HEIGHT),
        );
        self.editor.active_pane = EditorPane::Primary;
        self.editor.highlighted_block_uid = None;
        self.update_save_state_from_dirty();
        self.close_slash_menu();

        if let Some(db) = self.app.db.as_mut() {
            let _ = db.set_kv("active.page", &page.uid);
        }

        self.record_recent_page(&page.uid);
        if let Some(editor) = self.editor.editor.as_mut() {
            let cursor = if let Some(page_cursor) = self.editor.page_cursors.get(&page.uid) {
                let (active_ix, offset) =
                    helpers::resolve_cursor_for_blocks(&editor.blocks, Some(page_cursor));
                editor.active_ix = active_ix;
                offset
            } else {
                editor.active().text.len()
            };
            self.sync_block_input_from_active_with_cursor_for_pane(
                EditorPane::Primary,
                cursor,
                Some(window),
                cx,
            );
        }

        window.focus(&self.editor.block_input.focus_handle(cx), cx);
        self.refresh_references();
        cx.notify();
    }

    pub(crate) fn swap_panes(&mut self, cx: &mut Context<Self>) {
        let Some(primary_page) = self.editor.active_page.take() else {
            return;
        };
        let Some(primary_editor) = self.editor.editor.take() else {
            self.editor.active_page = Some(primary_page);
            return;
        };
        let secondary_page_uid = {
            let Some(pane) = self.editor.secondary_pane.as_mut() else {
                self.editor.active_page = Some(primary_page);
                self.editor.editor = Some(primary_editor);
                return;
            };

            let mut primary_selection = PaneSelection::new();
            mem::swap(&mut primary_selection, &mut self.editor.primary_selection);

            let secondary_page = mem::replace(&mut pane.page, primary_page);
            let secondary_editor = mem::replace(&mut pane.editor, primary_editor);
            let secondary_dirty = mem::replace(&mut pane.dirty, self.app.primary_dirty);
            let secondary_selection = mem::replace(&mut pane.selection, primary_selection);

            mem::swap(&mut self.editor.blocks_list_state, &mut pane.list_state);

            self.editor.active_page = Some(secondary_page.clone());
            self.editor.editor = Some(secondary_editor);
            self.app.primary_dirty = secondary_dirty;
            self.editor.primary_selection = secondary_selection;
            self.editor.highlighted_block_uid = None;

            secondary_page.uid.clone()
        };

        if let Some(db) = self.app.db.as_mut() {
            let _ = db.set_kv("active.page", &secondary_page_uid);
        }

        self.update_save_state_from_dirty();
        self.refresh_references();
        self.close_slash_menu();
        self.sync_block_input_from_active_for_pane(self.editor.active_pane, None, cx);
        cx.notify();
    }

    pub(crate) fn toggle_split_pane_action(
        &mut self,
        _: &ToggleSplitPane,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.toggle_split_pane(cx);
    }

    pub(crate) fn insert_block_below(
        &mut self,
        _: &InsertBlockBelow,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.app.mode != Mode::Editor {
            return;
        }
        let pane = self.editor.active_pane;
        if self
            .selection_for_pane(pane)
            .is_some_and(|selection| selection.has_range())
        {
            return;
        }
        let (cursor_offset, text) = {
            let input = self.editor.block_input.read(cx);
            (input.cursor(), input.value().to_string())
        };
        let cursor = {
            let Some(editor) = self.editor_for_pane_mut(pane) else {
                return;
            };
            if editor.active_ix >= editor.blocks.len() {
                return;
            }

            if editor.blocks[editor.active_ix].text != text {
                editor.blocks[editor.active_ix].text = text;
            }

            let cursor = editor.split_active_and_insert_after(cursor_offset);
            cursor
        };
        self.update_block_list_for_pane(pane);

        self.sync_block_input_from_active_with_cursor_for_pane(
            pane,
            cursor.offset,
            Some(window),
            cx,
        );
        window.focus(&self.editor.block_input.focus_handle(cx), cx);
        self.mark_dirty_for_pane(pane, cx);
        self.schedule_references_refresh(cx);
    }

    pub(crate) fn indent_block(
        &mut self,
        _: &IndentBlock,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let pane = self.editor.active_pane;
        if self
            .selection_for_pane(pane)
            .is_some_and(|selection| selection.has_range())
        {
            self.indent_selection_in_pane(pane, cx);
            return;
        }
        let Some(editor) = self.editor_for_pane_mut(pane) else {
            return;
        };
        if editor.adjust_active_indent(1) {
            self.mark_dirty_for_pane(pane, cx);
            self.schedule_references_refresh(cx);
        }
    }

    pub(crate) fn outdent_block(
        &mut self,
        _: &OutdentBlock,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let pane = self.editor.active_pane;
        if self
            .selection_for_pane(pane)
            .is_some_and(|selection| selection.has_range())
        {
            self.outdent_selection_in_pane(pane, cx);
            return;
        }
        let Some(editor) = self.editor_for_pane_mut(pane) else {
            return;
        };
        if editor.adjust_active_indent(-1) {
            self.mark_dirty_for_pane(pane, cx);
            self.schedule_references_refresh(cx);
        }
    }

    pub(crate) fn move_block_up(
        &mut self,
        _: &MoveBlockUp,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let pane = self.editor.active_pane;
        if self
            .selection_for_pane(pane)
            .is_some_and(|selection| selection.has_range())
        {
            self.move_selection_in_pane(pane, -1, window, cx);
            return;
        }
        let Some(editor) = self.editor_for_pane_mut(pane) else {
            return;
        };
        if editor.move_active_up() {
            self.sync_block_input_from_active_for_pane(pane, Some(window), cx);
            self.mark_dirty_for_pane(pane, cx);
            self.schedule_references_refresh(cx);
        }
    }

    pub(crate) fn move_block_down(
        &mut self,
        _: &MoveBlockDown,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let pane = self.editor.active_pane;
        if self
            .selection_for_pane(pane)
            .is_some_and(|selection| selection.has_range())
        {
            self.move_selection_in_pane(pane, 1, window, cx);
            return;
        }
        let Some(editor) = self.editor_for_pane_mut(pane) else {
            return;
        };
        if editor.move_active_down() {
            self.sync_block_input_from_active_for_pane(pane, Some(window), cx);
            self.mark_dirty_for_pane(pane, cx);
            self.schedule_references_refresh(cx);
        }
    }

    pub(crate) fn duplicate_block(
        &mut self,
        _: &DuplicateBlock,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let pane = self.editor.active_pane;
        if self
            .selection_for_pane(pane)
            .is_some_and(|selection| selection.has_range())
        {
            self.duplicate_selection_in_pane(pane, window, cx);
            return;
        }
        let Some(editor) = self.editor_for_pane_mut(pane) else {
            return;
        };
        if editor.active_ix >= editor.blocks.len() {
            return;
        }
        let cursor = editor.duplicate_active();
        self.update_block_list_for_pane(pane);
        self.sync_block_input_from_active_with_cursor_for_pane(
            pane,
            cursor.offset,
            Some(window),
            cx,
        );
        window.focus(&self.editor.block_input.focus_handle(cx), cx);
        self.mark_dirty_for_pane(pane, cx);
        self.schedule_references_refresh(cx);
    }

    pub(crate) fn delete_selection_action(
        &mut self,
        _: &DeleteSelection,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let pane = self.editor.active_pane;
        if self
            .selection_for_pane(pane)
            .is_some_and(|selection| selection.has_range())
        {
            self.delete_selection_in_pane(pane, cx);
        }
    }

    pub(crate) fn clear_selection_action(
        &mut self,
        _: &ClearSelection,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let pane = self.editor.active_pane;
        if self
            .selection_for_pane(pane)
            .is_some_and(|selection| selection.has_range())
        {
            self.clear_selection_for_pane(pane);
            cx.notify();
        }
    }

    pub(crate) fn handle_block_input_key_down(
        &mut self,
        pane: EditorPane,
        event: &KeyDownEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if self.app.mode != Mode::Editor {
            return false;
        }
        if self.editor.wikilink_menu.open && self.editor.wikilink_menu.pane == pane {
            let key = event.keystroke.key.as_str();
            if key == "escape" {
                self.close_wikilink_menu();
                cx.notify();
                return true;
            }
            if key == "up" || key == "down" {
                let items = self.wikilink_menu_items();
                if !items.is_empty() {
                    let forward = key == "down";
                    self.editor.wikilink_menu.selected_index = helpers::cycle_index(
                        self.editor.wikilink_menu.selected_index,
                        items.len(),
                        forward,
                    );
                    cx.notify();
                }
                return true;
            }
            if key == "tab" {
                let items = self.wikilink_menu_items();
                if !items.is_empty() {
                    let forward = !event.keystroke.modifiers.shift;
                    self.editor.wikilink_menu.selected_index = helpers::cycle_index(
                        self.editor.wikilink_menu.selected_index,
                        items.len(),
                        forward,
                    );
                    cx.notify();
                }
                return true;
            }
            if key == "enter" {
                let items = self.wikilink_menu_items();
                if !items.is_empty() {
                    let idx = self
                        .editor
                        .wikilink_menu
                        .selected_index
                        .min(items.len().saturating_sub(1));
                    match items[idx].clone() {
                        WikilinkMenuItem::Page(page) => {
                            let label = if page.title.trim().is_empty() {
                                page.uid
                            } else {
                                page.title
                            };
                            self.apply_wikilink_suggestion(&label, false, window, cx);
                        }
                        WikilinkMenuItem::Create { query, .. } => {
                            self.apply_wikilink_suggestion(&query, true, window, cx);
                        }
                    }
                }
                return true;
            }
        }
        if self.editor.slash_menu.open && self.editor.slash_menu.pane == pane {
            let key = event.keystroke.key.as_str();
            if key == "escape" {
                self.close_slash_menu();
                cx.notify();
                return true;
            }
            if key == "up" || key == "down" {
                let commands = self.filtered_slash_commands();
                if !commands.is_empty() {
                    let len = commands.len();
                    let forward = key == "down";
                    self.editor.slash_menu.selected_index =
                        helpers::cycle_index(self.editor.slash_menu.selected_index, len, forward);
                    cx.notify();
                }
                return true;
            }
            if key == "tab" {
                let commands = self.filtered_slash_commands();
                if !commands.is_empty() {
                    let forward = !event.keystroke.modifiers.shift;
                    self.editor.slash_menu.selected_index = helpers::cycle_index(
                        self.editor.slash_menu.selected_index,
                        commands.len(),
                        forward,
                    );
                    cx.notify();
                }
                return true;
            }
            if key == "enter" {
                if let Some((command_id, _)) = self.selected_slash_command() {
                    self.apply_slash_command(command_id, window, cx);
                }
                return true;
            }
        }
        if event.keystroke.modifiers.modified() {
            return false;
        }
        if self
            .selection_for_pane(pane)
            .is_some_and(|selection| selection.has_range())
        {
            return false;
        }

        let (cursor_offset, text_len) = {
            let input = self.editor.block_input.read(cx);
            (input.cursor(), input.text().len())
        };

        match event.keystroke.key.as_str() {
            "backspace" if cursor_offset == 0 => {
                let current_text = self.editor.block_input.read(cx).value().to_string();
                let cursor = {
                    let Some(editor) = self.editor_for_pane_mut(pane) else {
                        return false;
                    };
                    if editor.active_ix >= editor.blocks.len() {
                        return false;
                    }

                    let old_ix = editor.active_ix;
                    if editor.blocks[old_ix].text != current_text {
                        editor.blocks[old_ix].text = current_text.clone();
                    }

                    let cursor = if current_text.is_empty() {
                        editor.delete_active_if_empty()
                    } else {
                        editor.merge_active_into_previous()
                    };

                    let Some(cursor) = cursor else {
                        return false;
                    };
                    cursor
                };

                self.update_block_list_for_pane(pane);
                self.sync_block_input_from_active_with_cursor_for_pane(
                    pane,
                    cursor.offset,
                    Some(window),
                    cx,
                );
                self.close_slash_menu();
                self.mark_dirty_for_pane(pane, cx);
                self.schedule_references_refresh(cx);
                true
            }
            "delete" if cursor_offset == text_len => {
                let (cursor_offset, current_text) = {
                    let input = self.editor.block_input.read(cx);
                    (input.cursor(), input.value().to_string())
                };
                let cursor = {
                    let Some(editor) = self.editor_for_pane_mut(pane) else {
                        return false;
                    };
                    if editor.active_ix >= editor.blocks.len() {
                        return false;
                    }

                    let old_ix = editor.active_ix;
                    let next_ix = old_ix + 1;
                    if next_ix >= editor.blocks.len() {
                        return false;
                    }

                    if editor.blocks[old_ix].text != current_text {
                        editor.blocks[old_ix].text = current_text;
                    }

                    let Some(cursor) = editor.merge_next_into_active(cursor_offset) else {
                        return false;
                    };
                    cursor
                };

                self.update_block_list_for_pane(pane);
                self.sync_block_input_from_active_with_cursor_for_pane(
                    pane,
                    cursor.offset,
                    Some(window),
                    cx,
                );
                self.close_slash_menu();
                self.mark_dirty_for_pane(pane, cx);
                self.schedule_references_refresh(cx);
                true
            }
            "up" if cursor_offset == 0 => {
                let cursor = {
                    let Some(editor) = self.editor_for_pane_mut(pane) else {
                        return false;
                    };
                    if editor.active_ix == 0 {
                        return false;
                    }
                    editor.active_ix -= 1;
                    editor.blocks[editor.active_ix].text.len()
                };

                self.sync_block_input_from_active_with_cursor_for_pane(
                    pane,
                    cursor,
                    Some(window),
                    cx,
                );
                self.close_slash_menu();
                cx.notify();
                true
            }
            "down" if cursor_offset == text_len => {
                let has_next = {
                    let Some(editor) = self.editor_for_pane_mut(pane) else {
                        return false;
                    };
                    let next_ix = editor.active_ix + 1;
                    if next_ix >= editor.blocks.len() {
                        return false;
                    }
                    editor.active_ix = next_ix;
                    true
                };

                if has_next {
                    self.sync_block_input_from_active_with_cursor_for_pane(
                        pane,
                        0,
                        Some(window),
                        cx,
                    );
                }
                self.close_slash_menu();
                cx.notify();
                true
            }
            _ => false,
        }
    }

    pub(crate) fn on_click_page(
        &mut self,
        uid: String,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.open_page(&uid, cx);
    }

    pub(crate) fn on_click_block_in_pane(
        &mut self,
        pane: EditorPane,
        ix: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.set_active_pane(pane, cx);
        {
            let Some(editor) = self.editor_for_pane_mut(pane) else {
                return;
            };
            if ix >= editor.blocks.len() {
                return;
            }
            editor.active_ix = ix;
        }
        self.sync_block_input_from_active_for_pane(pane, Some(window), cx);
        window.focus(&self.editor.block_input.focus_handle(cx), cx);
        self.close_slash_menu();
        cx.notify();
    }

    pub(crate) fn on_click_block_with_event_in_pane(
        &mut self,
        pane: EditorPane,
        ix: usize,
        event: &gpui::ClickEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.app.mode != Mode::Editor {
            return;
        }
        self.set_active_pane(pane, cx);

        if let Some(selection) = self.selection_for_pane_mut(pane) {
            if selection.drag_completed {
                selection.drag_completed = false;
                return;
            }

            if event.modifiers().shift {
                let anchor = selection.anchor.unwrap_or(ix);
                selection.set_range(anchor, ix);
                if selection.has_range() {
                    selection.drag_completed = true;
                }
                cx.notify();
                return;
            }

            if selection.has_range() {
                self.clear_selection_for_pane(pane);
            }
            if let Some(selection) = self.selection_for_pane_mut(pane) {
                selection.anchor = Some(ix);
            }
        }
        self.on_click_block_in_pane(pane, ix, window, cx);
    }

    pub(crate) fn focus_block_by_uid(
        &mut self,
        block_uid: &str,
        window: Option<&mut Window>,
        cx: &mut Context<Self>,
    ) -> bool {
        self.focus_block_by_uid_in_pane(EditorPane::Primary, block_uid, window, cx)
    }

    pub(crate) fn focus_block_by_uid_in_pane(
        &mut self,
        pane: EditorPane,
        block_uid: &str,
        window: Option<&mut Window>,
        cx: &mut Context<Self>,
    ) -> bool {
        let ix = {
            let Some(editor) = self.editor_for_pane(pane) else {
                return false;
            };
            let Some(ix) = editor
                .blocks
                .iter()
                .position(|block| block.uid == block_uid)
            else {
                return false;
            };
            ix
        };
        if let Some(editor) = self.editor_for_pane_mut(pane) {
            editor.active_ix = ix;
        }
        self.set_active_pane(pane, cx);
        match window {
            Some(window) => {
                self.sync_block_input_from_active_for_pane(pane, Some(window), cx);
                window.focus(&self.editor.block_input.focus_handle(cx), cx);
            }
            None => {
                self.sync_block_input_from_active_for_pane(pane, None, cx);
            }
        }
        self.clear_selection_for_pane(pane);
        self.close_slash_menu();
        true
    }

    pub(crate) fn open_page_and_focus_block(
        &mut self,
        page_uid: &str,
        block_uid: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.set_mode(Mode::Editor, cx);
        self.open_page(page_uid, cx);
        if self.focus_block_by_uid(block_uid, Some(window), cx) {
            self.editor.highlighted_block_uid = Some(block_uid.to_string());
            self.schedule_highlight_clear(cx);
        }
    }

    pub(crate) fn insert_block_after_in_pane(
        &mut self,
        pane: EditorPane,
        ix: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let cursor = {
            let Some(editor) = self.editor_for_pane_mut(pane) else {
                return;
            };
            if ix >= editor.blocks.len() {
                return;
            }
            editor.active_ix = ix;
            editor.insert_after_active(String::new())
        };
        self.update_block_list_for_pane(pane);
        self.sync_block_input_from_active_with_cursor_for_pane(
            pane,
            cursor.offset,
            Some(window),
            cx,
        );
        window.focus(&self.editor.block_input.focus_handle(cx), cx);
        self.mark_dirty_for_pane(pane, cx);
        self.schedule_references_refresh(cx);
    }

    pub(crate) fn duplicate_block_at_in_pane(
        &mut self,
        pane: EditorPane,
        ix: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let cursor = {
            let Some(editor) = self.editor_for_pane_mut(pane) else {
                return;
            };
            if ix >= editor.blocks.len() {
                return;
            }
            editor.active_ix = ix;
            editor.duplicate_active()
        };
        self.update_block_list_for_pane(pane);
        self.sync_block_input_from_active_with_cursor_for_pane(
            pane,
            cursor.offset,
            Some(window),
            cx,
        );
        window.focus(&self.editor.block_input.focus_handle(cx), cx);
        self.mark_dirty_for_pane(pane, cx);
        self.schedule_references_refresh(cx);
    }

    pub(crate) fn add_review_from_block_in_pane(
        &mut self,
        pane: EditorPane,
        ix: usize,
        cx: &mut Context<Self>,
    ) {
        let Some(editor) = self.editor_for_pane(pane) else {
            return;
        };
        let Some(active_page) = self.page_for_pane(pane) else {
            return;
        };
        let Some(db) = self.app.db.as_ref() else {
            return;
        };
        if ix >= editor.blocks.len() {
            return;
        }
        let block_uid = editor.blocks[ix].uid.clone();
        let now = now_millis();
        let _ = db.upsert_review_queue_item(&active_page.uid, &block_uid, now, None);
        if self.app.mode == Mode::Review {
            self.load_review_items(cx);
        }
    }

    pub(crate) fn link_block_to_page_in_pane(
        &mut self,
        pane: EditorPane,
        ix: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(editor) = self.editor_for_pane_mut(pane) else {
            return;
        };
        if ix >= editor.blocks.len() {
            return;
        }
        editor.active_ix = ix;
        let current = editor.blocks[ix].text.clone();
        let separator = if current.ends_with(' ') || current.is_empty() {
            ""
        } else {
            " "
        };
        let next_text = format!("{current}{separator}[[Page]]");
        let next_cursor = next_text.len();
        editor.blocks[ix].text = next_text.clone();
        self.editor.block_input.update(cx, |input, cx| {
            input.set_value(next_text.clone(), window, cx);
            let position = input.text().offset_to_position(next_cursor);
            input.set_cursor_position(position, window, cx);
        });
        window.focus(&self.editor.block_input.focus_handle(cx), cx);
        self.mark_dirty_for_pane(pane, cx);
        self.schedule_references_refresh(cx);
    }

    pub(crate) fn link_unlinked_reference(
        &mut self,
        reference: &UnlinkedReference,
        cx: &mut Context<Self>,
    ) {
        let Some(editor) = self.editor.editor.as_mut() else {
            return;
        };
        let Some(ix) = editor
            .blocks
            .iter()
            .position(|block| block.uid == reference.block_uid)
        else {
            return;
        };
        let text = editor.blocks[ix].text.clone();
        let title = reference.page_title.trim();
        if title.is_empty() {
            return;
        }
        let cursor = if editor.active_ix == ix {
            self.editor.block_input.read(cx).cursor()
        } else {
            text.len()
        };
        let Some((next_text, next_cursor)) =
            helpers::link_first_unlinked_reference(&text, title, cursor)
        else {
            return;
        };
        editor.blocks[ix].text = next_text.clone();
        if editor.active_ix == ix {
            let block_input = self.editor.block_input.clone();
            self.with_window(cx, move |window, cx| {
                block_input.update(cx, |input, cx| {
                    input.set_value(next_text.clone(), window, cx);
                    let position = input.text().offset_to_position(next_cursor);
                    input.set_cursor_position(position, window, cx);
                });
            });
        }
        self.mark_dirty_for_pane(EditorPane::Primary, cx);
        self.schedule_references_refresh(cx);
    }

    pub(crate) fn duplicate_selection_in_pane(
        &mut self,
        pane: EditorPane,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(range) = self.selected_range_for_pane(pane) else {
            return;
        };
        let (insert_range, insert_count) = {
            let Some(editor) = self.editor_for_pane_mut(pane) else {
                return;
            };
            let insert_range = match editor.duplicate_range(range.clone()) {
                Some(range) => range,
                None => return,
            };
            let insert_count = insert_range.end.saturating_sub(insert_range.start);
            if insert_count > 0 {
                editor.active_ix = insert_range.start;
            }
            (insert_range, insert_count)
        };
        self.update_block_list_for_pane(pane);
        if insert_count > 0 {
            let new_start = insert_range.start;
            let new_end = insert_range.end.saturating_sub(1);
            self.set_selection_range_for_pane(pane, new_start, new_end);
            self.sync_block_input_from_active_for_pane(pane, Some(window), cx);
            window.focus(&self.editor.block_input.focus_handle(cx), cx);
        }
        self.mark_dirty_for_pane(pane, cx);
        self.schedule_references_refresh(cx);
    }

    pub(crate) fn delete_selection_in_pane(&mut self, pane: EditorPane, cx: &mut Context<Self>) {
        let Some(range) = self.selected_range_for_pane(pane) else {
            return;
        };
        let Some(editor) = self.editor_for_pane_mut(pane) else {
            return;
        };
        let cursor = match editor.delete_range(range.clone()) {
            Some(cursor) => cursor,
            None => return,
        };
        self.update_block_list_for_pane(pane);
        self.clear_selection_for_pane(pane);
        self.sync_block_input_from_active_for_pane(pane, None, cx);
        let block_input = self.editor.block_input.clone();
        let cursor_offset = cursor.offset;
        self.with_window(cx, move |window, cx| {
            block_input.update(cx, |input, cx| {
                let position = input.text().offset_to_position(cursor_offset);
                input.set_cursor_position(position, window, cx);
            });
        });
        self.mark_dirty_for_pane(pane, cx);
        self.schedule_references_refresh(cx);
        cx.notify();
    }

    pub(crate) fn indent_selection_in_pane(&mut self, pane: EditorPane, cx: &mut Context<Self>) {
        let Some(range) = self.selected_range_for_pane(pane) else {
            return;
        };
        let Some(editor) = self.editor_for_pane_mut(pane) else {
            return;
        };
        if editor.adjust_range_indent(range, 1) {
            self.mark_dirty_for_pane(pane, cx);
            self.schedule_references_refresh(cx);
        }
    }

    pub(crate) fn outdent_selection_in_pane(&mut self, pane: EditorPane, cx: &mut Context<Self>) {
        let Some(range) = self.selected_range_for_pane(pane) else {
            return;
        };
        let Some(editor) = self.editor_for_pane_mut(pane) else {
            return;
        };
        if editor.adjust_range_indent(range, -1) {
            self.mark_dirty_for_pane(pane, cx);
            self.schedule_references_refresh(cx);
        }
    }

    pub(crate) fn move_selection_in_pane(
        &mut self,
        pane: EditorPane,
        direction: i32,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(range) = self.selected_range_for_pane(pane) else {
            return;
        };
        let new_range = {
            let Some(editor) = self.editor_for_pane_mut(pane) else {
                return;
            };
            let new_range = match editor.move_range(range.clone(), direction) {
                Some(range) => range,
                None => return,
            };
            editor.active_ix = new_range.start;
            new_range
        };
        if new_range.end > 0 {
            self.set_selection_range_for_pane(pane, new_range.start, new_range.end - 1);
        }
        self.sync_block_input_from_active_for_pane(pane, Some(window), cx);
        window.focus(&self.editor.block_input.focus_handle(cx), cx);
        self.mark_dirty_for_pane(pane, cx);
        self.schedule_references_refresh(cx);
        cx.notify();
    }

    pub(crate) fn add_capture(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let text = self
            .editor
            .capture_input
            .read(cx)
            .value()
            .trim()
            .to_string();
        if text.is_empty() {
            return;
        }

        let (text, uid) = {
            let Some(editor) = self.editor.editor.as_mut() else {
                return;
            };

            let block = BlockSnapshot {
                uid: Uuid::new_v4().to_string(),
                text,
                indent: 0,
            };
            let uid = block.uid.clone();

            editor.blocks.insert(0, block);
            editor.active_ix = 0;

            let text = editor.blocks[0].text.clone();
            (text, uid)
        };
        self.update_block_list_for_pane(EditorPane::Primary);

        let cursor = text.len();
        self.editor.block_input.update(cx, |input, cx| {
            input.set_value(text.clone(), window, cx);
            let position = input.text().offset_to_position(cursor);
            input.set_cursor_position(position, window, cx);
        });

        self.editor.capture_input.update(cx, |input, cx| {
            input.set_value("", window, cx);
        });

        self.set_mode(Mode::Editor, cx);
        self.editor.active_pane = EditorPane::Primary;
        window.focus(&self.editor.block_input.focus_handle(cx), cx);

        self.ui.capture_confirmation = Some("Captured".into());
        self.schedule_capture_confirmation_clear(cx);
        self.editor.highlighted_block_uid = Some(uid);
        self.schedule_highlight_clear(cx);
        self.mark_dirty_for_pane(EditorPane::Primary, cx);
        self.schedule_references_refresh(cx);
    }

    pub(crate) fn update_slash_menu(
        &mut self,
        pane: EditorPane,
        block_uid: &str,
        block_ix: usize,
        cursor: usize,
        text: &str,
        cx: &mut Context<Self>,
    ) {
        if self.app.mode != Mode::Editor {
            self.close_slash_menu();
            return;
        }
        let Some(match_query) = helpers::find_slash_query(text, cursor) else {
            self.close_slash_menu();
            return;
        };
        if match_query.slash_index >= text.len() {
            self.close_slash_menu();
            return;
        }
        if !text.is_char_boundary(match_query.slash_index) {
            self.close_slash_menu();
            return;
        }

        if self.app.mode == Mode::Editor {
            self.editor.slash_menu = SlashMenuState {
                open: true,
                pane,
                block_uid: Some(block_uid.to_string()),
                block_ix: Some(block_ix),
                slash_index: Some(match_query.slash_index),
                query: match_query.query,
                selected_index: 0,
            };
        } else {
            self.editor.slash_menu = SlashMenuState::closed();
        }
        cx.notify();
    }

    pub(crate) fn close_slash_menu(&mut self) {
        self.editor.slash_menu = SlashMenuState::closed();
    }

    pub(crate) fn update_wikilink_menu(
        &mut self,
        pane: EditorPane,
        block_uid: &str,
        block_ix: usize,
        cursor: usize,
        text: &str,
        cx: &mut Context<Self>,
    ) {
        if self.app.mode != Mode::Editor {
            self.close_wikilink_menu();
            return;
        }
        let Some(query) = helpers::find_wikilink_query(text, cursor) else {
            self.close_wikilink_menu();
            return;
        };

        let selected_index =
            if self.editor.wikilink_menu.open && self.editor.wikilink_menu.query == query.query {
                self.editor.wikilink_menu.selected_index
            } else {
                0
            };

        self.editor.wikilink_menu = WikilinkMenuState {
            open: true,
            pane,
            block_uid: Some(block_uid.to_string()),
            block_ix: Some(block_ix),
            range_start: Some(query.range_start),
            range_end: Some(query.range_end),
            has_closing: query.has_closing,
            query: query.query,
            selected_index,
        };
        self.close_slash_menu();
        cx.notify();
    }

    pub(crate) fn close_wikilink_menu(&mut self) {
        self.editor.wikilink_menu = WikilinkMenuState::closed();
    }

    pub(crate) fn filtered_slash_commands(&self) -> Vec<(&'static str, &'static str)> {
        helpers::filter_slash_commands(&self.editor.slash_menu.query, SLASH_COMMANDS)
    }

    fn selected_slash_command(&mut self) -> Option<(&'static str, &'static str)> {
        let commands = self.filtered_slash_commands();
        if commands.is_empty() {
            return None;
        }
        if self.editor.slash_menu.selected_index >= commands.len() {
            self.editor.slash_menu.selected_index = 0;
        }
        commands.get(self.editor.slash_menu.selected_index).copied()
    }

    pub(crate) fn block_input_cursor_x(
        &self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> gpui::Pixels {
        let input = self.editor.block_input.read(cx);
        let text = input.value().to_string();
        let mut cursor = input.cursor();
        if cursor > text.len() {
            cursor = text.len();
        }
        while cursor > 0 && !text.is_char_boundary(cursor) {
            cursor -= 1;
        }

        let text_style = window.text_style();
        let font_size = text_style.font_size.to_pixels(window.rem_size());
        let display_text: SharedString = text.clone().into();
        let run = TextRun {
            len: display_text.len(),
            font: text_style.font(),
            color: text_style.color,
            background_color: None,
            underline: None,
            strikethrough: None,
        };
        let line = window
            .text_system()
            .shape_line(display_text, font_size, &[run], None);
        line.x_for_index(cursor)
    }

    fn filtered_wikilink_pages(&self) -> Vec<PageRecord> {
        let query = self.editor.wikilink_menu.query.trim().to_lowercase();
        if query.is_empty() {
            return self.editor.pages.clone();
        }
        self.editor
            .pages
            .iter()
            .filter(|page| {
                let title = page.title.to_lowercase();
                let uid = page.uid.to_lowercase();
                title.contains(&query) || uid.contains(&query)
            })
            .cloned()
            .collect()
    }

    fn wikilink_create_label(&self) -> Option<String> {
        let query = self.editor.wikilink_menu.query.trim();
        if query.is_empty() {
            return None;
        }
        let normalized = app::sanitize_kebab(query);
        let exists = self.editor.pages.iter().any(|page| {
            app::sanitize_kebab(&page.uid) == normalized
                || app::sanitize_kebab(&page.title) == normalized
        });
        if exists {
            None
        } else {
            Some(format!("Create page \"{query}\""))
        }
    }

    pub(crate) fn wikilink_menu_items(&self) -> Vec<WikilinkMenuItem> {
        let mut items = self
            .filtered_wikilink_pages()
            .into_iter()
            .map(WikilinkMenuItem::Page)
            .collect::<Vec<_>>();
        if let Some(label) = self.wikilink_create_label() {
            items.push(WikilinkMenuItem::Create {
                label,
                query: self.editor.wikilink_menu.query.trim().to_string(),
            });
        }
        items
    }

    pub(crate) fn apply_wikilink_suggestion(
        &mut self,
        title: &str,
        create: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let pane = self.editor.wikilink_menu.pane;
        let expected_uid = self.editor.wikilink_menu.block_uid.clone();
        let Some(block_ix) = self.editor.wikilink_menu.block_ix else {
            return;
        };
        let Some(range_start) = self.editor.wikilink_menu.range_start else {
            return;
        };
        let Some(range_end) = self.editor.wikilink_menu.range_end else {
            return;
        };
        let has_closing = self.editor.wikilink_menu.has_closing;
        let Some(editor) = self.editor_for_pane_mut(pane) else {
            return;
        };
        if block_ix >= editor.blocks.len() {
            return;
        }
        if expected_uid
            .as_ref()
            .is_some_and(|uid| &editor.blocks[block_ix].uid != uid)
        {
            return;
        }
        let text = editor.blocks[block_ix].text.clone();
        if range_start >= text.len() || range_end > text.len() || range_start >= range_end {
            return;
        }
        if !text.is_char_boundary(range_start) || !text.is_char_boundary(range_end) {
            return;
        }

        let inner_start = range_start + 2;
        let inner_end = if has_closing {
            range_end.saturating_sub(2)
        } else {
            range_end
        };
        if inner_start > inner_end || inner_end > text.len() {
            return;
        }
        let before = text[..range_start].to_string();
        let inner = text[inner_start..inner_end].to_string();
        let after = text[range_end..].to_string();

        let mut parts = inner.splitn(2, '|');
        let before_alias = parts.next().unwrap_or("").trim();
        let alias = parts
            .next()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty());
        let mut target_parts = before_alias.splitn(2, '#');
        let _target_base = target_parts.next().unwrap_or("").trim();
        let heading = target_parts
            .next()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty());

        let heading_suffix = heading.map(|value| format!("#{value}")).unwrap_or_default();
        let alias_suffix = alias.map(|value| format!("|{value}")).unwrap_or_default();
        let trimmed_title = title.trim();
        let next_inner = format!("{trimmed_title}{heading_suffix}{alias_suffix}");
        let next_text = format!("{before}[[{next_inner}]]{after}");
        let next_cursor = before.len() + 2 + next_inner.len() + 2;

        editor.blocks[block_ix].text = next_text.clone();
        editor.active_ix = block_ix;
        self.set_active_pane(pane, cx);
        self.editor.block_input.update(cx, |input, cx| {
            input.set_value(next_text.clone(), window, cx);
            let position = input.text().offset_to_position(next_cursor);
            input.set_cursor_position(position, window, cx);
        });
        window.focus(&self.editor.block_input.focus_handle(cx), cx);
        self.close_wikilink_menu();
        self.mark_dirty_for_pane(pane, cx);
        self.schedule_references_refresh(cx);

        if create {
            self.create_page_from_link(trimmed_title);
        }
    }

    fn create_page_from_link(&mut self, title: &str) {
        let Some(db) = self.app.db.as_mut() else {
            return;
        };
        let trimmed = title.trim();
        if trimmed.is_empty() {
            return;
        }
        let normalized = app::sanitize_kebab(trimmed);
        let exists = self.editor.pages.iter().any(|page| {
            app::sanitize_kebab(&page.uid) == normalized
                || app::sanitize_kebab(&page.title) == normalized
        });
        if exists {
            return;
        }
        let Ok(uid) = app::resolve_unique_page_uid(db, trimmed) else {
            return;
        };
        if db.insert_page(&uid, trimmed).is_err() {
            return;
        }
        if let Ok(pages) = db.list_pages() {
            self.editor.pages = pages;
            self.refresh_search_results();
        }
    }

    pub(crate) fn apply_wikilink_updates(
        &mut self,
        updated_blocks: &HashMap<String, String>,
        cx: &mut Context<Self>,
    ) {
        if updated_blocks.is_empty() {
            return;
        }
        let mut primary_changed = false;
        if let Some(editor) = self.editor.editor.as_mut() {
            for block in editor.blocks.iter_mut() {
                if let Some(next) = updated_blocks.get(&block.uid) {
                    if block.text != *next {
                        block.text = next.clone();
                        primary_changed = true;
                    }
                }
            }
        }

        let mut secondary_changed = false;
        if let Some(pane) = self.editor.secondary_pane.as_mut() {
            for block in pane.editor.blocks.iter_mut() {
                if let Some(next) = updated_blocks.get(&block.uid) {
                    if block.text != *next {
                        block.text = next.clone();
                        secondary_changed = true;
                    }
                }
            }
        }

        match self.editor.active_pane {
            EditorPane::Primary if primary_changed => {
                self.sync_block_input_from_active_for_pane(EditorPane::Primary, None, cx);
            }
            EditorPane::Secondary if secondary_changed => {
                self.sync_block_input_from_active_for_pane(EditorPane::Secondary, None, cx);
            }
            _ => {}
        }
    }

    pub(crate) fn open_link_preview(
        &mut self,
        target_title: &str,
        position: Point<Pixels>,
        cx: &mut Context<Self>,
    ) {
        let trimmed = target_title.trim();
        if trimmed.is_empty() {
            return;
        }

        let (page_uid, title) = match self.find_page_by_title(trimmed) {
            Some(page) => (page.uid.clone(), page.title.clone()),
            None => (app::sanitize_kebab(trimmed), trimmed.to_string()),
        };
        let position = point(position.x, position.y + px(12.0));

        if let Some(preview) = self.editor.link_preview.as_mut() {
            if preview.open && preview.page_uid == page_uid {
                preview.position = position;
                preview.title = title.clone();
                cx.notify();
                return;
            }
        }

        self.editor.link_preview_epoch += 1;
        let epoch = self.editor.link_preview_epoch;

        if let Some(cache) = self.editor.link_preview_cache.get(&page_uid).cloned() {
            self.editor.link_preview = Some(LinkPreviewState {
                open: true,
                page_uid,
                title: cache.title,
                blocks: cache.blocks,
                position,
                loading: false,
            });
            cx.notify();
            return;
        }

        self.editor.link_preview = Some(LinkPreviewState {
            open: true,
            page_uid: page_uid.clone(),
            title: title.clone(),
            blocks: Vec::new(),
            position,
            loading: true,
        });
        cx.notify();

        cx.spawn(async move |this, cx| {
            this.update(cx, |this, cx| {
                if this.editor.link_preview_epoch != epoch {
                    return;
                }
                let Some(db) = this.app.db.as_ref() else {
                    if let Some(preview) = this.editor.link_preview.as_mut() {
                        preview.loading = false;
                    }
                    return;
                };
                let Some(page) = db.get_page_by_uid(&page_uid).ok().flatten() else {
                    if let Some(preview) = this.editor.link_preview.as_mut() {
                        preview.loading = false;
                    }
                    return;
                };
                let blocks = db
                    .load_blocks_for_page(page.id)
                    .unwrap_or_default()
                    .into_iter()
                    .map(|block| block.text)
                    .filter(|text| !text.trim().is_empty())
                    .take(2)
                    .collect::<Vec<_>>();
                this.editor.link_preview_cache.insert(
                    page_uid.clone(),
                    LinkPreviewCacheEntry {
                        title: page.title.clone(),
                        blocks: blocks.clone(),
                    },
                );
                if let Some(preview) = this.editor.link_preview.as_mut() {
                    if preview.page_uid == page_uid {
                        preview.title = page.title.clone();
                        preview.blocks = blocks;
                        preview.loading = false;
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    pub(crate) fn schedule_link_preview_close(&mut self, cx: &mut Context<Self>) {
        self.editor.link_preview_close_epoch += 1;
        let epoch = self.editor.link_preview_close_epoch;
        cx.spawn(async move |this, cx| {
            cx.background_executor()
                .timer(Duration::from_millis(LINK_PREVIEW_CLOSE_DELAY_MS))
                .await;
            this.update(cx, |this, cx| {
                if this.editor.link_preview_close_epoch != epoch {
                    return;
                }
                this.editor.link_preview = None;
                this.editor.link_preview_hovering_link = false;
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    pub(crate) fn keep_link_preview_open(&mut self) {
        self.editor.link_preview_close_epoch += 1;
    }

    fn find_page_by_title(&self, title: &str) -> Option<PageRecord> {
        let normalized = app::sanitize_kebab(title);
        self.editor
            .pages
            .iter()
            .find(|page| app::sanitize_kebab(&page.uid) == normalized)
            .cloned()
            .or_else(|| {
                self.editor
                    .pages
                    .iter()
                    .find(|page| page.title.eq_ignore_ascii_case(title))
                    .cloned()
            })
    }

    pub(crate) fn apply_slash_command(
        &mut self,
        command_id: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let pane = self.editor.slash_menu.pane;
        let expected_uid = self.editor.slash_menu.block_uid.clone();
        let Some(block_ix) = self.editor.slash_menu.block_ix else {
            return;
        };
        let Some(slash_index) = self.editor.slash_menu.slash_index else {
            return;
        };
        let query = self.editor.slash_menu.query.clone();
        let Some(editor) = self.editor_for_pane_mut(pane) else {
            return;
        };
        if block_ix >= editor.blocks.len() {
            return;
        }
        if expected_uid
            .as_ref()
            .is_some_and(|uid| &editor.blocks[block_ix].uid != uid)
        {
            return;
        }

        let text = editor.blocks[block_ix].text.clone();
        let command_end = slash_index + 1 + query.len();
        if slash_index >= text.len() || command_end > text.len() {
            return;
        }
        if !text.is_char_boundary(slash_index) || !text.is_char_boundary(command_end) {
            return;
        }
        if !text[slash_index + 1..command_end].eq(query.as_str()) {
            return;
        }

        let before = text[..slash_index].to_string();
        let after = text[command_end..].to_string();
        let today = Local::now().format("%Y-%m-%d").to_string();
        let (next_text, next_cursor) =
            helpers::apply_slash_command_text(command_id, &before, &after, &today);

        editor.blocks[block_ix].text = next_text.clone();
        editor.active_ix = block_ix;
        self.set_active_pane(pane, cx);
        self.editor.block_input.update(cx, |input, cx| {
            input.set_value(next_text.clone(), window, cx);
            let position = input.text().offset_to_position(next_cursor);
            input.set_cursor_position(position, window, cx);
        });
        window.focus(&self.editor.block_input.focus_handle(cx), cx);
        self.close_slash_menu();
        self.mark_dirty_for_pane(pane, cx);
        self.schedule_references_refresh(cx);
    }
}
