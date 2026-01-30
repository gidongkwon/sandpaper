export type Block = {
  id: string;
  text: string;
  indent: number;
};

export type Page = {
  id: string;
  title: string;
  blocks: Block[];
};
