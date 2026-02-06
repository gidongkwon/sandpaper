use super::*;

pub(crate) fn expand_tilde(path: &str) -> PathBuf {
    if path == "~" {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home);
        }
    }
    if let Some(rest) = path.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home).join(rest);
        }
    }
    PathBuf::from(path)
}

pub(crate) fn default_vault_path(name: &str) -> String {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let dir = PathBuf::from(home)
        .join("Documents")
        .join("Sandpaper")
        .join(app::sanitize_kebab(name));
    dir.to_string_lossy().to_string()
}

pub(crate) fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

pub(crate) fn single_line_text(text: &str) -> String {
    text.replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace('\n', " ")
}

#[derive(Clone, Debug)]
pub(crate) struct PageCursor {
    pub block_uid: String,
    pub cursor_offset: usize,
}

pub(crate) fn format_snippet(text: &str, max_len: usize) -> String {
    let normalized = single_line_text(text);
    let trimmed = normalized.trim();
    if trimmed.len() <= max_len {
        return trimmed.to_string();
    }
    let mut end = max_len;
    while end > 0 && !trimmed.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &trimmed[..end])
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SlashQuery {
    pub slash_index: usize,
    pub query: String,
}

pub(crate) fn find_slash_query(text: &str, cursor: usize) -> Option<SlashQuery> {
    if text.is_empty() {
        return None;
    }
    let mut cursor = cursor.min(text.len());
    while cursor > 0 && !text.is_char_boundary(cursor) {
        cursor -= 1;
    }
    if cursor == 0 {
        return None;
    }

    let before = &text[..cursor];
    let slash_index = before.rfind('/')?;
    if slash_index > 0 {
        let prev = text[..slash_index].chars().rev().next()?;
        if !prev.is_whitespace() {
            return None;
        }
    }

    let query = &text[slash_index + 1..cursor];
    if query.chars().any(|ch| ch.is_whitespace()) {
        return None;
    }

    Some(SlashQuery {
        slash_index,
        query: query.to_string(),
    })
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct WikilinkQuery {
    pub range_start: usize,
    pub range_end: usize,
    pub has_closing: bool,
    pub query: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum WikilinkToken {
    Text(String),
    Link { target: String, label: String },
}

pub(crate) fn find_wikilink_query(text: &str, cursor: usize) -> Option<WikilinkQuery> {
    if text.len() < 2 {
        return None;
    }
    let mut cursor = cursor.min(text.len());
    while cursor > 0 && !text.is_char_boundary(cursor) {
        cursor -= 1;
    }
    if cursor == 0 {
        return None;
    }

    let before = &text[..cursor];
    let start = before.rfind("[[")?;
    if start + 2 > text.len() {
        return None;
    }
    let close_rel = text[start + 2..].find("]]");
    let close_ix = close_rel.map(|rel| start + 2 + rel);
    if let Some(close_ix) = close_ix {
        if close_ix < cursor {
            return None;
        }
    }

    let has_closing = close_ix.is_some();
    let range_end = if let Some(close_ix) = close_ix {
        (close_ix + 2).min(text.len())
    } else {
        text.len()
    };
    let inner_end = close_ix.unwrap_or(text.len()).min(text.len());
    if inner_end < start + 2 || start > text.len() {
        return None;
    }
    let inner = &text[start + 2..inner_end];
    let target_part = inner.split('|').next().unwrap_or(inner);
    let target_base = target_part.split('#').next().unwrap_or(target_part);
    let query = target_base.trim().to_string();

    Some(WikilinkQuery {
        range_start: start,
        range_end,
        has_closing,
        query,
    })
}

pub(crate) fn parse_wikilink_tokens(text: &str) -> Vec<WikilinkToken> {
    let mut tokens = Vec::new();
    let mut cursor = 0usize;
    while let Some(rel_start) = text[cursor..].find("[[") {
        let start = cursor + rel_start;
        if start > cursor {
            tokens.push(WikilinkToken::Text(text[cursor..start].to_string()));
        }
        let inner_start = start + 2;
        if inner_start >= text.len() {
            tokens.push(WikilinkToken::Text(text[start..].to_string()));
            return tokens;
        }
        let Some(rel_end) = text[inner_start..].find("]]") else {
            tokens.push(WikilinkToken::Text(text[start..].to_string()));
            return tokens;
        };
        let end = inner_start + rel_end;
        let inner = &text[inner_start..end];
        if let Some((target, label)) = parse_wikilink_inner(inner) {
            tokens.push(WikilinkToken::Link { target, label });
        } else {
            tokens.push(WikilinkToken::Text(text[start..end + 2].to_string()));
        }
        cursor = end + 2;
        if cursor >= text.len() {
            return tokens;
        }
    }

    if cursor < text.len() {
        tokens.push(WikilinkToken::Text(text[cursor..].to_string()));
    }
    tokens
}

fn parse_wikilink_inner(inner: &str) -> Option<(String, String)> {
    let raw = inner.trim();
    if raw.is_empty() {
        return None;
    }
    let mut parts = raw.splitn(2, '|');
    let before_alias = parts.next().unwrap_or("").trim();
    let alias = parts
        .next()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty());
    let mut target_parts = before_alias.splitn(2, '#');
    let target = target_parts.next().unwrap_or("").trim();
    if target.is_empty() {
        return None;
    }
    let label = alias.unwrap_or(target).trim();
    let label = if label.is_empty() { target } else { label };
    Some((target.to_string(), label.to_string()))
}

pub(crate) fn resolve_cursor_for_blocks(
    blocks: &[BlockSnapshot],
    cursor: Option<&PageCursor>,
) -> (usize, usize) {
    if blocks.is_empty() {
        return (0, 0);
    }

    if let Some(cursor) = cursor {
        if let Some(ix) = blocks
            .iter()
            .position(|block| block.uid == cursor.block_uid)
        {
            let offset = cursor.cursor_offset.min(blocks[ix].text.len());
            return (ix, offset);
        }
    }

    (0, blocks[0].text.len())
}

pub(crate) fn fuzzy_score(query: &str, text: &str) -> Option<i64> {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return Some(0);
    }

    let text_lower = text.to_lowercase();
    let query_chars: Vec<char> = query.chars().collect();
    let text_chars: Vec<char> = text_lower.chars().collect();

    if query_chars.is_empty() || text_chars.is_empty() {
        return None;
    }

    let mut score: i64 = 0;
    let mut search_idx = 0usize;
    let mut last_match: Option<usize> = None;

    for q in query_chars {
        let mut found = None;
        for (ix, ch) in text_chars.iter().enumerate().skip(search_idx) {
            if *ch == q {
                found = Some(ix);
                break;
            }
        }
        let ix = match found {
            Some(ix) => ix,
            None => return None,
        };

        score += 10;
        if let Some(prev) = last_match {
            if ix == prev + 1 {
                score += 6;
            } else {
                let gap = (ix - prev - 1) as i64;
                score -= gap.min(3);
            }
        }
        if ix == 0 || !text_chars[ix - 1].is_alphanumeric() {
            score += 3;
        }

        last_match = Some(ix);
        search_idx = ix + 1;
    }

    let length_penalty = (text_chars.len().saturating_sub(query.len())) as i64 / 4;
    Some(score - length_penalty)
}

