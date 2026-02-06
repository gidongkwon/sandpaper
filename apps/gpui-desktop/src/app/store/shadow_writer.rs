use super::{AppStore, EditorPane};
use crate::app::prelude::*;

use std::path::{Path, PathBuf};

pub(crate) fn shadow_markdown_path(vault_path: &Path, page_uid: &str) -> PathBuf {
    let safe_name = app::sanitize_kebab(page_uid);
    vault_path.join("pages").join(format!("{safe_name}.md"))
}

pub(crate) fn build_shadow_markdown(
    page_uid: &str,
    title: &str,
    blocks: &[BlockSnapshot],
) -> String {
    let mut lines = Vec::with_capacity(blocks.len() + 1);
    lines.push(format!("# {title} ^{page_uid}"));
    for block in blocks {
        let indent = "  ".repeat(std::cmp::max(0, block.indent) as usize);
        let text = block.text.trim_end();
        let line = format_block_as_markdown(&indent, text, &block.uid, block.block_type);
        lines.push(line);
    }
    format!("{}\n", lines.join("\n"))
}

fn format_block_as_markdown(indent: &str, text: &str, uid: &str, block_type: BlockType) -> String {
    let spacer = if text.is_empty() { "" } else { " " };
    match block_type {
        BlockType::Heading1 => format!("{indent}# {text}{spacer}^{uid}"),
        BlockType::Heading2 => format!("{indent}## {text}{spacer}^{uid}"),
        BlockType::Heading3 => format!("{indent}### {text}{spacer}^{uid}"),
        BlockType::Quote => format!("{indent}> {text}{spacer}^{uid}"),
        BlockType::Todo => {
            let is_checked = text.starts_with("- [x] ")
                || text.starts_with("[x] ")
                || text.starts_with("- [X] ")
                || text.starts_with("[X] ");
            let clean = strip_todo_prefix(text);
            let check = if is_checked { "x" } else { " " };
            let cs = if clean.is_empty() { "" } else { " " };
            format!("{indent}- [{check}] {clean}{cs}^{uid}")
        }
        BlockType::Divider => format!("{indent}--- ^{uid}"),
        BlockType::Code => format!("{indent}```\n{indent}{text}\n{indent}```{spacer}^{uid}"),
        BlockType::Callout
        | BlockType::Toggle
        | BlockType::ColumnLayout
        | BlockType::Column
        | BlockType::DatabaseView => {
            let type_name = serde_json::to_value(block_type)
                .ok()
                .and_then(|v| v.as_str().map(String::from))
                .unwrap_or_else(|| "text".to_string());
            format!("{indent}- {text} <!--sp:{{\"type\":\"{type_name}\"}}--> {spacer}^{uid}")
        }
        BlockType::Text => format!("{indent}- {text}{spacer}^{uid}"),
    }
}

fn strip_todo_prefix(text: &str) -> &str {
    for prefix in &["- [x] ", "- [X] ", "- [ ] ", "[x] ", "[X] ", "[ ] "] {
        if let Some(rest) = text.strip_prefix(prefix) {
            return rest;
        }
    }
    text
}

pub(crate) fn write_shadow_markdown_to_vault(
    vault_path: &Path,
    page_uid: &str,
    content: &str,
) -> Result<PathBuf, String> {
    let path = shadow_markdown_path(vault_path, page_uid);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| format!("{err:?}"))?;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if path.exists() {
            let permissions = std::fs::Permissions::from_mode(0o600);
            std::fs::set_permissions(&path, permissions).map_err(|err| format!("{err:?}"))?;
        }
    }

    std::fs::write(&path, content).map_err(|err| format!("{err:?}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = std::fs::Permissions::from_mode(0o444);
        std::fs::set_permissions(&path, permissions).map_err(|err| format!("{err:?}"))?;
    }

    Ok(path)
}

pub(crate) fn export_page_shadow_markdown(db: &Database, page_uid: &str) -> Result<String, String> {
    let normalized = app::sanitize_kebab(page_uid);
    let page = db
        .get_page_by_uid(&normalized)
        .map_err(|err| format!("{err:?}"))?
        .ok_or_else(|| "Page not found".to_string())?;
    let blocks = db
        .load_blocks_for_page(page.id)
        .map_err(|err| format!("{err:?}"))?;
    Ok(build_shadow_markdown(&page.uid, &page.title, &blocks))
}

impl AppStore {
    pub(crate) fn queue_shadow_write_for_pane(&mut self, pane: EditorPane) {
        let page_uid = match pane {
            EditorPane::Primary => self
                .editor
                .active_page
                .as_ref()
                .map(|page| page.uid.clone()),
            EditorPane::Secondary => self
                .editor
                .secondary_pane
                .as_ref()
                .map(|pane| pane.page.uid.clone()),
        };

        if let Some(uid) = page_uid {
            self.ui.shadow_write_pending.insert(uid);
        }
    }

