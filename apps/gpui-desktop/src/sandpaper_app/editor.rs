use super::*;
use super::helpers::now_millis;

impl SandpaperApp {
    pub(super) fn with_window(
        &self,
        cx: &mut Context<Self>,
        f: impl FnOnce(&mut Window, &mut App),
    ) {
        let _ = cx.update_window(self.window_handle, |_, window, cx| f(window, cx));
    }

    pub(super) fn record_page_cursor_for_pane(
        &mut self,
        pane: EditorPane,
        block_uid: &str,
        cursor: usize,
    ) {
        let Some(page) = self.page_for_pane(pane) else {
            return;
        };
        self.page_cursors.insert(
            page.uid.clone(),
            helpers::PageCursor {
                block_uid: block_uid.to_string(),
                cursor_offset: cursor,
            },
        );
    }

    pub(super) fn record_recent_page(&mut self, page_uid: &str) {
        self.recent_pages.retain(|uid| uid != page_uid);
        self.recent_pages.insert(0, page_uid.to_string());
        if self.recent_pages.len() > 24 {
            self.recent_pages.truncate(24);
        }
    }

    pub(super) fn selection_for_pane(&self, pane: EditorPane) -> Option<&PaneSelection> {
        match pane {
            EditorPane::Primary => Some(&self.primary_selection),
            EditorPane::Secondary => self.secondary_pane.as_ref().map(|pane| &pane.selection),
        }
    }

    pub(super) fn selection_for_pane_mut(&mut self, pane: EditorPane) -> Option<&mut PaneSelection> {
        match pane {
            EditorPane::Primary => Some(&mut self.primary_selection),
            EditorPane::Secondary => self.secondary_pane.as_mut().map(|pane| &mut pane.selection),
        }
    }

    pub(super) fn clear_selection_for_pane(&mut self, pane: EditorPane) {
        if let Some(selection) = self.selection_for_pane_mut(pane) {
            selection.clear();
        }
    }

    pub(super) fn clear_all_selections(&mut self) {
        self.primary_selection.clear();
        if let Some(pane) = self.secondary_pane.as_mut() {
            pane.selection.clear();
        }
    }

    pub(super) fn set_selection_range_for_pane(&mut self, pane: EditorPane, start: usize, end: usize) {
        if let Some(selection) = self.selection_for_pane_mut(pane) {
            selection.set_range(start, end);
        }
    }

    pub(super) fn selected_range_for_pane(&self, pane: EditorPane) -> Option<std::ops::Range<usize>> {
        self.selection_for_pane(pane)
            .and_then(|selection| selection.selected_range())
    }

    pub(super) fn editor_for_pane(&self, pane: EditorPane) -> Option<&EditorModel> {
        match pane {
            EditorPane::Primary => self.editor.as_ref(),
            EditorPane::Secondary => self.secondary_pane.as_ref().map(|pane| &pane.editor),
        }
    }

    pub(super) fn editor_for_pane_mut(&mut self, pane: EditorPane) -> Option<&mut EditorModel> {
        match pane {
            EditorPane::Primary => self.editor.as_mut(),
            EditorPane::Secondary => self.secondary_pane.as_mut().map(|pane| &mut pane.editor),
        }
    }

    pub(super) fn list_state_for_pane_mut(&mut self, pane: EditorPane) -> Option<&mut PaneListState> {
        match pane {
            EditorPane::Primary => Some(&mut self.blocks_list_state),
            EditorPane::Secondary => self.secondary_pane.as_mut().map(|pane| &mut pane.list_state),
        }
    }

    pub(super) fn update_block_list_for_pane(&mut self, pane: EditorPane) {
        let count = match self.editor_for_pane(pane) {
            Some(editor) => editor.blocks.len(),
            None => return,
        };
        if let Some(list_state) = self.list_state_for_pane_mut(pane) {
            list_state.set_count(count, px(BLOCK_ROW_HEIGHT));
        }
    }

