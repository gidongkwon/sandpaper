use super::helpers::now_millis;
use super::*;
use rfd::FileDialog;
use std::path::Path;

const HISTORY_MAX_ENTRIES: usize = 200;
const TEXT_HISTORY_COALESCE_WINDOW_MS: i64 = 750;

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
    fn next_popup_layer_priority(&mut self) -> usize {
        self.editor.popup_priority_counter = self.editor.popup_priority_counter.saturating_add(1);
        POPUP_STACK_PRIORITY_BASE.saturating_add(self.editor.popup_priority_counter)
    }

    fn trim_history_stack(entries: &mut Vec<HistoryEntry>) {
        if entries.len() > HISTORY_MAX_ENTRIES {
            let drop_count = entries.len() - HISTORY_MAX_ENTRIES;
            entries.drain(0..drop_count);
        }
    }

    fn push_history_entry(&mut self, entry: HistoryEntry) {
        if self.editor.is_replaying_history {
            return;
        }
        self.editor.redo_stack.clear();
        self.editor.undo_stack.push(entry);
        Self::trim_history_stack(&mut self.editor.undo_stack);
    }

    fn pane_dirty(&self, pane: EditorPane) -> Option<bool> {
        match pane {
            EditorPane::Primary => Some(self.app.primary_dirty),
            EditorPane::Secondary => self.editor.secondary_pane.as_ref().map(|pane| pane.dirty),
        }
    }

    fn pane_cursor_for_snapshot(&self, pane: EditorPane, cx: &App) -> Option<usize> {
        let editor = self.editor_for_pane(pane)?;
        if editor.active_ix >= editor.blocks.len() {
            return Some(0);
        }
        let block = &editor.blocks[editor.active_ix];
        if pane == self.editor.active_pane {
            let input = self.editor.block_input.read(cx);
            return Some(input.cursor().min(input.text().len()));
        }
        let cursor = self
            .page_for_pane(pane)
            .and_then(|page| self.editor.page_cursors.get(&page.uid))
            .filter(|saved| saved.block_uid == block.uid)
            .map(|saved| saved.cursor_offset)
            .unwrap_or_else(|| block.text.len());
        Some(cursor.min(block.text.len()))
    }

    fn pane_snapshot(&self, pane: EditorPane, cx: &App) -> Option<PaneHistorySnapshot> {
        let page = self.page_for_pane(pane)?.clone();
        let editor = self.editor_for_pane(pane)?.clone();
        let selection = self.selection_for_pane(pane)?.clone();
        let dirty = self.pane_dirty(pane)?;
        let cursor = self.pane_cursor_for_snapshot(pane, cx)?;
        Some(PaneHistorySnapshot {
            page,
            editor,
            selection,
            dirty,
            cursor,
        })
    }

    fn record_structural_history_if_changed(
        &mut self,
        pane: EditorPane,
        before: Option<PaneHistorySnapshot>,
        cx: &mut Context<Self>,
    ) {
        if self.editor.is_replaying_history {
            return;
        }
        let Some(before) = before else {
            return;
        };
        let Some(after) = self.pane_snapshot(pane, cx) else {
            return;
        };
        if before == after {
            return;
        }
        self.push_history_entry(HistoryEntry::Structural(StructuralHistoryEntry {
            pane,
            before,
            after,
        }));
    }

    pub(crate) fn record_text_history_change(
        &mut self,
        pane: EditorPane,
        page_uid: &str,
        block_uid: &str,
        before_text: String,
        after_text: String,
        before_cursor: usize,
        after_cursor: usize,
    ) {
        if self.editor.is_replaying_history || self.editor.text_history_suppression_depth > 0 {
            return;
        }
        if before_text == after_text && before_cursor == after_cursor {
            return;
        }

        let now = now_millis();
        if let Some(HistoryEntry::Text(entry)) = self.editor.undo_stack.last_mut() {
            if entry.pane == pane
                && entry.page_uid == page_uid
                && entry.block_uid == block_uid
                && now.saturating_sub(entry.edited_at_ms) <= TEXT_HISTORY_COALESCE_WINDOW_MS
            {
                entry.after_text = after_text;
                entry.after_cursor = after_cursor;
                entry.edited_at_ms = now;
                self.editor.redo_stack.clear();
                return;
            }
        }

        self.push_history_entry(HistoryEntry::Text(TextHistoryEntry {
            pane,
            page_uid: page_uid.to_string(),
            block_uid: block_uid.to_string(),
            before_text,
            after_text,
            before_cursor,
            after_cursor,
            edited_at_ms: now,
        }));
    }

    fn apply_pane_snapshot(
        &mut self,
        pane: EditorPane,
        snapshot: &PaneHistorySnapshot,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if !self
            .editor
            .pages
            .iter()
            .any(|page| page.uid == snapshot.page.uid)
        {
            self.editor.pages.push(snapshot.page.clone());
        }

        match pane {
            EditorPane::Primary => {
                self.editor.active_page = Some(snapshot.page.clone());
                self.editor.editor = Some(snapshot.editor.clone());
                self.editor.primary_selection = snapshot.selection.clone();
                self.app.primary_dirty = snapshot.dirty;
                self.editor
                    .blocks_list_state
                    .reset(snapshot.editor.blocks.len(), px(BLOCK_ROW_HEIGHT));
                self.update_block_list_for_pane(EditorPane::Primary);
                if let Some(db) = self.app.db.as_mut() {
                    let _ = db.set_kv("active.page", &snapshot.page.uid);
                }
                self.load_page_properties();
            }
            EditorPane::Secondary => {
                let list_state =
                    PaneListState::new(snapshot.editor.blocks.len(), px(BLOCK_ROW_HEIGHT));
                self.editor.secondary_pane = Some(SecondaryPane {
                    page: snapshot.page.clone(),
                    editor: snapshot.editor.clone(),
                    list_state,
                    selection: snapshot.selection.clone(),
                    dirty: snapshot.dirty,
                });
                self.update_block_list_for_pane(EditorPane::Secondary);
            }
        }

        self.editor.active_pane = pane;
        self.update_save_state_from_dirty();
        self.record_recent_page(&snapshot.page.uid);
        self.clear_selection_for_pane(pane);
        if let Some(selection) = self.selection_for_pane_mut(pane) {
            *selection = snapshot.selection.clone();
        }
        self.sync_block_input_from_active_with_cursor_for_pane(
            pane,
            snapshot.cursor,
            Some(window),
            cx,
        );
        window.focus(&self.editor.block_input.focus_handle(cx), cx);
        self.refresh_references();
        self.close_slash_menu();
        self.close_wikilink_menu();
        self.close_outline_menu();
        self.close_link_preview();
        self.schedule_connections_refresh(cx);
    }

    fn ensure_page_loaded_for_history(
        &mut self,
        pane: EditorPane,
        page_uid: &str,
        cx: &mut Context<Self>,
    ) -> bool {
        if self
            .page_for_pane(pane)
            .is_some_and(|page| page.uid == page_uid)
        {
            return true;
        }

        match pane {
            EditorPane::Primary => {
                if self
                    .page_for_pane(EditorPane::Secondary)
                    .is_some_and(|page| page.uid == page_uid)
                {
                    if let Some(secondary) = self.editor.secondary_pane.as_ref() {
                        self.editor.active_page = Some(secondary.page.clone());
                        self.editor.editor = Some(secondary.editor.clone());
                        self.editor.primary_selection = secondary.selection.clone();
                        self.app.primary_dirty = secondary.dirty;
                        self.editor
                            .blocks_list_state
                            .reset(secondary.editor.blocks.len(), px(BLOCK_ROW_HEIGHT));
                        self.update_block_list_for_pane(EditorPane::Primary);
                        self.editor.active_pane = EditorPane::Primary;
                        self.update_save_state_from_dirty();
                        return true;
                    }
                }
                self.open_page(page_uid, cx);
                self.page_for_pane(EditorPane::Primary)
                    .is_some_and(|page| page.uid == page_uid)
            }
            EditorPane::Secondary => {
                if self
                    .page_for_pane(EditorPane::Primary)
                    .is_some_and(|page| page.uid == page_uid)
                {
                    self.copy_primary_to_secondary(cx);
                    return self
                        .page_for_pane(EditorPane::Secondary)
                        .is_some_and(|page| page.uid == page_uid);
                }
                self.open_secondary_pane_for_page(page_uid, cx);
                self.page_for_pane(EditorPane::Secondary)
                    .is_some_and(|page| page.uid == page_uid)
            }
        }
    }

    fn apply_text_history_entry(
        &mut self,
        entry: &TextHistoryEntry,
        undo: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        let next_text = if undo {
            &entry.before_text
        } else {
            &entry.after_text
        };
        let next_cursor = if undo {
            entry.before_cursor
        } else {
            entry.after_cursor
        };

        if !self.ensure_page_loaded_for_history(entry.pane, &entry.page_uid, cx) {
            return false;
        }

        let changed = {
            let Some(editor) = self.editor_for_pane_mut(entry.pane) else {
                return false;
            };
            let Some(ix) = editor
                .blocks
                .iter()
                .position(|block| block.uid == entry.block_uid)
            else {
                return false;
            };
            editor.active_ix = ix;
            let changed = editor.blocks[ix].text != *next_text;
            editor.blocks[ix].text = next_text.clone();
            changed
        };

        self.editor.active_pane = entry.pane;
        self.update_block_list_for_pane(entry.pane);
        self.sync_block_input_from_active_with_cursor_for_pane(
            entry.pane,
            next_cursor,
            Some(window),
            cx,
        );
        window.focus(&self.editor.block_input.focus_handle(cx), cx);
        self.close_slash_menu();
        self.close_wikilink_menu();
        self.close_outline_menu();
        self.close_link_preview();
        self.clear_selection_for_pane(entry.pane);
        if changed {
            self.mark_dirty_for_pane(entry.pane, cx);
            self.schedule_references_refresh(cx);
        }
        true
    }

    fn apply_history_entry(
        &mut self,
        entry: &HistoryEntry,
        undo: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        match entry {
            HistoryEntry::Structural(structural) => {
                let target = if undo {
                    &structural.before
                } else {
                    &structural.after
                };
                self.apply_pane_snapshot(structural.pane, target, window, cx);
                self.mark_dirty_for_pane(structural.pane, cx);
                self.schedule_references_refresh(cx);
                true
            }
            HistoryEntry::Text(text) => self.apply_text_history_entry(text, undo, window, cx),
        }
    }

    fn run_undo(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(entry) = self.editor.undo_stack.pop() else {
            return;
        };

        self.editor.is_replaying_history = true;
        let applied = self.apply_history_entry(&entry, true, window, cx);
        self.editor.is_replaying_history = false;

        if applied {
            self.editor.redo_stack.push(entry);
            Self::trim_history_stack(&mut self.editor.redo_stack);
            cx.notify();
        } else {
            self.editor.undo_stack.push(entry);
            Self::trim_history_stack(&mut self.editor.undo_stack);
        }
    }

    fn run_redo(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(entry) = self.editor.redo_stack.pop() else {
            return;
        };

        self.editor.is_replaying_history = true;
        let applied = self.apply_history_entry(&entry, false, window, cx);
        self.editor.is_replaying_history = false;

        if applied {
            self.editor.undo_stack.push(entry);
            Self::trim_history_stack(&mut self.editor.undo_stack);
            cx.notify();
        } else {
            self.editor.redo_stack.push(entry);
            Self::trim_history_stack(&mut self.editor.redo_stack);
        }
    }

    fn visible_index_for_actual(list_state: &PaneListState, actual_ix: usize) -> usize {
        if list_state.actual_to_visible.is_empty() {
            return 0;
        }
        let actual_ix = actual_ix.min(list_state.actual_to_visible.len().saturating_sub(1));
        if let Some(ix) = list_state
            .actual_to_visible
            .get(actual_ix)
            .copied()
            .flatten()
        {
            return ix;
        }

        for ix in (0..actual_ix).rev() {
            if let Some(found) = list_state.actual_to_visible.get(ix).copied().flatten() {
                return found;
            }
        }
        for ix in actual_ix + 1..list_state.actual_to_visible.len() {
            if let Some(found) = list_state.actual_to_visible.get(ix).copied().flatten() {
                return found;
            }
        }

        0
    }

    pub(crate) fn with_window(
        &self,
        cx: &mut Context<Self>,
        f: impl FnOnce(&mut Window, &mut App),
    ) {
        let _ = cx.update_window(self.window_handle, |_, window, cx| f(window, cx));
    }

    pub(crate) fn row_height_for_block_text(text: &str) -> gpui::Pixels {
        // Baseline includes a small render buffer so glyph descenders do not clip
        // at virtual-list row boundaries on tight line-height/layout combinations.
        let mut height = BLOCK_ROW_HEIGHT;

        // Respect explicit newlines so multi-line content does not clip.
        let extra_lines = text.split('\n').count().saturating_sub(1) as f32;
        height += extra_lines * COMPACT_ROW_HEIGHT;

        if let Some(list) = markdown::parse_markdown_list(text) {
            let list_height =
                BLOCK_ROW_HEIGHT + list.items.len().saturating_sub(1) as f32 * COMPACT_ROW_HEIGHT;
            height = height.max(list_height);
        }

        if let Some(fence) = markdown::parse_inline_fence(text) {
            if matches!(fence.lang.as_str(), "mermaid" | "diagram") {
                const DIAGRAM_PREVIEW_ROW_HEIGHT: f32 = BLOCK_ROW_HEIGHT + 360.0;
                height = height.max(DIAGRAM_PREVIEW_ROW_HEIGHT);
            } else {
                const CODE_PREVIEW_ROW_HEIGHT: f32 = BLOCK_ROW_HEIGHT + 240.0;
                height = height.max(CODE_PREVIEW_ROW_HEIGHT);
            }
        }

        px(height)
    }

    pub(crate) fn row_height_for_block_type_and_text(
        block_type: BlockType,
        text: &str,
    ) -> gpui::Pixels {
        let mut height = f32::from(Self::row_height_for_block_text(text));

        // Virtual-list rows are height-clipped by content masks. Keep row sizing in sync with
        // renderer-specific vertical padding/margins so blocks do not crop on the bottom edge.
        height = match block_type {
            BlockType::Heading1 => height + 18.0,
            BlockType::Heading2 => height + 14.0,
            BlockType::Heading3 => height + 8.0,
            BlockType::Quote => height + 4.0,
            BlockType::Callout | BlockType::Code => height + 10.0,
            BlockType::Image => height.max(BLOCK_ROW_HEIGHT + 220.0),
            BlockType::DatabaseView => height.max(BLOCK_ROW_HEIGHT + 260.0),
            BlockType::ColumnLayout => height.max(BLOCK_ROW_HEIGHT + 56.0),
            _ => height,
        };

        px(height.ceil())
    }

    fn row_height_for_column_layout_block(
        blocks: &[BlockSnapshot],
        layout_ix: usize,
    ) -> gpui::Pixels {
        let Some(layout_block) = blocks.get(layout_ix) else {
            return px(BLOCK_ROW_HEIGHT + 56.0);
        };
        if !matches!(layout_block.block_type, BlockType::ColumnLayout) {
            return Self::row_height_for_block_type_and_text(
                layout_block.block_type,
                &layout_block.text,
            );
        }

        let base_height = f32::from(Self::row_height_for_block_type_and_text(
            BlockType::ColumnLayout,
            &layout_block.text,
        ));
        let layout_indent = layout_block.indent;

        const HEADER_HEIGHT: f32 = 28.0;
        const CARD_TOP_BOTTOM: f32 = 34.0;
        const ROW_HEIGHT: f32 = 22.0;
        const ROW_GAP: f32 = 4.0;
        const EMPTY_ROW_HEIGHT: f32 = 22.0;
        const ADD_BLOCK_BUTTON_HEIGHT: f32 = 24.0;
        const OUTER_BOTTOM_PADDING: f32 = 8.0;

        let mut ix = layout_ix + 1;
        let mut max_column_height = 0.0_f32;
        let mut column_count = 0usize;

        while ix < blocks.len() {
            let current = &blocks[ix];
            if current.indent <= layout_indent {
                break;
            }

            if current.indent == layout_indent + 1
                && matches!(current.block_type, BlockType::Column)
            {
                column_count += 1;
                let column_indent = current.indent;
                let mut row_count = 0usize;
                let mut row_ix = ix + 1;
                while row_ix < blocks.len() {
                    let child = &blocks[row_ix];
                    if child.indent <= column_indent {
                        break;
                    }

                    let raw = helpers::clean_text_for_block_type(&child.text, child.block_type);
                    let mut line = helpers::format_snippet(&raw, 120);
                    if matches!(child.block_type, BlockType::Divider) {
                        line = "—".to_string();
                    }
                    if !line.trim().is_empty() {
                        row_count += 1;
                    }
                    row_ix += 1;
                }

                let rows_height = if row_count == 0 {
                    EMPTY_ROW_HEIGHT
                } else {
                    row_count as f32 * ROW_HEIGHT + row_count.saturating_sub(1) as f32 * ROW_GAP
                };
                let column_height = CARD_TOP_BOTTOM + rows_height + ADD_BLOCK_BUTTON_HEIGHT;
                max_column_height = max_column_height.max(column_height);
                ix = row_ix;
                continue;
            }

            ix += 1;
        }

        if column_count == 0 {
            return px(base_height.ceil());
        }

        let desired = (HEADER_HEIGHT + max_column_height + OUTER_BOTTOM_PADDING).ceil();
        px(base_height.max(desired))
    }

    fn sync_list_row_height_for_block(
        &mut self,
        pane: EditorPane,
        actual_ix: usize,
        block_type: BlockType,
        text: &str,
        cx: &mut Context<Self>,
    ) {
        let Some(list_state) = self.list_state_for_pane_mut(pane) else {
            return;
        };
        let Some(visible_ix) = list_state
            .actual_to_visible
            .get(actual_ix)
            .copied()
            .flatten()
        else {
            return;
        };
        if visible_ix >= list_state.item_sizes.len() {
            return;
        }
        let desired = Self::row_height_for_block_type_and_text(block_type, text);
        if list_state.item_sizes[visible_ix].height != desired {
            let sizes = Rc::make_mut(&mut list_state.item_sizes);
            sizes[visible_ix] = size(px(0.), desired);
            cx.notify();
        }
    }

    pub(crate) fn apply_block_input_change_for_binding(
        &mut self,
        binding: &BlockInputBinding,
        text: String,
        cursor: usize,
        cx: &mut Context<Self>,
    ) {
        let pane = binding.pane;
        let Some(page_uid) = self.page_for_pane(pane).map(|page| page.uid.clone()) else {
            return;
        };
        if page_uid != binding.page_uid {
            return;
        }

        let block_uid = binding.block_uid.clone();
        let (block_ix, block_type, previous_text, is_active_block) = {
            let Some(editor) = self.editor_for_pane(pane) else {
                return;
            };
            let Some(ix) = editor
                .blocks
                .iter()
                .position(|block| block.uid == block_uid)
            else {
                return;
            };
            let block = &editor.blocks[ix];
            let is_active = self.editor.active_pane == pane
                && editor.active_ix < editor.blocks.len()
                && editor.blocks[editor.active_ix].uid == block_uid;
            (ix, block.block_type, block.text.clone(), is_active)
        };

        let previous_cursor = self
            .editor
            .page_cursors
            .get(&page_uid)
            .filter(|saved| saved.block_uid == block_uid)
            .map(|saved| saved.cursor_offset)
            .unwrap_or(cursor);
        let text_changed = previous_text != text;
        if text_changed {
            let Some(editor) = self.editor_for_pane_mut(pane) else {
                return;
            };
            if block_ix >= editor.blocks.len() {
                return;
            }
            editor.blocks[block_ix].text = text.clone();
        }

        self.record_page_cursor_for_pane(pane, &block_uid, cursor);

        if text_changed {
            self.record_text_history_change(
                pane,
                &page_uid,
                &block_uid,
                previous_text,
                text.clone(),
                previous_cursor,
                cursor,
            );
            let is_visible = self
                .list_state_for_pane(pane)
                .and_then(|list_state| list_state.actual_to_visible.get(block_ix))
                .copied()
                .flatten()
                .is_some();
            if is_visible {
                self.sync_list_row_height_for_block(pane, block_ix, block_type, &text, cx);
            } else {
                // Hidden descendants (for embedded renderers such as column layout children)
                // can change the visible parent row's required height.
                self.update_block_list_for_pane(pane);
                cx.notify();
            }
            self.mark_dirty_for_pane(pane, cx);
            self.schedule_references_refresh(cx);
        }

        if is_active_block {
            self.update_slash_menu(pane, &block_uid, block_ix, cursor, &text, cx);
            self.update_wikilink_menu(pane, &block_uid, block_ix, cursor, &text, cx);
        }
    }

    pub(crate) fn flush_bound_block_input(&mut self, cx: &mut Context<Self>) {
        if self.editor.text_history_suppression_depth > 0 || self.editor.is_replaying_history {
            return;
        }
        let Some(binding) = self.editor.block_input_binding.clone() else {
            return;
        };
        let (text, cursor) = {
            let input = self.editor.block_input.read(cx);
            (input.value().to_string(), input.cursor())
        };
        self.apply_block_input_change_for_binding(&binding, text, cursor, cx);
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

    pub(crate) fn begin_block_pointer_selection_in_pane(
        &mut self,
        pane: EditorPane,
        visible_ix: usize,
        position: gpui::Point<gpui::Pixels>,
        shift: bool,
    ) {
        let Some(selection) = self.selection_for_pane_mut(pane) else {
            return;
        };
        if !shift {
            selection.anchor = Some(visible_ix);
        }
        selection.dragging = false;
        selection.drag_completed = false;
        selection.pointer_origin = Some((
            f32::from(position.x).round() as i32,
            f32::from(position.y).round() as i32,
        ));
    }

    pub(crate) fn update_block_pointer_selection_in_pane(
        &mut self,
        pane: EditorPane,
        visible_ix: usize,
        position: gpui::Point<gpui::Pixels>,
        cx: &mut Context<Self>,
    ) {
        let Some(selection) = self.selection_for_pane_mut(pane) else {
            return;
        };
        let Some((origin_x, origin_y)) = selection.pointer_origin else {
            return;
        };

        let was_dragging = selection.dragging;
        if !selection.dragging {
            let dx = f32::from(position.x) - origin_x as f32;
            let dy = f32::from(position.y) - origin_y as f32;
            let threshold_sq =
                BLOCK_SELECTION_DRAG_THRESHOLD_PX * BLOCK_SELECTION_DRAG_THRESHOLD_PX;
            if (dx * dx) + (dy * dy) < threshold_sq {
                return;
            }
            selection.dragging = true;
        }

        let previous_range = selection.range;
        let anchor = selection.anchor.unwrap_or(visible_ix);
        selection.set_range(anchor, visible_ix);
        if selection.range != previous_range || selection.dragging != was_dragging {
            cx.notify();
        }
    }

    pub(crate) fn end_block_pointer_selection_in_pane(
        &mut self,
        pane: EditorPane,
        cx: &mut Context<Self>,
    ) {
        let Some(selection) = self.selection_for_pane_mut(pane) else {
            return;
        };
        let had_pointer_origin = selection.pointer_origin.take().is_some();
        let was_dragging = selection.dragging;
        selection.dragging = false;
        if was_dragging {
            selection.drag_completed = selection.has_range();
        }
        if was_dragging || had_pointer_origin {
            cx.notify();
        }
    }

    pub(crate) fn shift_click_block_in_pane(
        &mut self,
        pane: EditorPane,
        visible_ix: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        let Some(list_state) = self.list_state_for_pane(pane) else {
            return false;
        };
        let Some(actual_ix) = list_state.visible_to_actual.get(visible_ix).copied() else {
            return false;
        };
        let next_cursor = {
            let Some(editor) = self.editor_for_pane(pane) else {
                return false;
            };
            let Some(block) = editor.blocks.get(actual_ix) else {
                return false;
            };
            block.text.len()
        };

        let anchor = {
            let current_anchor = self
                .selection_for_pane(pane)
                .and_then(|selection| selection.anchor);
            current_anchor.unwrap_or(visible_ix)
        };

        if let Some(selection) = self.selection_for_pane_mut(pane) {
            selection.anchor = Some(anchor);
            selection.set_range(anchor, visible_ix);
            selection.dragging = false;
            selection.drag_completed = false;
            selection.pointer_origin = None;
        }

        if let Some(editor) = self.editor_for_pane_mut(pane) {
            editor.active_ix = actual_ix;
        } else {
            return false;
        }

        self.sync_block_input_from_active_with_cursor_for_pane(pane, next_cursor, Some(window), cx);
        window.focus(&self.editor.block_input.focus_handle(cx), cx);
        self.close_slash_menu();
        self.close_wikilink_menu();
        self.close_outline_menu();
        cx.notify();
        true
    }

    pub(crate) fn select_all_blocks_in_pane(
        &mut self,
        pane: EditorPane,
        cx: &mut Context<Self>,
    ) -> bool {
        let Some(list_state) = self.list_state_for_pane(pane) else {
            return false;
        };
        if list_state.visible_to_actual.is_empty() {
            return false;
        }
        let last_visible_ix = list_state.visible_to_actual.len().saturating_sub(1);
        let first_actual_ix = list_state.visible_to_actual.first().copied().unwrap_or(0);
        if let Some(editor) = self.editor_for_pane_mut(pane) {
            editor.active_ix = first_actual_ix;
        } else {
            return false;
        }

        self.set_selection_range_for_pane(pane, 0, last_visible_ix);
        if let Some(selection) = self.selection_for_pane_mut(pane) {
            selection.anchor = Some(0);
            selection.dragging = false;
            selection.drag_completed = false;
            selection.pointer_origin = None;
        }
        self.close_slash_menu();
        self.close_wikilink_menu();
        cx.notify();
        true
    }

    pub(crate) fn extend_block_selection_with_arrow_for_pane(
        &mut self,
        pane: EditorPane,
        forward: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        let (next_visible_ix, next_actual_ix, anchor_visible_ix) = {
            let Some(editor) = self.editor_for_pane(pane) else {
                return false;
            };
            let Some(list_state) = self.list_state_for_pane(pane) else {
                return false;
            };
            if list_state.visible_to_actual.is_empty() {
                return false;
            }

            let active_visible_ix = Self::visible_index_for_actual(list_state, editor.active_ix);
            let next_visible_ix = if forward {
                let next = active_visible_ix.saturating_add(1);
                if next >= list_state.visible_to_actual.len() {
                    return false;
                }
                next
            } else {
                let Some(prev) = active_visible_ix.checked_sub(1) else {
                    return false;
                };
                prev
            };
            let Some(next_actual_ix) = list_state.visible_to_actual.get(next_visible_ix).copied()
            else {
                return false;
            };
            let anchor_visible_ix = self
                .selection_for_pane(pane)
                .and_then(|selection| selection.anchor)
                .unwrap_or(active_visible_ix);

            (next_visible_ix, next_actual_ix, anchor_visible_ix)
        };

        let next_cursor = {
            let Some(editor) = self.editor_for_pane(pane) else {
                return false;
            };
            editor
                .blocks
                .get(next_actual_ix)
                .map(|block| if forward { 0 } else { block.text.len() })
                .unwrap_or(0)
        };
        if let Some(editor) = self.editor_for_pane_mut(pane) {
            editor.active_ix = next_actual_ix;
        } else {
            return false;
        }

        self.set_selection_range_for_pane(pane, anchor_visible_ix, next_visible_ix);
        if let Some(selection) = self.selection_for_pane_mut(pane) {
            selection.anchor = Some(anchor_visible_ix);
        }
        self.sync_block_input_from_active_with_cursor_for_pane(pane, next_cursor, Some(window), cx);
        self.close_slash_menu();
        self.close_wikilink_menu();
        cx.notify();
        true
    }

    pub(crate) fn jump_to_block_edge_in_pane(
        &mut self,
        pane: EditorPane,
        to_bottom: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        let (target_visible_ix, target_actual_ix, next_cursor) = {
            let Some(editor) = self.editor_for_pane(pane) else {
                return false;
            };
            let Some(list_state) = self.list_state_for_pane(pane) else {
                return false;
            };
            if list_state.visible_to_actual.is_empty() {
                return false;
            }

            let target_visible_ix = if to_bottom {
                list_state.visible_to_actual.len().saturating_sub(1)
            } else {
                0
            };
            let Some(target_actual_ix) =
                list_state.visible_to_actual.get(target_visible_ix).copied()
            else {
                return false;
            };
            let next_cursor = editor
                .blocks
                .get(target_actual_ix)
                .map(|block| if to_bottom { block.text.len() } else { 0 })
                .unwrap_or(0);
            (target_visible_ix, target_actual_ix, next_cursor)
        };

        if let Some(editor) = self.editor_for_pane_mut(pane) {
            editor.active_ix = target_actual_ix;
        } else {
            return false;
        }
        self.clear_selection_for_pane(pane);
        if let Some(selection) = self.selection_for_pane_mut(pane) {
            selection.anchor = Some(target_visible_ix);
        }
        self.sync_block_input_from_active_with_cursor_for_pane(pane, next_cursor, Some(window), cx);
        self.close_slash_menu();
        self.close_wikilink_menu();
        cx.notify();
        true
    }

    pub(crate) fn extend_block_selection_to_edge_in_pane(
        &mut self,
        pane: EditorPane,
        to_bottom: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        let (target_visible_ix, target_actual_ix, anchor_visible_ix, next_cursor) = {
            let Some(editor) = self.editor_for_pane(pane) else {
                return false;
            };
            let Some(list_state) = self.list_state_for_pane(pane) else {
                return false;
            };
            if list_state.visible_to_actual.is_empty() {
                return false;
            }

            let active_visible_ix = Self::visible_index_for_actual(list_state, editor.active_ix);
            let target_visible_ix = if to_bottom {
                list_state.visible_to_actual.len().saturating_sub(1)
            } else {
                0
            };
            if target_visible_ix == active_visible_ix {
                return false;
            }
            let Some(target_actual_ix) =
                list_state.visible_to_actual.get(target_visible_ix).copied()
            else {
                return false;
            };
            let anchor_visible_ix = self
                .selection_for_pane(pane)
                .and_then(|selection| selection.anchor)
                .unwrap_or(active_visible_ix);
            let next_cursor = editor
                .blocks
                .get(target_actual_ix)
                .map(|block| if to_bottom { 0 } else { block.text.len() })
                .unwrap_or(0);
            (
                target_visible_ix,
                target_actual_ix,
                anchor_visible_ix,
                next_cursor,
            )
        };

        if let Some(editor) = self.editor_for_pane_mut(pane) {
            editor.active_ix = target_actual_ix;
        } else {
            return false;
        }
        self.set_selection_range_for_pane(pane, anchor_visible_ix, target_visible_ix);
        if let Some(selection) = self.selection_for_pane_mut(pane) {
            selection.anchor = Some(anchor_visible_ix);
        }
        self.sync_block_input_from_active_with_cursor_for_pane(pane, next_cursor, Some(window), cx);
        self.close_slash_menu();
        self.close_wikilink_menu();
        cx.notify();
        true
    }

    pub(crate) fn collapse_selection_with_arrow_for_pane(
        &mut self,
        pane: EditorPane,
        to_bottom: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        let (target_visible_ix, target_actual_ix, next_cursor) = {
            let Some(selection) = self.selection_for_pane(pane) else {
                return false;
            };
            let Some((start_visible, end_visible)) = selection.range else {
                return false;
            };
            let target_visible_ix = if to_bottom {
                end_visible
            } else {
                start_visible
            };
            let Some(list_state) = self.list_state_for_pane(pane) else {
                return false;
            };
            let Some(target_actual_ix) =
                list_state.visible_to_actual.get(target_visible_ix).copied()
            else {
                return false;
            };
            let Some(editor) = self.editor_for_pane(pane) else {
                return false;
            };
            let next_cursor = editor
                .blocks
                .get(target_actual_ix)
                .map(|block| if to_bottom { block.text.len() } else { 0 })
                .unwrap_or(0);
            (target_visible_ix, target_actual_ix, next_cursor)
        };

        if let Some(editor) = self.editor_for_pane_mut(pane) {
            editor.active_ix = target_actual_ix;
        } else {
            return false;
        }
        self.clear_selection_for_pane(pane);
        if let Some(selection) = self.selection_for_pane_mut(pane) {
            selection.anchor = Some(target_visible_ix);
        }
        self.sync_block_input_from_active_with_cursor_for_pane(pane, next_cursor, Some(window), cx);
        self.close_slash_menu();
        self.close_wikilink_menu();
        cx.notify();
        true
    }

    pub(crate) fn copy_selection_blocks_in_pane(
        &mut self,
        pane: EditorPane,
        cx: &mut Context<Self>,
    ) -> bool {
        let Some((start_visible, end_visible)) = self
            .selection_for_pane(pane)
            .and_then(|selection| selection.range)
        else {
            return false;
        };
        let Some(list_state) = self.list_state_for_pane(pane) else {
            return false;
        };
        let selected_actual = crate::app::store::outline::selected_actual_indexes_for_visible_range(
            &list_state.visible_to_actual,
            start_visible,
            end_visible,
        );
        if selected_actual.is_empty() {
            return false;
        }

        let items: Vec<BlockClipboardItem> = {
            let Some(editor) = self.editor_for_pane(pane) else {
                return false;
            };
            selected_actual
                .iter()
                .filter_map(|ix| editor.blocks.get(*ix))
                .map(|block| BlockClipboardItem {
                    text: block.text.clone(),
                    indent: block.indent,
                    block_type: block.block_type,
                })
                .collect()
        };
        if items.is_empty() {
            return false;
        }

        let plain = items
            .iter()
            .map(|item| item.text.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        cx.write_to_clipboard(gpui::ClipboardItem::new_string(plain));
        self.editor.block_clipboard = Some(BlockClipboard { items });
        true
    }

    pub(crate) fn cut_selection_blocks_in_pane(
        &mut self,
        pane: EditorPane,
        cx: &mut Context<Self>,
    ) -> bool {
        if !self.copy_selection_blocks_in_pane(pane, cx) {
            return false;
        }
        self.delete_selection_in_pane(pane, cx);
        true
    }

    pub(crate) fn paste_selection_blocks_in_pane(
        &mut self,
        pane: EditorPane,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        let Some(clipboard) = self.editor.block_clipboard.as_ref().cloned() else {
            return false;
        };
        if clipboard.items.is_empty() {
            return false;
        }
        let Some((start_visible, end_visible)) = self
            .selection_for_pane(pane)
            .and_then(|selection| selection.range)
        else {
            return false;
        };
        let Some(list_state) = self.list_state_for_pane(pane) else {
            return false;
        };
        let selected_actual = crate::app::store::outline::selected_actual_indexes_for_visible_range(
            &list_state.visible_to_actual,
            start_visible,
            end_visible,
        );
        if selected_actual.is_empty() {
            return false;
        }
        let history_before = self.pane_snapshot(pane, cx);

        let (active_uid, clones, inserted_uids, insert_at) = {
            let Some(editor) = self.editor_for_pane(pane) else {
                return false;
            };
            let active_uid = editor
                .blocks
                .get(editor.active_ix)
                .map(|block| block.uid.clone());
            let clones: Vec<BlockSnapshot> = clipboard
                .items
                .iter()
                .map(|item| BlockSnapshot {
                    uid: Uuid::new_v4().to_string(),
                    text: item.text.clone(),
                    indent: item.indent,
                    block_type: item.block_type,
                })
                .collect();
            let inserted_uids = clones
                .iter()
                .map(|block| block.uid.clone())
                .collect::<Vec<_>>();
            let insert_at = selected_actual
                .last()
                .copied()
                .and_then(|ix| ix.checked_add(1))
                .unwrap_or(0);
            (active_uid, clones, inserted_uids, insert_at)
        };

        if clones.is_empty() {
            return false;
        }
        {
            let Some(editor) = self.editor_for_pane_mut(pane) else {
                return false;
            };
            let insert_at = insert_at.min(editor.blocks.len());
            editor.blocks.splice(insert_at..insert_at, clones);
            if let Some(active_uid) = active_uid.as_ref() {
                if let Some(ix) = editor
                    .blocks
                    .iter()
                    .position(|block| &block.uid == active_uid)
                {
                    editor.active_ix = ix;
                }
            }
        }

        self.update_block_list_for_pane(pane);
        if let (Some(editor), Some(list_state)) =
            (self.editor_for_pane(pane), self.list_state_for_pane(pane))
        {
            if let Some((start, end)) = crate::app::store::outline::restore_visible_range_by_uids(
                &editor.blocks,
                &list_state.actual_to_visible,
                &inserted_uids,
            ) {
                self.set_selection_range_for_pane(pane, start, end);
                if let Some(selection) = self.selection_for_pane_mut(pane) {
                    selection.anchor = Some(start);
                }
            } else {
                self.clear_selection_for_pane(pane);
            }
        }

        self.mark_dirty_for_pane(pane, cx);
        self.schedule_references_refresh(cx);
        self.record_structural_history_if_changed(pane, history_before, cx);
        cx.notify();
        true
    }

    pub(crate) fn handle_selection_clipboard_key_down(
        &mut self,
        event: &KeyDownEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if self.app.mode != Mode::Editor {
            return false;
        }
        let pane = self.editor.active_pane;
        if !self
            .selection_for_pane(pane)
            .is_some_and(|selection| selection.has_range())
        {
            return false;
        }
        let modifiers = event.keystroke.modifiers;
        if !modifiers.secondary() || modifiers.number_of_modifiers() != 1 {
            return false;
        }

        match event.keystroke.key.to_ascii_lowercase().as_str() {
            "c" => self.copy_selection_blocks_in_pane(pane, cx),
            "x" => self.cut_selection_blocks_in_pane(pane, cx),
            "v" => self.paste_selection_blocks_in_pane(pane, window, cx),
            _ => false,
        }
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

    pub(crate) fn list_state_for_pane(&self, pane: EditorPane) -> Option<&PaneListState> {
        match pane {
            EditorPane::Primary => Some(&self.editor.blocks_list_state),
            EditorPane::Secondary => self
                .editor
                .secondary_pane
                .as_ref()
                .map(|pane| &pane.list_state),
        }
    }

    pub(crate) fn load_collapsed_state_for_page(&mut self, page_uid: &str) {
        let Some(db) = self.app.db.as_ref() else {
            return;
        };
        let key = crate::app::store::outline::collapsed_storage_key(page_uid);
        let collapsed = db
            .get_kv(&key)
            .ok()
            .flatten()
            .map(|raw| crate::app::store::outline::deserialize_collapsed(&raw))
            .unwrap_or_default();
        self.editor
            .collapsed_by_page_uid
            .insert(page_uid.to_string(), collapsed);
    }

    pub(crate) fn persist_collapsed_state_for_page(&mut self, page_uid: &str) {
        let Some(db) = self.app.db.as_ref() else {
            return;
        };
        let Some(collapsed) = self.editor.collapsed_by_page_uid.get(page_uid) else {
            return;
        };
        let key = crate::app::store::outline::collapsed_storage_key(page_uid);
        let raw = crate::app::store::outline::serialize_collapsed(collapsed);
        let _ = db.set_kv(&key, &raw);
    }

    pub(crate) fn update_block_list_for_pane(&mut self, pane: EditorPane) {
        let (sizes, outline) = {
            let Some(editor) = self.editor_for_pane(pane) else {
                return;
            };
            let collapsed = self
                .page_for_pane(pane)
                .and_then(|page| self.editor.collapsed_by_page_uid.get(&page.uid))
                .cloned()
                .unwrap_or_default();
            let outline = crate::app::store::outline::build_outline(&editor.blocks, &collapsed);

            let mut block_renderers_by_lang: HashMap<String, &PluginRenderer> = HashMap::new();
            if let Some(status) = self.plugins.plugin_status.as_ref() {
                for renderer in status.renderers.iter() {
                    if renderer.kind != "block" {
                        continue;
                    }
                    for lang in renderer.languages.iter() {
                        let lang = lang.trim().to_lowercase();
                        if lang.is_empty() {
                            continue;
                        }
                        block_renderers_by_lang.entry(lang).or_insert(renderer);
                    }
                }
            }

            let mut sizes = Vec::with_capacity(outline.visible_to_actual.len());
            for actual_ix in outline.visible_to_actual.iter().copied() {
                let Some(block) = editor.blocks.get(actual_ix) else {
                    continue;
                };

                let mut height =
                    Self::row_height_for_block_type_and_text(block.block_type, &block.text);
                if matches!(block.block_type, BlockType::ColumnLayout) {
                    height = height.max(Self::row_height_for_column_layout_block(
                        &editor.blocks,
                        actual_ix,
                    ));
                }
                if let Some(fence) = markdown::parse_inline_fence(&block.text) {
                    if let Some(renderer) = block_renderers_by_lang.get(&fence.lang) {
                        let preview_key = Self::plugin_preview_state_key(pane, &block.uid);
                        if let Some(state) = self.editor.plugin_block_previews.get(&preview_key) {
                            if let Some(view) = state.view.as_ref() {
                                let key_current = super::plugin_blocks::cache_key_for(
                                    renderer,
                                    &block.uid,
                                    &block.text,
                                );
                                let mut should_use_view = state.key == key_current;
                                if !should_use_view {
                                    if let Some(next_text) = view.next_text.as_deref() {
                                        let key_next = super::plugin_blocks::cache_key_for(
                                            renderer, &block.uid, next_text,
                                        );
                                        should_use_view = state.key == key_next;
                                    }
                                }
                                if !should_use_view
                                    && !view.plugin_id.is_empty()
                                    && !view.renderer_id.is_empty()
                                {
                                    should_use_view = view.plugin_id == renderer.plugin_id
                                        && view.renderer_id == renderer.id;
                                }

                                if should_use_view {
                                    let text_for_view =
                                        view.next_text.as_deref().unwrap_or(block.text.as_str());
                                    height =
                                        Self::row_height_for_plugin_block_view(text_for_view, view);
                                }
                            }
                        }
                    }
                }

                sizes.push(size(px(0.), height));
            }

            (sizes, outline)
        };
        if let Some(list_state) = self.list_state_for_pane_mut(pane) {
            list_state.item_sizes = Rc::new(sizes);
            list_state.visible_to_actual = Rc::new(outline.visible_to_actual);
            list_state.actual_to_visible = Rc::new(outline.actual_to_visible);
            list_state.has_children_by_actual = Rc::new(outline.has_children_by_actual);
            list_state.parent_by_actual = Rc::new(outline.parent_by_actual);
        }
    }

    fn update_block_lists_for_page_uid(&mut self, page_uid: &str) {
        if self
            .page_for_pane(EditorPane::Primary)
            .is_some_and(|page| page.uid == page_uid)
        {
            self.update_block_list_for_pane(EditorPane::Primary);
        }
        if self
            .page_for_pane(EditorPane::Secondary)
            .is_some_and(|page| page.uid == page_uid)
        {
            self.update_block_list_for_pane(EditorPane::Secondary);
        }
    }

    fn ensure_active_visible_for_pane(&mut self, pane: EditorPane) -> bool {
        let active_ix = match self.editor_for_pane(pane) {
            Some(editor) => editor.active_ix,
            None => return false,
        };
        let (actual_to_visible, parent_by_actual) = match self.list_state_for_pane(pane) {
            Some(state) => (
                state.actual_to_visible.clone(),
                state.parent_by_actual.clone(),
            ),
            None => return false,
        };
        if actual_to_visible
            .get(active_ix)
            .copied()
            .flatten()
            .is_some()
        {
            return false;
        }

        let mut current = parent_by_actual.get(active_ix).copied().flatten();
        while let Some(ix) = current {
            if actual_to_visible.get(ix).copied().flatten().is_some() {
                if let Some(editor) = self.editor_for_pane_mut(pane) {
                    editor.active_ix = ix;
                    return true;
                }
                return false;
            }
            current = parent_by_actual.get(ix).copied().flatten();
        }

        if let Some(editor) = self.editor_for_pane_mut(pane) {
            editor.active_ix = 0;
            return true;
        }

        false
    }

    pub(crate) fn toggle_collapse_for_block(
        &mut self,
        pane: EditorPane,
        actual_ix: usize,
        window: Option<&mut Window>,
        cx: &mut Context<Self>,
    ) {
        let Some(page_uid) = self.page_for_pane(pane).map(|page| page.uid.clone()) else {
            return;
        };
        let Some(editor) = self.editor_for_pane(pane) else {
            return;
        };
        let Some(block) = editor.blocks.get(actual_ix) else {
            return;
        };

        let has_children = self
            .list_state_for_pane(pane)
            .and_then(|state| state.has_children_by_actual.get(actual_ix))
            .copied()
            .unwrap_or_else(|| {
                editor
                    .blocks
                    .get(actual_ix + 1)
                    .is_some_and(|next| next.indent > block.indent)
            });
        if !has_children {
            return;
        }

        let block_uid = block.uid.clone();
        let mut is_collapsing = false;
        {
            let collapsed = self
                .editor
                .collapsed_by_page_uid
                .entry(page_uid.clone())
                .or_default();
            if collapsed.contains(&block_uid) {
                collapsed.remove(&block_uid);
            } else {
                collapsed.insert(block_uid.clone());
                is_collapsing = true;
            }
        }
        self.persist_collapsed_state_for_page(&page_uid);
        self.clear_selection_for_pane(pane);

        let mut active_changed_in_pane = false;
        if is_collapsing {
            if let Some(editor) = self.editor_for_pane_mut(pane) {
                let active_ix = editor.active_ix;
                if active_ix != actual_ix {
                    let end = crate::app::store::outline::subtree_end(&editor.blocks, actual_ix);
                    if active_ix > actual_ix && active_ix <= end {
                        editor.active_ix = actual_ix;
                        active_changed_in_pane = true;
                    }
                }
            }
        }

        self.update_block_lists_for_page_uid(&page_uid);

        let mut active_changed = false;
        if self
            .page_for_pane(EditorPane::Primary)
            .is_some_and(|page| page.uid == page_uid)
        {
            active_changed |= self.ensure_active_visible_for_pane(EditorPane::Primary);
        }
        if self
            .page_for_pane(EditorPane::Secondary)
            .is_some_and(|page| page.uid == page_uid)
        {
            active_changed |= self.ensure_active_visible_for_pane(EditorPane::Secondary);
        }

        if (active_changed_in_pane || active_changed) && pane == self.editor.active_pane {
            let cursor = self
                .editor_for_pane(pane)
                .and_then(|editor| editor.blocks.get(editor.active_ix))
                .map(|block| block.text.len())
                .unwrap_or(0);
            self.sync_block_input_from_active_with_cursor_for_pane(pane, cursor, window, cx);
        }

        cx.notify();
    }

    pub(crate) fn fold_outline_to_level(
        &mut self,
        pane: EditorPane,
        level: i64,
        window: Option<&mut Window>,
        cx: &mut Context<Self>,
    ) {
        let Some(page_uid) = self.page_for_pane(pane).map(|page| page.uid.clone()) else {
            return;
        };
        let Some(editor) = self.editor_for_pane(pane) else {
            return;
        };
        let collapsed = crate::app::store::outline::fold_to_level(&editor.blocks, level);
        self.editor
            .collapsed_by_page_uid
            .insert(page_uid.clone(), collapsed);
        self.persist_collapsed_state_for_page(&page_uid);
        self.clear_selection_for_pane(pane);
        self.update_block_lists_for_page_uid(&page_uid);

        let mut active_changed = false;
        if self
            .page_for_pane(EditorPane::Primary)
            .is_some_and(|page| page.uid == page_uid)
        {
            active_changed |= self.ensure_active_visible_for_pane(EditorPane::Primary);
        }
        if self
            .page_for_pane(EditorPane::Secondary)
            .is_some_and(|page| page.uid == page_uid)
        {
            active_changed |= self.ensure_active_visible_for_pane(EditorPane::Secondary);
        }

        if active_changed && pane == self.editor.active_pane {
            self.sync_block_input_from_active_for_pane(pane, window, cx);
        }

        cx.notify();
    }

    pub(crate) fn unfold_all_outline(
        &mut self,
        pane: EditorPane,
        _window: Option<&mut Window>,
        cx: &mut Context<Self>,
    ) {
        let Some(page_uid) = self.page_for_pane(pane).map(|page| page.uid.clone()) else {
            return;
        };
        self.editor
            .collapsed_by_page_uid
            .insert(page_uid.clone(), HashSet::new());
        self.persist_collapsed_state_for_page(&page_uid);
        self.clear_selection_for_pane(pane);
        self.update_block_lists_for_page_uid(&page_uid);

        cx.notify();
    }

    pub(crate) fn scroll_active_block_into_view(&mut self, pane: EditorPane) {
        let active_ix = match self.editor_for_pane(pane) {
            Some(editor) => editor.active_ix,
            None => return,
        };
        let visible_ix = self
            .list_state_for_pane(pane)
            .map(|state| Self::visible_index_for_actual(state, active_ix))
            .unwrap_or(0);
        if let Some(list_state) = self.list_state_for_pane_mut(pane) {
            list_state
                .scroll_handle
                .scroll_to_item(visible_ix, ScrollStrategy::Nearest);
        }
        if self.settings.sync_scroll {
            let other = match pane {
                EditorPane::Primary => EditorPane::Secondary,
                EditorPane::Secondary => EditorPane::Primary,
            };
            let other_visible_ix = self
                .list_state_for_pane(other)
                .map(|state| Self::visible_index_for_actual(state, active_ix))
                .unwrap_or(0);
            if let Some(list_state) = self.list_state_for_pane_mut(other) {
                list_state
                    .scroll_handle
                    .scroll_to_item(other_visible_ix, ScrollStrategy::Nearest);
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
            self.close_wikilink_menu();
            self.close_outline_menu();
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
        self.flush_bound_block_input(cx);

        let Some(page_uid) = self.page_for_pane(pane).map(|page| page.uid.clone()) else {
            self.editor.block_input_binding = None;
            return;
        };
        let Some(editor) = self.editor_for_pane(pane) else {
            self.editor.block_input_binding = None;
            return;
        };
        if editor.active_ix >= editor.blocks.len() {
            self.editor.block_input_binding = None;
            return;
        }
        let block = &editor.blocks[editor.active_ix];
        let text = block.text.clone();
        let cursor = cursor.min(text.len());
        let block_uid = block.uid.clone();
        let input = self.editor.block_input.clone();
        let text_for_input = text.clone();
        let update_input = move |window: &mut Window, cx: &mut App| {
            input.update(cx, |input, cx| {
                input.set_value(text_for_input.clone(), window, cx);
                let position = input.text().offset_to_position(cursor);
                input.set_cursor_position(position, window, cx);
            });
        };
        self.editor.text_history_suppression_depth =
            self.editor.text_history_suppression_depth.saturating_add(1);
        let mut input_synced = false;
        if let Some(window) = window {
            update_input(window, cx);
            input_synced = true;
        } else {
            self.with_window(cx, |window, cx| {
                input_synced = true;
                update_input(window, cx);
            });
        }
        self.editor.text_history_suppression_depth =
            self.editor.text_history_suppression_depth.saturating_sub(1);
        self.record_page_cursor_for_pane(pane, &block_uid, cursor);
        let input_matches_target = {
            let input = self.editor.block_input.read(cx);
            input.value() == text
        };
        if input_synced && input_matches_target {
            self.editor.block_input_binding = Some(BlockInputBinding {
                pane,
                page_uid,
                block_uid: block_uid.clone(),
            });
        } else {
            self.editor.block_input_binding = None;
        }
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
        let normalized = app::sanitize_kebab(page_uid);
        let (page, blocks) = {
            let Some(db) = self.app.db.as_ref() else {
                return;
            };
            let Some(page) = db.get_page_by_uid(&normalized).ok().flatten() else {
                return;
            };
            let blocks = db.load_blocks_for_page(page.id).unwrap_or_default();
            (page, blocks)
        };
        self.load_collapsed_state_for_page(&page.uid);
        let editor = EditorModel::new(blocks);
        let list_state = PaneListState::new(editor.blocks.len(), px(BLOCK_ROW_HEIGHT));
        self.editor.secondary_pane = Some(SecondaryPane {
            page,
            editor,
            list_state,
            selection: PaneSelection::new(),
            dirty: false,
        });
        self.update_block_list_for_pane(EditorPane::Secondary);
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
        self.update_block_list_for_pane(EditorPane::Secondary);

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
        self.update_block_list_for_pane(EditorPane::Primary);
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
        // If the slash menu is open, pressing Enter should execute the selected command
        if self.editor.slash_menu.open && self.editor.slash_menu.pane == pane {
            if let Some(cmd) = self.selected_slash_command() {
                self.apply_slash_command(cmd.id, cmd.action, window, cx);
            }
            return;
        }
        // If the wikilink menu is open, pressing Enter should accept the selected suggestion
        if self.editor.wikilink_menu.open && self.editor.wikilink_menu.pane == pane {
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
            return;
        }
        if self
            .selection_for_pane(pane)
            .is_some_and(|selection| selection.has_range())
        {
            return;
        }
        let history_before = self.pane_snapshot(pane, cx);
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

            editor.split_active_and_insert_after(cursor_offset)
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
        self.record_structural_history_if_changed(pane, history_before, cx);
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
        let history_before = self.pane_snapshot(pane, cx);
        let Some(editor) = self.editor_for_pane_mut(pane) else {
            return;
        };
        if editor.adjust_active_indent(1) {
            self.mark_dirty_for_pane(pane, cx);
            self.schedule_references_refresh(cx);
            self.record_structural_history_if_changed(pane, history_before, cx);
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
        let history_before = self.pane_snapshot(pane, cx);
        let Some(editor) = self.editor_for_pane_mut(pane) else {
            return;
        };
        if editor.adjust_active_indent(-1) {
            self.mark_dirty_for_pane(pane, cx);
            self.schedule_references_refresh(cx);
            self.record_structural_history_if_changed(pane, history_before, cx);
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
        let history_before = self.pane_snapshot(pane, cx);
        let Some(editor) = self.editor_for_pane_mut(pane) else {
            return;
        };
        if editor.move_active_up() {
            self.sync_block_input_from_active_for_pane(pane, Some(window), cx);
            self.mark_dirty_for_pane(pane, cx);
            self.schedule_references_refresh(cx);
            self.record_structural_history_if_changed(pane, history_before, cx);
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
        let history_before = self.pane_snapshot(pane, cx);
        let Some(editor) = self.editor_for_pane_mut(pane) else {
            return;
        };
        if editor.move_active_down() {
            self.sync_block_input_from_active_for_pane(pane, Some(window), cx);
            self.mark_dirty_for_pane(pane, cx);
            self.schedule_references_refresh(cx);
            self.record_structural_history_if_changed(pane, history_before, cx);
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
        let history_before = self.pane_snapshot(pane, cx);
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
        self.record_structural_history_if_changed(pane, history_before, cx);
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

    pub(crate) fn select_all_blocks_action(
        &mut self,
        _: &SelectAllBlocks,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.app.mode != Mode::Editor {
            return;
        }
        let pane = self.editor.active_pane;
        self.select_all_blocks_in_pane(pane, cx);
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

    pub(crate) fn undo_edit_action(
        &mut self,
        _: &UndoEdit,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.app.mode != Mode::Editor {
            return;
        }
        self.run_undo(window, cx);
    }

    pub(crate) fn redo_edit_action(
        &mut self,
        _: &RedoEdit,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.app.mode != Mode::Editor {
            return;
        }
        self.run_redo(window, cx);
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
        if event.keystroke.modifiers.secondary() {
            let key = event.keystroke.key.to_ascii_lowercase();
            if key == "z" {
                if event.keystroke.modifiers.shift {
                    self.redo_edit_action(&RedoEdit, window, cx);
                } else {
                    self.undo_edit_action(&UndoEdit, window, cx);
                }
                return true;
            }
            if key == "y" && !event.keystroke.modifiers.shift {
                self.redo_edit_action(&RedoEdit, window, cx);
                return true;
            }
            if (key == "up" || key == "down")
                && event.keystroke.modifiers.number_of_modifiers() == 1
            {
                return self.jump_to_block_edge_in_pane(pane, key == "down", window, cx);
            }
            if (key == "up" || key == "down")
                && event.keystroke.modifiers.shift
                && event.keystroke.modifiers.number_of_modifiers() == 2
            {
                return self.extend_block_selection_to_edge_in_pane(
                    pane,
                    key == "down",
                    window,
                    cx,
                );
            }
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
                if let Some(cmd) = self.selected_slash_command() {
                    self.apply_slash_command(cmd.id, cmd.action, window, cx);
                }
                return true;
            }
        }
        if event.keystroke.modifiers.shift {
            match event.keystroke.key.as_str() {
                "up" | "down" => {
                    let has_range = self
                        .selection_for_pane(pane)
                        .is_some_and(|selection| selection.has_range());
                    if !has_range {
                        let (cursor_offset, text_len) = {
                            let input = self.editor.block_input.read(cx);
                            (input.cursor(), input.text().len())
                        };
                        let is_up = event.keystroke.key == "up";
                        if (is_up && cursor_offset != 0) || (!is_up && cursor_offset != text_len) {
                            return false;
                        }
                    }
                    let forward = event.keystroke.key == "down";
                    return self
                        .extend_block_selection_with_arrow_for_pane(pane, forward, window, cx);
                }
                _ => {}
            }
        }
        if event.keystroke.modifiers.modified() {
            return false;
        }
        if self
            .selection_for_pane(pane)
            .is_some_and(|selection| selection.has_range())
        {
            return match event.keystroke.key.as_str() {
                "up" => self.collapse_selection_with_arrow_for_pane(pane, false, window, cx),
                "down" => self.collapse_selection_with_arrow_for_pane(pane, true, window, cx),
                _ => false,
            };
        }

        let (cursor_offset, text_len) = {
            let input = self.editor.block_input.read(cx);
            (input.cursor(), input.text().len())
        };

        match event.keystroke.key.as_str() {
            "backspace" if cursor_offset == 0 => {
                let history_before = self.pane_snapshot(pane, cx);
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
                self.record_structural_history_if_changed(pane, history_before, cx);
                true
            }
            "delete" if cursor_offset == text_len => {
                let history_before = self.pane_snapshot(pane, cx);
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
                self.record_structural_history_if_changed(pane, history_before, cx);
                true
            }
            "up" if cursor_offset == 0 => {
                let next_ix = {
                    let Some(editor) = self.editor_for_pane(pane) else {
                        return false;
                    };
                    let Some(list_state) = self.list_state_for_pane(pane) else {
                        return false;
                    };
                    let visible_ix = Self::visible_index_for_actual(list_state, editor.active_ix);
                    let Some(prev_visible_ix) = visible_ix.checked_sub(1) else {
                        return false;
                    };
                    let Some(next_ix) = list_state.visible_to_actual.get(prev_visible_ix).copied()
                    else {
                        return false;
                    };
                    next_ix
                };

                if let Some(editor) = self.editor_for_pane_mut(pane) {
                    editor.active_ix = next_ix;
                }

                self.sync_block_input_from_active_with_cursor_for_pane(pane, 0, Some(window), cx);
                self.close_slash_menu();
                cx.notify();
                true
            }
            "down" if cursor_offset == text_len => {
                let (next_ix, cursor) = {
                    let Some(editor) = self.editor_for_pane(pane) else {
                        return false;
                    };
                    let Some(list_state) = self.list_state_for_pane(pane) else {
                        return false;
                    };
                    let visible_ix = Self::visible_index_for_actual(list_state, editor.active_ix);
                    let next_visible_ix = visible_ix + 1;
                    let Some(next_ix) = list_state.visible_to_actual.get(next_visible_ix).copied()
                    else {
                        return false;
                    };
                    let cursor = editor
                        .blocks
                        .get(next_ix)
                        .map(|block| block.text.len())
                        .unwrap_or(0);
                    (next_ix, cursor)
                };

                if let Some(editor) = self.editor_for_pane_mut(pane) {
                    editor.active_ix = next_ix;
                }

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
        visible_ix: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.set_active_pane(pane, cx);
        let Some(actual_ix) = self
            .list_state_for_pane(pane)
            .and_then(|state| state.visible_to_actual.get(visible_ix))
            .copied()
        else {
            return;
        };
        let already_active = self.editor.active_pane == pane
            && self
                .editor_for_pane(pane)
                .is_some_and(|editor| editor.active_ix == actual_ix);
        if already_active
            && !self
                .selection_for_pane(pane)
                .is_some_and(|selection| selection.has_range())
        {
            window.focus(&self.editor.block_input.focus_handle(cx), cx);
            self.close_slash_menu();
            cx.notify();
            return;
        }
        {
            let Some(editor) = self.editor_for_pane_mut(pane) else {
                return;
            };
            if actual_ix >= editor.blocks.len() {
                return;
            }
            editor.active_ix = actual_ix;
        }
        self.sync_block_input_from_active_for_pane(pane, Some(window), cx);
        window.focus(&self.editor.block_input.focus_handle(cx), cx);
        self.close_slash_menu();
        cx.notify();
    }

    pub(crate) fn on_click_block_with_event_in_pane(
        &mut self,
        pane: EditorPane,
        visible_ix: usize,
        event: &gpui::ClickEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.app.mode != Mode::Editor {
            return;
        }
        self.set_active_pane(pane, cx);

        if self
            .selection_for_pane(pane)
            .is_some_and(|selection| selection.drag_completed)
        {
            if let Some(selection) = self.selection_for_pane_mut(pane) {
                selection.drag_completed = false;
                selection.pointer_origin = None;
            }
            return;
        }

        if event.modifiers().shift {
            self.shift_click_block_in_pane(pane, visible_ix, window, cx);
            return;
        }

        if self
            .selection_for_pane(pane)
            .is_some_and(|selection| selection.has_range())
        {
            self.clear_selection_for_pane(pane);
        }
        if let Some(selection) = self.selection_for_pane_mut(pane) {
            selection.anchor = Some(visible_ix);
            selection.pointer_origin = None;
        }
        self.on_click_block_in_pane(pane, visible_ix, window, cx);
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
        let Some(page_uid) = self.page_for_pane(pane).map(|page| page.uid.clone()) else {
            return false;
        };
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

        let ancestor_uids = {
            let Some(editor) = self.editor_for_pane(pane) else {
                return false;
            };
            let Some(list_state) = self.list_state_for_pane(pane) else {
                return false;
            };
            let mut uids = Vec::new();
            let mut current = list_state.parent_by_actual.get(ix).copied().flatten();
            while let Some(parent_ix) = current {
                if let Some(block) = editor.blocks.get(parent_ix) {
                    uids.push(block.uid.clone());
                }
                current = list_state
                    .parent_by_actual
                    .get(parent_ix)
                    .copied()
                    .flatten();
            }
            uids
        };

        let mut expanded = false;
        {
            let collapsed = self
                .editor
                .collapsed_by_page_uid
                .entry(page_uid.clone())
                .or_default();
            for uid in ancestor_uids {
                expanded |= collapsed.remove(&uid);
            }
        }
        if expanded {
            self.persist_collapsed_state_for_page(&page_uid);
            self.update_block_lists_for_page_uid(&page_uid);
        }

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
        self.close_outline_menu();
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
        let history_before = self.pane_snapshot(pane, cx);
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
        self.record_structural_history_if_changed(pane, history_before, cx);
    }

    pub(crate) fn add_column_to_layout_in_pane(
        &mut self,
        pane: EditorPane,
        layout_ix: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let history_before = self.pane_snapshot(pane, cx);
        let cursor_offset = {
            let Some(editor) = self.editor_for_pane_mut(pane) else {
                return;
            };
            if layout_ix >= editor.blocks.len() {
                return;
            }
            let layout_block = &editor.blocks[layout_ix];
            if !matches!(layout_block.block_type, BlockType::ColumnLayout) {
                return;
            }

            let layout_indent = layout_block.indent;
            let mut insert_ix = layout_ix + 1;
            let mut column_count = 0usize;
            while insert_ix < editor.blocks.len() {
                let block = &editor.blocks[insert_ix];
                if block.indent <= layout_indent {
                    break;
                }
                if block.indent == layout_indent + 1
                    && matches!(block.block_type, BlockType::Column)
                {
                    column_count += 1;
                }
                insert_ix += 1;
            }

            let column_label = format!("Column {}", column_count + 1);
            let column_indent = layout_indent + 1;
            let child_indent = column_indent + 1;
            editor.blocks.insert(
                insert_ix,
                BlockSnapshot {
                    uid: Uuid::new_v4().to_string(),
                    text: column_label,
                    indent: column_indent,
                    block_type: BlockType::Column,
                },
            );
            editor.blocks.insert(
                insert_ix + 1,
                BlockSnapshot {
                    uid: Uuid::new_v4().to_string(),
                    text: String::new(),
                    indent: child_indent,
                    block_type: BlockType::Text,
                },
            );
            editor.active_ix = insert_ix + 1;
            0
        };

        self.update_block_list_for_pane(pane);
        self.set_active_pane(pane, cx);
        self.sync_block_input_from_active_with_cursor_for_pane(
            pane,
            cursor_offset,
            Some(window),
            cx,
        );
        window.focus(&self.editor.block_input.focus_handle(cx), cx);
        self.mark_dirty_for_pane(pane, cx);
        self.schedule_references_refresh(cx);
        self.record_structural_history_if_changed(pane, history_before, cx);
    }

    pub(crate) fn add_block_to_column_in_pane(
        &mut self,
        pane: EditorPane,
        column_ix: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let history_before = self.pane_snapshot(pane, cx);
        let cursor_offset = {
            let Some(editor) = self.editor_for_pane_mut(pane) else {
                return;
            };
            if column_ix >= editor.blocks.len() {
                return;
            }
            let column_block = &editor.blocks[column_ix];
            if !matches!(column_block.block_type, BlockType::Column) {
                return;
            }

            let column_indent = column_block.indent;
            let child_indent = column_indent + 1;
            let mut insert_ix = column_ix + 1;
            while insert_ix < editor.blocks.len() && editor.blocks[insert_ix].indent > column_indent
            {
                insert_ix += 1;
            }

            editor.blocks.insert(
                insert_ix,
                BlockSnapshot {
                    uid: Uuid::new_v4().to_string(),
                    text: String::new(),
                    indent: child_indent,
                    block_type: BlockType::Text,
                },
            );
            editor.active_ix = insert_ix;
            0
        };

        self.update_block_list_for_pane(pane);
        self.set_active_pane(pane, cx);
        self.sync_block_input_from_active_with_cursor_for_pane(
            pane,
            cursor_offset,
            Some(window),
            cx,
        );
        window.focus(&self.editor.block_input.focus_handle(cx), cx);
        self.mark_dirty_for_pane(pane, cx);
        self.schedule_references_refresh(cx);
        self.record_structural_history_if_changed(pane, history_before, cx);
    }

    pub(crate) fn duplicate_block_at_in_pane(
        &mut self,
        pane: EditorPane,
        ix: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let history_before = self.pane_snapshot(pane, cx);
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
        self.record_structural_history_if_changed(pane, history_before, cx);
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
        let history_before = self.pane_snapshot(pane, cx);
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
        editor.blocks[ix].text = next_text;
        self.sync_block_input_from_active_with_cursor_for_pane(pane, next_cursor, Some(window), cx);
        window.focus(&self.editor.block_input.focus_handle(cx), cx);
        self.mark_dirty_for_pane(pane, cx);
        self.schedule_references_refresh(cx);
        self.record_structural_history_if_changed(pane, history_before, cx);
    }

    pub(crate) fn link_unlinked_reference(
        &mut self,
        reference: &UnlinkedReference,
        cx: &mut Context<Self>,
    ) {
        let history_before = self.pane_snapshot(EditorPane::Primary, cx);
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
            self.sync_block_input_from_active_with_cursor_for_pane(
                EditorPane::Primary,
                next_cursor,
                None,
                cx,
            );
        }
        self.mark_dirty_for_pane(EditorPane::Primary, cx);
        self.schedule_references_refresh(cx);
        self.record_structural_history_if_changed(EditorPane::Primary, history_before, cx);
    }

    pub(crate) fn duplicate_selection_in_pane(
        &mut self,
        pane: EditorPane,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let history_before = self.pane_snapshot(pane, cx);
        let Some((start_visible, end_visible)) = self
            .selection_for_pane(pane)
            .and_then(|selection| selection.range)
        else {
            return;
        };
        let Some(list_state) = self.list_state_for_pane(pane) else {
            return;
        };
        let selected_actual = crate::app::store::outline::selected_actual_indexes_for_visible_range(
            &list_state.visible_to_actual,
            start_visible,
            end_visible,
        );
        if selected_actual.is_empty() {
            return;
        }

        let (active_uid, clones, insert_at) = {
            let Some(editor) = self.editor_for_pane(pane) else {
                return;
            };
            let active_uid = editor
                .blocks
                .get(editor.active_ix)
                .map(|block| block.uid.clone());
            let clones: Vec<BlockSnapshot> = selected_actual
                .iter()
                .filter_map(|ix| editor.blocks.get(*ix))
                .map(|block| BlockSnapshot {
                    uid: Uuid::new_v4().to_string(),
                    text: block.text.clone(),
                    indent: block.indent,
                    block_type: block.block_type,
                })
                .collect();
            let insert_at = selected_actual
                .last()
                .copied()
                .and_then(|ix| ix.checked_add(1))
                .unwrap_or(0);
            (active_uid, clones, insert_at)
        };

        let insert_count = clones.len();
        if insert_count == 0 {
            return;
        }
        {
            let Some(editor) = self.editor_for_pane_mut(pane) else {
                return;
            };
            let insert_at = insert_at.min(editor.blocks.len());
            editor.blocks.splice(insert_at..insert_at, clones);

            if let Some(active_uid) = active_uid.as_ref() {
                if let Some(ix) = editor
                    .blocks
                    .iter()
                    .position(|block| &block.uid == active_uid)
                {
                    editor.active_ix = ix;
                }
            }
        }

        self.update_block_list_for_pane(pane);
        let new_start = end_visible + 1;
        let new_end = new_start + insert_count.saturating_sub(1);
        self.set_selection_range_for_pane(pane, new_start, new_end);
        if let Some(selection) = self.selection_for_pane_mut(pane) {
            selection.anchor = Some(new_start);
        }
        self.mark_dirty_for_pane(pane, cx);
        self.schedule_references_refresh(cx);
        self.record_structural_history_if_changed(pane, history_before, cx);
        cx.notify();
    }

    pub(crate) fn delete_selection_in_pane(&mut self, pane: EditorPane, cx: &mut Context<Self>) {
        let history_before = self.pane_snapshot(pane, cx);
        let Some((start_visible, end_visible)) = self
            .selection_for_pane(pane)
            .and_then(|selection| selection.range)
        else {
            return;
        };
        let Some(list_state) = self.list_state_for_pane(pane) else {
            return;
        };
        let selected_actual = crate::app::store::outline::selected_actual_indexes_for_visible_range(
            &list_state.visible_to_actual,
            start_visible,
            end_visible,
        );
        if selected_actual.is_empty() {
            return;
        }

        let (removed_uids, target_uid) = {
            let Some(editor) = self.editor_for_pane(pane) else {
                return;
            };
            let removed_uids: HashSet<String> = selected_actual
                .iter()
                .filter_map(|ix| editor.blocks.get(*ix).map(|block| block.uid.clone()))
                .collect();
            if removed_uids.is_empty() {
                return;
            }

            let first_ix = *selected_actual.first().unwrap_or(&0);
            let last_ix = *selected_actual.last().unwrap_or(&0);

            let mut next_ix = last_ix.saturating_add(1);
            while next_ix < editor.blocks.len()
                && editor
                    .blocks
                    .get(next_ix)
                    .is_some_and(|block| removed_uids.contains(&block.uid))
            {
                next_ix += 1;
            }

            let mut prev_ix = first_ix as isize - 1;
            while prev_ix >= 0
                && editor
                    .blocks
                    .get(prev_ix as usize)
                    .is_some_and(|block| removed_uids.contains(&block.uid))
            {
                prev_ix -= 1;
            }

            let target_uid = editor
                .blocks
                .get(next_ix)
                .or_else(|| {
                    if prev_ix >= 0 {
                        editor.blocks.get(prev_ix as usize)
                    } else {
                        None
                    }
                })
                .map(|block| block.uid.clone());

            (removed_uids, target_uid)
        };

        let next_uid = {
            let Some(editor) = self.editor_for_pane_mut(pane) else {
                return;
            };
            if removed_uids.len() >= editor.blocks.len() {
                let replacement = BlockSnapshot {
                    uid: Uuid::new_v4().to_string(),
                    text: String::new(),
                    indent: 0,
                    block_type: BlockType::Text,
                };
                let uid = replacement.uid.clone();
                editor.blocks = vec![replacement];
                editor.active_ix = 0;
                Some(uid)
            } else {
                editor
                    .blocks
                    .retain(|block| !removed_uids.contains(&block.uid));
                editor.active_ix = 0;
                target_uid
            }
        };

        self.update_block_list_for_pane(pane);
        self.clear_selection_for_pane(pane);
        if let Some(uid) = next_uid.as_deref() {
            let _ = self.focus_block_by_uid_in_pane(pane, uid, None, cx);
        }
        if self.ensure_active_visible_for_pane(pane) {
            self.update_block_list_for_pane(pane);
        }
        self.sync_block_input_from_active_with_cursor_for_pane(pane, 0, None, cx);
        self.mark_dirty_for_pane(pane, cx);
        self.schedule_references_refresh(cx);
        self.record_structural_history_if_changed(pane, history_before, cx);
        cx.notify();
    }

    pub(crate) fn indent_selection_in_pane(&mut self, pane: EditorPane, cx: &mut Context<Self>) {
        let history_before = self.pane_snapshot(pane, cx);
        let Some((start_visible, end_visible)) = self
            .selection_for_pane(pane)
            .and_then(|selection| selection.range)
        else {
            return;
        };
        let Some(list_state) = self.list_state_for_pane(pane) else {
            return;
        };
        let selected_actual = crate::app::store::outline::selected_actual_indexes_for_visible_range(
            &list_state.visible_to_actual,
            start_visible,
            end_visible,
        );
        if selected_actual.is_empty() {
            return;
        }

        let mut changed = false;
        if let Some(editor) = self.editor_for_pane_mut(pane) {
            for ix in selected_actual {
                let Some(block) = editor.blocks.get_mut(ix) else {
                    continue;
                };
                let next = (block.indent + 1).max(0);
                if next != block.indent {
                    block.indent = next;
                    changed = true;
                }
            }
        }

        if changed {
            self.update_block_list_for_pane(pane);
            self.mark_dirty_for_pane(pane, cx);
            self.schedule_references_refresh(cx);
            self.record_structural_history_if_changed(pane, history_before, cx);
            cx.notify();
        }
    }

    pub(crate) fn outdent_selection_in_pane(&mut self, pane: EditorPane, cx: &mut Context<Self>) {
        let history_before = self.pane_snapshot(pane, cx);
        let Some((start_visible, end_visible)) = self
            .selection_for_pane(pane)
            .and_then(|selection| selection.range)
        else {
            return;
        };
        let Some(list_state) = self.list_state_for_pane(pane) else {
            return;
        };
        let selected_actual = crate::app::store::outline::selected_actual_indexes_for_visible_range(
            &list_state.visible_to_actual,
            start_visible,
            end_visible,
        );
        if selected_actual.is_empty() {
            return;
        }

        let mut changed = false;
        if let Some(editor) = self.editor_for_pane_mut(pane) {
            for ix in selected_actual {
                let Some(block) = editor.blocks.get_mut(ix) else {
                    continue;
                };
                let next = (block.indent - 1).max(0);
                if next != block.indent {
                    block.indent = next;
                    changed = true;
                }
            }
        }

        if changed {
            self.update_block_list_for_pane(pane);
            self.mark_dirty_for_pane(pane, cx);
            self.schedule_references_refresh(cx);
            self.record_structural_history_if_changed(pane, history_before, cx);
            cx.notify();
        }
    }

    fn move_block_range(
        blocks: &mut Vec<BlockSnapshot>,
        start: usize,
        end: usize,
        insert_at: usize,
    ) -> bool {
        if start >= blocks.len() || end >= blocks.len() || end < start {
            return false;
        }
        let segment: Vec<_> = blocks.drain(start..=end).collect();
        let target = insert_at.min(blocks.len());
        blocks.splice(target..target, segment);
        true
    }

    fn move_block_range_before_index(
        blocks: &mut Vec<BlockSnapshot>,
        start: usize,
        end: usize,
        insert_before_ix: usize,
    ) -> bool {
        if start >= blocks.len() || end >= blocks.len() || end < start {
            return false;
        }
        if insert_before_ix >= start && insert_before_ix <= end + 1 {
            return false;
        }
        let length = end - start + 1;
        let mut insert_at = insert_before_ix.min(blocks.len());
        if insert_at > end {
            insert_at = insert_at.saturating_sub(length);
        }
        Self::move_block_range(blocks, start, end, insert_at)
    }

    pub(crate) fn set_hovered_block_uid(
        &mut self,
        block_uid: Option<String>,
        cx: &mut Context<Self>,
    ) {
        if self.editor.hovered_block_uid != block_uid {
            self.editor.hovered_block_uid = block_uid;
            cx.notify();
        }
    }

    pub(crate) fn begin_block_drag_in_pane(
        &mut self,
        pane: EditorPane,
        visible_ix: usize,
        cx: &mut Context<Self>,
    ) {
        self.set_active_pane(pane, cx);
        let Some(actual_ix) = self
            .list_state_for_pane(pane)
            .and_then(|state| state.visible_to_actual.get(visible_ix))
            .copied()
        else {
            return;
        };
        let Some(block_uid) = self
            .editor_for_pane(pane)
            .and_then(|editor| editor.blocks.get(actual_ix))
            .map(|block| block.uid.clone())
        else {
            return;
        };

        self.editor.drag_source = Some(DragSource {
            pane,
            block_ix: actual_ix,
            block_uid: block_uid.clone(),
        });
        self.editor.drag_target = Some(DragTarget {
            pane,
            insert_before_ix: actual_ix,
        });
        self.editor.hovered_block_uid = Some(block_uid);
        if let Some(selection) = self.selection_for_pane_mut(pane) {
            selection.dragging = false;
            selection.drag_completed = false;
            selection.pointer_origin = None;
        }
        cx.notify();
    }

    pub(crate) fn update_block_drag_target_for_visible_row_in_pane(
        &mut self,
        pane: EditorPane,
        visible_ix: usize,
        cx: &mut Context<Self>,
    ) {
        self.update_block_drag_target_for_visible_drop_slot_in_pane(pane, visible_ix, false, cx);
    }

    pub(crate) fn update_block_drag_target_for_visible_drop_slot_in_pane(
        &mut self,
        pane: EditorPane,
        visible_ix: usize,
        drop_after: bool,
        cx: &mut Context<Self>,
    ) {
        let Some(list_state) = self.list_state_for_pane(pane) else {
            return;
        };
        let Some(actual_ix) = self
            .list_state_for_pane(pane)
            .and_then(|state| state.visible_to_actual.get(visible_ix))
            .copied()
        else {
            return;
        };
        let insert_before_ix = if drop_after {
            list_state
                .visible_to_actual
                .get(visible_ix.saturating_add(1))
                .copied()
                .or_else(|| self.editor_for_pane(pane).map(|editor| editor.blocks.len()))
                .unwrap_or(actual_ix)
        } else {
            actual_ix
        };

        if self
            .editor
            .drag_source
            .as_ref()
            .is_some_and(|source| source.pane == pane)
        {
            let next = DragTarget {
                pane,
                insert_before_ix,
            };
            let changed = self.editor.drag_target.as_ref().is_none_or(|current| {
                current.pane != next.pane || current.insert_before_ix != next.insert_before_ix
            });
            if changed {
                self.editor.drag_target = Some(next);
                cx.notify();
            }
            return;
        }

        if let Some(block_uid) = self
            .editor_for_pane(pane)
            .and_then(|editor| editor.blocks.get(actual_ix))
            .map(|block| block.uid.clone())
        {
            self.set_hovered_block_uid(Some(block_uid), cx);
        }
    }

    pub(crate) fn commit_block_drag_if_active(&mut self, cx: &mut Context<Self>) -> bool {
        let Some(source) = self.editor.drag_source.clone() else {
            return false;
        };
        self.commit_block_drag_for_pane(source.pane, cx)
    }

    pub(crate) fn commit_block_drag_for_pane(
        &mut self,
        pane: EditorPane,
        cx: &mut Context<Self>,
    ) -> bool {
        let Some(source) = self.editor.drag_source.clone() else {
            return false;
        };
        let Some(target) = self.editor.drag_target.clone() else {
            self.editor.drag_source = None;
            return false;
        };
        if source.pane != pane || target.pane != pane {
            return false;
        }

        let Some(editor) = self.editor_for_pane(pane) else {
            self.editor.drag_source = None;
            self.editor.drag_target = None;
            return false;
        };
        if source.block_ix >= editor.blocks.len() {
            self.editor.drag_source = None;
            self.editor.drag_target = None;
            return false;
        }

        let source_visible_ix = self
            .list_state_for_pane(pane)
            .and_then(|state| state.actual_to_visible.get(source.block_ix))
            .copied()
            .flatten();
        let selected_actual =
            if let (Some(source_visible_ix), Some((start, end)), Some(list_state)) = (
                source_visible_ix,
                self.selection_for_pane(pane)
                    .and_then(|selection| selection.range),
                self.list_state_for_pane(pane),
            ) {
                if source_visible_ix >= start && source_visible_ix <= end {
                    crate::app::store::outline::selected_actual_indexes_for_visible_range(
                        &list_state.visible_to_actual,
                        start,
                        end,
                    )
                } else {
                    vec![source.block_ix]
                }
            } else {
                vec![source.block_ix]
            };
        if selected_actual.is_empty() {
            self.editor.drag_source = None;
            self.editor.drag_target = None;
            return false;
        }

        let history_before = self.pane_snapshot(pane, cx);
        let (selected_uids, active_uid) = {
            let Some(editor) = self.editor_for_pane(pane) else {
                self.editor.drag_source = None;
                self.editor.drag_target = None;
                return false;
            };
            let selected_uids: Vec<String> = selected_actual
                .iter()
                .filter_map(|ix| editor.blocks.get(*ix).map(|block| block.uid.clone()))
                .collect();
            let active_uid = editor
                .blocks
                .get(editor.active_ix)
                .map(|block| block.uid.clone());
            (selected_uids, active_uid)
        };

        let moved = {
            let Some(editor) = self.editor_for_pane_mut(pane) else {
                self.editor.drag_source = None;
                self.editor.drag_target = None;
                return false;
            };
            let start_actual = *selected_actual.first().unwrap_or(&0);
            let mut end_actual = *selected_actual.last().unwrap_or(&start_actual);
            for ix in &selected_actual {
                let subtree_end = crate::app::store::outline::subtree_end(&editor.blocks, *ix);
                end_actual = end_actual.max(subtree_end);
            }
            let moved = Self::move_block_range_before_index(
                &mut editor.blocks,
                start_actual,
                end_actual,
                target.insert_before_ix,
            );
            if moved {
                if let Some(active_uid) = active_uid.as_ref() {
                    if let Some(ix) = editor
                        .blocks
                        .iter()
                        .position(|block| &block.uid == active_uid)
                    {
                        editor.active_ix = ix;
                    }
                }
            }
            moved
        };

        self.editor.drag_source = None;
        self.editor.drag_target = None;
        if let Some(selection) = self.selection_for_pane_mut(pane) {
            selection.dragging = false;
            selection.drag_completed = true;
            selection.pointer_origin = None;
        }

        if !moved {
            cx.notify();
            return false;
        }

        self.update_block_list_for_pane(pane);
        if let (Some(editor), Some(list_state)) =
            (self.editor_for_pane(pane), self.list_state_for_pane(pane))
        {
            if let Some((start, end)) = crate::app::store::outline::restore_visible_range_by_uids(
                &editor.blocks,
                &list_state.actual_to_visible,
                &selected_uids,
            ) {
                self.set_selection_range_for_pane(pane, start, end);
                if let Some(selection) = self.selection_for_pane_mut(pane) {
                    selection.anchor = Some(start);
                }
            } else {
                self.clear_selection_for_pane(pane);
            }
        }

        self.mark_dirty_for_pane(pane, cx);
        self.schedule_references_refresh(cx);
        self.record_structural_history_if_changed(pane, history_before, cx);
        cx.notify();
        true
    }

    pub(crate) fn move_selection_in_pane(
        &mut self,
        pane: EditorPane,
        direction: i32,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let history_before = self.pane_snapshot(pane, cx);
        let Some((start_visible, end_visible)) = self
            .selection_for_pane(pane)
            .and_then(|selection| selection.range)
        else {
            return;
        };
        let Some(list_state) = self.list_state_for_pane(pane) else {
            return;
        };
        let visible_to_actual = list_state.visible_to_actual.clone();
        let selected_actual = crate::app::store::outline::selected_actual_indexes_for_visible_range(
            &visible_to_actual,
            start_visible,
            end_visible,
        );
        if selected_actual.is_empty() {
            return;
        }

        let (selected_uids, active_uid) = {
            let Some(editor) = self.editor_for_pane(pane) else {
                return;
            };
            let selected_uids: Vec<String> = selected_actual
                .iter()
                .filter_map(|ix| editor.blocks.get(*ix).map(|block| block.uid.clone()))
                .collect();
            let active_uid = editor
                .blocks
                .get(editor.active_ix)
                .map(|block| block.uid.clone());
            (selected_uids, active_uid)
        };

        {
            let Some(editor) = self.editor_for_pane_mut(pane) else {
                return;
            };

            let start_actual = *selected_actual.first().unwrap_or(&0);
            let mut end_actual = *selected_actual.last().unwrap_or(&start_actual);
            for ix in &selected_actual {
                let subtree_end = crate::app::store::outline::subtree_end(&editor.blocks, *ix);
                end_actual = end_actual.max(subtree_end);
            }

            if direction < 0 {
                let Some(prev_visible) = start_visible.checked_sub(1) else {
                    return;
                };
                let Some(prev_actual) = visible_to_actual.get(prev_visible).copied() else {
                    return;
                };
                if prev_actual >= start_actual && prev_actual <= end_actual {
                    return;
                }
                Self::move_block_range(&mut editor.blocks, start_actual, end_actual, prev_actual);
            } else if direction > 0 {
                let next_visible = end_visible + 1;
                if next_visible >= visible_to_actual.len() {
                    return;
                }
                let Some(next_actual) = visible_to_actual.get(next_visible).copied() else {
                    return;
                };
                let next_end = crate::app::store::outline::subtree_end(&editor.blocks, next_actual);
                let length = end_actual - start_actual + 1;
                let insert_at = next_end.saturating_sub(length).saturating_add(1);
                Self::move_block_range(&mut editor.blocks, start_actual, end_actual, insert_at);
            } else {
                return;
            }

            if let Some(active_uid) = active_uid.as_ref() {
                if let Some(ix) = editor
                    .blocks
                    .iter()
                    .position(|block| &block.uid == active_uid)
                {
                    editor.active_ix = ix;
                }
            }
        }

        self.update_block_list_for_pane(pane);
        if let (Some(editor), Some(list_state)) =
            (self.editor_for_pane(pane), self.list_state_for_pane(pane))
        {
            if let Some((start, end)) = crate::app::store::outline::restore_visible_range_by_uids(
                &editor.blocks,
                &list_state.actual_to_visible,
                &selected_uids,
            ) {
                self.set_selection_range_for_pane(pane, start, end);
                if let Some(selection) = self.selection_for_pane_mut(pane) {
                    selection.anchor = Some(start);
                }
            } else {
                self.clear_selection_for_pane(pane);
            }
        }

        self.mark_dirty_for_pane(pane, cx);
        self.schedule_references_refresh(cx);
        self.record_structural_history_if_changed(pane, history_before, cx);
        cx.notify();
    }

    fn ensure_inbox_page(&mut self) -> Result<PageRecord, String> {
        let Some(db) = self.app.db.as_mut() else {
            return Err("database unavailable".to_string());
        };

        if let Some(page) = db
            .get_page_by_uid("inbox")
            .map_err(|err| format!("lookup inbox page: {err}"))?
        {
            return Ok(page);
        }

        let page_id = db
            .insert_page("inbox", "Inbox")
            .map_err(|err| format!("create inbox page: {err}"))?;
        if let Ok(pages) = db.list_pages() {
            self.editor.pages = pages;
        }

        Ok(PageRecord {
            id: page_id,
            uid: "inbox".to_string(),
            title: "Inbox".to_string(),
        })
    }

    fn capture_blocks_for_page(&self, page: &PageRecord) -> Vec<BlockSnapshot> {
        if self
            .editor
            .active_page
            .as_ref()
            .is_some_and(|active| active.uid == page.uid)
        {
            if let Some(editor) = self.editor.editor.as_ref() {
                return editor.blocks.clone();
            }
        }

        if let Some(secondary) = self.editor.secondary_pane.as_ref() {
            if secondary.page.uid == page.uid {
                return secondary.editor.blocks.clone();
            }
        }

        self.app
            .db
            .as_ref()
            .and_then(|db| db.load_blocks_for_page(page.id).ok())
            .unwrap_or_default()
    }

    fn sync_capture_blocks_for_visible_page(
        &mut self,
        page_uid: &str,
        blocks: &[BlockSnapshot],
        cx: &mut Context<Self>,
    ) {
        let mut update_primary = false;
        if self
            .editor
            .active_page
            .as_ref()
            .is_some_and(|active| active.uid == page_uid)
        {
            if let Some(editor) = self.editor.editor.as_mut() {
                editor.blocks = blocks.to_vec();
                if editor.blocks.is_empty() {
                    editor.active_ix = 0;
                } else {
                    editor.active_ix = editor.active_ix.min(editor.blocks.len() - 1);
                }
                update_primary = true;
            }
        }
        if update_primary {
            self.update_block_list_for_pane(EditorPane::Primary);
            if self.editor.active_pane == EditorPane::Primary {
                self.sync_block_input_from_active_for_pane(EditorPane::Primary, None, cx);
            }
        }

        let mut update_secondary = false;
        if let Some(secondary) = self.editor.secondary_pane.as_mut() {
            if secondary.page.uid == page_uid {
                secondary.editor.blocks = blocks.to_vec();
                if secondary.editor.blocks.is_empty() {
                    secondary.editor.active_ix = 0;
                } else {
                    secondary.editor.active_ix = secondary
                        .editor
                        .active_ix
                        .min(secondary.editor.blocks.len() - 1);
                }
                update_secondary = true;
            }
        }
        if update_secondary {
            self.update_block_list_for_pane(EditorPane::Secondary);
            if self.editor.active_pane == EditorPane::Secondary {
                self.sync_block_input_from_active_for_pane(EditorPane::Secondary, None, cx);
            }
        }
    }

    fn persist_capture_blocks_for_page(
        &mut self,
        page: &PageRecord,
        blocks: &[BlockSnapshot],
        cx: &mut Context<Self>,
    ) -> Result<(), String> {
        {
            let Some(db) = self.app.db.as_mut() else {
                return Err("database unavailable".to_string());
            };
            db.replace_blocks_for_page(page.id, blocks)
                .map_err(|err| format!("replace blocks for '{}': {err}", page.uid))?;
        }
        self.sync_capture_blocks_for_visible_page(&page.uid, blocks, cx);
        Ok(())
    }

    pub(crate) fn capture_queue_items(&self) -> Vec<CaptureQueueItem> {
        let inbox_page = self
            .app
            .db
            .as_ref()
            .and_then(|db| db.get_page_by_uid("inbox").ok().flatten());
        let Some(inbox_page) = inbox_page else {
            return Vec::new();
        };

        self.capture_blocks_for_page(&inbox_page)
            .into_iter()
            .map(|block| CaptureQueueItem {
                uid: block.uid,
                text: block.text,
            })
            .collect()
    }

    pub(crate) fn enqueue_capture_queue_item(
        &mut self,
        raw_text: &str,
        cx: &mut Context<Self>,
    ) -> Result<String, String> {
        let text = raw_text.trim();
        if text.is_empty() {
            return Err("capture text is empty".to_string());
        }

        let inbox_page = self.ensure_inbox_page()?;
        let mut inbox_blocks = self.capture_blocks_for_page(&inbox_page);

        let block = BlockSnapshot {
            uid: Uuid::new_v4().to_string(),
            text: text.to_string(),
            indent: 0,
            block_type: BlockType::Text,
        };
        let uid = block.uid.clone();

        inbox_blocks.push(block);
        self.persist_capture_blocks_for_page(&inbox_page, &inbox_blocks, cx)?;
        if let Some(db) = self.app.db.as_ref() {
            let now = now_millis();
            let _ = db.upsert_review_queue_item(&inbox_page.uid, &uid, now, None);
        }
        self.load_review_items(cx);
        self.editor.highlighted_block_uid = Some(uid.clone());
        self.schedule_highlight_clear(cx);
        self.schedule_references_refresh(cx);
        Ok(uid)
    }

    #[allow(dead_code)] // Planned for capture queue management UI
    pub(crate) fn move_capture_queue_item_to_page(
        &mut self,
        item_uid: &str,
        destination_uid: &str,
        cx: &mut Context<Self>,
    ) -> Result<(), String> {
        let destination_uid = destination_uid.trim();
        if destination_uid.is_empty() {
            return Err("destination page is required".to_string());
        }
        if destination_uid == "inbox" {
            return Err("destination page cannot be inbox".to_string());
        }

        let (inbox_page, destination_page) = {
            let Some(db) = self.app.db.as_ref() else {
                return Err("database unavailable".to_string());
            };
            let Some(inbox_page) = db
                .get_page_by_uid("inbox")
                .map_err(|err| format!("lookup inbox page: {err}"))?
            else {
                return Err("inbox page is missing".to_string());
            };
            let Some(destination_page) = db
                .get_page_by_uid(destination_uid)
                .map_err(|err| format!("lookup destination page '{destination_uid}': {err}"))?
            else {
                return Err(format!("destination page '{destination_uid}' not found"));
            };
            (inbox_page, destination_page)
        };

        let mut inbox_blocks = self.capture_blocks_for_page(&inbox_page);
        let Some(source_ix) = inbox_blocks.iter().position(|block| block.uid == item_uid) else {
            return Err(format!("capture queue item '{item_uid}' not found"));
        };
        let mut source = inbox_blocks.remove(source_ix);
        source.indent = 0;

        let mut destination_blocks = self.capture_blocks_for_page(&destination_page);
        destination_blocks.insert(0, source.clone());

        self.persist_capture_blocks_for_page(&inbox_page, &inbox_blocks, cx)?;
        if let Err(err) =
            self.persist_capture_blocks_for_page(&destination_page, &destination_blocks, cx)
        {
            let mut restore_inbox = inbox_blocks;
            restore_inbox.insert(source_ix, source);
            let _ = self.persist_capture_blocks_for_page(&inbox_page, &restore_inbox, cx);
            return Err(err);
        }

        self.schedule_references_refresh(cx);
        Ok(())
    }

    pub(crate) fn delete_capture_queue_item(
        &mut self,
        item_uid: &str,
        cx: &mut Context<Self>,
    ) -> Result<(), String> {
        let inbox_page = {
            let Some(db) = self.app.db.as_ref() else {
                return Err("database unavailable".to_string());
            };
            let Some(inbox_page) = db
                .get_page_by_uid("inbox")
                .map_err(|err| format!("lookup inbox page: {err}"))?
            else {
                return Err("inbox page is missing".to_string());
            };
            inbox_page
        };

        let mut inbox_blocks = self.capture_blocks_for_page(&inbox_page);
        let Some(source_ix) = inbox_blocks.iter().position(|block| block.uid == item_uid) else {
            return Err(format!("capture queue item '{item_uid}' not found"));
        };
        inbox_blocks.remove(source_ix);

        self.persist_capture_blocks_for_page(&inbox_page, &inbox_blocks, cx)?;
        if self.editor.capture_move_item_uid.as_deref() == Some(item_uid) {
            self.editor.capture_move_item_uid = None;
        }
        self.schedule_references_refresh(cx);
        Ok(())
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

        let layer_priority = if self.editor.slash_menu.open
            && self.editor.slash_menu.pane == pane
            && self.editor.slash_menu.block_uid.as_deref() == Some(block_uid)
            && self.editor.slash_menu.block_ix == Some(block_ix)
            && self.editor.slash_menu.slash_index == Some(match_query.slash_index)
        {
            self.editor.slash_menu.layer_priority
        } else {
            self.next_popup_layer_priority()
        };

        if self.app.mode == Mode::Editor {
            self.close_wikilink_menu();
            self.close_outline_menu();
            self.close_link_preview();
            self.editor.slash_menu = SlashMenuState {
                open: true,
                pane,
                block_uid: Some(block_uid.to_string()),
                block_ix: Some(block_ix),
                slash_index: Some(match_query.slash_index),
                query: match_query.query,
                selected_index: 0,
                layer_priority,
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

        let layer_priority = if self.editor.wikilink_menu.open
            && self.editor.wikilink_menu.pane == pane
            && self.editor.wikilink_menu.block_uid.as_deref() == Some(block_uid)
            && self.editor.wikilink_menu.block_ix == Some(block_ix)
            && self.editor.wikilink_menu.range_start == Some(query.range_start)
            && self.editor.wikilink_menu.range_end == Some(query.range_end)
        {
            self.editor.wikilink_menu.layer_priority
        } else {
            self.next_popup_layer_priority()
        };

        self.close_outline_menu();
        self.close_link_preview();
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
            layer_priority,
        };
        self.close_slash_menu();
        cx.notify();
    }

    pub(crate) fn close_wikilink_menu(&mut self) {
        self.editor.wikilink_menu = WikilinkMenuState::closed();
    }

    pub(crate) fn toggle_outline_menu(&mut self, pane: EditorPane, cx: &mut Context<Self>) {
        if self.editor.outline_menu.open && self.editor.outline_menu.pane == pane {
            self.editor.outline_menu = OutlineMenuState::closed();
        } else {
            self.editor.outline_menu = OutlineMenuState {
                open: true,
                pane,
                layer_priority: self.next_popup_layer_priority(),
            };
            self.close_link_preview();
        }
        self.close_slash_menu();
        self.close_wikilink_menu();
        cx.notify();
    }

    pub(crate) fn close_outline_menu(&mut self) {
        self.editor.outline_menu = OutlineMenuState::closed();
    }

    pub(crate) fn close_link_preview(&mut self) {
        self.editor.link_preview = None;
        self.editor.link_preview_hovering_link = false;
    }

    pub(crate) fn filtered_slash_commands(&self) -> Vec<&'static SlashCommandDef> {
        helpers::filter_slash_commands(&self.editor.slash_menu.query, SLASH_COMMANDS)
    }

    fn selected_slash_command(&mut self) -> Option<&'static SlashCommandDef> {
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

        // `shape_line` panics on embedded newlines, so shape only the current line segment.
        let line_start = text[..cursor]
            .char_indices()
            .rev()
            .find_map(|(ix, ch)| (ch == '\n' || ch == '\r').then_some(ix + ch.len_utf8()))
            .unwrap_or(0);
        let line_text = &text[line_start..cursor];
        if line_text.is_empty() {
            return px(0.0);
        }

        let text_style = window.text_style();
        let font_size = text_style.font_size.to_pixels(window.rem_size());
        let display_text: SharedString = line_text.to_string().into();
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
        let history_before = self.pane_snapshot(pane, cx);
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
        self.sync_block_input_from_active_with_cursor_for_pane(pane, next_cursor, Some(window), cx);
        window.focus(&self.editor.block_input.focus_handle(cx), cx);
        self.close_wikilink_menu();
        self.mark_dirty_for_pane(pane, cx);
        self.schedule_references_refresh(cx);
        self.record_structural_history_if_changed(pane, history_before, cx);

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
        self.close_outline_menu();

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
            let layer_priority = self.next_popup_layer_priority();
            self.editor.link_preview = Some(LinkPreviewState {
                open: true,
                page_uid,
                title: cache.title,
                blocks: cache.blocks,
                position,
                loading: false,
                layer_priority,
            });
            cx.notify();
            return;
        }

        let layer_priority = self.next_popup_layer_priority();
        self.editor.link_preview = Some(LinkPreviewState {
            open: true,
            page_uid: page_uid.clone(),
            title: title.clone(),
            blocks: Vec::new(),
            position,
            loading: true,
            layer_priority,
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
                this.close_link_preview();
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    pub(crate) fn keep_link_preview_open(&mut self) {
        self.editor.link_preview_close_epoch += 1;
    }

    pub(crate) fn copy_block_text_to_clipboard(
        &mut self,
        block_uid: &str,
        text: &str,
        cx: &mut Context<Self>,
    ) {
        cx.write_to_clipboard(gpui::ClipboardItem::new_string(text.to_string()));
        self.editor.copied_block_uid = Some(block_uid.to_string());
        self.editor.copied_epoch += 1;
        let epoch = self.editor.copied_epoch;
        cx.notify();

        cx.spawn(async move |this, cx| {
            cx.background_executor()
                .timer(Duration::from_millis(1200))
                .await;
            this.update(cx, |this, cx| {
                if this.editor.copied_epoch != epoch {
                    return;
                }
                this.editor.copied_block_uid = None;
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    pub(crate) fn ensure_diagram_preview(
        &mut self,
        block_uid: &str,
        source: &str,
        cx: &mut Context<Self>,
    ) {
        let source = source.trim();
        let block_uid = block_uid.to_string();

        if source.is_empty() {
            self.editor.diagram_previews.insert(
                block_uid,
                DiagramPreviewState {
                    key: String::new(),
                    loading: false,
                    error: Some("Unable to render diagram preview.".into()),
                    image: None,
                    epoch: 0,
                },
            );
            cx.notify();
            return;
        }

        let key = diagram::diagram_cache_key(source);
        if let Some(image) = self.editor.diagram_preview_cache.get(&key).cloned() {
            self.editor.diagram_previews.insert(
                block_uid,
                DiagramPreviewState {
                    key,
                    loading: false,
                    error: None,
                    image: Some(image),
                    epoch: 0,
                },
            );
            return;
        }

        let entry = self.editor.diagram_previews.entry(block_uid.clone());
        let state = entry.or_insert_with(|| DiagramPreviewState {
            key: key.clone(),
            loading: false,
            error: None,
            image: None,
            epoch: 0,
        });

        if state.key == key && (state.loading || state.image.is_some()) {
            return;
        }

        state.key = key.clone();
        state.loading = true;
        state.error = None;
        state.image = None;
        state.epoch += 1;
        let epoch = state.epoch;

        cx.notify();

        let source = source.to_string();
        cx.spawn(async move |this, cx| {
            let result = diagram::render_mermaid_svg(&source);
            this.update(cx, |this, cx| {
                let Some(state) = this.editor.diagram_previews.get_mut(&block_uid) else {
                    return;
                };
                if state.key != key || state.epoch != epoch {
                    return;
                }

                state.loading = false;
                match result {
                    Ok(svg) => {
                        let image = std::sync::Arc::new(gpui::Image::from_bytes(
                            gpui::ImageFormat::Svg,
                            svg.into_bytes(),
                        ));
                        this.editor
                            .diagram_preview_cache
                            .insert(key.clone(), image.clone());
                        state.image = Some(image);
                        state.error = None;
                    }
                    Err(_) => {
                        state.error = Some("Unable to render diagram preview.".into());
                    }
                }

                cx.notify();
            })
            .ok();
        })
        .detach();
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

    pub(crate) fn image_mime_type_for_path(path: &Path) -> Option<&'static str> {
        let ext = path.extension()?.to_str()?.to_ascii_lowercase();
        match ext.as_str() {
            "png" => Some("image/png"),
            "jpg" | "jpeg" => Some("image/jpeg"),
            "webp" => Some("image/webp"),
            "gif" => Some("image/gif"),
            "svg" => Some("image/svg+xml"),
            "bmp" => Some("image/bmp"),
            "tif" | "tiff" => Some("image/tiff"),
            "ico" => Some("image/ico"),
            _ => None,
        }
    }

    fn sanitize_markdown_image_alt(value: &str) -> String {
        let mut out = String::new();
        for ch in value.trim().chars() {
            if matches!(ch, '[' | ']' | '(' | ')') {
                continue;
            }
            if matches!(ch, '\n' | '\r') {
                out.push(' ');
                continue;
            }
            out.push(ch);
        }
        out.trim().to_string()
    }

    fn markdown_image_text(source: &str, original_name: Option<&str>) -> String {
        let alt = original_name
            .map(Self::sanitize_markdown_image_alt)
            .filter(|value| !value.is_empty())
            .unwrap_or_default();
        format!("![{alt}]({source})")
    }

    fn import_image_file_for_active_vault(&self, path: &Path) -> Option<String> {
        let mime_type = Self::image_mime_type_for_path(path)?;
        let file_name = path.file_name()?.to_str().unwrap_or("image");
        let bytes = std::fs::read(path).ok()?;
        let db = self.app.db.as_ref()?;
        let vault_root = self.app.active_vault_root.as_ref()?;
        let store = sandpaper_core::assets::AssetStore::new(db, vault_root);
        let record = store.store_bytes(file_name, mime_type, &bytes).ok()?;
        let source = format!("/{}", record.path.trim_start_matches('/'));
        Some(Self::markdown_image_text(&source, Some(file_name)))
    }

    fn pick_image_source_for_slash_command(&self) -> Option<String> {
        if cfg!(test) {
            return None;
        }

        let path = FileDialog::new()
            .add_filter(
                "Images",
                &[
                    "png", "jpg", "jpeg", "webp", "gif", "svg", "bmp", "tif", "tiff", "ico",
                ],
            )
            .pick_file()?;
        self.import_image_file_for_active_vault(&path)
    }

    pub(crate) fn insert_image_blocks_from_paths_in_pane(
        &mut self,
        pane: EditorPane,
        paths: &[PathBuf],
        window: Option<&mut Window>,
        cx: &mut Context<Self>,
    ) -> usize {
        if paths.is_empty() {
            return 0;
        }

        let history_before = self.pane_snapshot(pane, cx);
        let imported_sources: Vec<String> = paths
            .iter()
            .filter_map(|path| self.import_image_file_for_active_vault(path))
            .collect();
        if imported_sources.is_empty() {
            return 0;
        }

        let inserted_count = imported_sources.len();
        {
            let Some(editor) = self.editor_for_pane_mut(pane) else {
                return 0;
            };

            let (insert_ix, indent) = if editor.blocks.is_empty() {
                (0usize, 0i64)
            } else {
                let active_ix = editor.active_ix.min(editor.blocks.len().saturating_sub(1));
                (active_ix.saturating_add(1), editor.blocks[active_ix].indent)
            };

            let mut next_ix = insert_ix;
            for source in imported_sources {
                let block = BlockSnapshot {
                    uid: Uuid::new_v4().to_string(),
                    text: source,
                    indent,
                    block_type: BlockType::Image,
                };
                editor.blocks.insert(next_ix, block);
                next_ix = next_ix.saturating_add(1);
            }

            editor.active_ix = insert_ix;
        };

        self.set_active_pane(pane, cx);
        self.update_block_list_for_pane(pane);
        self.clear_selection_for_pane(pane);
        match window {
            Some(window) => {
                self.sync_block_input_from_active_for_pane(pane, Some(window), cx);
                window.focus(&self.editor.block_input.focus_handle(cx), cx);
            }
            None => {
                self.sync_block_input_from_active_for_pane(pane, None, cx);
            }
        }
        self.close_slash_menu();
        self.close_wikilink_menu();
        self.close_outline_menu();
        self.mark_dirty_for_pane(pane, cx);
        self.schedule_references_refresh(cx);
        self.record_structural_history_if_changed(pane, history_before, cx);
        inserted_count
    }

    pub(crate) fn apply_slash_command(
        &mut self,
        command_id: &str,
        action: SlashAction,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let pane = self.editor.slash_menu.pane;
        let history_before = self.pane_snapshot(pane, cx);
        let expected_uid = self.editor.slash_menu.block_uid.clone();
        let Some(block_ix) = self.editor.slash_menu.block_ix else {
            return;
        };
        let Some(slash_index) = self.editor.slash_menu.slash_index else {
            return;
        };
        let query = self.editor.slash_menu.query.clone();
        let text = {
            let Some(editor) = self.editor_for_pane(pane) else {
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
            editor.blocks[block_ix].text.clone()
        };
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

        let (next_block_type, next_text, next_cursor) = match action {
            SlashAction::SetBlockType(block_type) => {
                let raw = format!("{before}{after}");
                let cleaned = helpers::clean_text_for_block_type(&raw, block_type);
                let cursor = cleaned.len();
                (Some(block_type), cleaned, cursor)
            }
            SlashAction::TextTransform => {
                let today = Local::now().format("%Y-%m-%d").to_string();
                let (next_text, next_cursor) =
                    helpers::apply_slash_command_text(command_id, &before, &after, &today);
                (None, next_text, next_cursor)
            }
            SlashAction::InsertImage => {
                let raw = format!("{before}{after}");
                let fallback_source = helpers::extract_image_source(&raw);
                let source = self
                    .pick_image_source_for_slash_command()
                    .unwrap_or_else(|| {
                        if let Some(source) = fallback_source {
                            Self::markdown_image_text(&source, None)
                        } else {
                            raw.trim().to_string()
                        }
                    });
                let cursor = source.len();
                (Some(BlockType::Image), source, cursor)
            }
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
        if let Some(block_type) = next_block_type {
            editor.blocks[block_ix].block_type = block_type;
        }
        editor.blocks[block_ix].text = next_text.clone();
        editor.active_ix = block_ix;
        self.set_active_pane(pane, cx);
        self.sync_block_input_from_active_with_cursor_for_pane(pane, next_cursor, Some(window), cx);
        window.focus(&self.editor.block_input.focus_handle(cx), cx);
        self.close_slash_menu();
        self.mark_dirty_for_pane(pane, cx);
        self.schedule_references_refresh(cx);
        self.record_structural_history_if_changed(pane, history_before, cx);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::{point, px, KeyDownEvent, Keystroke, TestAppContext};
    use gpui_component::Root;
    use std::cell::RefCell;
    use std::rc::Rc;

    #[gpui::test]
    fn popup_layer_priority_increases_for_new_overlays(cx: &mut TestAppContext) {
        cx.skip_drawing();
        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        cx.update_window(*window, |_root, _window, cx| {
            app.update(cx, |app, cx| {
                app.update_slash_menu(EditorPane::Primary, "block-1", 0, 3, "/li", cx);
                let slash_priority = app.editor.slash_menu.layer_priority;

                app.toggle_outline_menu(EditorPane::Primary, cx);
                let outline_priority = app.editor.outline_menu.layer_priority;

                app.open_link_preview("missing-page", point(px(40.0), px(40.0)), cx);
                let preview_priority = app
                    .editor
                    .link_preview
                    .as_ref()
                    .expect("link preview")
                    .layer_priority;

                assert!(outline_priority > slash_priority);
                assert!(preview_priority > outline_priority);
            });
        })
        .unwrap();
    }

    #[gpui::test]
    fn slash_menu_keeps_priority_until_closed(cx: &mut TestAppContext) {
        cx.skip_drawing();
        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        cx.update_window(*window, |_root, _window, cx| {
            app.update(cx, |app, cx| {
                app.app.mode = Mode::Editor;
                app.update_slash_menu(EditorPane::Primary, "block-1", 0, 2, "/l", cx);
                let first_priority = app.editor.slash_menu.layer_priority;

                app.update_slash_menu(EditorPane::Primary, "block-1", 0, 3, "/li", cx);
                let same_popup_priority = app.editor.slash_menu.layer_priority;
                assert_eq!(same_popup_priority, first_priority);

                app.close_slash_menu();
                app.update_slash_menu(EditorPane::Primary, "block-1", 0, 4, "/lin", cx);
                let reopened_priority = app.editor.slash_menu.layer_priority;
                assert!(reopened_priority > first_priority);
            });
        })
        .unwrap();
    }

    #[gpui::test]
    fn opening_slash_menu_closes_conflicting_overlays(cx: &mut TestAppContext) {
        cx.skip_drawing();
        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        cx.update_window(*window, |_root, _window, cx| {
            app.update(cx, |app, cx| {
                app.app.mode = Mode::Editor;
                app.editor.outline_menu = OutlineMenuState {
                    open: true,
                    pane: EditorPane::Primary,
                    layer_priority: 7,
                };
                app.editor.link_preview = Some(LinkPreviewState {
                    open: true,
                    page_uid: "preview-page".to_string(),
                    title: "Preview".to_string(),
                    blocks: vec!["one".to_string()],
                    position: point(px(40.0), px(40.0)),
                    loading: false,
                    layer_priority: 8,
                });
                app.editor.link_preview_hovering_link = true;

                app.update_slash_menu(EditorPane::Primary, "block-1", 0, 3, "/li", cx);

                assert!(app.editor.slash_menu.open);
                assert!(!app.editor.outline_menu.open);
                assert!(app.editor.link_preview.is_none());
                assert!(!app.editor.link_preview_hovering_link);
            });
        })
        .unwrap();
    }

    #[gpui::test]
    fn opening_wikilink_menu_closes_conflicting_overlays(cx: &mut TestAppContext) {
        cx.skip_drawing();
        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        cx.update_window(*window, |_root, _window, cx| {
            app.update(cx, |app, cx| {
                app.app.mode = Mode::Editor;
                app.editor.outline_menu = OutlineMenuState {
                    open: true,
                    pane: EditorPane::Primary,
                    layer_priority: 7,
                };
                app.editor.link_preview = Some(LinkPreviewState {
                    open: true,
                    page_uid: "preview-page".to_string(),
                    title: "Preview".to_string(),
                    blocks: vec!["one".to_string()],
                    position: point(px(40.0), px(40.0)),
                    loading: false,
                    layer_priority: 8,
                });
                app.editor.link_preview_hovering_link = true;

                app.update_wikilink_menu(EditorPane::Primary, "block-1", 0, 4, "[[ab", cx);

                assert!(app.editor.wikilink_menu.open);
                assert!(!app.editor.outline_menu.open);
                assert!(app.editor.link_preview.is_none());
                assert!(!app.editor.link_preview_hovering_link);
            });
        })
        .unwrap();
    }

    #[gpui::test]
    fn opening_link_preview_closes_outline_overlay(cx: &mut TestAppContext) {
        cx.skip_drawing();
        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        cx.update_window(*window, |_root, _window, cx| {
            app.update(cx, |app, cx| {
                app.editor.outline_menu = OutlineMenuState {
                    open: true,
                    pane: EditorPane::Primary,
                    layer_priority: 12,
                };

                app.open_link_preview("missing-page", point(px(70.0), px(40.0)), cx);

                assert!(app.editor.link_preview.is_some());
                assert!(!app.editor.outline_menu.open);
            });
        })
        .unwrap();
    }

    #[test]
    fn row_height_baseline_has_descender_headroom() {
        let height = AppStore::row_height_for_block_text("single line");
        assert_eq!(height, px(34.0));
    }

    #[test]
    fn row_height_for_markdown_list_stacks_from_baseline() {
        let text = "- one\n- two\n- three";
        let expected = px(BLOCK_ROW_HEIGHT + COMPACT_ROW_HEIGHT * 2.0);
        assert_eq!(AppStore::row_height_for_block_text(text), expected);
    }

    #[test]
    fn row_height_for_multiline_text_stacks_from_baseline() {
        let text = "line one\nline two\nline three";
        let expected = px(BLOCK_ROW_HEIGHT + COMPACT_ROW_HEIGHT * 2.0);
        assert_eq!(AppStore::row_height_for_block_text(text), expected);
    }

    #[test]
    fn row_height_for_callout_includes_renderer_padding() {
        let height = AppStore::row_height_for_block_type_and_text(
            BlockType::Callout,
            "Important notice here",
        );
        assert_eq!(height, px(44.0));
    }

    #[test]
    fn row_height_for_heading_includes_top_margin() {
        let h1 = AppStore::row_height_for_block_type_and_text(BlockType::Heading1, "Heading");
        let h2 = AppStore::row_height_for_block_type_and_text(BlockType::Heading2, "Heading");
        let h3 = AppStore::row_height_for_block_type_and_text(BlockType::Heading3, "Heading");
        assert_eq!(h1, px(52.0));
        assert_eq!(h2, px(48.0));
        assert_eq!(h3, px(42.0));
    }

    #[test]
    fn row_height_for_multiline_code_includes_padding() {
        let text = "fn main() {\n  println!(\"hello\");\n}";
        let height = AppStore::row_height_for_block_type_and_text(BlockType::Code, text);
        assert_eq!(height, px(104.0));
    }

    #[test]
    fn row_height_for_database_and_column_layout_reserves_renderer_space() {
        let db = AppStore::row_height_for_block_type_and_text(
            BlockType::DatabaseView,
            "Database view block",
        );
        let columns = AppStore::row_height_for_block_type_and_text(
            BlockType::ColumnLayout,
            "Column layout block",
        );

        assert_eq!(db, px(294.0));
        assert_eq!(columns, px(90.0));
    }

    #[test]
    fn row_height_for_image_reserves_preview_space() {
        let image = AppStore::row_height_for_block_type_and_text(
            BlockType::Image,
            "https://example.com/cat.png",
        );
        assert_eq!(image, px(254.0));
    }

    #[test]
    fn row_height_for_column_layout_tracks_tallest_column_content() {
        let blocks = vec![
            BlockSnapshot {
                uid: "layout".to_string(),
                text: "2-column layout".to_string(),
                indent: 0,
                block_type: BlockType::ColumnLayout,
            },
            BlockSnapshot {
                uid: "col-left".to_string(),
                text: "Left".to_string(),
                indent: 1,
                block_type: BlockType::Column,
            },
            BlockSnapshot {
                uid: "left-1".to_string(),
                text: "One".to_string(),
                indent: 2,
                block_type: BlockType::Text,
            },
            BlockSnapshot {
                uid: "left-2".to_string(),
                text: "Two".to_string(),
                indent: 2,
                block_type: BlockType::Text,
            },
            BlockSnapshot {
                uid: "left-3".to_string(),
                text: "Three".to_string(),
                indent: 2,
                block_type: BlockType::Text,
            },
            BlockSnapshot {
                uid: "col-right".to_string(),
                text: "Right".to_string(),
                indent: 1,
                block_type: BlockType::Column,
            },
            BlockSnapshot {
                uid: "right-1".to_string(),
                text: "Single row".to_string(),
                indent: 2,
                block_type: BlockType::Text,
            },
        ];

        let height = AppStore::row_height_for_column_layout_block(&blocks, 0);
        assert!(height > px(90.0));
    }

    #[gpui::test]
    fn undo_redo_replays_structural_edit(cx: &mut TestAppContext) {
        cx.skip_drawing();
        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        cx.update_window(*window, |_root, window, cx| {
            app.update(cx, |app, cx| {
                app.app.mode = Mode::Editor;
                app.editor.active_page = Some(PageRecord {
                    id: 1,
                    uid: "page-a".to_string(),
                    title: "Page A".to_string(),
                });
                app.editor.editor = Some(EditorModel::new(vec![BlockSnapshot {
                    uid: "a1".to_string(),
                    text: "Alpha".to_string(),
                    indent: 0,
                    block_type: BlockType::Text,
                }]));
                app.editor.blocks_list_state.reset(1, px(BLOCK_ROW_HEIGHT));
                app.update_block_list_for_pane(EditorPane::Primary);
                app.sync_block_input_from_active_with_cursor_for_pane(
                    EditorPane::Primary,
                    5,
                    Some(window),
                    cx,
                );

                app.duplicate_block(&DuplicateBlock, window, cx);
                assert_eq!(app.editor.editor.as_ref().expect("editor").blocks.len(), 2);
                assert_eq!(app.editor.undo_stack.len(), 1);

                app.undo_edit_action(&UndoEdit, window, cx);
                assert_eq!(app.editor.editor.as_ref().expect("editor").blocks.len(), 1);
                assert_eq!(app.editor.redo_stack.len(), 1);

                app.redo_edit_action(&RedoEdit, window, cx);
                assert_eq!(app.editor.editor.as_ref().expect("editor").blocks.len(), 2);
                assert!(app.editor.redo_stack.is_empty());
            });
        })
        .unwrap();
    }

    #[gpui::test]
    fn text_history_coalesces_recent_input_updates(cx: &mut TestAppContext) {
        cx.skip_drawing();
        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        cx.update_window(*window, |_root, window, cx| {
            app.update(cx, |app, cx| {
                app.app.mode = Mode::Editor;
                app.editor.active_page = Some(PageRecord {
                    id: 1,
                    uid: "page-a".to_string(),
                    title: "Page A".to_string(),
                });
                app.editor.editor = Some(EditorModel::new(vec![BlockSnapshot {
                    uid: "a1".to_string(),
                    text: String::new(),
                    indent: 0,
                    block_type: BlockType::Text,
                }]));
                app.editor.blocks_list_state.reset(1, px(BLOCK_ROW_HEIGHT));
                app.update_block_list_for_pane(EditorPane::Primary);
                app.sync_block_input_from_active_with_cursor_for_pane(
                    EditorPane::Primary,
                    0,
                    Some(window),
                    cx,
                );

                if let Some(editor) = app.editor.editor.as_mut() {
                    editor.blocks[0].text = "h".to_string();
                }
                app.record_text_history_change(
                    EditorPane::Primary,
                    "page-a",
                    "a1",
                    "".to_string(),
                    "h".to_string(),
                    0,
                    1,
                );
                if let Some(editor) = app.editor.editor.as_mut() {
                    editor.blocks[0].text = "he".to_string();
                }
                app.record_text_history_change(
                    EditorPane::Primary,
                    "page-a",
                    "a1",
                    "h".to_string(),
                    "he".to_string(),
                    1,
                    2,
                );

                assert_eq!(
                    app.editor
                        .editor
                        .as_ref()
                        .expect("editor")
                        .blocks
                        .first()
                        .expect("block")
                        .text,
                    "he"
                );
                assert_eq!(app.editor.undo_stack.len(), 1);
                assert!(matches!(
                    app.editor.undo_stack.first(),
                    Some(HistoryEntry::Text(_))
                ));

                app.undo_edit_action(&UndoEdit, window, cx);
                assert_eq!(
                    app.editor
                        .editor
                        .as_ref()
                        .expect("editor")
                        .blocks
                        .first()
                        .expect("block")
                        .text,
                    ""
                );

                app.redo_edit_action(&RedoEdit, window, cx);
                assert_eq!(
                    app.editor
                        .editor
                        .as_ref()
                        .expect("editor")
                        .blocks
                        .first()
                        .expect("block")
                        .text,
                    "he"
                );
            });
        })
        .unwrap();
    }

    #[gpui::test]
    fn global_history_undo_auto_switches_pages(cx: &mut TestAppContext) {
        cx.skip_drawing();
        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        cx.update_window(*window, |_root, window, cx| {
            app.update(cx, |app, cx| {
                app.app.mode = Mode::Editor;
                let mut db = Database::new_in_memory().expect("db init");
                db.run_migrations().expect("migrations");
                db.insert_page("page-a", "Page A").expect("insert page a");
                db.insert_page("page-b", "Page B").expect("insert page b");
                let page_a = db
                    .get_page_by_uid("page-a")
                    .expect("page a lookup")
                    .expect("page a");
                let page_b = db
                    .get_page_by_uid("page-b")
                    .expect("page b lookup")
                    .expect("page b");
                db.replace_blocks_for_page(
                    page_a.id,
                    &[BlockSnapshot {
                        uid: "a1".to_string(),
                        text: "A".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    }],
                )
                .expect("seed page a");
                db.replace_blocks_for_page(
                    page_b.id,
                    &[BlockSnapshot {
                        uid: "b1".to_string(),
                        text: "B".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    }],
                )
                .expect("seed page b");

                app.app.db = Some(db);
                app.editor.pages = app
                    .app
                    .db
                    .as_ref()
                    .expect("db")
                    .list_pages()
                    .expect("list pages");

                app.open_page("page-a", cx);
                app.duplicate_block(&DuplicateBlock, window, cx);
                app.open_page("page-b", cx);
                app.duplicate_block(&DuplicateBlock, window, cx);

                app.undo_edit_action(&UndoEdit, window, cx);
                assert_eq!(
                    app.editor.active_page.as_ref().expect("active page").uid,
                    "page-b"
                );
                assert_eq!(app.editor.editor.as_ref().expect("editor").blocks.len(), 1);

                app.undo_edit_action(&UndoEdit, window, cx);
                assert_eq!(
                    app.editor.active_page.as_ref().expect("active page").uid,
                    "page-a"
                );
                assert_eq!(app.editor.editor.as_ref().expect("editor").blocks.len(), 1);
            });
        })
        .unwrap();
    }

    #[gpui::test]
    fn select_all_blocks_action_selects_visible_block_range(cx: &mut TestAppContext) {
        cx.skip_drawing();
        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        cx.update_window(*window, |_root, window, cx| {
            app.update(cx, |app, cx| {
                app.app.mode = Mode::Editor;
                app.editor.active_page = Some(PageRecord {
                    id: 1,
                    uid: "page-a".to_string(),
                    title: "Page A".to_string(),
                });
                app.editor.editor = Some(EditorModel::new(vec![
                    BlockSnapshot {
                        uid: "a1".to_string(),
                        text: "One".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a2".to_string(),
                        text: "Two".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a3".to_string(),
                        text: "Three".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                ]));
                app.editor.blocks_list_state.reset(3, px(BLOCK_ROW_HEIGHT));
                app.update_block_list_for_pane(EditorPane::Primary);
                app.sync_block_input_from_active_with_cursor_for_pane(
                    EditorPane::Primary,
                    0,
                    Some(window),
                    cx,
                );

                app.select_all_blocks_action(&SelectAllBlocks, window, cx);

                assert_eq!(app.editor.primary_selection.range, Some((0, 2)));
                assert_eq!(app.editor.primary_selection.anchor, Some(0));
                assert_eq!(app.editor.editor.as_ref().expect("editor").active_ix, 0);
            });
        })
        .unwrap();
    }

    #[gpui::test]
    fn shift_selection_moves_with_active_edge(cx: &mut TestAppContext) {
        cx.skip_drawing();
        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        cx.update_window(*window, |_root, window, cx| {
            app.update(cx, |app, cx| {
                app.app.mode = Mode::Editor;
                app.editor.active_page = Some(PageRecord {
                    id: 1,
                    uid: "page-a".to_string(),
                    title: "Page A".to_string(),
                });
                app.editor.editor = Some(EditorModel::new(vec![
                    BlockSnapshot {
                        uid: "a1".to_string(),
                        text: "One".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a2".to_string(),
                        text: "Two".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a3".to_string(),
                        text: "Three".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                ]));
                if let Some(editor) = app.editor.editor.as_mut() {
                    editor.active_ix = 1;
                }
                app.editor.blocks_list_state.reset(3, px(BLOCK_ROW_HEIGHT));
                app.update_block_list_for_pane(EditorPane::Primary);
                app.sync_block_input_from_active_with_cursor_for_pane(
                    EditorPane::Primary,
                    3,
                    Some(window),
                    cx,
                );

                assert!(app.extend_block_selection_with_arrow_for_pane(
                    EditorPane::Primary,
                    true,
                    window,
                    cx
                ));
                assert_eq!(app.editor.primary_selection.range, Some((1, 2)));
                assert_eq!(app.editor.primary_selection.anchor, Some(1));
                assert_eq!(app.editor.editor.as_ref().expect("editor").active_ix, 2);

                assert!(app.extend_block_selection_with_arrow_for_pane(
                    EditorPane::Primary,
                    false,
                    window,
                    cx
                ));
                assert_eq!(app.editor.primary_selection.range, None);
                assert_eq!(app.editor.primary_selection.anchor, Some(1));
                assert_eq!(app.editor.editor.as_ref().expect("editor").active_ix, 1);

                assert!(app.extend_block_selection_with_arrow_for_pane(
                    EditorPane::Primary,
                    false,
                    window,
                    cx
                ));
                assert_eq!(app.editor.primary_selection.range, Some((0, 1)));
                assert_eq!(app.editor.primary_selection.anchor, Some(1));
                assert_eq!(app.editor.editor.as_ref().expect("editor").active_ix, 0);

                assert!(!app.extend_block_selection_with_arrow_for_pane(
                    EditorPane::Primary,
                    false,
                    window,
                    cx
                ));
            });
        })
        .unwrap();
    }

    #[gpui::test]
    fn mouse_move_below_threshold_does_not_start_range_selection_primary(cx: &mut TestAppContext) {
        cx.skip_drawing();
        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        cx.update_window(*window, |_root, _window, cx| {
            app.update(cx, |app, cx| {
                app.app.mode = Mode::Editor;
                app.editor.active_page = Some(PageRecord {
                    id: 1,
                    uid: "page-a".to_string(),
                    title: "Page A".to_string(),
                });
                app.editor.editor = Some(EditorModel::new(vec![
                    BlockSnapshot {
                        uid: "a1".to_string(),
                        text: "One".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a2".to_string(),
                        text: "Two".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a3".to_string(),
                        text: "Three".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                ]));
                app.editor.blocks_list_state.reset(3, px(BLOCK_ROW_HEIGHT));
                app.update_block_list_for_pane(EditorPane::Primary);

                app.begin_block_pointer_selection_in_pane(
                    EditorPane::Primary,
                    0,
                    point(px(10.0), px(10.0)),
                    false,
                );
                app.update_block_pointer_selection_in_pane(
                    EditorPane::Primary,
                    1,
                    point(px(13.0), px(13.0)),
                    cx,
                );

                let selection = app
                    .selection_for_pane(EditorPane::Primary)
                    .expect("selection");
                assert!(!selection.dragging);
                assert_eq!(selection.range, None);
                assert_eq!(selection.anchor, Some(0));

                app.end_block_pointer_selection_in_pane(EditorPane::Primary, cx);
                let selection = app
                    .selection_for_pane(EditorPane::Primary)
                    .expect("selection");
                assert!(!selection.dragging);
                assert!(!selection.drag_completed);
            });
        })
        .unwrap();
    }

    #[gpui::test]
    fn mouse_move_above_threshold_starts_range_selection_primary(cx: &mut TestAppContext) {
        cx.skip_drawing();
        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        cx.update_window(*window, |_root, _window, cx| {
            app.update(cx, |app, cx| {
                app.app.mode = Mode::Editor;
                app.editor.active_page = Some(PageRecord {
                    id: 1,
                    uid: "page-a".to_string(),
                    title: "Page A".to_string(),
                });
                app.editor.editor = Some(EditorModel::new(vec![
                    BlockSnapshot {
                        uid: "a1".to_string(),
                        text: "One".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a2".to_string(),
                        text: "Two".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a3".to_string(),
                        text: "Three".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                ]));
                app.editor.blocks_list_state.reset(3, px(BLOCK_ROW_HEIGHT));
                app.update_block_list_for_pane(EditorPane::Primary);

                app.begin_block_pointer_selection_in_pane(
                    EditorPane::Primary,
                    0,
                    point(px(10.0), px(10.0)),
                    false,
                );
                app.update_block_pointer_selection_in_pane(
                    EditorPane::Primary,
                    1,
                    point(px(24.0), px(10.0)),
                    cx,
                );

                let selection = app
                    .selection_for_pane(EditorPane::Primary)
                    .expect("selection");
                assert!(selection.dragging);
                assert_eq!(selection.range, Some((0, 1)));
                assert_eq!(selection.anchor, Some(0));

                app.end_block_pointer_selection_in_pane(EditorPane::Primary, cx);
                let selection = app
                    .selection_for_pane(EditorPane::Primary)
                    .expect("selection");
                assert!(!selection.dragging);
                assert!(selection.drag_completed);
                assert_eq!(selection.range, Some((0, 1)));
            });
        })
        .unwrap();
    }

    #[gpui::test]
    fn shift_click_extends_range_and_focuses_clicked_endpoint_primary(cx: &mut TestAppContext) {
        cx.skip_drawing();
        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        cx.update_window(*window, |_root, window, cx| {
            app.update(cx, |app, cx| {
                app.app.mode = Mode::Editor;
                app.editor.active_page = Some(PageRecord {
                    id: 1,
                    uid: "page-a".to_string(),
                    title: "Page A".to_string(),
                });
                app.editor.editor = Some(EditorModel::new(vec![
                    BlockSnapshot {
                        uid: "a1".to_string(),
                        text: "One".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a2".to_string(),
                        text: "Two".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a3".to_string(),
                        text: "Three".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a4".to_string(),
                        text: "Four".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                ]));
                if let Some(editor) = app.editor.editor.as_mut() {
                    editor.active_ix = 1;
                }
                app.editor.blocks_list_state.reset(4, px(BLOCK_ROW_HEIGHT));
                app.update_block_list_for_pane(EditorPane::Primary);
                app.sync_block_input_from_active_with_cursor_for_pane(
                    EditorPane::Primary,
                    0,
                    Some(window),
                    cx,
                );
                if let Some(selection) = app.selection_for_pane_mut(EditorPane::Primary) {
                    selection.anchor = Some(1);
                }

                assert!(app.shift_click_block_in_pane(EditorPane::Primary, 3, window, cx));

                assert_eq!(app.editor.primary_selection.range, Some((1, 3)));
                assert_eq!(app.editor.primary_selection.anchor, Some(1));
                assert!(!app.editor.primary_selection.drag_completed);
                assert_eq!(app.editor.editor.as_ref().expect("editor").active_ix, 3);
                assert_eq!(app.editor.block_input.read(cx).cursor(), "Four".len());
            });
        })
        .unwrap();
    }

    #[gpui::test]
    fn shift_click_extends_range_and_focuses_clicked_endpoint_secondary(cx: &mut TestAppContext) {
        cx.skip_drawing();
        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        cx.update_window(*window, |_root, window, cx| {
            app.update(cx, |app, cx| {
                app.app.mode = Mode::Editor;
                app.editor.active_page = Some(PageRecord {
                    id: 1,
                    uid: "page-a".to_string(),
                    title: "Page A".to_string(),
                });
                app.editor.editor = Some(EditorModel::new(vec![BlockSnapshot {
                    uid: "a1".to_string(),
                    text: "Primary".to_string(),
                    indent: 0,
                    block_type: BlockType::Text,
                }]));
                app.editor.blocks_list_state.reset(1, px(BLOCK_ROW_HEIGHT));
                app.update_block_list_for_pane(EditorPane::Primary);

                let secondary_blocks = vec![
                    BlockSnapshot {
                        uid: "b1".to_string(),
                        text: "One".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "b2".to_string(),
                        text: "Two".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "b3".to_string(),
                        text: "Three".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                ];
                app.editor.secondary_pane = Some(SecondaryPane {
                    page: PageRecord {
                        id: 2,
                        uid: "page-b".to_string(),
                        title: "Page B".to_string(),
                    },
                    editor: EditorModel::new(secondary_blocks),
                    list_state: PaneListState::new(3, px(BLOCK_ROW_HEIGHT)),
                    selection: PaneSelection::new(),
                    dirty: false,
                });
                app.update_block_list_for_pane(EditorPane::Secondary);
                if let Some(secondary) = app.editor.secondary_pane.as_mut() {
                    secondary.editor.active_ix = 0;
                    secondary.selection.anchor = Some(0);
                }
                app.set_active_pane(EditorPane::Secondary, cx);
                app.sync_block_input_from_active_with_cursor_for_pane(
                    EditorPane::Secondary,
                    0,
                    Some(window),
                    cx,
                );

                assert!(app.shift_click_block_in_pane(EditorPane::Secondary, 2, window, cx));

                let secondary = app.editor.secondary_pane.as_ref().expect("secondary pane");
                assert_eq!(secondary.selection.range, Some((0, 2)));
                assert_eq!(secondary.selection.anchor, Some(0));
                assert!(!secondary.selection.drag_completed);
                assert_eq!(secondary.editor.active_ix, 2);
                assert_eq!(app.editor.active_pane, EditorPane::Secondary);
                assert_eq!(app.editor.block_input.read(cx).cursor(), "Three".len());
            });
        })
        .unwrap();
    }

    #[gpui::test]
    fn secondary_up_jumps_to_first_visible_block(cx: &mut TestAppContext) {
        cx.skip_drawing();
        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        cx.update_window(*window, |_root, window, cx| {
            app.update(cx, |app, cx| {
                app.app.mode = Mode::Editor;
                app.editor.active_page = Some(PageRecord {
                    id: 1,
                    uid: "page-a".to_string(),
                    title: "Page A".to_string(),
                });
                app.editor.editor = Some(EditorModel::new(vec![
                    BlockSnapshot {
                        uid: "a1".to_string(),
                        text: "One".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a2".to_string(),
                        text: "Two".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a3".to_string(),
                        text: "Three".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                ]));
                if let Some(editor) = app.editor.editor.as_mut() {
                    editor.active_ix = 2;
                }
                app.editor.blocks_list_state.reset(3, px(BLOCK_ROW_HEIGHT));
                app.update_block_list_for_pane(EditorPane::Primary);
                app.sync_block_input_from_active_with_cursor_for_pane(
                    EditorPane::Primary,
                    2,
                    Some(window),
                    cx,
                );

                let key_down = KeyDownEvent {
                    keystroke: Keystroke::parse("secondary-up").expect("parse keystroke"),
                    is_held: false,
                    prefer_character_input: false,
                };
                assert!(app.handle_block_input_key_down(
                    EditorPane::Primary,
                    &key_down,
                    window,
                    cx
                ));
                assert_eq!(app.editor.editor.as_ref().expect("editor").active_ix, 0);
                assert_eq!(app.editor.block_input.read(cx).cursor(), 0);
            });
        })
        .unwrap();
    }

    #[gpui::test]
    fn secondary_shift_down_extends_selection_to_last_visible_block(cx: &mut TestAppContext) {
        cx.skip_drawing();
        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        cx.update_window(*window, |_root, window, cx| {
            app.update(cx, |app, cx| {
                app.app.mode = Mode::Editor;
                app.editor.active_page = Some(PageRecord {
                    id: 1,
                    uid: "page-a".to_string(),
                    title: "Page A".to_string(),
                });
                app.editor.editor = Some(EditorModel::new(vec![
                    BlockSnapshot {
                        uid: "a1".to_string(),
                        text: "One".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a2".to_string(),
                        text: "Two".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a3".to_string(),
                        text: "Three".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a4".to_string(),
                        text: "Four".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                ]));
                if let Some(editor) = app.editor.editor.as_mut() {
                    editor.active_ix = 1;
                }
                app.editor.blocks_list_state.reset(4, px(BLOCK_ROW_HEIGHT));
                app.update_block_list_for_pane(EditorPane::Primary);
                app.sync_block_input_from_active_with_cursor_for_pane(
                    EditorPane::Primary,
                    0,
                    Some(window),
                    cx,
                );

                let key_down = KeyDownEvent {
                    keystroke: Keystroke::parse("secondary-shift-down").expect("parse keystroke"),
                    is_held: false,
                    prefer_character_input: false,
                };
                assert!(app.handle_block_input_key_down(
                    EditorPane::Primary,
                    &key_down,
                    window,
                    cx
                ));
                assert_eq!(app.editor.primary_selection.range, Some((1, 3)));
                assert_eq!(app.editor.primary_selection.anchor, Some(1));
                assert_eq!(app.editor.editor.as_ref().expect("editor").active_ix, 3);
                assert_eq!(app.editor.block_input.read(cx).cursor(), 0);
            });
        })
        .unwrap();
    }

    #[gpui::test]
    fn plain_up_repeats_block_navigation(cx: &mut TestAppContext) {
        cx.skip_drawing();
        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        cx.update_window(*window, |_root, window, cx| {
            app.update(cx, |app, cx| {
                app.app.mode = Mode::Editor;
                app.editor.active_page = Some(PageRecord {
                    id: 1,
                    uid: "page-a".to_string(),
                    title: "Page A".to_string(),
                });
                app.editor.editor = Some(EditorModel::new(vec![
                    BlockSnapshot {
                        uid: "a1".to_string(),
                        text: "One".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a2".to_string(),
                        text: "Two".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a3".to_string(),
                        text: "Three".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                ]));
                if let Some(editor) = app.editor.editor.as_mut() {
                    editor.active_ix = 2;
                }
                app.editor.blocks_list_state.reset(3, px(BLOCK_ROW_HEIGHT));
                app.update_block_list_for_pane(EditorPane::Primary);
                app.sync_block_input_from_active_with_cursor_for_pane(
                    EditorPane::Primary,
                    0,
                    Some(window),
                    cx,
                );

                let up = KeyDownEvent {
                    keystroke: Keystroke::parse("up").expect("parse keystroke"),
                    is_held: false,
                    prefer_character_input: false,
                };
                assert!(app.handle_block_input_key_down(EditorPane::Primary, &up, window, cx));
                assert_eq!(app.editor.editor.as_ref().expect("editor").active_ix, 1);
                assert_eq!(app.editor.block_input.read(cx).cursor(), 0);

                assert!(app.handle_block_input_key_down(EditorPane::Primary, &up, window, cx));
                assert_eq!(app.editor.editor.as_ref().expect("editor").active_ix, 0);
                assert_eq!(app.editor.block_input.read(cx).cursor(), 0);

                assert!(!app.handle_block_input_key_down(EditorPane::Primary, &up, window, cx));
                assert_eq!(app.editor.editor.as_ref().expect("editor").active_ix, 0);
            });
        })
        .unwrap();
    }

    #[gpui::test]
    fn plain_down_repeats_block_navigation(cx: &mut TestAppContext) {
        cx.skip_drawing();
        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        cx.update_window(*window, |_root, window, cx| {
            app.update(cx, |app, cx| {
                app.app.mode = Mode::Editor;
                app.editor.active_page = Some(PageRecord {
                    id: 1,
                    uid: "page-a".to_string(),
                    title: "Page A".to_string(),
                });
                app.editor.editor = Some(EditorModel::new(vec![
                    BlockSnapshot {
                        uid: "a1".to_string(),
                        text: "One".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a2".to_string(),
                        text: "Two".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a3".to_string(),
                        text: "Three".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                ]));
                if let Some(editor) = app.editor.editor.as_mut() {
                    editor.active_ix = 0;
                }
                app.editor.blocks_list_state.reset(3, px(BLOCK_ROW_HEIGHT));
                app.update_block_list_for_pane(EditorPane::Primary);
                app.sync_block_input_from_active_with_cursor_for_pane(
                    EditorPane::Primary,
                    3,
                    Some(window),
                    cx,
                );

                let down = KeyDownEvent {
                    keystroke: Keystroke::parse("down").expect("parse keystroke"),
                    is_held: false,
                    prefer_character_input: false,
                };
                assert!(app.handle_block_input_key_down(EditorPane::Primary, &down, window, cx));
                assert_eq!(app.editor.editor.as_ref().expect("editor").active_ix, 1);
                assert_eq!(app.editor.block_input.read(cx).cursor(), 3);

                assert!(app.handle_block_input_key_down(EditorPane::Primary, &down, window, cx));
                assert_eq!(app.editor.editor.as_ref().expect("editor").active_ix, 2);
                assert_eq!(app.editor.block_input.read(cx).cursor(), 5);

                assert!(!app.handle_block_input_key_down(EditorPane::Primary, &down, window, cx));
                assert_eq!(app.editor.editor.as_ref().expect("editor").active_ix, 2);
            });
        })
        .unwrap();
    }

    #[gpui::test]
    fn plain_up_collapses_selection_to_first_block(cx: &mut TestAppContext) {
        cx.skip_drawing();
        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        cx.update_window(*window, |_root, window, cx| {
            app.update(cx, |app, cx| {
                app.app.mode = Mode::Editor;
                app.editor.active_page = Some(PageRecord {
                    id: 1,
                    uid: "page-a".to_string(),
                    title: "Page A".to_string(),
                });
                app.editor.editor = Some(EditorModel::new(vec![
                    BlockSnapshot {
                        uid: "a1".to_string(),
                        text: "One".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a2".to_string(),
                        text: "Two".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a3".to_string(),
                        text: "Three".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a4".to_string(),
                        text: "Four".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                ]));
                if let Some(editor) = app.editor.editor.as_mut() {
                    editor.active_ix = 2;
                }
                app.editor.blocks_list_state.reset(4, px(BLOCK_ROW_HEIGHT));
                app.update_block_list_for_pane(EditorPane::Primary);
                app.set_selection_range_for_pane(EditorPane::Primary, 1, 3);
                if let Some(selection) = app.selection_for_pane_mut(EditorPane::Primary) {
                    selection.anchor = Some(1);
                }

                let up = KeyDownEvent {
                    keystroke: Keystroke::parse("up").expect("parse keystroke"),
                    is_held: false,
                    prefer_character_input: false,
                };
                assert!(app.handle_block_input_key_down(EditorPane::Primary, &up, window, cx));
                assert_eq!(app.editor.primary_selection.range, None);
                assert_eq!(app.editor.primary_selection.anchor, Some(1));
                assert_eq!(app.editor.editor.as_ref().expect("editor").active_ix, 1);
                assert_eq!(app.editor.block_input.read(cx).cursor(), 0);
            });
        })
        .unwrap();
    }

    #[gpui::test]
    fn plain_down_collapses_selection_to_last_block(cx: &mut TestAppContext) {
        cx.skip_drawing();
        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        cx.update_window(*window, |_root, window, cx| {
            app.update(cx, |app, cx| {
                app.app.mode = Mode::Editor;
                app.editor.active_page = Some(PageRecord {
                    id: 1,
                    uid: "page-a".to_string(),
                    title: "Page A".to_string(),
                });
                app.editor.editor = Some(EditorModel::new(vec![
                    BlockSnapshot {
                        uid: "a1".to_string(),
                        text: "One".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a2".to_string(),
                        text: "Two".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a3".to_string(),
                        text: "Three".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a4".to_string(),
                        text: "Four".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                ]));
                if let Some(editor) = app.editor.editor.as_mut() {
                    editor.active_ix = 2;
                }
                app.editor.blocks_list_state.reset(4, px(BLOCK_ROW_HEIGHT));
                app.update_block_list_for_pane(EditorPane::Primary);
                app.set_selection_range_for_pane(EditorPane::Primary, 1, 3);
                if let Some(selection) = app.selection_for_pane_mut(EditorPane::Primary) {
                    selection.anchor = Some(1);
                }

                let down = KeyDownEvent {
                    keystroke: Keystroke::parse("down").expect("parse keystroke"),
                    is_held: false,
                    prefer_character_input: false,
                };
                assert!(app.handle_block_input_key_down(EditorPane::Primary, &down, window, cx));
                assert_eq!(app.editor.primary_selection.range, None);
                assert_eq!(app.editor.primary_selection.anchor, Some(3));
                assert_eq!(app.editor.editor.as_ref().expect("editor").active_ix, 3);
                assert_eq!(app.editor.block_input.read(cx).cursor(), 4);
            });
        })
        .unwrap();
    }

    #[gpui::test]
    fn commit_block_drag_moves_single_block_before_target(cx: &mut TestAppContext) {
        cx.skip_drawing();
        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        cx.update_window(*window, |_root, _window, cx| {
            app.update(cx, |app, cx| {
                app.app.mode = Mode::Editor;
                app.editor.active_page = Some(PageRecord {
                    id: 1,
                    uid: "page-a".to_string(),
                    title: "Page A".to_string(),
                });
                app.editor.editor = Some(EditorModel::new(vec![
                    BlockSnapshot {
                        uid: "a1".to_string(),
                        text: "A".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a2".to_string(),
                        text: "B".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a3".to_string(),
                        text: "C".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a4".to_string(),
                        text: "D".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                ]));
                app.editor.blocks_list_state.reset(4, px(BLOCK_ROW_HEIGHT));
                app.update_block_list_for_pane(EditorPane::Primary);

                app.editor.drag_source = Some(DragSource {
                    pane: EditorPane::Primary,
                    block_ix: 1,
                    block_uid: "a2".to_string(),
                });
                app.editor.drag_target = Some(DragTarget {
                    pane: EditorPane::Primary,
                    insert_before_ix: 3,
                });

                assert!(app.commit_block_drag_for_pane(EditorPane::Primary, cx));
                assert!(app.editor.drag_source.is_none());
                assert!(app.editor.drag_target.is_none());

                let editor = app.editor.editor.as_ref().expect("editor");
                assert_eq!(editor.blocks[0].uid, "a1");
                assert_eq!(editor.blocks[1].uid, "a3");
                assert_eq!(editor.blocks[2].uid, "a2");
                assert_eq!(editor.blocks[3].uid, "a4");
            });
        })
        .unwrap();
    }

    #[gpui::test]
    fn commit_block_drag_moves_selected_range_when_dragging_inside_selection(
        cx: &mut TestAppContext,
    ) {
        cx.skip_drawing();
        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        cx.update_window(*window, |_root, _window, cx| {
            app.update(cx, |app, cx| {
                app.app.mode = Mode::Editor;
                app.editor.active_page = Some(PageRecord {
                    id: 1,
                    uid: "page-a".to_string(),
                    title: "Page A".to_string(),
                });
                app.editor.editor = Some(EditorModel::new(vec![
                    BlockSnapshot {
                        uid: "a1".to_string(),
                        text: "A".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a2".to_string(),
                        text: "B".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a3".to_string(),
                        text: "C".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a4".to_string(),
                        text: "D".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                ]));
                app.editor.blocks_list_state.reset(4, px(BLOCK_ROW_HEIGHT));
                app.update_block_list_for_pane(EditorPane::Primary);
                app.set_selection_range_for_pane(EditorPane::Primary, 1, 2);
                if let Some(selection) = app.selection_for_pane_mut(EditorPane::Primary) {
                    selection.anchor = Some(1);
                }

                app.editor.drag_source = Some(DragSource {
                    pane: EditorPane::Primary,
                    block_ix: 2,
                    block_uid: "a3".to_string(),
                });
                app.editor.drag_target = Some(DragTarget {
                    pane: EditorPane::Primary,
                    insert_before_ix: 0,
                });

                assert!(app.commit_block_drag_for_pane(EditorPane::Primary, cx));

                let editor = app.editor.editor.as_ref().expect("editor");
                assert_eq!(editor.blocks[0].uid, "a2");
                assert_eq!(editor.blocks[1].uid, "a3");
                assert_eq!(editor.blocks[2].uid, "a1");
                assert_eq!(editor.blocks[3].uid, "a4");
                assert_eq!(app.editor.primary_selection.range, Some((0, 1)));
                assert_eq!(app.editor.primary_selection.anchor, Some(0));
            });
        })
        .unwrap();
    }

    #[gpui::test]
    fn commit_block_drag_moves_single_block_to_end_when_target_is_len(cx: &mut TestAppContext) {
        cx.skip_drawing();
        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        cx.update_window(*window, |_root, _window, cx| {
            app.update(cx, |app, cx| {
                app.app.mode = Mode::Editor;
                app.editor.active_page = Some(PageRecord {
                    id: 1,
                    uid: "page-a".to_string(),
                    title: "Page A".to_string(),
                });
                app.editor.editor = Some(EditorModel::new(vec![
                    BlockSnapshot {
                        uid: "a1".to_string(),
                        text: "A".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a2".to_string(),
                        text: "B".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a3".to_string(),
                        text: "C".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a4".to_string(),
                        text: "D".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                ]));
                app.editor.blocks_list_state.reset(4, px(BLOCK_ROW_HEIGHT));
                app.update_block_list_for_pane(EditorPane::Primary);

                app.editor.drag_source = Some(DragSource {
                    pane: EditorPane::Primary,
                    block_ix: 1,
                    block_uid: "a2".to_string(),
                });
                app.editor.drag_target = Some(DragTarget {
                    pane: EditorPane::Primary,
                    insert_before_ix: 4,
                });

                assert!(app.commit_block_drag_for_pane(EditorPane::Primary, cx));

                let editor = app.editor.editor.as_ref().expect("editor");
                assert_eq!(editor.blocks[0].uid, "a1");
                assert_eq!(editor.blocks[1].uid, "a3");
                assert_eq!(editor.blocks[2].uid, "a4");
                assert_eq!(editor.blocks[3].uid, "a2");
            });
        })
        .unwrap();
    }

    #[gpui::test]
    fn drop_image_paths_inserts_image_blocks_into_active_pane(cx: &mut TestAppContext) {
        cx.skip_drawing();
        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));
        let vault_dir = tempfile::tempdir().expect("tempdir");
        let vault_root = vault_dir.path().to_path_buf();
        let image_path = vault_root.join("cat.png");
        std::fs::write(&image_path, b"png-bytes").expect("write image");

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        cx.update_window(*window, |_root, window, cx| {
            app.update(cx, |app, cx| {
                let db = Database::new_in_memory().expect("db init");
                db.run_migrations().expect("migrations");
                app.app.db = Some(db);
                app.app.active_vault_root = Some(vault_root.clone());
                app.app.mode = Mode::Editor;
                app.editor.active_page = Some(PageRecord {
                    id: 1,
                    uid: "page-a".to_string(),
                    title: "Page A".to_string(),
                });
                app.editor.editor = Some(EditorModel::new(vec![BlockSnapshot {
                    uid: "a1".to_string(),
                    text: "A".to_string(),
                    indent: 0,
                    block_type: BlockType::Text,
                }]));
                app.editor.blocks_list_state.reset(1, px(BLOCK_ROW_HEIGHT));
                app.update_block_list_for_pane(EditorPane::Primary);

                let inserted = app.insert_image_blocks_from_paths_in_pane(
                    EditorPane::Primary,
                    std::slice::from_ref(&image_path),
                    Some(window),
                    cx,
                );
                assert_eq!(inserted, 1);

                let editor = app.editor.editor.as_ref().expect("editor");
                assert_eq!(editor.blocks.len(), 2);
                assert_eq!(editor.active_ix, 1);
                assert_eq!(editor.blocks[1].block_type, BlockType::Image);
                assert!(editor.blocks[1].text.starts_with("![cat.png](/assets/"));
                let source =
                    helpers::extract_image_source(&editor.blocks[1].text).expect("image source");
                let stored = vault_root.join(source.trim_start_matches('/'));
                assert!(stored.exists());
                assert!(app.app.primary_dirty);
            });
        })
        .unwrap();
    }

    #[gpui::test]
    fn drop_non_image_paths_does_not_mutate_editor(cx: &mut TestAppContext) {
        cx.skip_drawing();
        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));
        let vault_dir = tempfile::tempdir().expect("tempdir");
        let vault_root = vault_dir.path().to_path_buf();
        let text_path = vault_root.join("notes.txt");
        std::fs::write(&text_path, b"hello").expect("write text");

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        cx.update_window(*window, |_root, window, cx| {
            app.update(cx, |app, cx| {
                let db = Database::new_in_memory().expect("db init");
                db.run_migrations().expect("migrations");
                app.app.db = Some(db);
                app.app.active_vault_root = Some(vault_root.clone());
                app.app.mode = Mode::Editor;
                app.editor.active_page = Some(PageRecord {
                    id: 1,
                    uid: "page-a".to_string(),
                    title: "Page A".to_string(),
                });
                app.editor.editor = Some(EditorModel::new(vec![BlockSnapshot {
                    uid: "a1".to_string(),
                    text: "A".to_string(),
                    indent: 0,
                    block_type: BlockType::Text,
                }]));
                app.editor.blocks_list_state.reset(1, px(BLOCK_ROW_HEIGHT));
                app.update_block_list_for_pane(EditorPane::Primary);

                let inserted = app.insert_image_blocks_from_paths_in_pane(
                    EditorPane::Primary,
                    std::slice::from_ref(&text_path),
                    Some(window),
                    cx,
                );
                assert_eq!(inserted, 0);

                let editor = app.editor.editor.as_ref().expect("editor");
                assert_eq!(editor.blocks.len(), 1);
                assert_eq!(editor.blocks[0].block_type, BlockType::Text);
                assert!(!app.app.primary_dirty);
            });
        })
        .unwrap();
    }

    #[gpui::test]
    fn copy_paste_selection_blocks_roundtrip_preserves_block_shape(cx: &mut TestAppContext) {
        cx.skip_drawing();
        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        cx.update_window(*window, |_root, window, cx| {
            app.update(cx, |app, cx| {
                app.app.mode = Mode::Editor;
                app.editor.active_page = Some(PageRecord {
                    id: 1,
                    uid: "page-a".to_string(),
                    title: "Page A".to_string(),
                });
                app.editor.editor = Some(EditorModel::new(vec![
                    BlockSnapshot {
                        uid: "a1".to_string(),
                        text: "A".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a2".to_string(),
                        text: "B".to_string(),
                        indent: 2,
                        block_type: BlockType::Todo,
                    },
                    BlockSnapshot {
                        uid: "a3".to_string(),
                        text: "C".to_string(),
                        indent: 1,
                        block_type: BlockType::Heading2,
                    },
                ]));
                app.editor.blocks_list_state.reset(3, px(BLOCK_ROW_HEIGHT));
                app.update_block_list_for_pane(EditorPane::Primary);
                app.set_selection_range_for_pane(EditorPane::Primary, 0, 1);
                if let Some(selection) = app.selection_for_pane_mut(EditorPane::Primary) {
                    selection.anchor = Some(0);
                }

                assert!(app.copy_selection_blocks_in_pane(EditorPane::Primary, cx));
                let copied = app
                    .editor
                    .block_clipboard
                    .as_ref()
                    .expect("selection clipboard");
                assert_eq!(copied.items.len(), 2);
                assert_eq!(copied.items[0].text, "A");
                assert_eq!(copied.items[0].indent, 0);
                assert_eq!(copied.items[0].block_type, BlockType::Text);
                assert_eq!(copied.items[1].text, "B");
                assert_eq!(copied.items[1].indent, 2);
                assert_eq!(copied.items[1].block_type, BlockType::Todo);

                assert!(app.paste_selection_blocks_in_pane(EditorPane::Primary, window, cx));

                let editor = app.editor.editor.as_ref().expect("editor");
                assert_eq!(editor.blocks.len(), 5);
                assert_eq!(editor.blocks[0].text, "A");
                assert_eq!(editor.blocks[1].text, "B");
                assert_eq!(editor.blocks[2].text, "A");
                assert_eq!(editor.blocks[2].indent, 0);
                assert_eq!(editor.blocks[2].block_type, BlockType::Text);
                assert_eq!(editor.blocks[3].text, "B");
                assert_eq!(editor.blocks[3].indent, 2);
                assert_eq!(editor.blocks[3].block_type, BlockType::Todo);
                assert_eq!(editor.blocks[4].text, "C");
                assert_ne!(editor.blocks[0].uid, editor.blocks[2].uid);
                assert_ne!(editor.blocks[1].uid, editor.blocks[3].uid);
                assert_eq!(app.editor.primary_selection.range, Some((2, 3)));
            });
        })
        .unwrap();
    }

    #[gpui::test]
    fn cut_selection_blocks_removes_selected_blocks_and_populates_clipboard(
        cx: &mut TestAppContext,
    ) {
        cx.skip_drawing();
        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        cx.update_window(*window, |_root, _window, cx| {
            app.update(cx, |app, cx| {
                app.app.mode = Mode::Editor;
                app.editor.active_page = Some(PageRecord {
                    id: 1,
                    uid: "page-a".to_string(),
                    title: "Page A".to_string(),
                });
                app.editor.editor = Some(EditorModel::new(vec![
                    BlockSnapshot {
                        uid: "a1".to_string(),
                        text: "A".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a2".to_string(),
                        text: "B".to_string(),
                        indent: 1,
                        block_type: BlockType::Todo,
                    },
                    BlockSnapshot {
                        uid: "a3".to_string(),
                        text: "C".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                ]));
                app.editor.blocks_list_state.reset(3, px(BLOCK_ROW_HEIGHT));
                app.update_block_list_for_pane(EditorPane::Primary);
                app.set_selection_range_for_pane(EditorPane::Primary, 0, 1);
                if let Some(selection) = app.selection_for_pane_mut(EditorPane::Primary) {
                    selection.anchor = Some(0);
                }

                assert!(app.cut_selection_blocks_in_pane(EditorPane::Primary, cx));
                assert_eq!(app.editor.primary_selection.range, None);
                let copied = app
                    .editor
                    .block_clipboard
                    .as_ref()
                    .expect("selection clipboard");
                assert_eq!(copied.items.len(), 2);
                assert_eq!(copied.items[0].text, "A");
                assert_eq!(copied.items[1].text, "B");

                let editor = app.editor.editor.as_ref().expect("editor");
                assert_eq!(editor.blocks.len(), 1);
                assert_eq!(editor.blocks[0].text, "C");
            });
        })
        .unwrap();
    }

    #[gpui::test]
    fn paste_selection_blocks_requires_active_selection(cx: &mut TestAppContext) {
        cx.skip_drawing();
        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        cx.update_window(*window, |_root, window, cx| {
            app.update(cx, |app, cx| {
                app.app.mode = Mode::Editor;
                app.editor.active_page = Some(PageRecord {
                    id: 1,
                    uid: "page-a".to_string(),
                    title: "Page A".to_string(),
                });
                app.editor.editor = Some(EditorModel::new(vec![
                    BlockSnapshot {
                        uid: "a1".to_string(),
                        text: "A".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a2".to_string(),
                        text: "B".to_string(),
                        indent: 1,
                        block_type: BlockType::Todo,
                    },
                ]));
                app.editor.blocks_list_state.reset(2, px(BLOCK_ROW_HEIGHT));
                app.update_block_list_for_pane(EditorPane::Primary);

                app.set_selection_range_for_pane(EditorPane::Primary, 0, 1);
                assert!(app.copy_selection_blocks_in_pane(EditorPane::Primary, cx));
                app.clear_selection_for_pane(EditorPane::Primary);

                assert!(!app.paste_selection_blocks_in_pane(EditorPane::Primary, window, cx));
                let editor = app.editor.editor.as_ref().expect("editor");
                assert_eq!(editor.blocks.len(), 2);
                assert_eq!(editor.blocks[0].text, "A");
                assert_eq!(editor.blocks[1].text, "B");
            });
        })
        .unwrap();
    }

    #[gpui::test]
    fn undo_text_edit_after_focus_switch_reverts_original_block(cx: &mut TestAppContext) {
        cx.skip_drawing();
        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        cx.update_window(*window, |_root, window, cx| {
            app.update(cx, |app, cx| {
                app.app.mode = Mode::Editor;
                app.editor.active_page = Some(PageRecord {
                    id: 1,
                    uid: "page-a".to_string(),
                    title: "Page A".to_string(),
                });
                app.editor.editor = Some(EditorModel::new(vec![
                    BlockSnapshot {
                        uid: "a1".to_string(),
                        text: "Alpha".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a2".to_string(),
                        text: "Beta".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                ]));
                app.editor.blocks_list_state.reset(2, px(BLOCK_ROW_HEIGHT));
                app.update_block_list_for_pane(EditorPane::Primary);
                app.sync_block_input_from_active_with_cursor_for_pane(
                    EditorPane::Primary,
                    5,
                    Some(window),
                    cx,
                );
            });
        })
        .unwrap();

        cx.update_window(*window, |_root, window, cx| {
            app.update(cx, |app, cx| {
                app.editor.block_input.update(cx, |input, cx| {
                    input.set_value("Alpha changed".to_string(), window, cx);
                    let position = input.text().offset_to_position(13);
                    input.set_cursor_position(position, window, cx);
                });

                if let Some(editor) = app.editor.editor.as_mut() {
                    editor.active_ix = 1;
                }
                app.sync_block_input_from_active_with_cursor_for_pane(
                    EditorPane::Primary,
                    4,
                    Some(window),
                    cx,
                );
            });
        })
        .unwrap();

        cx.run_until_parked();

        cx.update_window(*window, |_root, window, cx| {
            app.update(cx, |app, cx| {
                assert_eq!(app.editor.undo_stack.len(), 1);
                let editor = app.editor.editor.as_ref().expect("editor");
                assert_eq!(editor.blocks[0].text, "Alpha changed");
                assert_eq!(editor.blocks[1].text, "Beta");

                app.undo_edit_action(&UndoEdit, window, cx);

                let editor = app.editor.editor.as_ref().expect("editor");
                assert_eq!(editor.blocks[0].text, "Alpha");
                assert_eq!(editor.blocks[1].text, "Beta");
                assert_eq!(editor.active_ix, 0);
            });
        })
        .unwrap();
    }

    #[gpui::test]
    fn block_input_shortcut_undo_routes_to_app_history(cx: &mut TestAppContext) {
        cx.skip_drawing();
        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        cx.update_window(*window, |_root, window, cx| {
            app.update(cx, |app, cx| {
                app.app.mode = Mode::Editor;
                app.editor.active_page = Some(PageRecord {
                    id: 1,
                    uid: "page-a".to_string(),
                    title: "Page A".to_string(),
                });
                app.editor.editor = Some(EditorModel::new(vec![
                    BlockSnapshot {
                        uid: "a1".to_string(),
                        text: "Alpha".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                    BlockSnapshot {
                        uid: "a2".to_string(),
                        text: "Beta".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    },
                ]));
                app.editor.blocks_list_state.reset(2, px(BLOCK_ROW_HEIGHT));
                app.update_block_list_for_pane(EditorPane::Primary);
                app.sync_block_input_from_active_with_cursor_for_pane(
                    EditorPane::Primary,
                    5,
                    Some(window),
                    cx,
                );

                if let Some(editor) = app.editor.editor.as_mut() {
                    editor.blocks[0].text = "Alpha changed".to_string();
                    editor.active_ix = 1;
                }
                app.record_text_history_change(
                    EditorPane::Primary,
                    "page-a",
                    "a1",
                    "Alpha".to_string(),
                    "Alpha changed".to_string(),
                    5,
                    13,
                );
                app.sync_block_input_from_active_with_cursor_for_pane(
                    EditorPane::Primary,
                    4,
                    Some(window),
                    cx,
                );

                let undo = KeyDownEvent {
                    keystroke: Keystroke::parse("secondary-z").expect("parse keystroke"),
                    is_held: false,
                    prefer_character_input: false,
                };
                assert!(app.handle_block_input_key_down(EditorPane::Primary, &undo, window, cx));

                let editor = app.editor.editor.as_ref().expect("editor");
                assert_eq!(editor.blocks[0].text, "Alpha");
                assert_eq!(editor.blocks[1].text, "Beta");
            });
        })
        .unwrap();
    }

    #[gpui::test]
    fn clicking_active_block_preserves_mid_text_cursor(cx: &mut TestAppContext) {
        cx.skip_drawing();
        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        cx.update_window(*window, |_root, window, cx| {
            app.update(cx, |app, cx| {
                app.app.mode = Mode::Editor;
                app.editor.active_page = Some(PageRecord {
                    id: 1,
                    uid: "page-a".to_string(),
                    title: "Page A".to_string(),
                });
                app.editor.editor = Some(EditorModel::new(vec![BlockSnapshot {
                    uid: "a1".to_string(),
                    text: "Alpha Beta".to_string(),
                    indent: 0,
                    block_type: BlockType::Text,
                }]));
                app.editor.blocks_list_state.reset(1, px(BLOCK_ROW_HEIGHT));
                app.update_block_list_for_pane(EditorPane::Primary);
                app.sync_block_input_from_active_with_cursor_for_pane(
                    EditorPane::Primary,
                    5,
                    Some(window),
                    cx,
                );

                app.editor.block_input.update(cx, |input, cx| {
                    let position = input.text().offset_to_position(2);
                    input.set_cursor_position(position, window, cx);
                });
                assert_eq!(app.editor.block_input.read(cx).cursor(), 2);

                app.on_click_block_in_pane(EditorPane::Primary, 0, window, cx);

                assert_eq!(app.editor.block_input.read(cx).cursor(), 2);
            });
        })
        .unwrap();
    }

    #[gpui::test]
    fn block_input_defaults_to_multiline_mode(cx: &mut TestAppContext) {
        cx.skip_drawing();
        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        cx.update_window(*window, |_root, window, cx| {
            app.update(cx, |app, cx| {
                app.editor.block_input.update(cx, |input, cx| {
                    input.set_value("Alpha\nBeta".to_string(), window, cx);
                });

                let input = app.editor.block_input.read(cx);
                assert_eq!(input.value().to_string(), "Alpha\nBeta");
                assert_eq!(input.cursor(), 0);
            });
        })
        .unwrap();
    }

    #[gpui::test]
    fn block_input_cursor_x_handles_multiline_text(cx: &mut TestAppContext) {
        cx.skip_drawing();
        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        cx.update_window(*window, |_root, window, cx| {
            app.update(cx, |app, cx| {
                app.app.mode = Mode::Editor;
                app.editor.active_page = Some(PageRecord {
                    id: 1,
                    uid: "page-a".to_string(),
                    title: "Page A".to_string(),
                });
                app.editor.editor = Some(EditorModel::new(vec![BlockSnapshot {
                    uid: "a1".to_string(),
                    text: "Alpha\nBeta".to_string(),
                    indent: 0,
                    block_type: BlockType::Text,
                }]));
                app.editor.blocks_list_state.reset(1, px(BLOCK_ROW_HEIGHT));
                app.update_block_list_for_pane(EditorPane::Primary);
                app.sync_block_input_from_active_with_cursor_for_pane(
                    EditorPane::Primary,
                    "Alpha\nBeta".len(),
                    Some(window),
                    cx,
                );

                let cursor_x = app.block_input_cursor_x(window, cx);
                assert!(cursor_x >= px(0.0));
            });
        })
        .unwrap();
    }

    #[gpui::test]
    fn move_capture_queue_item_to_page_moves_block_between_pages(cx: &mut TestAppContext) {
        cx.skip_drawing();
        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        cx.update_window(*window, |_root, _window, cx| {
            app.update(cx, |app, cx| {
                let mut db = Database::new_in_memory().expect("db init");
                db.run_migrations().expect("migrations");
                db.insert_page("inbox", "Inbox").expect("insert inbox");
                db.insert_page("project", "Project")
                    .expect("insert project");

                let inbox = db
                    .get_page_by_uid("inbox")
                    .expect("inbox lookup")
                    .expect("inbox");
                let project = db
                    .get_page_by_uid("project")
                    .expect("project lookup")
                    .expect("project");

                db.replace_blocks_for_page(
                    inbox.id,
                    &[
                        BlockSnapshot {
                            uid: "cap-1".to_string(),
                            text: "capture item".to_string(),
                            indent: 0,
                            block_type: BlockType::Text,
                        },
                        BlockSnapshot {
                            uid: "cap-2".to_string(),
                            text: "another capture".to_string(),
                            indent: 0,
                            block_type: BlockType::Text,
                        },
                    ],
                )
                .expect("seed inbox");
                db.replace_blocks_for_page(
                    project.id,
                    &[BlockSnapshot {
                        uid: "proj-1".to_string(),
                        text: "project note".to_string(),
                        indent: 0,
                        block_type: BlockType::Text,
                    }],
                )
                .expect("seed project");

                app.app.db = Some(db);
                app.editor.pages = app
                    .app
                    .db
                    .as_ref()
                    .expect("db")
                    .list_pages()
                    .expect("list pages");
                app.editor.active_page = None;
                app.editor.editor = None;
                app.editor.secondary_pane = None;

                app.move_capture_queue_item_to_page("cap-1", "project", cx)
                    .expect("move capture");

                let db = app.app.db.as_ref().expect("db");
                let inbox_blocks = db
                    .load_blocks_for_page(inbox.id)
                    .expect("load inbox blocks");
                assert_eq!(inbox_blocks.len(), 1);
                assert_eq!(inbox_blocks[0].uid, "cap-2");

                let project_blocks = db
                    .load_blocks_for_page(project.id)
                    .expect("load project blocks");
                assert_eq!(project_blocks.len(), 2);
                assert_eq!(project_blocks[0].uid, "cap-1");
                assert_eq!(project_blocks[0].text, "capture item");
                assert_eq!(project_blocks[1].uid, "proj-1");
            });
        })
        .unwrap();
    }

    #[gpui::test]
    fn enqueue_capture_queue_item_appends_new_item_last(cx: &mut TestAppContext) {
        cx.skip_drawing();
        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        cx.update_window(*window, |_root, _window, cx| {
            app.update(cx, |app, cx| {
                let mut db = Database::new_in_memory().expect("db init");
                db.run_migrations().expect("migrations");
                db.insert_page("inbox", "Inbox").expect("insert inbox");
                let inbox = db
                    .get_page_by_uid("inbox")
                    .expect("inbox lookup")
                    .expect("inbox");
                db.replace_blocks_for_page(
                    inbox.id,
                    &[
                        BlockSnapshot {
                            uid: "cap-1".to_string(),
                            text: "first".to_string(),
                            indent: 0,
                            block_type: BlockType::Text,
                        },
                        BlockSnapshot {
                            uid: "cap-2".to_string(),
                            text: "second".to_string(),
                            indent: 0,
                            block_type: BlockType::Text,
                        },
                    ],
                )
                .expect("seed inbox");

                app.app.db = Some(db);
                app.editor.pages = app
                    .app
                    .db
                    .as_ref()
                    .expect("db")
                    .list_pages()
                    .expect("list pages");
                app.editor.active_page = None;
                app.editor.editor = None;
                app.editor.secondary_pane = None;

                let added_uid = app
                    .enqueue_capture_queue_item("latest", cx)
                    .expect("enqueue capture");

                let db = app.app.db.as_ref().expect("db");
                let blocks = db
                    .load_blocks_for_page(inbox.id)
                    .expect("load inbox blocks");
                assert_eq!(blocks.len(), 3);
                assert_eq!(blocks[0].uid, "cap-1");
                assert_eq!(blocks[1].uid, "cap-2");
                assert_eq!(blocks[2].uid, added_uid);
                assert_eq!(blocks[2].text, "latest");
            });
        })
        .unwrap();
    }

    #[gpui::test]
    fn enqueue_capture_queue_item_adds_item_to_review_queue(cx: &mut TestAppContext) {
        cx.skip_drawing();
        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        cx.update_window(*window, |_root, _window, cx| {
            app.update(cx, |app, cx| {
                let db = Database::new_in_memory().expect("db init");
                db.run_migrations().expect("migrations");
                db.insert_page("inbox", "Inbox").expect("insert inbox");

                app.app.db = Some(db);
                app.editor.pages = app
                    .app
                    .db
                    .as_ref()
                    .expect("db")
                    .list_pages()
                    .expect("list pages");
                app.editor.active_page = None;
                app.editor.editor = None;
                app.editor.secondary_pane = None;

                let added_uid = app
                    .enqueue_capture_queue_item("review me", cx)
                    .expect("enqueue capture");

                let db = app.app.db.as_ref().expect("db");
                let due = db
                    .list_review_queue_due(chrono::Utc::now().timestamp_millis(), 10)
                    .expect("list review due");
                assert_eq!(due.len(), 1);
                assert_eq!(due[0].page_uid, "inbox");
                assert_eq!(due[0].block_uid, added_uid);
                assert_eq!(app.editor.review_items.len(), 1);
                assert_eq!(app.editor.review_items[0].block_uid, added_uid);
            });
        })
        .unwrap();
    }

    #[gpui::test]
    fn delete_capture_queue_item_removes_item_from_inbox(cx: &mut TestAppContext) {
        cx.skip_drawing();
        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        cx.update_window(*window, |_root, _window, cx| {
            app.update(cx, |app, cx| {
                let mut db = Database::new_in_memory().expect("db init");
                db.run_migrations().expect("migrations");
                db.insert_page("inbox", "Inbox").expect("insert inbox");
                let inbox = db
                    .get_page_by_uid("inbox")
                    .expect("inbox lookup")
                    .expect("inbox");
                db.replace_blocks_for_page(
                    inbox.id,
                    &[
                        BlockSnapshot {
                            uid: "cap-1".to_string(),
                            text: "first".to_string(),
                            indent: 0,
                            block_type: BlockType::Text,
                        },
                        BlockSnapshot {
                            uid: "cap-2".to_string(),
                            text: "second".to_string(),
                            indent: 0,
                            block_type: BlockType::Text,
                        },
                    ],
                )
                .expect("seed inbox");

                app.app.db = Some(db);
                app.editor.pages = app
                    .app
                    .db
                    .as_ref()
                    .expect("db")
                    .list_pages()
                    .expect("list pages");
                app.editor.active_page = None;
                app.editor.editor = None;
                app.editor.secondary_pane = None;
                app.editor.capture_move_item_uid = Some("cap-1".to_string());

                app.delete_capture_queue_item("cap-1", cx)
                    .expect("delete capture");

                let db = app.app.db.as_ref().expect("db");
                let blocks = db
                    .load_blocks_for_page(inbox.id)
                    .expect("load inbox blocks");
                assert_eq!(blocks.len(), 1);
                assert_eq!(blocks[0].uid, "cap-2");
                assert!(app.editor.capture_move_item_uid.is_none());
            });
        })
        .unwrap();
    }
}
