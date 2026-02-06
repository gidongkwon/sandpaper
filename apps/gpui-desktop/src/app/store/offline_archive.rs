use super::shadow_writer::build_shadow_markdown;
use super::AppStore;
use crate::app::prelude::*;
use rfd::FileDialog;

use std::io::{Cursor, Read, Write};

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct MarkdownPage {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) blocks: Vec<BlockSnapshot>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct MarkdownParseResult {
    pub(crate) page: MarkdownPage,
    pub(crate) warnings: Vec<String>,
    pub(crate) has_header: bool,
}

pub(crate) fn parse_markdown_page(markdown: &str) -> MarkdownParseResult {
    const INDENT_UNIT: usize = 2;
    const DEFAULT_TITLE: &str = "Imported";

    fn strip_plugin_metadata(value: &str) -> &str {
        let trimmed = value.trim_end();
        let Some(start) = trimmed.rfind("<!--sp:") else {
            return trimmed;
        };
        let Some(end_rel) = trimmed[start..].find("-->") else {
            return trimmed;
        };
        let end = start + end_rel + 3;
        if trimmed[end..].trim().is_empty() {
            trimmed[..start].trim_end()
        } else {
            trimmed
        }
    }

    fn extract_trailing_id(value: &str) -> (String, Option<String>) {
        let trimmed = value.trim_end();
        let Some(caret_pos) = trimmed.rfind('^') else {
            return (trimmed.to_string(), None);
        };
        let (before, after) = trimmed.split_at(caret_pos);
        let id = after.trim_start_matches('^');
        let before_trimmed = before.trim_end();
        if before_trimmed.len() == before.len() {
            return (trimmed.to_string(), None);
        }
        if id.is_empty() || !id.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-') {
            return (trimmed.to_string(), None);
        }
        (before_trimmed.to_string(), Some(id.to_string()))
    }

    fn normalize_indent(value: &str) -> String {
        value.replace('\t', "  ")
    }

    let normalized = markdown.replace("\r\n", "\n").replace('\r', "\n");
    let lines: Vec<&str> = normalized.split('\n').collect();
    let mut cursor = 0;

    while cursor < lines.len() && lines[cursor].trim().is_empty() {
        cursor += 1;
    }

    let mut has_header = false;
    let mut page_title = DEFAULT_TITLE.to_string();
    let mut page_id = Uuid::new_v4().to_string();

    if cursor < lines.len() {
        let header_line = lines[cursor].trim();
        if header_line.starts_with('#') {
            let header_text = header_line.trim_start_matches('#').trim();
            let cleaned = strip_plugin_metadata(header_text);
            let (text, id) = extract_trailing_id(cleaned);
            page_title = {
                let trimmed = text.trim();
                if trimmed.is_empty() {
                    "Untitled".to_string()
                } else {
                    trimmed.to_string()
                }
            };
            if let Some(id) = id {
                page_id = id;
            }
            has_header = true;
            cursor += 1;
        }
    }

    let mut warnings = Vec::new();
    let mut seen_ids = HashSet::new();
    let mut blocks = Vec::new();

    for (ix, raw_line) in lines.iter().enumerate().skip(cursor) {
        if raw_line.trim().is_empty() {
            continue;
        }

        let trimmed_left = raw_line.trim_start_matches([' ', '\t']);
        if !trimmed_left.starts_with('-') {
            warnings.push(format!("Ignored line {}: not a list item.", ix + 1));
            continue;
        }
        let rest = trimmed_left[1..].trim_start();

        let indent_width = raw_line.len().saturating_sub(trimmed_left.len());
        let indent_text = normalize_indent(&raw_line[..indent_width]);
        let indent = (indent_text.len() / INDENT_UNIT) as i64;

        let raw_text = strip_plugin_metadata(rest);
        let (text, id) = extract_trailing_id(raw_text.trim_end());

        let mut resolved_id = id;
        if resolved_id.is_none() {
            let generated = Uuid::new_v4().to_string();
            warnings.push(format!(
                "Line {}: missing block id, generated {generated}.",
                ix + 1
            ));
            resolved_id = Some(generated);
        }

        let mut resolved_id = resolved_id.expect("id");
        if seen_ids.contains(&resolved_id) {
            let replacement = Uuid::new_v4().to_string();
            warnings.push(format!(
                "Line {}: duplicate block id {resolved_id}, replaced with {replacement}.",
                ix + 1
            ));
            resolved_id = replacement;
        }

        seen_ids.insert(resolved_id.clone());
        blocks.push(BlockSnapshot {
            uid: resolved_id,
            text: text.trim_end().to_string(),
            indent,
            block_type: BlockType::Text,
        });
    }

    if blocks.is_empty() {
        warnings.push("No list items found in Markdown.".to_string());
    }

    MarkdownParseResult {
        page: MarkdownPage {
            id: page_id,
            title: page_title,
            blocks,
        },
        warnings,
        has_header,
    }
}

