export type CodeFence = {
  lang: string;
  content: string;
};

export type MarkdownList = {
  type: "ul" | "ol";
  items: string[];
};

export type MarkdownTable = {
  headers: string[];
  rows: string[][];
};

export type InlineWikilinkToken = {
  target: string;
  label: string;
};

export type InlineLinkToken = {
  label: string;
  href: string;
};
