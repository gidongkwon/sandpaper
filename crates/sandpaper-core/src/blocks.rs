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
    ColumnLayout,
    Column,
    DatabaseView,
}

impl BlockType {
    pub fn is_text(&self) -> bool {
        matches!(self, BlockType::Text)
    }
}
