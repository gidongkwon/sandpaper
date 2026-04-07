use crate::rag::hash::hash_chunk_content;
use crate::rag::types::ChunkRecord;
use sandpaper_core::db::BlockSnapshot;

const MAX_CHUNK_TOKENS: usize = 96;
const MAX_CHILD_CONTEXT_BLOCKS: usize = 3;

fn estimate_token_count(value: &str) -> usize {
    let whitespace_tokens = value.split_whitespace().count();
    let char_tokens = value.chars().count().div_ceil(4);
    whitespace_tokens.max(char_tokens).max(1)
}

fn build_breadcrumb(stack: &[String]) -> Option<String> {
    if stack.is_empty() {
        None
    } else {
        Some(stack.join(" / "))
    }
}

fn trimmed_text(block: &BlockSnapshot) -> Option<String> {
    let trimmed = block.text.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn append_segment(parts: &mut Vec<String>, segment: String, token_count: &mut usize) {
    let segment_tokens = estimate_token_count(&segment);
    if !parts.is_empty() && *token_count + segment_tokens > MAX_CHUNK_TOKENS {
        return;
    }
    *token_count += segment_tokens;
    parts.push(segment);
}

fn previous_sibling_text(blocks: &[BlockSnapshot], index: usize) -> Option<String> {
    let indent = blocks[index].indent;
    for candidate in blocks[..index].iter().rev() {
        if candidate.indent < indent {
            break;
        }
        if candidate.indent == indent {
            if let Some(text) = trimmed_text(candidate) {
                return Some(text);
            }
        }
    }
    None
}

fn next_sibling_text(blocks: &[BlockSnapshot], index: usize) -> Option<String> {
    let indent = blocks[index].indent;
    for candidate in blocks.iter().skip(index + 1) {
        if candidate.indent < indent {
            break;
        }
        if candidate.indent == indent {
            if let Some(text) = trimmed_text(candidate) {
                return Some(text);
            }
        }
    }
    None
}

fn direct_child_context(blocks: &[BlockSnapshot], index: usize) -> Vec<String> {
    let indent = blocks[index].indent;
    let mut children = Vec::new();
    for candidate in blocks.iter().skip(index + 1) {
        if candidate.indent <= indent {
            break;
        }
        if candidate.indent == indent + 1 {
            if let Some(text) = trimmed_text(candidate) {
                children.push(text);
                if children.len() >= MAX_CHILD_CONTEXT_BLOCKS {
                    break;
                }
            }
        }
    }
    children
}

pub fn chunk_page_blocks(
    page_uid: &str,
    title: &str,
    blocks: &[BlockSnapshot],
) -> Vec<ChunkRecord> {
    let mut chunks = Vec::new();
    let mut ancestor_stack: Vec<String> = Vec::new();

    for (index, block) in blocks.iter().enumerate() {
        while ancestor_stack.len() > block.indent.max(0) as usize {
            ancestor_stack.pop();
        }

        let Some(trimmed) = trimmed_text(block) else {
            continue;
        };

        let breadcrumb = build_breadcrumb(&ancestor_stack);
        let mut content_parts = Vec::new();
        let mut token_count = 0usize;
        append_segment(
            &mut content_parts,
            title.trim().to_string(),
            &mut token_count,
        );
        if let Some(value) = breadcrumb.as_ref() {
            append_segment(&mut content_parts, value.clone(), &mut token_count);
        }
        append_segment(&mut content_parts, trimmed.clone(), &mut token_count);
        for child in direct_child_context(blocks, index) {
            append_segment(&mut content_parts, child, &mut token_count);
        }
        if let Some(previous) = previous_sibling_text(blocks, index) {
            append_segment(&mut content_parts, previous, &mut token_count);
        }
        if let Some(next) = next_sibling_text(blocks, index) {
            append_segment(&mut content_parts, next, &mut token_count);
        }
        let content = content_parts.join("\n\n");
        let ordinal = chunks.len();

        chunks.push(ChunkRecord {
            chunk_id: format!("{page_uid}:{}", block.uid),
            page_uid: page_uid.to_string(),
            block_uid: block.uid.clone(),
            ordinal,
            source_kind: "block".to_string(),
            breadcrumb,
            token_count,
            chunk_hash: hash_chunk_content(page_uid, &block.uid, ordinal, &content),
            content,
        });

        ancestor_stack.push(trimmed);
    }

    chunks
}

#[cfg(test)]
mod tests {
    use super::{chunk_page_blocks, MAX_CHUNK_TOKENS};
    use sandpaper_core::blocks::BlockType;
    use sandpaper_core::db::BlockSnapshot;

    fn make_block(uid: &str, text: &str, indent: i64, block_type: BlockType) -> BlockSnapshot {
        BlockSnapshot {
            uid: uid.to_string(),
            text: text.to_string(),
            indent,
            block_type,
            meta: None,
        }
    }

    #[test]
    fn chunk_page_blocks_skips_empty_blocks_and_keeps_page_title() {
        let chunks = chunk_page_blocks(
            "page-1",
            "Inbox",
            &[
                make_block("b1", "", 0, BlockType::Text),
                make_block("b2", "Hello world", 0, BlockType::Text),
            ],
        );

        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].page_uid, "page-1");
        assert_eq!(chunks[0].block_uid, "b2");
        assert!(chunks[0].content.contains("Inbox"));
        assert!(chunks[0].content.contains("Hello world"));
    }

    #[test]
    fn chunk_page_blocks_builds_breadcrumb_from_visible_ancestors() {
        let chunks = chunk_page_blocks(
            "page-1",
            "Research",
            &[
                make_block("b1", "Retrieval", 0, BlockType::Heading2),
                make_block("b2", "Embedding choice", 1, BlockType::Text),
            ],
        );

        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[1].breadcrumb.as_deref(), Some("Retrieval"));
        assert!(chunks[1].content.contains("Retrieval"));
        assert!(chunks[1].content.contains("Embedding choice"));
    }

    #[test]
    fn chunk_page_blocks_includes_child_and_sibling_context() {
        let chunks = chunk_page_blocks(
            "page-1",
            "Research",
            &[
                make_block("b1", "Retrieval", 0, BlockType::Heading2),
                make_block("b2", "Hybrid search", 1, BlockType::Text),
                make_block("b3", "RRF fusion", 2, BlockType::Text),
                make_block("b4", "Semantic rerank", 1, BlockType::Text),
            ],
        );

        let hybrid_chunk = chunks
            .iter()
            .find(|chunk| chunk.block_uid == "b2")
            .expect("hybrid chunk");

        assert!(hybrid_chunk.content.contains("Hybrid search"));
        assert!(hybrid_chunk.content.contains("RRF fusion"));
        assert!(hybrid_chunk.content.contains("Semantic rerank"));
    }

    #[test]
    fn chunk_page_blocks_respects_context_budget() {
        let chunks = chunk_page_blocks(
            "page-1",
            "Research",
            &[
                make_block("b1", "Topic", 0, BlockType::Heading2),
                make_block("b2", &"A".repeat(320), 1, BlockType::Text),
                make_block("b3", &"B".repeat(320), 2, BlockType::Text),
                make_block("b4", &"C".repeat(320), 2, BlockType::Text),
                make_block("b5", &"D".repeat(320), 1, BlockType::Text),
            ],
        );

        let first_chunk = chunks
            .iter()
            .find(|chunk| chunk.block_uid == "b2")
            .expect("first chunk");

        assert!(first_chunk.token_count <= MAX_CHUNK_TOKENS);
        assert!(first_chunk.content.contains(&"A".repeat(320)));
        assert!(!first_chunk.content.contains(&"D".repeat(320)));
    }
}