pub(crate) fn build_offline_archive_zip(
    db: &Database,
    vault_name: Option<&str>,
    exported_at: &str,
) -> Result<Vec<u8>, String> {
    let pages = db.list_pages().map_err(|err| format!("{err:?}"))?;

    let mut manifest_pages = Vec::new();
    let mut page_files: Vec<(String, String)> = Vec::new();

    for page in &pages {
        let blocks = db
            .load_blocks_for_page(page.id)
            .map_err(|err| format!("{err:?}"))?;
        let markdown = build_shadow_markdown(&page.uid, &page.title, &blocks);
        page_files.push((format!("pages/{}.md", page.uid), markdown));
        manifest_pages.push(serde_json::json!({
            "uid": page.uid,
            "title": page.title,
            "file": format!("pages/{}.md", page.uid),
        }));
    }

    let manifest = serde_json::json!({
        "version": 1,
        "exported_at": exported_at,
        "page_count": pages.len(),
        "asset_count": 0,
        "vault_name": vault_name,
        "pages": manifest_pages,
    });
    let manifest_text =
        serde_json::to_string_pretty(&manifest).map_err(|err| format!("{err:?}"))?;

    let mut out = Cursor::new(Vec::new());
    {
        let mut writer = zip::ZipWriter::new(&mut out);
        let options =
            zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

        writer
            .start_file("manifest.json", options)
            .map_err(|err| format!("{err:?}"))?;
        writer
            .write_all(manifest_text.as_bytes())
            .map_err(|err| format!("{err:?}"))?;

        writer
            .start_file("assets/README.txt", options)
            .map_err(|err| format!("{err:?}"))?;
        writer
            .write_all(b"Drop assets here when exporting attachments.")
            .map_err(|err| format!("{err:?}"))?;

        for (name, content) in page_files {
            writer
                .start_file(name, options)
                .map_err(|err| format!("{err:?}"))?;
            writer
                .write_all(content.as_bytes())
                .map_err(|err| format!("{err:?}"))?;
        }

        writer.finish().map_err(|err| format!("{err:?}"))?;
    }

    Ok(out.into_inner())
}