pub(crate) fn count_case_insensitive_occurrences(text: &str, needle: &str) -> usize {
    let needle = needle.trim();
    if needle.is_empty() {
        return 0;
    }
    let text_lower = text.to_lowercase();
    let needle_lower = needle.to_lowercase();
    if needle_lower.is_empty() {
        return 0;
    }
    text_lower.match_indices(&needle_lower).count()
}

fn wikilink_ranges(text: &str) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    let mut cursor = 0usize;
    while let Some(rel_start) = text[cursor..].find("[[") {
        let start = cursor + rel_start;
        let inner_start = start + 2;
        if inner_start >= text.len() {
            break;
        }
        let Some(rel_end) = text[inner_start..].find("]]") else {
            break;
        };
        let end = inner_start + rel_end + 2;
        ranges.push((start, end.min(text.len())));
        cursor = end;
        if cursor >= text.len() {
            break;
        }
    }
    ranges
}

pub(crate) fn count_case_insensitive_occurrences_outside_wikilinks(
    text: &str,
    needle: &str,
) -> usize {
    let needle = needle.trim();
    if needle.is_empty() {
        return 0;
    }

    let ranges = wikilink_ranges(text);
    if ranges.is_empty() {
        return count_case_insensitive_occurrences(text, needle);
    }

    let mut count = 0usize;
    let mut cursor = 0usize;
    for (start, end) in ranges {
        if start > cursor {
            count += count_case_insensitive_occurrences(&text[cursor..start], needle);
        }
        cursor = end.min(text.len());
    }
    if cursor < text.len() {
        count += count_case_insensitive_occurrences(&text[cursor..], needle);
    }

    count
}