    pub(super) fn scroll_active_block_into_view(&mut self, pane: EditorPane) {
        let active_ix = match self.editor_for_pane(pane) {
            Some(editor) => editor.active_ix,
            None => return,
        };
        if let Some(list_state) = self.list_state_for_pane_mut(pane) {
            list_state
                .scroll_handle
                .scroll_to_item(active_ix, ScrollStrategy::Nearest);
        }
        if self.sync_scroll {
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

    pub(super) fn page_for_pane(&self, pane: EditorPane) -> Option<&PageRecord> {
        match pane {
            EditorPane::Primary => self.active_page.as_ref(),
            EditorPane::Secondary => self.secondary_pane.as_ref().map(|pane| &pane.page),
        }
    }

    pub(super) fn set_active_pane(&mut self, pane: EditorPane, cx: &mut Context<Self>) {
        let next = if pane == EditorPane::Secondary && self.secondary_pane.is_none() {
            EditorPane::Primary
        } else {
            pane
        };
        if self.active_pane != next {
            self.active_pane = next;
            self.close_slash_menu();
            cx.notify();
        }
    }

    pub(super) fn sync_block_input_from_active_with_cursor(
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

    pub(super) fn sync_block_input_from_active_for_pane(
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

    pub(super) fn sync_block_input_from_active_with_cursor_for_pane(
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
        let input = self.block_input.clone();
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

    pub(super) fn toggle_split_pane(&mut self, cx: &mut Context<Self>) {
        if self.secondary_pane.is_some() {
            if self
                .secondary_pane
                .as_ref()
                .is_some_and(|pane| pane.dirty)
            {
                self.save(cx);
            }
            self.secondary_pane = None;
            if self.active_pane == EditorPane::Secondary {
                self.active_pane = EditorPane::Primary;
                self.sync_block_input_from_active_for_pane(EditorPane::Primary, None, cx);
            }
            cx.notify();
            return;
        }
        let Some(active_page) = self.active_page.clone() else {
            return;
        };
        self.open_secondary_pane_for_page(&active_page.uid, cx);
    }

    pub(super) fn open_secondary_pane_for_page(&mut self, page_uid: &str, cx: &mut Context<Self>) {
        if self
            .secondary_pane
            .as_ref()
            .is_some_and(|pane| pane.dirty)
        {
            self.save(cx);
        }
        let Some(db) = self.db.as_ref() else {
            return;
        };
        let normalized = app::sanitize_kebab(page_uid);
        let Some(page) = db.get_page_by_uid(&normalized).ok().flatten() else {
            return;
        };
        let blocks = db.load_blocks_for_page(page.id).unwrap_or_default();
        let editor = EditorModel::new(blocks);
        let list_state = PaneListState::new(editor.blocks.len(), px(BLOCK_ROW_HEIGHT));
        self.secondary_pane = Some(SecondaryPane {
            page,
            editor,
            list_state,
            selection: PaneSelection::new(),
            dirty: false,
        });
        self.record_recent_page(page_uid);
        if self.active_pane == EditorPane::Secondary {
            self.sync_block_input_from_active_for_pane(EditorPane::Secondary, None, cx);
        }
        cx.notify();
    }

    pub(super) fn copy_primary_to_secondary(&mut self, cx: &mut Context<Self>) {
        if self
            .secondary_pane
            .as_ref()
            .is_some_and(|pane| pane.dirty)
        {
            self.save(cx);
        }
        let Some(active_page) = self.active_page.clone() else {
            return;
        };
        let Some(editor) = self.editor.as_ref() else {
            return;
        };
        let editor = editor.clone();
        let list_state = PaneListState::new(editor.blocks.len(), px(BLOCK_ROW_HEIGHT));
        let selection = PaneSelection::new();
        let dirty = self.primary_dirty;

        match self.secondary_pane.as_mut() {
            Some(pane) => {
                pane.page = active_page;
                pane.editor = editor;
                pane.list_state = list_state;
                pane.selection = selection;
                pane.dirty = dirty;
            }
            None => {
                self.secondary_pane = Some(SecondaryPane {
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
        if self.active_pane == EditorPane::Secondary {
            self.sync_block_input_from_active_for_pane(EditorPane::Secondary, None, cx);
        }
        cx.notify();
    }

    pub(super) fn copy_secondary_to_primary(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.primary_dirty {
            self.save(cx);
        }

        let (page, editor, selection, dirty) = {
            let Some(pane) = self.secondary_pane.as_ref() else {
                return;
            };
            (
                pane.page.clone(),
                pane.editor.clone(),
                pane.selection.clone(),
                pane.dirty,
            )
        };

        self.active_page = Some(page.clone());
        self.editor = Some(editor);
        self.primary_selection = selection;
        self.primary_dirty = dirty;
        self.blocks_list_state.reset(
            self.editor.as_ref().map(|e| e.blocks.len()).unwrap_or(0),
            px(BLOCK_ROW_HEIGHT),
        );
        self.active_pane = EditorPane::Primary;
        self.highlighted_block_uid = None;
        self.update_save_state_from_dirty();
        self.close_slash_menu();

        if let Some(db) = self.db.as_mut() {
            let _ = db.set_kv("active.page", &page.uid);
        }

        self.record_recent_page(&page.uid);
        if let Some(editor) = self.editor.as_mut() {
            let cursor = if let Some(page_cursor) = self.page_cursors.get(&page.uid) {
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

        window.focus(&self.block_input.focus_handle(cx), cx);
        self.refresh_references();
        cx.notify();
    }

    pub(super) fn swap_panes(&mut self, cx: &mut Context<Self>) {
        let Some(primary_page) = self.active_page.take() else {
            return;
        };
        let Some(primary_editor) = self.editor.take() else {
            self.active_page = Some(primary_page);
            return;
        };
        let secondary_page_uid = {
            let Some(pane) = self.secondary_pane.as_mut() else {
                self.active_page = Some(primary_page);
                self.editor = Some(primary_editor);
                return;
            };

            let mut primary_selection = PaneSelection::new();
            mem::swap(&mut primary_selection, &mut self.primary_selection);

            let secondary_page = mem::replace(&mut pane.page, primary_page);
            let secondary_editor = mem::replace(&mut pane.editor, primary_editor);
            let secondary_dirty = mem::replace(&mut pane.dirty, self.primary_dirty);
            let secondary_selection = mem::replace(&mut pane.selection, primary_selection);

            mem::swap(&mut self.blocks_list_state, &mut pane.list_state);

            self.active_page = Some(secondary_page.clone());
            self.editor = Some(secondary_editor);
            self.primary_dirty = secondary_dirty;
            self.primary_selection = secondary_selection;
            self.highlighted_block_uid = None;

            secondary_page.uid.clone()
        };

        if let Some(db) = self.db.as_mut() {
            let _ = db.set_kv("active.page", &secondary_page_uid);
        }

        self.update_save_state_from_dirty();
        self.refresh_references();
        self.close_slash_menu();
        self.sync_block_input_from_active_for_pane(self.active_pane, None, cx);
        cx.notify();
    }

    pub(super) fn toggle_split_pane_action(
        &mut self,
        _: &ToggleSplitPane,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.toggle_split_pane(cx);
    }

    pub(super) fn insert_block_below(
        &mut self,
        _: &InsertBlockBelow,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.mode != Mode::Editor {
            return;
        }
        let pane = self.active_pane;
        if self
            .selection_for_pane(pane)
            .is_some_and(|selection| selection.has_range())
        {
            return;
        }
        let (cursor_offset, text) = {
            let input = self.block_input.read(cx);
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
        window.focus(&self.block_input.focus_handle(cx), cx);
        self.mark_dirty_for_pane(pane, cx);
        self.schedule_references_refresh(cx);
    }

    pub(super) fn indent_block(
        &mut self,
        _: &IndentBlock,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let pane = self.active_pane;
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

    pub(super) fn outdent_block(
        &mut self,
        _: &OutdentBlock,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let pane = self.active_pane;
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

    pub(super) fn move_block_up(
        &mut self,
        _: &MoveBlockUp,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let pane = self.active_pane;
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

    pub(super) fn move_block_down(
        &mut self,
        _: &MoveBlockDown,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let pane = self.active_pane;
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

    pub(super) fn duplicate_block(
        &mut self,
        _: &DuplicateBlock,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let pane = self.active_pane;
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
        window.focus(&self.block_input.focus_handle(cx), cx);
        self.mark_dirty_for_pane(pane, cx);
        self.schedule_references_refresh(cx);
    }

    pub(super) fn delete_selection_action(
        &mut self,
        _: &DeleteSelection,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let pane = self.active_pane;
        if self
            .selection_for_pane(pane)
            .is_some_and(|selection| selection.has_range())
        {
            self.delete_selection_in_pane(pane, cx);
        }
    }

    pub(super) fn clear_selection_action(
        &mut self,
        _: &ClearSelection,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let pane = self.active_pane;
        if self
            .selection_for_pane(pane)
            .is_some_and(|selection| selection.has_range())
        {
            self.clear_selection_for_pane(pane);
            cx.notify();
        }
    }

    pub(super) fn handle_block_input_key_down(
        &mut self,
        pane: EditorPane,
        event: &KeyDownEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if self.mode != Mode::Editor {
            return false;
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
            let input = self.block_input.read(cx);
            (input.cursor(), input.text().len())
        };

        match event.keystroke.key.as_str() {
            "backspace" if cursor_offset == 0 => {
                let current_text = self.block_input.read(cx).value().to_string();
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
                    let input = self.block_input.read(cx);
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

    pub(super) fn on_click_page(
        &mut self,
        uid: String,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.open_page(&uid, cx);
    }

    pub(super) fn on_click_block_in_pane(
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
        window.focus(&self.block_input.focus_handle(cx), cx);
        self.close_slash_menu();
        cx.notify();
    }

    pub(super) fn on_click_block_with_event_in_pane(
        &mut self,
        pane: EditorPane,
        ix: usize,
        event: &gpui::ClickEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.mode != Mode::Editor {
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

    pub(super) fn focus_block_by_uid(
        &mut self,
        block_uid: &str,
        window: Option<&mut Window>,
        cx: &mut Context<Self>,
    ) -> bool {
        self.focus_block_by_uid_in_pane(EditorPane::Primary, block_uid, window, cx)
    }

    pub(super) fn focus_block_by_uid_in_pane(
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
            let Some(ix) = editor.blocks.iter().position(|block| block.uid == block_uid) else {
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
                window.focus(&self.block_input.focus_handle(cx), cx);
            }
            None => {
                self.sync_block_input_from_active_for_pane(pane, None, cx);
            }
        }
        self.clear_selection_for_pane(pane);
        self.close_slash_menu();
        true
    }

    pub(super) fn open_page_and_focus_block(
        &mut self,
        page_uid: &str,
        block_uid: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.set_mode(Mode::Editor, cx);
        self.open_page(page_uid, cx);
        if self.focus_block_by_uid(block_uid, Some(window), cx) {
            self.highlighted_block_uid = Some(block_uid.to_string());
            self.schedule_highlight_clear(cx);
        }
    }

    pub(super) fn insert_block_after_in_pane(
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
        window.focus(&self.block_input.focus_handle(cx), cx);
        self.mark_dirty_for_pane(pane, cx);
        self.schedule_references_refresh(cx);
    }

    pub(super) fn duplicate_block_at_in_pane(
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
        window.focus(&self.block_input.focus_handle(cx), cx);
        self.mark_dirty_for_pane(pane, cx);
        self.schedule_references_refresh(cx);
    }

    pub(super) fn add_review_from_block_in_pane(
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
        let Some(db) = self.db.as_ref() else {
            return;
        };
        if ix >= editor.blocks.len() {
            return;
        }
        let block_uid = editor.blocks[ix].uid.clone();
        let now = now_millis();
        let _ = db.upsert_review_queue_item(&active_page.uid, &block_uid, now, None);
        if self.mode == Mode::Review {
            self.load_review_items(cx);
        }
    }

    pub(super) fn link_block_to_page_in_pane(
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
        self.block_input.update(cx, |input, cx| {
            input.set_value(next_text.clone(), window, cx);
            let position = input.text().offset_to_position(next_cursor);
            input.set_cursor_position(position, window, cx);
        });
        window.focus(&self.block_input.focus_handle(cx), cx);
        self.mark_dirty_for_pane(pane, cx);
        self.schedule_references_refresh(cx);
    }

    pub(super) fn link_unlinked_reference(
        &mut self,
        reference: &UnlinkedReference,
        cx: &mut Context<Self>,
    ) {
        let Some(editor) = self.editor.as_mut() else {
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
            self.block_input.read(cx).cursor()
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
            let block_input = self.block_input.clone();
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

    pub(super) fn duplicate_selection_in_pane(
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
            window.focus(&self.block_input.focus_handle(cx), cx);
        }
        self.mark_dirty_for_pane(pane, cx);
        self.schedule_references_refresh(cx);
    }

    pub(super) fn delete_selection_in_pane(&mut self, pane: EditorPane, cx: &mut Context<Self>) {
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
        let block_input = self.block_input.clone();
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

    pub(super) fn indent_selection_in_pane(&mut self, pane: EditorPane, cx: &mut Context<Self>) {
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

    pub(super) fn outdent_selection_in_pane(&mut self, pane: EditorPane, cx: &mut Context<Self>) {
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

    pub(super) fn move_selection_in_pane(
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
        window.focus(&self.block_input.focus_handle(cx), cx);
        self.mark_dirty_for_pane(pane, cx);
        self.schedule_references_refresh(cx);
        cx.notify();
    }

    pub(super) fn add_capture(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let text = self
            .capture_input
            .read(cx)
            .value()
            .trim()
            .to_string();
        if text.is_empty() {
            return;
        }

        let (text, uid) = {
            let Some(editor) = self.editor.as_mut() else {
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
        self.block_input.update(cx, |input, cx| {
            input.set_value(text.clone(), window, cx);
            let position = input.text().offset_to_position(cursor);
            input.set_cursor_position(position, window, cx);
        });

        self.capture_input.update(cx, |input, cx| {
            input.set_value("", window, cx);
        });

        self.set_mode(Mode::Editor, cx);
        self.active_pane = EditorPane::Primary;
        window.focus(&self.block_input.focus_handle(cx), cx);

        self.capture_confirmation = Some("Captured".into());
        self.schedule_capture_confirmation_clear(cx);
        self.highlighted_block_uid = Some(uid);
        self.schedule_highlight_clear(cx);
        self.mark_dirty_for_pane(EditorPane::Primary, cx);
        self.schedule_references_refresh(cx);
    }

    pub(super) fn update_slash_menu(
        &mut self,
        pane: EditorPane,
        block_uid: &str,
        block_ix: usize,
        cursor: usize,
        text: &str,
        cx: &mut Context<Self>,
    ) {
        if self.mode != Mode::Editor {
            self.close_slash_menu();
            return;
        }
        if cursor == 0 || cursor > text.len() {
            self.close_slash_menu();
            return;
        }
        let before = &text[..cursor];
        let slash_index = before.rfind('/');
        let should_open = slash_index.is_some_and(|ix| ix + 1 == before.len());
        if should_open {
            self.slash_menu = SlashMenuState {
                open: true,
                pane,
                block_uid: Some(block_uid.to_string()),
                block_ix: Some(block_ix),
                slash_index,
            };
        } else {
            self.slash_menu = SlashMenuState::closed();
        }
        cx.notify();
    }

    pub(super) fn close_slash_menu(&mut self) {
        self.slash_menu = SlashMenuState::closed();
    }

    pub(super) fn apply_slash_command(
        &mut self,
        command_id: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let pane = self.slash_menu.pane;
        let expected_uid = self.slash_menu.block_uid.clone();
        let Some(block_ix) = self.slash_menu.block_ix else {
            return;
        };
        let Some(slash_index) = self.slash_menu.slash_index else {
            return;
        };
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
        if slash_index >= text.len() {
            return;
        }
        let before = text[..slash_index].to_string();
        let after = text[slash_index + 1..].to_string();
        let mut next_text = text.clone();
        let mut next_cursor = before.len();

        if command_id == "link" {
            let insert_text = "[[Page]]";
            next_text = format!("{before}{insert_text}{after}");
            next_cursor = before.len() + insert_text.len();
        } else if command_id == "date" {
            let insert_text = Local::now().format("%Y-%m-%d").to_string();
            next_text = format!("{before}{insert_text}{after}");
            next_cursor = before.len() + insert_text.len();
        } else if command_id == "task" {
            let cleaned = format!("{before}{after}").trim_start().to_string();
            let prefix = if cleaned.starts_with("- [ ] ") || cleaned.starts_with("- [x] ") {
                ""
            } else {
                "- [ ] "
            };
            next_text = format!("{prefix}{cleaned}");
            next_cursor = next_text.len();
        }

        editor.blocks[block_ix].text = next_text.clone();
        editor.active_ix = block_ix;
        self.set_active_pane(pane, cx);
        self.block_input.update(cx, |input, cx| {
            input.set_value(next_text.clone(), window, cx);
            let position = input.text().offset_to_position(next_cursor);
            input.set_cursor_position(position, window, cx);
        });
        window.focus(&self.block_input.focus_handle(cx), cx);
        self.close_slash_menu();
        self.mark_dirty_for_pane(pane, cx);
        self.schedule_references_refresh(cx);
    }
}
