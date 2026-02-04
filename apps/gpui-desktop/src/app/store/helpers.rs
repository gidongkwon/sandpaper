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

#[derive(Clone, Debug)]
pub(crate) struct PageCursor {
    pub block_uid: String,
    pub cursor_offset: usize,
}

pub(crate) fn format_snippet(text: &str, max_len: usize) -> String {
    let trimmed = text.trim();
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

pub(crate) fn filter_slash_commands<'a>(
    query: &str,
    commands: &[(&'a str, &'a str)],
) -> Vec<(&'a str, &'a str)> {
    let query = query.trim();
    if query.is_empty() {
        return commands.to_vec();
    }

    let mut scored: Vec<(i64, usize, (&'a str, &'a str))> = Vec::new();
    for (ix, (id, label)) in commands.iter().copied().enumerate() {
        let score = fuzzy_score(query, id).or_else(|| fuzzy_score(query, label));
        if let Some(score) = score {
            scored.push((score, ix, (id, label)));
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

pub(crate) fn link_first_unlinked_reference(
    text: &str,
    title: &str,
    cursor: usize,
) -> Option<(String, usize)> {
    let title = title.trim();
    if title.is_empty() {
        return None;
    }
    let lowered = text.to_lowercase();
    let title_lower = title.to_lowercase();
    let match_start = lowered.find(&title_lower)?;
    let match_end = match_start + title_lower.len();
    if match_end > text.len() {
        return None;
    }

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
