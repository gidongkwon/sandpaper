use super::*;

pub(super) fn expand_tilde(path: &str) -> PathBuf {
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

pub(super) fn default_vault_path(name: &str) -> String {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let dir = PathBuf::from(home)
        .join("Documents")
        .join("Sandpaper")
        .join(app::sanitize_kebab(name));
    dir.to_string_lossy().to_string()
}

pub(super) fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

#[derive(Clone, Debug)]
pub(super) struct PageCursor {
    pub block_uid: String,
    pub cursor_offset: usize,
}

pub(super) fn format_snippet(text: &str, max_len: usize) -> String {
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

pub(super) fn resolve_cursor_for_blocks(
    blocks: &[BlockSnapshot],
    cursor: Option<&PageCursor>,
) -> (usize, usize) {
    if blocks.is_empty() {
        return (0, 0);
    }

    if let Some(cursor) = cursor {
        if let Some(ix) = blocks.iter().position(|block| block.uid == cursor.block_uid) {
            let offset = cursor.cursor_offset.min(blocks[ix].text.len());
            return (ix, offset);
        }
    }

    (0, blocks[0].text.len())
}

pub(super) fn fuzzy_score(query: &str, text: &str) -> Option<i64> {
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

pub(super) fn count_case_insensitive_occurrences(text: &str, needle: &str) -> usize {
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

pub(super) fn link_first_unlinked_reference(
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

pub(super) fn score_palette_page(
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
