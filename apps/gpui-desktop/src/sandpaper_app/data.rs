use super::*;
use super::helpers::{format_snippet, now_millis};

impl SandpaperApp {
    pub(super) fn schedule_highlight_clear(&mut self, cx: &mut Context<Self>) {
        self.highlight_epoch += 1;
        let epoch = self.highlight_epoch;

        cx.spawn(async move |this, cx| {
            cx.background_executor().timer(Duration::from_millis(1500)).await;
            this.update(cx, |this, cx| {
                if this.highlight_epoch != epoch {
                    return;
                }
                this.highlighted_block_uid = None;
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    pub(super) fn schedule_capture_confirmation_clear(&mut self, cx: &mut Context<Self>) {
        self.capture_confirmation_epoch += 1;
        let epoch = self.capture_confirmation_epoch;

        cx.spawn(async move |this, cx| {
            cx.background_executor().timer(Duration::from_millis(1200)).await;
            this.update(cx, |this, cx| {
                if this.capture_confirmation_epoch != epoch {
                    return;
                }
                this.capture_confirmation = None;
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    pub(super) fn refresh_search_results(&mut self) {
        let query = self.sidebar_search_query.trim();
        if query.is_empty() {
            self.search_pages.clear();
            self.search_blocks.clear();
            return;
        }
        let Some(db) = self.db.as_ref() else {
            self.search_pages.clear();
            self.search_blocks.clear();
            return;
        };
        let page_ids = db.search_pages(query).unwrap_or_default();
        let lookup: HashMap<i64, PageRecord> = self
            .pages
            .iter()
            .cloned()
            .map(|page| (page.id, page))
            .collect();
        self.search_pages = page_ids
            .iter()
            .filter_map(|id| lookup.get(id).cloned())
            .collect();
        self.search_blocks = db
            .search_block_page_summaries(query, 20)
            .unwrap_or_default();
    }

    pub(super) fn schedule_references_refresh(&mut self, cx: &mut Context<Self>) {
        self.references_epoch += 1;
        let epoch = self.references_epoch;

        cx.spawn(async move |this, cx| {
            cx.background_executor()
                .timer(Duration::from_millis(300))
                .await;
            this.update(cx, |this, cx| {
                if this.references_epoch != epoch {
                    return;
                }
                this.refresh_references();
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    pub(super) fn refresh_references(&mut self) {
        self.backlinks.clear();
        self.unlinked_references.clear();
        self.block_backlinks.clear();

        let Some(active_page) = self.active_page.as_ref() else {
            return;
        };
        let Some(db) = self.db.as_ref() else {
            return;
        };

        let active_uid = active_page.uid.clone();
        let active_title = active_page.title.clone();

        if let Ok(records) = db.list_blocks_with_wikilinks() {
            for record in records {
                if record.page_uid == active_uid {
                    continue;
                }
                let mut is_match = false;
                for link in extract_wikilinks(&record.text) {
                    let target_uid = app::sanitize_kebab(&link);
                    if target_uid == active_uid || link.eq_ignore_ascii_case(&active_title) {
                        is_match = true;
                        break;
                    }
                }
                if is_match {
                    self.backlinks.push(BacklinkEntry {
                        block_uid: record.block_uid,
                        page_uid: record.page_uid,
                        page_title: record.page_title,
                        text: record.text,
                    });
                }
            }
        }
        if self.backlinks.len() > 20 {
            self.backlinks.truncate(20);
        }

        let Some(editor) = self.editor.as_ref() else {
            return;
        };

        let mut seen = HashSet::new();
        let pages = self
            .pages
            .iter()
            .filter(|page| page.uid != active_uid && !page.title.trim().is_empty())
            .cloned()
            .collect::<Vec<_>>();

        for block in editor.blocks.iter() {
            let stripped = strip_wikilinks(&block.text);
            if stripped.trim().is_empty() {
                continue;
            }
            let lowered = stripped.to_lowercase();
            for page in pages.iter() {
                let title = page.title.trim();
                if title.is_empty() {
                    continue;
                }
                let key = format!("{}:{}", block.uid, page.uid);
                if seen.contains(&key) {
                    continue;
                }
                let count =
                    helpers::count_case_insensitive_occurrences(&stripped, title);
                if count > 0 && lowered.contains(&title.to_lowercase()) {
                    seen.insert(key);
                    self.unlinked_references.push(UnlinkedReference {
                        block_uid: block.uid.clone(),
                        page_title: page.title.clone(),
                        snippet: format_snippet(&stripped, 120),
                        match_count: count,
                    });
                }
            }
        }

        if self.unlinked_references.len() > 12 {
            self.unlinked_references.truncate(12);
        }

        self.refresh_block_backlinks();
    }

    pub(super) fn refresh_block_backlinks(&mut self) {
        self.block_backlinks.clear();

        let Some(editor) = self.editor.as_ref() else {
            return;
        };
        let Some(db) = self.db.as_ref() else {
            return;
        };

        let active_block_uid = editor.active().uid.clone();

        if let Ok(records) = db.list_blocks_with_block_refs() {
            for record in records {
                if record.block_uid == active_block_uid {
                    continue;
                }
                let mut is_match = false;
                for link in extract_block_refs(&record.text) {
                    if link == active_block_uid {
                        is_match = true;
                        break;
                    }
                }
                if is_match {
                    self.block_backlinks.push(BacklinkEntry {
                        block_uid: record.block_uid,
                        page_uid: record.page_uid,
                        page_title: record.page_title,
                        text: record.text,
                    });
                }
            }
        }

        if self.block_backlinks.len() > 20 {
            self.block_backlinks.truncate(20);
        }
    }

    pub(super) fn load_review_items(&mut self, cx: &mut Context<Self>) {
        let Some(db) = self.db.as_ref() else {
            self.review_items.clear();
            return;
        };

        let now = now_millis();
        let items = db.list_review_queue_due(now, 50).unwrap_or_default();
        let mut page_cache: HashMap<String, PageRecord> = HashMap::new();
        let mut blocks_cache: HashMap<String, Vec<BlockSnapshot>> = HashMap::new();
        let mut display_items = Vec::with_capacity(items.len());

        for item in items {
            let page_uid = item.page_uid;
            let block_uid = item.block_uid;

            let page = if let Some(page) = page_cache.get(&page_uid) {
                Some(page.clone())
            } else {
                match db.get_page_by_uid(&page_uid).ok().flatten() {
                    Some(page) => {
                        page_cache.insert(page.uid.clone(), page.clone());
                        Some(page)
                    }
                    None => None,
                }
            };

            let page_title = page
                .as_ref()
                .map(|page| page.title.clone())
                .unwrap_or_else(|| page_uid.clone());

            let text = if let Some(page) = &page {
                let blocks = blocks_cache
                    .entry(page.uid.clone())
                    .or_insert_with(|| db.load_blocks_for_page(page.id).unwrap_or_default());
                blocks
                    .iter()
                    .find(|block| block.uid == block_uid)
                    .map(|block| block.text.clone())
                    .unwrap_or_else(|| "Block not found.".to_string())
            } else {
                "Block not found.".to_string()
            };

            display_items.push(ReviewDisplayItem {
                id: item.id,
                page_uid,
                block_uid,
                page_title,
                text,
                due_at: item.due_at,
            });
        }

        self.review_items = display_items;
        cx.notify();
    }

    pub(super) fn review_mark_done(&mut self, item_id: i64, cx: &mut Context<Self>) {
        let Some(db) = self.db.as_ref() else {
            return;
        };
        let now = now_millis();
        let _ = db.mark_review_queue_item(item_id, "done", now, None);
        self.load_review_items(cx);
    }

    pub(super) fn review_snooze_day(&mut self, item_id: i64, cx: &mut Context<Self>) {
        let Some(db) = self.db.as_ref() else {
            return;
        };
        let now = now_millis();
        let next = now + 86_400_000;
        let _ = db.mark_review_queue_item(item_id, "pending", now, Some(next));
        self.load_review_items(cx);
    }

    pub(super) fn review_snooze_week(&mut self, item_id: i64, cx: &mut Context<Self>) {
        let Some(db) = self.db.as_ref() else {
            return;
        };
        let now = now_millis();
        let next = now + 604_800_000;
        let _ = db.mark_review_queue_item(item_id, "pending", now, Some(next));
        self.load_review_items(cx);
    }
}
