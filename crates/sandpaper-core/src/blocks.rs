use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BlockType {
    #[default]
    Text,
    Heading1,
    Heading2,
    Heading3,
    Quote,
    Callout,
    Code,
    Divider,
    Toggle,
    Todo,
    Image,
    ColumnLayout,
    Column,
    DatabaseView,
}

impl BlockType {
    pub fn is_text(&self) -> bool {
        matches!(self, BlockType::Text)
    }
}

#[cfg(test)]
mod tests {
    use super::BlockType;

    #[test]
    fn block_type_image_round_trip_serializes_as_snake_case() {
        let encoded = serde_json::to_string(&BlockType::Image).expect("serialize block type");
        assert_eq!(encoded, "\"image\"");

        let decoded: BlockType = serde_json::from_str("\"image\"").expect("deserialize block type");
        assert_eq!(decoded, BlockType::Image);
    }
}