pub(crate) fn import_offline_archive_zip(
    db: &mut Database,
    bytes: &[u8],
) -> Result<Vec<String>, String> {
    let cursor = Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|err| format!("{err:?}"))?;

    let manifest_files: Option<Vec<String>> =
        archive.by_name("manifest.json").ok().and_then(|mut file| {
            let mut text = String::new();
            file.read_to_string(&mut text).ok()?;
            let value: serde_json::Value = serde_json::from_str(&text).ok()?;
            let files = value
                .get("pages")
                .and_then(|pages| pages.as_array())
                .map(|pages| {
                    pages
                        .iter()
                        .filter_map(|entry| entry.get("file")?.as_str().map(|s| s.to_string()))
                        .collect::<Vec<_>>()
                });
            files
        });

    let mut page_files: Vec<String> = if let Some(files) = manifest_files {
        files
    } else {
        let mut files = Vec::new();
        for index in 0..archive.len() {
            let file = archive.by_index(index).map_err(|err| format!("{err:?}"))?;
            let name = file.name().to_string();
            if name.starts_with("pages/") && name.ends_with(".md") {
                files.push(name);
            }
        }
        files
    };

    page_files.sort();

    let mut imported = Vec::new();

    for file_name in page_files {
        let mut file = match archive.by_name(&file_name) {
            Ok(file) => file,
            Err(_) => continue,
        };
        let mut text = String::new();
        file.read_to_string(&mut text)
            .map_err(|err| format!("{err:?}"))?;

        let parsed = parse_markdown_page(&text);
        if parsed.page.blocks.is_empty() {
            continue;
        }

        let uid = app::sanitize_kebab(&parsed.page.id);
        let title = {
            let trimmed = parsed.page.title.trim();
            if trimmed.is_empty() {
                "Untitled".to_string()
            } else {
                trimmed.to_string()
            }
        };

        let page_id = app::ensure_page(db, &uid, &title).map_err(|err| format!("{err:?}"))?;
        db.update_page_title(page_id, &title)
            .map_err(|err| format!("{err:?}"))?;
        db.replace_blocks_for_page(page_id, &parsed.page.blocks)
            .map_err(|err| format!("{err:?}"))?;

        imported.push(uid);
    }

    Ok(imported)
}