fn find_case_insensitive_range(text: &str, needle: &str) -> Option<(usize, usize)> {
    let needle = needle.trim();
    if needle.is_empty() {
        return None;
    }
    let needle_folded: Vec<char> = needle.chars().flat_map(|ch| ch.to_lowercase()).collect();
    if needle_folded.is_empty() {
        return None;
    }

    for (start, _) in text.char_indices() {
        let mut needle_ix = 0usize;
        let mut matched = true;

        for (rel, ch) in text[start..].char_indices() {
            for folded in ch.to_lowercase() {
                if needle_ix >= needle_folded.len() {
                    break;
                }
                if folded != needle_folded[needle_ix] {
                    matched = false;
                    break;
                }
                needle_ix += 1;
            }

            if !matched {
                break;
            }

            if needle_ix >= needle_folded.len() {
                let end = start + rel + ch.len_utf8();
                return Some((start, end));
            }
        }
    }

    None
}

pub(crate) fn filter_slash_commands<'a>(
    query: &str,
    commands: &'a [super::SlashCommandDef],
) -> Vec<&'a super::SlashCommandDef> {
    let query = query.trim();
    if query.is_empty() {
        return commands.iter().collect();
    }

    let mut scored: Vec<(i64, usize, &'a super::SlashCommandDef)> = Vec::new();
    for (ix, cmd) in commands.iter().enumerate() {
        let score = fuzzy_score(query, cmd.id).or_else(|| fuzzy_score(query, cmd.label));
        if let Some(score) = score {
            scored.push((score, ix, cmd));
        }
    }
    scored.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
    scored.into_iter().map(|entry| entry.2).collect()
}

pub(crate) fn cycle_index(current: usize, len: usize, forward: bool) -> usize {
    if len == 0 {
        return 0;
    }
    if forward {
        (current + 1) % len
    } else {
        current.checked_sub(1).unwrap_or(len.saturating_sub(1))
    }
}

pub(crate) fn apply_slash_command_text(
    command_id: &str,
    before: &str,
    after: &str,
    date: &str,
) -> (String, usize) {
    let cleaned = format!("{before}{after}");

    match command_id {
        "link" => {
            let insert_text = "[[Page]]";
            let next_text = format!("{before}{insert_text}{after}");
            let next_cursor = before.len() + insert_text.len();
            (next_text, next_cursor)
        }
        "date" => {
            let insert_text = date;
            let next_text = format!("{before}{insert_text}{after}");
            let next_cursor = before.len() + insert_text.len();
            (next_text, next_cursor)
        }
        "task" => {
            let trimmed = cleaned.trim_start();
            let prefix = if trimmed.starts_with("- [ ] ") || trimmed.starts_with("- [x] ") {
                ""
            } else {
                "- [ ] "
            };
            let next_text = format!("{prefix}{trimmed}");
            (next_text.clone(), next_text.len())
        }
        "h1" => apply_heading_command("# ", &cleaned),
        "h2" => apply_heading_command("## ", &cleaned),
        "h3" => apply_heading_command("### ", &cleaned),
        "quote" => {
            let trimmed = strip_prefix(cleaned.trim(), "> ");
            let next_text = format!("> {trimmed}");
            (next_text.clone(), next_text.len())
        }
        "bold" => apply_wrap_command("**", &cleaned),
        "italic" => apply_wrap_command("_", &cleaned),
        "code" => apply_wrap_command("`", &cleaned),
        "divider" => ("---".to_string(), 3),
        _ => {
            let trimmed = cleaned.trim().to_string();
            (trimmed.clone(), trimmed.len())
        }
    }
}

