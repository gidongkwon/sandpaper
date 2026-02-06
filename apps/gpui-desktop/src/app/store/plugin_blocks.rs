use super::helpers::now_millis;
use super::*;

const DEFAULT_CACHE_TTL_MS: i64 = 15_000;
const MAX_CACHE_ENTRIES: usize = 200;

pub(crate) fn normalize_cache_key_text(text: &str) -> String {
    let trimmed = text.trim();
    if !trimmed.starts_with("```") {
        return text.to_string();
    }
    let rest = trimmed.trim_start_matches("```").trim();
    if rest.is_empty() {
        return text.to_string();
    }

    let left = rest.split_once("::").map(|(left, _)| left).unwrap_or(rest);
    let left = left.trim();
    if left.is_empty() {
        return text.to_string();
    }

    let mut parts = left.split_whitespace();
    let Some(lang) = parts.next() else {
        return text.to_string();
    };
    let lang = lang.trim();
    if lang.is_empty() {
        return text.to_string();
    }

    let mut config_text = parts.collect::<Vec<_>>().join(" ");
    if !config_text.is_empty() {
        config_text = strip_cache_ts(&config_text);
        config_text = config_text
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .trim()
            .to_string();
    }

    if config_text.is_empty() {
        lang.to_lowercase()
    } else {
        format!("{} {}", lang.to_lowercase(), config_text)
    }
}

pub(crate) fn cache_key_for(renderer: &PluginRenderer, block_uid: &str, text: &str) -> String {
    format!(
        "{}::{}::{}::{}",
        renderer.plugin_id,
        renderer.id,
        block_uid,
        normalize_cache_key_text(text)
    )
}

fn strip_cache_ts(config_text: &str) -> String {
    let parts: Vec<&str> = config_text.split_whitespace().collect();
    if parts.is_empty() {
        return String::new();
    }

    let mut out: Vec<&str> = Vec::with_capacity(parts.len());
    let mut ix = 0usize;

    while ix < parts.len() {
        let part = parts[ix];
        if let Some(value) = part.strip_prefix("cache_ts=") {
            ix += 1;
            if let Some(quote) = value.chars().next() {
                if (quote == '"' || quote == '\'') && (value.len() == 1 || !value.ends_with(quote))
                {
                    while ix < parts.len() {
                        let tail = parts[ix];
                        ix += 1;
                        if tail.ends_with(quote) {
                            break;
                        }
                    }
                }
            }
            continue;
        }

        out.push(part);
        ix += 1;
    }

    out.join(" ")
}

fn resolve_cache_ttl_ms(view: &PluginBlockView) -> Option<i64> {
    match view.cache.as_ref().and_then(|cache| cache.ttl_seconds) {
        Some(ttl) if ttl == 0 => None,
        Some(ttl) => Some((ttl as i64).saturating_mul(1000)),
        None => Some(DEFAULT_CACHE_TTL_MS),
    }
}

fn estimate_wrapped_lines(text: &str, chars_per_line: usize) -> usize {
    let chars_per_line = chars_per_line.max(1);
    let mut lines = 0usize;
    for segment in text.split('\n') {
        let len = segment.chars().count();
        let segment_lines = (len + chars_per_line - 1) / chars_per_line;
        lines += segment_lines.max(1);
    }
    lines.max(1)
}

impl AppStore {
    pub(crate) fn plugin_preview_state_key(pane: EditorPane, block_uid: &str) -> String {
        match pane {
            EditorPane::Primary => format!("primary:{block_uid}"),
            EditorPane::Secondary => format!("secondary:{block_uid}"),
        }
    }

    fn plugin_preview_skip_key(pane: EditorPane, block_uid: &str, text: &str) -> String {
        format!(
            "{}::{text}",
            Self::plugin_preview_state_key(pane, block_uid)
        )
    }

    fn ensure_plugin_preview_state(
        &mut self,
        pane: EditorPane,
        block_uid: &str,
        initial_key: &str,
    ) -> &mut PluginBlockPreviewState {
        let preview_key = Self::plugin_preview_state_key(pane, block_uid);
        self.editor
            .plugin_block_previews
            .entry(preview_key)
            .or_insert_with(|| PluginBlockPreviewState {
                key: initial_key.to_string(),
                loading: false,
                error: None,
                view: None,
                epoch: 0,
                skip_next_key: None,
            })
    }

