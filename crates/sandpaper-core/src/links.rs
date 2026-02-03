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

#[cfg(test)]
mod tests {
    use super::{extract_block_refs, extract_wikilinks, strip_block_refs, strip_wikilinks};

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
}
