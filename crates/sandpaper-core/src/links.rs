use crate::app;

pub fn extract_wikilinks(text: &str) -> Vec<String> {
    let mut links = Vec::new();
    let mut cursor = 0;
    while let Some(start) = text[cursor..].find("[[") {
        let start_ix = cursor + start + 2;
        if let Some(end_rel) = text[start_ix..].find("]]") {
            let end_ix = start_ix + end_rel;
            let value = text[start_ix..end_ix].trim();
            if !value.is_empty() {
                links.push(value.to_string());
            }
            cursor = end_ix + 2;
        } else {
            break;
        }
    }
    links
}

pub fn strip_wikilinks(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut cursor = 0;
    while let Some(start) = text[cursor..].find("[[") {
        let start_ix = cursor + start;
        output.push_str(&text[cursor..start_ix]);
        let link_start = start_ix + 2;
        if let Some(end_rel) = text[link_start..].find("]]") {
            let link_end = link_start + end_rel;
            output.push_str(text[link_start..link_end].trim());
            cursor = link_end + 2;
        } else {
            output.push_str(&text[start_ix..]);
            return output;
        }
    }
    output.push_str(&text[cursor..]);
    output
}

pub fn extract_block_refs(text: &str) -> Vec<String> {
    let mut refs = Vec::new();
    let mut cursor = 0;
    while let Some(start) = text[cursor..].find("((") {
        let start_ix = cursor + start + 2;
        if let Some(end_rel) = text[start_ix..].find("))") {
            let end_ix = start_ix + end_rel;
            let mut value = text[start_ix..end_ix].trim();
            if let Some((id, _alias)) = value.split_once('|') {
                value = id.trim();
            }
            if !value.is_empty() {
                refs.push(value.to_string());
            }
            cursor = end_ix + 2;
        } else {
            break;
        }
    }
    refs
}

pub fn strip_block_refs(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut cursor = 0;
    while let Some(start) = text[cursor..].find("((") {
        let start_ix = cursor + start;
        output.push_str(&text[cursor..start_ix]);
        let ref_start = start_ix + 2;
        if let Some(end_rel) = text[ref_start..].find("))") {
            let ref_end = ref_start + end_rel;
            let inner = text[ref_start..ref_end].trim();
            let display = inner
                .split_once('|')
                .map(|(_, alias)| alias.trim())
                .unwrap_or(inner);
            output.push_str(display);
            cursor = ref_end + 2;
        } else {
            output.push_str(&text[start_ix..]);
            return output;
        }
    }
    output.push_str(&text[cursor..]);
    output
}

pub fn replace_wikilinks_in_text(text: &str, from_title: &str, to_title: &str) -> String {
    let normalized_from = app::sanitize_kebab(from_title);
    let normalized_to = app::sanitize_kebab(to_title);
    if normalized_from.is_empty() || normalized_from == normalized_to {
        return text.to_string();
    }

    let mut output = String::with_capacity(text.len());
    let mut cursor = 0;
    while let Some(start_rel) = text[cursor..].find("[[") {
        let start = cursor + start_rel;
        output.push_str(&text[cursor..start]);
        let inner_start = start + 2;
        if inner_start >= text.len() {
            output.push_str(&text[start..]);
            return output;
        }
        let Some(end_rel) = text[inner_start..].find("]]") else {
            output.push_str(&text[start..]);
            return output;
        };
        let inner_end = inner_start + end_rel;
        let inner = text[inner_start..inner_end].trim();
        if inner.is_empty() {
            output.push_str(&text[start..inner_end + 2]);
            cursor = inner_end + 2;
            continue;
        }

        let mut parts = inner.splitn(2, '|');
        let target_part = parts.next().unwrap_or("").trim();
        let alias_part = parts
            .next()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty());
        let mut target_parts = target_part.splitn(2, '#');
        let target_base = target_parts.next().unwrap_or("").trim();
        let heading_part = target_parts
            .next()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty());

        if target_base.is_empty()
            || app::sanitize_kebab(target_base) != normalized_from
        {
            output.push_str(&text[start..inner_end + 2]);
            cursor = inner_end + 2;
            continue;
        }

        let next_target = to_title.trim();
        let next_target = if next_target.is_empty() {
            target_base
        } else {
            next_target
        };
        let heading_suffix = heading_part
            .map(|value| format!("#{value}"))
            .unwrap_or_default();
        let alias_suffix = alias_part
            .map(|value| format!("|{value}"))
            .unwrap_or_default();
        output.push_str(&format!(
            "[[{next_target}{heading_suffix}{alias_suffix}]]"
        ));
        cursor = inner_end + 2;
    }

    output.push_str(&text[cursor..]);
    output
}

#[cfg(test)]
mod tests {
    use super::{
        extract_block_refs, extract_wikilinks, replace_wikilinks_in_text, strip_block_refs,
        strip_wikilinks,
    };

    #[test]
    fn extract_wikilinks_collects_titles() {
        let links = extract_wikilinks("Hello [[Page One]] and [[Other Page]]!");
        assert_eq!(links, vec!["Page One", "Other Page"]);
    }

    #[test]
    fn strip_wikilinks_removes_brackets() {
        let stripped = strip_wikilinks("Hello [[Page]]!");
        assert_eq!(stripped, "Hello Page!");
    }

    #[test]
    fn extract_block_refs_collects_ids() {
        let refs = extract_block_refs("See ((block-1)) and ((block-2|Alias)).");
        assert_eq!(refs, vec!["block-1", "block-2"]);
    }

    #[test]
    fn strip_block_refs_removes_parens() {
        let stripped = strip_block_refs("Link to ((block-1)) and ((block-2|Alias)).");
        assert_eq!(stripped, "Link to block-1 and Alias.");
    }

    #[test]
    fn replace_wikilinks_updates_matching_targets() {
        let text = "See [[Project Atlas|Alias]] and [[Project Atlas#Head]] plus [[Other]].";
        let next = replace_wikilinks_in_text(text, "Project Atlas", "Project Nova");
        assert_eq!(
            next,
            "See [[Project Nova|Alias]] and [[Project Nova#Head]] plus [[Other]]."
        );
    }

    #[test]
    fn replace_wikilinks_ignores_mismatched_targets() {
        let text = "Check [[Atlas]] and [[Other|Alias]].";
        let next = replace_wikilinks_in_text(text, "Project Atlas", "Project Nova");
        assert_eq!(next, text);
    }

    #[test]
    fn replace_wikilinks_keeps_target_when_new_title_blank() {
        let text = "Jump to [[Project Atlas]]";
        let next = replace_wikilinks_in_text(text, "Project Atlas", "");
        assert_eq!(next, text);
    }

    #[test]
    fn replace_wikilinks_matches_normalized_titles() {
        let text = "Jump to [[project-atlas]]";
        let next = replace_wikilinks_in_text(text, "Project Atlas", "Project Nova");
        assert_eq!(next, "Jump to [[Project Nova]]");
    }
}
