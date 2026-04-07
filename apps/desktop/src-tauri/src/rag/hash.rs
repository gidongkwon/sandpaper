use sandpaper_core::db::BlockSnapshot;
use serde::Serialize;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

fn canonicalize_json(value: Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.into_iter().map(canonicalize_json).collect()),
        Value::Object(entries) => {
            let mut keys: Vec<_> = entries.into_iter().collect();
            keys.sort_by(|left, right| left.0.cmp(&right.0));
            let mut normalized = Map::new();
            for (key, value) in keys {
                normalized.insert(key, canonicalize_json(value));
            }
            Value::Object(normalized)
        }
        other => other,
    }
}

fn stable_hash<T>(value: &T) -> String
where
    T: Serialize,
{
    let json = serde_json::to_value(value).expect("serialize hash input");
    let normalized = canonicalize_json(json);
    let encoded = serde_json::to_vec(&normalized).expect("encode hash input");
    let mut hasher = Sha256::new();
    hasher.update(encoded);
    format!("{:x}", hasher.finalize())
}

pub fn hash_block_snapshot(block: &BlockSnapshot) -> String {
    stable_hash(block)
}

pub fn hash_page_snapshot(page_uid: &str, title: &str, blocks: &[BlockSnapshot]) -> String {
    #[derive(Serialize)]
    struct PageHashInput<'a> {
        page_uid: &'a str,
        title: &'a str,
        blocks: &'a [BlockSnapshot],
    }

    stable_hash(&PageHashInput {
        page_uid,
        title,
        blocks,
    })
}

pub fn hash_chunk_content(
    page_uid: &str,
    block_uid: &str,
    ordinal: usize,
    content: &str,
) -> String {
    #[derive(Serialize)]
    struct ChunkHashInput<'a> {
        page_uid: &'a str,
        block_uid: &'a str,
        ordinal: usize,
        content: &'a str,
    }

    stable_hash(&ChunkHashInput {
        page_uid,
        block_uid,
        ordinal,
        content,
    })
}

#[cfg(test)]
mod tests {
    use super::{hash_block_snapshot, hash_chunk_content, hash_page_snapshot};
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
    fn page_hash_is_stable_for_identical_input() {
        let blocks = vec![
            make_block("b1", "Hello", 0, BlockType::Text),
            make_block("b2", "World", 1, BlockType::Todo),
        ];

        let left = hash_page_snapshot("page-1", "Inbox", &blocks);
        let right = hash_page_snapshot("page-1", "Inbox", &blocks);

        assert_eq!(left, right);
    }

    #[test]
    fn page_hash_changes_when_title_changes() {
        let blocks = vec![make_block("b1", "Hello", 0, BlockType::Text)];

        let left = hash_page_snapshot("page-1", "Inbox", &blocks);
        let right = hash_page_snapshot("page-1", "Archive", &blocks);

        assert_ne!(left, right);
    }

    #[test]
    fn block_hash_changes_when_text_changes() {
        let left = hash_block_snapshot(&make_block("b1", "Hello", 0, BlockType::Text));
        let right = hash_block_snapshot(&make_block("b1", "Hello there", 0, BlockType::Text));

        assert_ne!(left, right);
    }

    #[test]
    fn block_hash_changes_when_indent_changes() {
        let left = hash_block_snapshot(&make_block("b1", "Hello", 0, BlockType::Text));
        let right = hash_block_snapshot(&make_block("b1", "Hello", 1, BlockType::Text));

        assert_ne!(left, right);
    }

    #[test]
    fn chunk_hash_changes_when_content_changes() {
        let left = hash_chunk_content("page-1", "b1", 0, "alpha");
        let right = hash_chunk_content("page-1", "b1", 0, "beta");

        assert_ne!(left, right);
    }
}