fn apply_heading_command(prefix: &str, text: &str) -> (String, usize) {
    let trimmed = strip_heading_prefix(text.trim());
    let next_text = format!("{prefix}{trimmed}");
    (next_text.clone(), next_text.len())
}

fn apply_wrap_command(wrapper: &str, text: &str) -> (String, usize) {
    let trimmed = text.trim();
    if trimmed.starts_with(wrapper)
        && trimmed.ends_with(wrapper)
        && trimmed.len() >= 2 * wrapper.len()
    {
        let next_text = trimmed.to_string();
        return (next_text.clone(), next_text.len());
    }
    let next_text = format!("{wrapper}{trimmed}{wrapper}");
    (next_text.clone(), next_text.len())
}

fn strip_heading_prefix(text: &str) -> &str {
    let trimmed = text.trim_start();
    let mut hash_count = 0usize;
    let mut iter = trimmed.char_indices();
    while let Some((_, ch)) = iter.next() {
        if ch == '#' {
            hash_count += 1;
            continue;
        }
        if ch == ' ' && hash_count > 0 {
            let offset = hash_count + 1;
            if trimmed.len() >= offset {
                return &trimmed[offset..];
            }
        }
        break;
    }
    trimmed
}

fn strip_prefix<'a>(text: &'a str, prefix: &str) -> &'a str {
    if text.starts_with(prefix) {
        &text[prefix.len()..]
    } else {
        text
    }
}

fn normalize_image_source(source: &str) -> Option<String> {
    let source = source.trim();
    if source.is_empty() {
        return None;
    }

    let source = if source.starts_with('<') && source.ends_with('>') && source.len() > 2 {
        &source[1..source.len() - 1]
    } else {
        source
    };

    if source.starts_with("http://") || source.starts_with("https://") {
        return Some(source.to_string());
    }

    if source.starts_with("/assets/") && source.len() > "/assets/".len() {
        return Some(source.to_string());
    }

    None
}

pub(crate) fn extract_markdown_image_parts(text: &str) -> Option<(String, String)> {
    let text = text.trim();
    if !text.starts_with("![") {
        return None;
    }

    let bracket_close = text.find("](")?;
    if bracket_close < 2 {
        return None;
    }
    let paren_close = text.rfind(')')?;
    if paren_close <= bracket_close + 2 || paren_close + 1 != text.len() {
        return None;
    }

    let alt = text[2..bracket_close].to_string();
    let source_raw = &text[bracket_close + 2..paren_close];
    let source = normalize_image_source(source_raw)?;
    Some((alt, source))
}

pub(crate) fn extract_image_source(text: &str) -> Option<String> {
    let text = text.trim();
    if text.is_empty() {
        return None;
    }

    if let Some((_alt, source)) = extract_markdown_image_parts(text) {
        return Some(source);
    }

    normalize_image_source(text)
}

/// Strip markdown prefixes from text when converting to a typed block.
/// Removes heading hashes, quote markers, task checkboxes, and divider dashes.
pub(crate) fn clean_text_for_block_type(text: &str, block_type: BlockType) -> String {
    let trimmed = text.trim();
    match block_type {
        BlockType::Heading1 | BlockType::Heading2 | BlockType::Heading3 => {
            strip_heading_prefix(trimmed).to_string()
        }
        BlockType::Quote => strip_prefix(trimmed, "> ").to_string(),
        BlockType::Todo => {
            let t = strip_prefix(trimmed, "- [x] ");
            let t = strip_prefix(t, "- [ ] ");
            let t = strip_prefix(t, "[x] ");
            let t = strip_prefix(t, "[ ] ");
            t.to_string()
        }
        BlockType::Image => extract_image_source(trimmed).unwrap_or_else(|| trimmed.to_string()),
        BlockType::Divider => String::new(),
        _ => trimmed.to_string(),
    }
}

