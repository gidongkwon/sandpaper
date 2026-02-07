import type { Block as CoreBlock, BlockType as CoreBlockType } from "@sandpaper/core-model";

export type BlockType = CoreBlockType;

export type Block = CoreBlock & {
  block_type?: BlockType;
};

export type BlockPayload = {
  uid: string;
  text: string;
  indent: number;
  block_type?: BlockType;
};

export type BlockSearchResult = {
  id: number;
  uid: string;
  text: string;
};