    fn read_cached_plugin_block_view(&mut self, key: &str) -> Option<PluginBlockView> {
        let now = now_millis();
        let Some(entry) = self.editor.plugin_block_view_cache.get(key) else {
            return None;
        };
        if now.saturating_sub(entry.fetched_at_ms) > entry.ttl_ms {
            self.editor.plugin_block_view_cache.remove(key);
            return None;
        }
        Some(entry.view.clone())
    }

    fn store_cached_plugin_block_view(&mut self, key: String, view: &PluginBlockView) {
        let Some(ttl_ms) = resolve_cache_ttl_ms(view) else {
            return;
        };

        self.editor.plugin_block_view_cache_next_id =
            self.editor.plugin_block_view_cache_next_id.wrapping_add(1);
        let id = self.editor.plugin_block_view_cache_next_id;

        self.editor.plugin_block_view_cache.insert(
            key.clone(),
            PluginBlockCacheEntry {
                view: view.clone(),
                fetched_at_ms: now_millis(),
                ttl_ms,
                id,
            },
        );
        self.editor
            .plugin_block_view_cache_order
            .push_back((key, id));

        while self.editor.plugin_block_view_cache.len() > MAX_CACHE_ENTRIES {
            let Some((old_key, old_id)) = self.editor.plugin_block_view_cache_order.pop_front()
            else {
                break;
            };
            if let Some(entry) = self.editor.plugin_block_view_cache.get(&old_key) {
                if entry.id == old_id {
                    self.editor.plugin_block_view_cache.remove(&old_key);
                }
            }
        }
    }

