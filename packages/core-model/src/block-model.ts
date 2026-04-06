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
  | "table"
  | "ordered_list"
  | "bookmark"
  | "file"
  | "math"
  | "toc"
  | "column_layout"
  | "column"
  | "database_view";

export type CaptureBlockMeta = {
  batchId: string;
  order: number;
  role: "body" | "attachment";
};

export type BlockMeta = {
  capture?: CaptureBlockMeta;
};

export type Block = {
  id: string;
  text: string;
  indent: number;
  block_type?: BlockType;
  meta?: BlockMeta;
};

export type Page = {
  id: string;
  title: string;
  blocks: Block[];
};
