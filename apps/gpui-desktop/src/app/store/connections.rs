use super::*;

#[derive(Clone, Debug)]
pub(crate) struct RelatedPage {
    pub(crate) page_uid: String,
    pub(crate) page_title: String,
    pub(crate) score: f64,
    pub(crate) reasons: Vec<ConnectionReason>,
}

#[derive(Clone, Debug)]
pub(crate) enum ConnectionReason {
    SharedLink(String),
    DirectLink,
}

impl AppStore {
    pub(crate) fn refresh_connections(&mut self, cx: &mut Context<Self>) {
        let Some(db) = self.app.db.as_ref() else {
            return;
        };
        let Some(active_page) = self.editor.active_page.as_ref() else {
            self.editor.related_pages.clear();
            self.editor.random_pages.clear();
            return;
        };
        let active_uid = active_page.uid.clone();

        // Build link graph: page_uid -> set of link targets (normalized)
        let wikilink_blocks = db.list_blocks_with_wikilinks().unwrap_or_default();
        let mut page_links: HashMap<String, HashSet<String>> = HashMap::new();
        for block in &wikilink_blocks {
            let targets = extract_wikilink_targets(&block.text);
            page_links
                .entry(block.page_uid.clone())
                .or_default()
                .extend(targets);
        }

        let my_links = page_links.get(&active_uid).cloned().unwrap_or_default();

        // Score other pages
        let pages = db.list_pages().unwrap_or_default();
        let mut scored: Vec<RelatedPage> = Vec::new();
        for page in &pages {
            if page.uid == active_uid {
                continue;
            }
            let mut score = 0.0;
            let mut reasons = Vec::new();

            let their_links = page_links.get(&page.uid);

            // Shared links: both link to same target
            if let Some(their) = their_links {
                for shared in my_links.intersection(their) {
                    score += 3.0;
                    if reasons.len() < 3 {
                        reasons.push(ConnectionReason::SharedLink(shared.clone()));
                    }
                }
            }

            // Direct links: we link to them or they link to us
            if my_links.contains(&page.uid) {
                score += 2.0;
                reasons.push(ConnectionReason::DirectLink);
            }
            if their_links.is_some_and(|links| links.contains(&active_uid)) {
                score += 2.0;
                if !reasons
                    .iter()
                    .any(|r| matches!(r, ConnectionReason::DirectLink))
                {
                    reasons.push(ConnectionReason::DirectLink);
                }
            }

            if score > 0.0 {
                scored.push(RelatedPage {
                    page_uid: page.uid.clone(),
                    page_title: page.title.clone(),
                    score,
                    reasons,
                });
            }
        }

        scored.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        scored.truncate(8);
        self.editor.related_pages = scored;

        // Random discovery pages (excluding current)
        let random = db.random_pages(3).unwrap_or_default();
        self.editor.random_pages = random
            .into_iter()
            .filter(|p| p.uid != active_uid)
            .take(2)
            .collect();

        cx.notify();
    }

    pub(crate) fn refresh_feed(&mut self, cx: &mut Context<Self>) {
        if self.app.db.is_none() {
            return;
        }

        // Call mutable methods first (before borrowing db)
        self.load_review_items(cx);
        self.refresh_connections(cx);

        let mut items: Vec<FeedItem> = Vec::new();

        // 1. Due reviews
        if !self.editor.review_items.is_empty() {
            items.push(FeedItem::SectionHeader("Due for Review".into()));
            for review in &self.editor.review_items {
                items.push(FeedItem::ReviewDue(review.clone()));
            }
        }

        // 2. Related pages
        if !self.editor.related_pages.is_empty() {
            items.push(FeedItem::SectionHeader("Related".into()));
            for rp in &self.editor.related_pages {
                items.push(FeedItem::RelatedPage(rp.clone()));
            }
        }

        // 3. Recently edited pages (from session-tracked recent_pages)
        if let Some(db) = self.app.db.as_ref() {
            let all_pages = db.list_pages().unwrap_or_default();
            let recent_uids: Vec<String> =
                self.editor.recent_pages.iter().take(10).cloned().collect();
            let mut recent_pages: Vec<PageRecord> = Vec::new();
            for uid in &recent_uids {
                if let Some(page) = all_pages.iter().find(|p| &p.uid == uid) {
                    recent_pages.push(page.clone());
                }
            }
            if !recent_pages.is_empty() {
                items.push(FeedItem::SectionHeader("Recently Edited".into()));
                for page in recent_pages {
                    items.push(FeedItem::RecentEdit { page, edited_at: 0 });
                }
            }

            // 4. Random discovery
            let random = db.random_pages(4).unwrap_or_default();
            let active_uid = self
                .editor
                .active_page
                .as_ref()
                .map(|p| p.uid.clone())
                .unwrap_or_default();
            let random: Vec<_> = random
                .into_iter()
                .filter(|p| p.uid != active_uid)
                .take(3)
                .collect();
            if !random.is_empty() {
                items.push(FeedItem::SectionHeader("Discover".into()));
                for page in random {
                    items.push(FeedItem::RandomDiscovery(page));
                }
            }
        }

        self.editor.feed_items = items;
        self.editor.feed_selected_index = 0;
        cx.notify();
    }

    pub(crate) fn schedule_connections_refresh(&mut self, cx: &mut Context<Self>) {
        self.editor.connections_epoch += 1;
        let epoch = self.editor.connections_epoch;
        cx.spawn(async move |this, cx| {
            cx.background_executor()
                .timer(Duration::from_millis(500))
                .await;
            this.update(cx, |this, cx| {
                if this.editor.connections_epoch != epoch {
                    return;
                }
                this.refresh_connections(cx);
            })
            .ok();
        })
        .detach();
    }
}

fn extract_wikilink_targets(text: &str) -> Vec<String> {
    let mut targets = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find("[[") {
        rest = &rest[start + 2..];
        if let Some(end) = rest.find("]]") {
            let inner = &rest[..end];
            let target = inner.split('|').next().unwrap_or(inner);
            let target = target.split('#').next().unwrap_or(target);
            let normalized = app::sanitize_kebab(target.trim());
            if !normalized.is_empty() {
                targets.push(normalized);
            }
            rest = &rest[end + 2..];
        } else {
            break;
        }
    }
    targets
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_wikilink_targets_finds_links() {
        let targets = extract_wikilink_targets("See [[Page One]] and [[Other|Alias]]");
        assert_eq!(targets, vec!["page-one", "other"]);
    }

    #[test]
    fn extract_wikilink_targets_handles_headings() {
        let targets = extract_wikilink_targets("See [[Page#Section]]");
        assert_eq!(targets, vec!["page"]);
    }

    #[test]
    fn extract_wikilink_targets_empty_on_no_links() {
        let targets = extract_wikilink_targets("No links here");
        assert!(targets.is_empty());
    }
}