    pub(crate) fn ensure_plugin_block_preview(
        &mut self,
        pane: EditorPane,
        block_uid: &str,
        text: &str,
        renderer: &PluginRenderer,
        cx: &mut Context<Self>,
    ) {
        let cache_key = cache_key_for(renderer, block_uid, text);
        let preview_key = Self::plugin_preview_state_key(pane, block_uid);
        let skip_key = Self::plugin_preview_skip_key(pane, block_uid, text);

        if self
            .editor
            .plugin_block_previews
            .get(&preview_key)
            .and_then(|state| state.skip_next_key.as_ref())
            .is_some_and(|key| key == &skip_key)
        {
            if let Some(state) = self.editor.plugin_block_previews.get_mut(&preview_key) {
                state.skip_next_key = None;
            }
            return;
        }

        let existing_state = self
            .editor
            .plugin_block_previews
            .get(&preview_key)
            .and_then(|state| {
                if state.key == cache_key && (state.loading || state.view.is_some()) {
                    Some((
                        state.loading,
                        state
                            .view
                            .as_ref()
                            .map(|view| Self::row_height_for_plugin_block_view(text, view)),
                    ))
                } else {
                    None
                }
            });
        if let Some((_loading, desired_height)) = existing_state {
            if let Some(desired_height) = desired_height {
                if self.set_row_height_for_block_uid_in_pane(pane, block_uid, desired_height) {
                    cx.notify();
                }
            }
            return;
        }

        let runtime_available = self.plugins.plugin_runtime.is_some();
        let cached_view = self.read_cached_plugin_block_view(&cache_key);

        if !runtime_available && cached_view.is_none() {
            let state = self.ensure_plugin_preview_state(pane, block_uid, &cache_key);
            state.loading = false;
            state.error = Some("Plugins not loaded.".into());
            return;
        }

        if let Some(view) = cached_view {
            let desired_height = Self::row_height_for_plugin_block_view(
                view.next_text.as_deref().unwrap_or(text),
                &view,
            );
            let mut next_text_to_apply: Option<String> = None;
            let mut next_key: Option<String> = None;
            if let Some(next_text) = view.next_text.clone() {
                if next_text != text {
                    next_key = Some(cache_key_for(renderer, block_uid, &next_text));
                    next_text_to_apply = Some(next_text);
                }
            }
            if let Some(next_key) = next_key.clone() {
                self.store_cached_plugin_block_view(next_key, &view);
            }

            {
                let state = self.ensure_plugin_preview_state(pane, block_uid, &cache_key);
                state.key = cache_key.clone();
                state.loading = false;
                state.error = None;
                state.view = Some(view);
                if let (Some(next_key), Some(next_text)) =
                    (next_key.as_ref(), next_text_to_apply.as_ref())
                {
                    state.key = next_key.clone();
                    state.skip_next_key =
                        Some(Self::plugin_preview_skip_key(pane, block_uid, next_text));
                }
            }

            if let Some(next_text) = next_text_to_apply {
                self.apply_next_text_for_plugin_block(pane, block_uid, &next_text, cx);
            }

            let _ = self.set_row_height_for_block_uid_in_pane(pane, block_uid, desired_height);
            cx.notify();
            return;
        }

        let epoch = {
            let state = self.ensure_plugin_preview_state(pane, block_uid, &cache_key);
            state.key = cache_key.clone();
            state.loading = true;
            state.error = None;
            state.epoch += 1;
            state.epoch
        };
        cx.notify();

        let renderer = renderer.clone();
        let block_uid = block_uid.to_string();
        let text = text.to_string();
        let cache_key = cache_key.clone();
        let preview_key = preview_key.clone();
        cx.spawn(async move |this, cx| {
            this.update(cx, |this, cx| {
                let is_active = this
                    .editor
                    .plugin_block_previews
                    .get(&preview_key)
                    .is_some_and(|state| state.key == cache_key && state.epoch == epoch);
                if !is_active {
                    return;
                }

                let result = match this.plugins.plugin_runtime.as_mut() {
                    Some(runtime) => {
                        runtime.render_block(&renderer.plugin_id, &renderer.id, &block_uid, &text)
                    }
                    None => return,
                };

                let mut next_text_to_apply: Option<String> = None;
                let mut next_key: Option<String> = None;
                let mut desired_height: Option<gpui::Pixels> = None;
                if let Ok(view) = &result {
                    this.store_cached_plugin_block_view(cache_key.clone(), view);
                    if let Some(next_text) = view.next_text.clone() {
                        if next_text != text {
                            let key = cache_key_for(&renderer, &block_uid, &next_text);
                            this.store_cached_plugin_block_view(key.clone(), view);
                            next_key = Some(key);
                            next_text_to_apply = Some(next_text);
                        }
                    }

                    desired_height = Some(Self::row_height_for_plugin_block_view(
                        next_text_to_apply.as_deref().unwrap_or(&text),
                        view,
                    ));
                }

                {
                    let Some(state) = this.editor.plugin_block_previews.get_mut(&preview_key)
                    else {
                        return;
                    };
                    if state.key != cache_key || state.epoch != epoch {
                        return;
                    }

                    state.loading = false;
                    match result {
                        Ok(view) => {
                            state.error = None;
                            state.view = Some(view);
                            if let Some(next_key) = next_key.as_ref() {
                                state.key = next_key.clone();
                            }
                            if let Some(next_text) = next_text_to_apply.as_ref() {
                                state.skip_next_key = Some(Self::plugin_preview_skip_key(
                                    pane, &block_uid, next_text,
                                ));
                            }
                        }
                        Err(err) => {
                            let err = super::plugins::describe_plugin_error(&err);
                            state.error = Some(err.message.into());
                        }
                    }
                }

                if let Some(next_text) = next_text_to_apply {
                    this.apply_next_text_for_plugin_block(pane, &block_uid, &next_text, cx);
                }

                if let Some(desired_height) = desired_height {
                    let _ =
                        this.set_row_height_for_block_uid_in_pane(pane, &block_uid, desired_height);
                }

                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    pub(crate) fn run_plugin_block_action(
        &mut self,
        pane: EditorPane,
        block_uid: &str,
        renderer: &PluginRenderer,
        action_id: &str,
        value: Option<&str>,
        cx: &mut Context<Self>,
    ) {
        let Some(block) = self
            .editor_for_pane(pane)
            .and_then(|editor| editor.blocks.iter().find(|block| block.uid == block_uid))
            .cloned()
        else {
            return;
        };

        let cache_key = cache_key_for(renderer, block_uid, &block.text);
        let preview_key = Self::plugin_preview_state_key(pane, block_uid);

        let epoch = {
            let state = self.ensure_plugin_preview_state(pane, block_uid, &cache_key);
            state.key = cache_key.clone();
            state.loading = true;
            state.error = None;
            state.epoch += 1;
            state.epoch
        };
        cx.notify();

        let renderer = renderer.clone();
        let block_uid = block_uid.to_string();
        let text = block.text;
        let action_id = action_id.to_string();
        let value = value.map(|value| value.to_string());
        let cache_key = cache_key.clone();
        let preview_key = preview_key.clone();

        cx.spawn(async move |this, cx| {
            this.update(cx, |this, cx| {
                let is_active = this
                    .editor
                    .plugin_block_previews
                    .get(&preview_key)
                    .is_some_and(|state| state.key == cache_key && state.epoch == epoch);
                if !is_active {
                    return;
                }

                let action_value = value.clone().map(Value::String);
                let result = match this.plugins.plugin_runtime.as_mut() {
                    Some(runtime) => runtime.handle_block_action(
                        &renderer.plugin_id,
                        &renderer.id,
                        &block_uid,
                        &text,
                        &action_id,
                        action_value,
                    ),
                    None => {
                        return;
                    }
                };

                let mut next_text_to_apply: Option<String> = None;
                let mut next_key: Option<String> = None;
                let mut desired_height: Option<gpui::Pixels> = None;
                if let Ok(view) = &result {
                    this.store_cached_plugin_block_view(cache_key.clone(), view);
                    if let Some(next_text) = view.next_text.clone() {
                        if next_text != text {
                            let key = cache_key_for(&renderer, &block_uid, &next_text);
                            this.store_cached_plugin_block_view(key.clone(), view);
                            next_key = Some(key);
                            next_text_to_apply = Some(next_text);
                        }
                    }

                    desired_height = Some(Self::row_height_for_plugin_block_view(
                        next_text_to_apply.as_deref().unwrap_or(&text),
                        view,
                    ));
                }

                {
                    let Some(state) = this.editor.plugin_block_previews.get_mut(&preview_key)
                    else {
                        return;
                    };
                    if state.key != cache_key || state.epoch != epoch {
                        return;
                    }

                    state.loading = false;
                    match result {
                        Ok(view) => {
                            state.error = None;
                            state.view = Some(view);
                            if let Some(next_key) = next_key.as_ref() {
                                state.key = next_key.clone();
                            }
                            if let Some(next_text) = next_text_to_apply.as_ref() {
                                state.skip_next_key = Some(Self::plugin_preview_skip_key(
                                    pane, &block_uid, next_text,
                                ));
                            }
                        }
                        Err(err) => {
                            let err = super::plugins::describe_plugin_error(&err);
                            state.error = Some(err.message.into());
                        }
                    }
                }

                if let Some(next_text) = next_text_to_apply {
                    this.apply_next_text_for_plugin_block(pane, &block_uid, &next_text, cx);
                }

                if let Some(desired_height) = desired_height {
                    let _ =
                        this.set_row_height_for_block_uid_in_pane(pane, &block_uid, desired_height);
                }

                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn estimate_plugin_preview_extra_height(view: &PluginBlockView) -> f32 {
        const MIN_EXTRA_HEIGHT: f32 = 240.0;
        const BASE_EXTRA_HEIGHT: f32 = 80.0;
        const SECTION_MARGIN_TOP: f32 = 8.0;

        const MESSAGE_LINE_HEIGHT: f32 = 16.0;
        const MESSAGE_CHARS_PER_LINE: usize = 90;

        const BODY_TEXT_LINE_HEIGHT: f32 = 18.0;
        const BODY_TEXT_CHARS_PER_LINE: usize = 80;

        const LIST_ITEM_LINE_HEIGHT: f32 = 18.0;
        const LIST_ITEM_CHARS_PER_LINE: usize = 56;
        const LIST_ITEM_GAP: f32 = 4.0;

        const STATS_ROW_HEIGHT: f32 = 16.0;
        const STATS_GAP: f32 = 4.0;

        const JSON_LINE_HEIGHT: f32 = 16.0;
        const JSON_MAX_LINES: usize = 80;

        const CONTROLS_ROW_HEIGHT: f32 = 28.0;
        const CONTROLS_PER_ROW: usize = 3;

        let mut extra = BASE_EXTRA_HEIGHT;
        let message = view.message.as_ref().or(view.summary.as_ref());

        if let Some(body) = view.body.as_ref() {
            let kind = body.get("kind").and_then(Value::as_str).unwrap_or("");
            match kind {
                "text" => {
                    if let Some(text) = body.get("text").and_then(Value::as_str) {
                        let lines = estimate_wrapped_lines(text, BODY_TEXT_CHARS_PER_LINE);
                        extra += SECTION_MARGIN_TOP + lines as f32 * BODY_TEXT_LINE_HEIGHT;
                    } else if let Some(message) = message {
                        let lines = estimate_wrapped_lines(message, MESSAGE_CHARS_PER_LINE);
                        extra += SECTION_MARGIN_TOP + lines as f32 * MESSAGE_LINE_HEIGHT;
                    }
                }
                "list" => {
                    let items = body
                        .get("items")
                        .and_then(Value::as_array)
                        .map(|items| items.as_slice())
                        .unwrap_or(&[]);
                    let mut item_count = 0usize;
                    let mut total_lines = 0usize;
                    for item in items {
                        if let Some(text) = item.as_str() {
                            item_count += 1;
                            total_lines += estimate_wrapped_lines(text, LIST_ITEM_CHARS_PER_LINE);
                        }
                    }
                    if item_count > 0 {
                        let gaps = (item_count.saturating_sub(1) as f32) * LIST_ITEM_GAP;
                        extra +=
                            SECTION_MARGIN_TOP + total_lines as f32 * LIST_ITEM_LINE_HEIGHT + gaps;
                    } else if let Some(message) = message {
                        let lines = estimate_wrapped_lines(message, MESSAGE_CHARS_PER_LINE);
                        extra += SECTION_MARGIN_TOP + lines as f32 * MESSAGE_LINE_HEIGHT;
                    }
                }
                "stats" => {
                    let items = body
                        .get("items")
                        .and_then(Value::as_array)
                        .map(|items| items.as_slice())
                        .unwrap_or(&[]);
                    let count = items
                        .iter()
                        .filter(|item| item.as_object().is_some())
                        .count();
                    if count > 0 {
                        let gaps = (count.saturating_sub(1) as f32) * STATS_GAP;
                        extra += SECTION_MARGIN_TOP + count as f32 * STATS_ROW_HEIGHT + gaps;
                    } else if let Some(message) = message {
                        let lines = estimate_wrapped_lines(message, MESSAGE_CHARS_PER_LINE);
                        extra += SECTION_MARGIN_TOP + lines as f32 * MESSAGE_LINE_HEIGHT;
                    }
                }
                _ => {
                    let pretty =
                        serde_json::to_string_pretty(body).unwrap_or_else(|_| body.to_string());
                    let lines = pretty.lines().count().max(1).min(JSON_MAX_LINES);
                    extra += SECTION_MARGIN_TOP + lines as f32 * JSON_LINE_HEIGHT;
                }
            }
        } else if let Some(message) = message {
            let lines = estimate_wrapped_lines(message, MESSAGE_CHARS_PER_LINE);
            extra += SECTION_MARGIN_TOP + lines as f32 * MESSAGE_LINE_HEIGHT;
        }

        if !view.controls.is_empty() {
            let rows = (view.controls.len() + CONTROLS_PER_ROW - 1) / CONTROLS_PER_ROW;
            extra += SECTION_MARGIN_TOP + rows as f32 * CONTROLS_ROW_HEIGHT;
        }

        extra.max(MIN_EXTRA_HEIGHT)
    }

    pub(crate) fn row_height_for_plugin_block_view(
        text: &str,
        view: &PluginBlockView,
    ) -> gpui::Pixels {
        let baseline = Self::row_height_for_block_text(text);
        let estimated_total = BLOCK_ROW_HEIGHT + Self::estimate_plugin_preview_extra_height(view);
        px(f32::from(baseline).max(estimated_total))
    }

    fn set_row_height_for_block_uid_in_pane(
        &mut self,
        pane: EditorPane,
        block_uid: &str,
        desired: gpui::Pixels,
    ) -> bool {
        let actual_ix = {
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

        let Some(list_state) = self.list_state_for_pane_mut(pane) else {
            return false;
        };
        let Some(visible_ix) = list_state
            .actual_to_visible
            .get(actual_ix)
            .copied()
            .flatten()
        else {
            return false;
        };
        if visible_ix >= list_state.item_sizes.len() {
            return false;
        }

        if list_state.item_sizes[visible_ix].height == desired {
            return false;
        }

        let sizes = Rc::make_mut(&mut list_state.item_sizes);
        sizes[visible_ix] = size(px(0.), desired);
        true
    }

    fn apply_next_text_for_plugin_block(
        &mut self,
        pane: EditorPane,
        block_uid: &str,
        next_text: &str,
        cx: &mut Context<Self>,
    ) {
        let active_pane = self.editor.active_pane;
        let cursor = self.editor.block_input.read(cx).cursor();

        let (ix, block_type, sync_input) = {
            let Some(editor) = self.editor_for_pane_mut(pane) else {
                return;
            };
            let Some(ix) = editor
                .blocks
                .iter()
                .position(|block| block.uid == block_uid)
            else {
                return;
            };
            if editor.blocks[ix].text == next_text {
                return;
            }

            let block_type = editor.blocks[ix].block_type;
            editor.blocks[ix].text = next_text.to_string();

            let sync_input = active_pane == pane
                && editor
                    .blocks
                    .get(editor.active_ix)
                    .is_some_and(|block| block.uid == block_uid);
            (ix, block_type, sync_input)
        };

        if sync_input {
            self.sync_block_input_from_active_with_cursor_for_pane(pane, cursor, None, cx);
        }

        if let Some(list_state) = self.list_state_for_pane_mut(pane) {
            if let Some(visible_ix) = list_state.actual_to_visible.get(ix).copied().flatten() {
                if visible_ix < list_state.item_sizes.len() {
                    let desired = Self::row_height_for_block_type_and_text(block_type, next_text);
                    if list_state.item_sizes[visible_ix].height != desired {
                        let sizes = Rc::make_mut(&mut list_state.item_sizes);
                        sizes[visible_ix] = size(px(0.), desired);
                    }
                }
            }
        }

        self.mark_dirty_for_pane(pane, cx);
        self.schedule_references_refresh(cx);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::TestAppContext;
    use gpui_component::Root;
    use std::cell::RefCell;
    use std::rc::Rc;

    #[test]
    fn row_height_for_plugin_block_view_never_smaller_than_text_height() {
        let text = "```hn-top count=5";
        let baseline = AppStore::row_height_for_block_text(text);
        let view = PluginBlockView {
            plugin_id: "p".into(),
            renderer_id: "r".into(),
            block_uid: "b".into(),
            summary: Some("Summary".into()),
            next_text: None,
            status: None,
            message: Some("Message".into()),
            body: None,
            controls: Vec::new(),
            cache: None,
        };

        let desired = AppStore::row_height_for_plugin_block_view(text, &view);
        assert!(f32::from(desired) >= f32::from(baseline));
    }

    #[test]
    fn row_height_for_plugin_block_view_grows_for_long_list_titles() {
        let text = "```hn-top count=5";
        let baseline = AppStore::row_height_for_block_text(text);
        let view = PluginBlockView {
            plugin_id: "p".into(),
            renderer_id: "r".into(),
            block_uid: "b".into(),
            summary: None,
            next_text: None,
            status: None,
            message: None,
            body: Some(serde_json::json!({
                "kind": "list",
                "items": [
                    "A".repeat(200),
                    "B".repeat(200),
                    "C".repeat(200),
                    "D".repeat(200),
                    "E".repeat(200),
                ],
            })),
            controls: Vec::new(),
            cache: None,
        };

        let desired = AppStore::row_height_for_plugin_block_view(text, &view);
        assert!(f32::from(desired) > f32::from(baseline));
    }

    #[gpui::test]
    fn update_block_list_preserves_plugin_block_preview_height(cx: &mut TestAppContext) {
        cx.skip_drawing();
        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        app.update(cx, |app, _cx| {
            let text = "```hn-top count=5";
            app.editor.editor = Some(EditorModel::new(vec![
                BlockSnapshot {
                    uid: "a".into(),
                    text: text.into(),
                    indent: 0,
                    block_type: BlockType::Text,
                },
                BlockSnapshot {
                    uid: "b".into(),
                    text: "below".into(),
                    indent: 0,
                    block_type: BlockType::Text,
                },
            ]));

            let renderer = PluginRenderer {
                plugin_id: "sample".into(),
                id: "hn-top".into(),
                title: "HN Top".into(),
                kind: "block".into(),
                languages: vec!["hn-top".into()],
                permissions: Vec::new(),
            };

            app.plugins.plugin_status = Some(PluginRuntimeStatus {
                loaded: vec!["sample".into()],
                blocked: Vec::new(),
                commands: Vec::new(),
                panels: Vec::new(),
                toolbar_actions: Vec::new(),
                renderers: vec![renderer.clone()],
            });

            let preview_key = AppStore::plugin_preview_state_key(EditorPane::Primary, "a");
            app.editor.plugin_block_previews.insert(
                preview_key,
                PluginBlockPreviewState {
                    key: cache_key_for(&renderer, "a", text),
                    loading: false,
                    error: None,
                    view: Some(PluginBlockView {
                        plugin_id: renderer.plugin_id.clone(),
                        renderer_id: renderer.id.clone(),
                        block_uid: "a".into(),
                        summary: None,
                        next_text: None,
                        status: None,
                        message: None,
                        body: Some(serde_json::json!({
                            "kind": "list",
                            "items": [
                                "A".repeat(200),
                                "B".repeat(200),
                                "C".repeat(200),
                                "D".repeat(200),
                                "E".repeat(200),
                            ],
                        })),
                        controls: Vec::new(),
                        cache: None,
                    }),
                    epoch: 0,
                    skip_next_key: None,
                },
            );

            app.update_block_list_for_pane(EditorPane::Primary);

            let baseline = AppStore::row_height_for_block_text(text);
            let actual = app
                .editor
                .blocks_list_state
                .item_sizes
                .first()
                .expect("first size")
                .height;
            assert!(f32::from(actual) > f32::from(baseline));
        });
    }

    #[test]
    fn normalize_cache_key_text_returns_original_for_non_fence() {
        assert_eq!(normalize_cache_key_text("hello"), "hello");
    }

    #[test]
    fn normalize_cache_key_text_ignores_summary_and_cache_ts() {
        assert_eq!(
            normalize_cache_key_text(
                "```hn-top count=5 cache_ttl=60 cache_ts=2026-02-01T00:00:00Z :: Summary"
            ),
            "hn-top count=5 cache_ttl=60"
        );
    }

    #[test]
    fn normalize_cache_key_text_removes_quoted_cache_ts_value() {
        assert_eq!(
            normalize_cache_key_text(
                "```hn-top cache_ts=\"2026-02-01T00:00:00Z\" count=5 :: Summary"
            ),
            "hn-top count=5"
        );
    }

    #[test]
    fn resolve_cache_ttl_ms_defaults_to_15s() {
        let view = PluginBlockView {
            plugin_id: "p".into(),
            renderer_id: "r".into(),
            block_uid: "b".into(),
            summary: None,
            next_text: None,
            status: None,
            message: None,
            body: None,
            controls: Vec::new(),
            cache: None,
        };
        assert_eq!(resolve_cache_ttl_ms(&view), Some(15_000));
    }

    #[test]
    fn resolve_cache_ttl_ms_disables_cache_at_zero() {
        let view = PluginBlockView {
            plugin_id: "p".into(),
            renderer_id: "r".into(),
            block_uid: "b".into(),
            summary: None,
            next_text: None,
            status: None,
            message: None,
            body: None,
            controls: Vec::new(),
            cache: Some(sandpaper_core::plugins::PluginBlockCache {
                ttl_seconds: Some(0),
                timestamp: None,
            }),
        };
        assert_eq!(resolve_cache_ttl_ms(&view), None);
    }
}
