export type BlockType =
  | "text"
  | "heading1"
  | "heading2"
  | "heading3"
  | "quote"
  | "callout"
  | "code"
  | "divider"
  | "toggle"
  | "todo"
  | "image"
  | "column_layout"
  | "column"
  | "database_view";

export type Block = {
  id: string;
  text: string;
  indent: number;
  block_type?: BlockType;
};

export type Page = {
  id: string;
  title: string;
  blocks: Block[];
};