pub(crate) fn link_first_unlinked_reference(
    text: &str,
    title: &str,
    cursor: usize,
) -> Option<(String, usize)> {
    let title = title.trim();
    if title.is_empty() {
        return None;
    }
    let ranges = wikilink_ranges(text);
    let (match_start, match_end) = if ranges.is_empty() {
        find_case_insensitive_range(text, title)?
    } else {
        let mut cursor = 0usize;
        let mut found: Option<(usize, usize)> = None;
        for (start, end) in ranges {
            if start > cursor {
                let segment = &text[cursor..start];
                if let Some((rel_start, rel_end)) = find_case_insensitive_range(segment, title) {
                    found = Some((cursor + rel_start, cursor + rel_end));
                    break;
                }
            }
            cursor = end.min(text.len());
        }

        if found.is_none() && cursor < text.len() {
            let segment = &text[cursor..];
            if let Some((rel_start, rel_end)) = find_case_insensitive_range(segment, title) {
                found = Some((cursor + rel_start, cursor + rel_end));
            }
        }

        found?
    };

    let mut next_text = String::with_capacity(text.len() + 4);
    next_text.push_str(&text[..match_start]);
    next_text.push_str("[[");
    next_text.push_str(title);
    next_text.push_str("]]");
    next_text.push_str(&text[match_end..]);

    let replaced_len = match_end - match_start;
    let delta = (4 + title.len()) as isize - replaced_len as isize;
    let next_cursor = if cursor <= match_start {
        cursor
    } else if cursor >= match_end {
        cursor.saturating_add(delta.max(0) as usize)
    } else {
        match_start + 2 + title.len()
    };

    Some((next_text, next_cursor))
}

pub(crate) fn score_palette_page(
    query: &str,
    title: &str,
    snippet: &str,
    recent_rank: Option<usize>,
) -> Option<i64> {
    let query = query.trim();
    let recency_boost = recent_rank
        .map(|rank| (100 - (rank as i64 * 2)).max(0))
        .unwrap_or(0);

    if query.is_empty() {
        return Some(recency_boost);
    }

    let title_score = fuzzy_score(query, title);
    let snippet_score = fuzzy_score(query, snippet).map(|score| score.saturating_sub(3));
    let best = match (title_score, snippet_score) {
        (Some(title), Some(snippet)) => title.max(snippet),
        (Some(title), None) => title,
        (None, Some(snippet)) => snippet,
        (None, None) => return None,
    };

    Some(best + recency_boost)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_snippet_replaces_newlines_with_spaces() {
        assert_eq!(format_snippet("first\nsecond", 64), "first second");
        assert_eq!(format_snippet("a\r\nb", 64), "a b");
    }

    #[test]
    fn single_line_text_replaces_crlf_and_lf() {
        assert_eq!(single_line_text("a\nb"), "a b");
        assert_eq!(single_line_text("a\r\nb"), "a b");
        assert_eq!(single_line_text("a\rb"), "a b");
    }

    #[test]
    fn clean_todo_text_removes_markdown_checkbox_prefixes() {
        assert_eq!(
            clean_text_for_block_type("- [ ] pending item", BlockType::Todo),
            "pending item"
        );
        assert_eq!(
            clean_text_for_block_type("- [x] completed item", BlockType::Todo),
            "completed item"
        );
        assert_eq!(
            clean_text_for_block_type("[ ] bare pending item", BlockType::Todo),
            "bare pending item"
        );
        assert_eq!(
            clean_text_for_block_type("[x] bare completed item", BlockType::Todo),
            "bare completed item"
        );
    }

    #[test]
    fn extract_image_source_supports_markdown_http_and_assets_path() {
        assert_eq!(
            extract_image_source("![alt](https://example.com/cat.png)"),
            Some("https://example.com/cat.png".to_string())
        );
        assert_eq!(
            extract_markdown_image_parts("![cat.png](/assets/abc123)"),
            Some(("cat.png".to_string(), "/assets/abc123".to_string()))
        );
        assert_eq!(
            extract_image_source("https://example.com/cat.png"),
            Some("https://example.com/cat.png".to_string())
        );
        assert_eq!(
            extract_image_source("/assets/abc123"),
            Some("/assets/abc123".to_string())
        );
    }

    #[test]
    fn extract_image_source_rejects_unsupported_schemes() {
        assert_eq!(extract_image_source("file:///tmp/cat.png"), None);
        assert_eq!(extract_image_source("data:image/png;base64,abc"), None);
    }

    #[test]
    fn clean_image_text_normalizes_markdown_image_source() {
        assert_eq!(
            clean_text_for_block_type(
                "![A cat](https://example.com/cat.png)",
                BlockType::Image
            ),
            "https://example.com/cat.png"
        );
    }
}
