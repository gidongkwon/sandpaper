import type {
  Block as CoreBlock,
  BlockMeta as CoreBlockMeta,
  BlockType as CoreBlockType
} from "@sandpaper/core-model";

export type BlockType = CoreBlockType;
export type BlockMeta = CoreBlockMeta;

export type Block = CoreBlock & {
  block_type?: BlockType;
};

export type BlockPayload = {
  uid: string;
  text: string;
  indent: number;
  block_type?: BlockType;
  meta?: BlockMeta;
};

export type BlockSearchResult = {
  id: number;
  uid: string;
  text: string;
};