impl AppStore {
    pub(crate) fn export_offline_archive(&mut self, cx: &mut Context<Self>) {
        if self.ui.offline_export_busy {
            return;
        }

        let Some(db) = self.app.db.as_ref() else {
            self.ui.offline_export_status = Some("Database not available.".into());
            cx.notify();
            return;
        };

        let Some(vault_root) = self.app.active_vault_root.clone() else {
            self.ui.offline_export_status = Some("Vault not available.".into());
            cx.notify();
            return;
        };

        let vault_name: Option<String> = self
            .app
            .active_vault_id
            .as_ref()
            .and_then(|id| self.app.vaults.iter().find(|vault| &vault.id == id))
            .map(|vault| vault.name.clone());

        let date_stamp = Local::now().format("%Y-%m-%d").to_string();
        let default_name = format!("sandpaper-offline-{date_stamp}.zip");

        let path = FileDialog::new()
            .set_directory(&vault_root)
            .set_file_name(&default_name)
            .add_filter("Zip archive", &["zip"])
            .save_file();

        let Some(path) = path else {
            return;
        };

        self.ui.offline_export_busy = true;
        self.ui.offline_export_status = None;
        cx.notify();

        let exported_at = chrono::Utc::now().to_rfc3339();
        let bytes = match build_offline_archive_zip(db, vault_name.as_deref(), &exported_at) {
            Ok(bytes) => bytes,
            Err(err) => {
                self.ui.offline_export_busy = false;
                self.ui.offline_export_status =
                    Some(format!("Offline export failed: {err}").into());
                cx.notify();
                return;
            }
        };

        cx.spawn(async move |this, cx| {
            let result = std::fs::write(&path, bytes).map_err(|err| format!("{err:?}"));
            this.update(cx, |this, cx| {
                this.ui.offline_export_busy = false;
                this.ui.offline_export_status = Some(match result {
                    Ok(_) => format!("Offline export ready: {}", path.display()).into(),
                    Err(err) => format!("Offline export failed: {err}").into(),
                });
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    pub(crate) fn import_offline_archive(&mut self, cx: &mut Context<Self>) {
        if self.ui.offline_import_busy {
            return;
        }

        let Some(vault_root) = self.app.active_vault_root.clone() else {
            self.ui.offline_import_status = Some("Vault not available.".into());
            cx.notify();
            return;
        };

        let path = FileDialog::new()
            .set_directory(&vault_root)
            .add_filter("Zip archive", &["zip"])
            .pick_file();

        let Some(path) = path else {
            return;
        };

        self.ui.offline_import_busy = true;
        self.ui.offline_import_status = None;
        cx.notify();

        cx.spawn(async move |this, cx| {
            let bytes = std::fs::read(&path).map_err(|err| format!("{err:?}"));
            this.update(cx, |this, cx| {
                let bytes = match bytes {
                    Ok(bytes) => bytes,
                    Err(err) => {
                        this.ui.offline_import_busy = false;
                        this.ui.offline_import_status =
                            Some(format!("Offline import failed: {err}").into());
                        cx.notify();
                        return;
                    }
                };

                let Some(db) = this.app.db.as_mut() else {
                    this.ui.offline_import_busy = false;
                    this.ui.offline_import_status = Some("Database not available.".into());
                    cx.notify();
                    return;
                };

                match import_offline_archive_zip(db, &bytes) {
                    Ok(imported) => {
                        this.editor.pages = db.list_pages().unwrap_or_default();
                        this.refresh_search_results();

                        if let Some(first) = imported.first().cloned() {
                            this.open_page(&first, cx);
                        }

                        this.ui.offline_import_status = Some(
                            format!(
                                "Imported {} page{} from {}.",
                                imported.len(),
                                if imported.len() == 1 { "" } else { "s" },
                                path.display()
                            )
                            .into(),
                        );
                    }
                    Err(err) => {
                        this.ui.offline_import_status =
                            Some(format!("Offline import failed: {err}").into());
                    }
                }

                this.ui.offline_import_busy = false;
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

    fn read_zip_file(bytes: &[u8], name: &str) -> String {
        let cursor = Cursor::new(bytes.to_vec());
        let mut archive = zip::ZipArchive::new(cursor).expect("zip open");
        let mut file = archive.by_name(name).expect("file exists");
        let mut out = String::new();
        file.read_to_string(&mut out).expect("read");
        out
    }

    #[test]
    fn build_offline_archive_zip_includes_manifest_and_pages() {
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

        let bytes =
            build_offline_archive_zip(&db, Some("Vault"), "2026-01-31T00:00:00Z").expect("build");
        assert!(!bytes.is_empty());

        let manifest = read_zip_file(&bytes, "manifest.json");
        assert!(manifest.contains("\"version\": 1"));
        assert!(manifest.contains("\"page_count\": 1"));
        assert!(manifest.contains("\"vault_name\": \"Vault\""));

        let page = read_zip_file(&bytes, "pages/inbox.md");
        assert_eq!(page, "# Inbox ^inbox\n- Hello ^b1\n");
    }

    #[test]
    fn import_offline_archive_zip_creates_pages_and_blocks() {
        let mut out = Cursor::new(Vec::new());
        {
            let mut writer = zip::ZipWriter::new(&mut out);
            let options = zip::write::FileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);

            writer
                .start_file("manifest.json", options)
                .expect("start manifest");
            writer
                .write_all(
                    br#"{"version":1,"exported_at":"2026-01-31T00:00:00Z","page_count":1,"asset_count":0,"pages":[{"uid":"travel","title":"Travel Log","file":"pages/travel.md"}]}"#,
                )
                .expect("write manifest");

            writer
                .start_file("pages/travel.md", options)
                .expect("start page");
            writer
                .write_all(b"# Travel Log ^travel\n- First stop ^t1\n")
                .expect("write page");

            writer
                .start_file("assets/README.txt", options)
                .expect("start assets");
            writer
                .write_all(b"Assets placeholder")
                .expect("write assets");

            writer.finish().expect("finish");
        }

        let bytes = out.into_inner();
        let mut db = Database::new_in_memory().expect("db init");
        db.run_migrations().expect("migrations");

        let imported = import_offline_archive_zip(&mut db, &bytes).expect("import");
        assert_eq!(imported, vec!["travel".to_string()]);

        let page = db
            .get_page_by_uid("travel")
            .expect("get page")
            .expect("page exists");
        assert_eq!(page.title, "Travel Log");

        let blocks = db.load_blocks_for_page(page.id).expect("load blocks");
        assert_eq!(
            blocks,
            vec![BlockSnapshot {
                uid: "t1".into(),
                text: "First stop".into(),
                indent: 0,
                block_type: BlockType::Text,
            }]
        );
    }
}