    fn is_page_dirty_for_shadow_write(&self, uid: &str) -> bool {
        if self
            .editor
            .active_page
            .as_ref()
            .is_some_and(|page| page.uid == uid)
        {
            return self.app.primary_dirty;
        }

        if self
            .editor
            .secondary_pane
            .as_ref()
            .is_some_and(|pane| pane.page.uid == uid)
        {
            return self
                .editor
                .secondary_pane
                .as_ref()
                .is_some_and(|pane| pane.dirty);
        }

        false
    }

    pub(crate) fn schedule_shadow_write_flush(&mut self, cx: &mut Context<Self>) {
        self.ui.shadow_write_epoch += 1;
        let epoch = self.ui.shadow_write_epoch;
        cx.spawn(async move |this, cx| {
            cx.background_executor()
                .timer(Duration::from_millis(400))
                .await;
            this.update(cx, |this, cx| {
                if this.ui.shadow_write_epoch != epoch {
                    return;
                }
                this.flush_shadow_write_queue(cx);
            })
            .ok();
        })
        .detach();
    }

    pub(crate) fn flush_shadow_write_queue(&mut self, cx: &mut Context<Self>) {
        if self.ui.shadow_write_busy {
            return;
        }
        if self.ui.shadow_write_pending.is_empty() {
            return;
        }

        let Some(vault_path) = self.app.active_vault_root.clone() else {
            self.ui.shadow_write_last_error = Some("Vault path not available.".into());
            cx.notify();
            return;
        };

        let Some(db) = self.app.db.as_ref() else {
            self.ui.shadow_write_last_error = Some("Database not available.".into());
            cx.notify();
            return;
        };

        let candidates: Vec<String> = self
            .ui
            .shadow_write_pending
            .iter()
            .filter(|uid| !self.is_page_dirty_for_shadow_write(uid))
            .cloned()
            .collect();
        if candidates.is_empty() {
            return;
        }

        let mut tasks = Vec::new();
        let mut drop_uids = Vec::new();
        for uid in candidates {
            match export_page_shadow_markdown(db, &uid) {
                Ok(markdown) => tasks.push((uid, markdown)),
                Err(err) => {
                    if err == "Page not found" {
                        drop_uids.push(uid);
                    } else {
                        self.ui.shadow_write_last_error = Some(err.into());
                    }
                }
            }
        }

        for uid in drop_uids {
            self.ui.shadow_write_pending.remove(&uid);
        }

        if tasks.is_empty() {
            return;
        }

        self.ui.shadow_write_busy = true;
        self.ui.shadow_write_last_error = None;
        cx.notify();

        cx.spawn(async move |this, cx| {
            let mut succeeded = Vec::new();
            let mut last_error: Option<String> = None;

            for (uid, markdown) in tasks {
                match write_shadow_markdown_to_vault(&vault_path, &uid, &markdown) {
                    Ok(_) => succeeded.push(uid),
                    Err(err) => last_error = Some(err),
                }
            }

            this.update(cx, |this, cx| {
                for uid in succeeded {
                    this.ui.shadow_write_pending.remove(&uid);
                }
                this.ui.shadow_write_busy = false;
                if let Some(err) = last_error {
                    this.ui.shadow_write_last_error = Some(err.into());
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    pub(crate) fn export_all_shadow_markdown(&mut self, cx: &mut Context<Self>) {
        if self.ui.shadow_write_busy {
            return;
        }

        let Some(vault_path) = self.app.active_vault_root.clone() else {
            self.ui.shadow_write_last_error = Some("Vault path not available.".into());
            cx.notify();
            return;
        };

        let Some(db) = self.app.db.as_ref() else {
            self.ui.shadow_write_last_error = Some("Database not available.".into());
            cx.notify();
            return;
        };

        let pages = match db.list_pages() {
            Ok(pages) => pages,
            Err(err) => {
                self.ui.shadow_write_last_error = Some(format!("{err:?}").into());
                cx.notify();
                return;
            }
        };

        let mut tasks = Vec::new();
        for page in pages {
            let blocks = match db.load_blocks_for_page(page.id) {
                Ok(blocks) => blocks,
                Err(err) => {
                    self.ui.shadow_write_last_error = Some(format!("{err:?}").into());
                    cx.notify();
                    return;
                }
            };
            let markdown = build_shadow_markdown(&page.uid, &page.title, &blocks);
            tasks.push((page.uid, markdown));
        }

        self.ui.shadow_write_busy = true;
        self.ui.shadow_write_last_error = None;
        cx.notify();

        cx.spawn(async move |this, cx| {
            let mut written = Vec::new();
            let mut last_error: Option<String> = None;

            for (uid, markdown) in tasks {
                match write_shadow_markdown_to_vault(&vault_path, &uid, &markdown) {
                    Ok(_) => written.push(uid),
                    Err(err) => last_error = Some(err),
                }
            }

            this.update(cx, |this, cx| {
                for uid in written {
                    if !this.is_page_dirty_for_shadow_write(&uid) {
                        this.ui.shadow_write_pending.remove(&uid);
                    }
                }
                this.ui.shadow_write_busy = false;
                if let Some(err) = last_error {
                    this.ui.shadow_write_last_error = Some(err.into());
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shadow_markdown_path_uses_pages_dir_and_sanitizes() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = shadow_markdown_path(dir.path(), "Daily Notes");
        assert!(path.ends_with("pages/daily-notes.md"));
    }

    #[test]
    fn build_shadow_markdown_matches_expected_format() {
        let blocks = vec![
            BlockSnapshot {
                uid: "b1".into(),
                text: "First".into(),
                indent: 0,
                block_type: BlockType::Text,
            },
            BlockSnapshot {
                uid: "b2".into(),
                text: "".into(),
                indent: 1,
                block_type: BlockType::Text,
            },
        ];

        let markdown = build_shadow_markdown("page-1", "Inbox", &blocks);
        assert_eq!(markdown, "# Inbox ^page-1\n- First ^b1\n  - ^b2\n");
    }

    #[test]
    fn build_shadow_markdown_encodes_block_types() {
        let blocks = vec![
            BlockSnapshot {
                uid: "h1".into(),
                text: "Title".into(),
                indent: 0,
                block_type: BlockType::Heading1,
            },
            BlockSnapshot {
                uid: "h2".into(),
                text: "Subtitle".into(),
                indent: 0,
                block_type: BlockType::Heading2,
            },
            BlockSnapshot {
                uid: "q1".into(),
                text: "A wise quote".into(),
                indent: 0,
                block_type: BlockType::Quote,
            },
            BlockSnapshot {
                uid: "t1".into(),
                text: "Buy milk".into(),
                indent: 0,
                block_type: BlockType::Todo,
            },
            BlockSnapshot {
                uid: "d1".into(),
                text: "".into(),
                indent: 0,
                block_type: BlockType::Divider,
            },
            BlockSnapshot {
                uid: "c1".into(),
                text: "let x = 1;".into(),
                indent: 0,
                block_type: BlockType::Code,
            },
        ];

        let markdown = build_shadow_markdown("p1", "Test", &blocks);
        assert!(markdown.contains("# Title ^h1"));
        assert!(markdown.contains("## Subtitle ^h2"));
        assert!(markdown.contains("> A wise quote ^q1"));
        assert!(markdown.contains("- [ ] Buy milk ^t1"));
        assert!(markdown.contains("--- ^d1"));
        assert!(markdown.contains("```\nlet x = 1;\n``` ^c1"));
    }

    #[test]
    fn build_shadow_markdown_encodes_complex_types() {
        let blocks = vec![
            BlockSnapshot {
                uid: "ca1".into(),
                text: "Warning message".into(),
                indent: 0,
                block_type: BlockType::Callout,
            },
            BlockSnapshot {
                uid: "tg1".into(),
                text: "Click to expand".into(),
                indent: 0,
                block_type: BlockType::Toggle,
            },
        ];

        let markdown = build_shadow_markdown("p2", "Complex", &blocks);
        assert!(markdown.contains("<!--sp:{\"type\":\"callout\"}-->"));
        assert!(markdown.contains("<!--sp:{\"type\":\"toggle\"}-->"));
    }

    #[test]
    fn write_shadow_markdown_creates_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let content = "# Inbox ^inbox\n- Hello ^b1\n";
        let path = write_shadow_markdown_to_vault(dir.path(), "Inbox", content).expect("write");
        assert!(path.exists());
        let saved = std::fs::read_to_string(&path).expect("read");
        assert_eq!(saved, content);

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).expect("meta").permissions().mode() & 0o777;
            assert_eq!(mode, 0o444);
        }
    }

    #[test]
    fn export_page_shadow_markdown_loads_from_db() {
        let mut db = Database::new_in_memory().expect("db init");
        db.run_migrations().expect("migrations");

        let page_id = db.insert_page("inbox", "Inbox").expect("insert page");
        db.replace_blocks_for_page(
            page_id,
            &[BlockSnapshot {
                uid: "b1".into(),
                text: "Hello".into(),
                indent: 0,
                block_type: BlockType::Text,
            }],
        )
        .expect("insert blocks");

        let markdown = export_page_shadow_markdown(&db, "inbox").expect("export");
        assert_eq!(markdown, "# Inbox ^inbox\n- Hello ^b1\n");
    }
}
