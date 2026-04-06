import type { Block, BlockMeta, BlockType } from "./block-types";

export const makeBlock = (
  id: string,
  text = "",
  indent = 0,
  blockType: BlockType = "text",
  meta?: BlockMeta
): Block => ({
  id,
  text,
  indent,
  block_type: blockType,
  ...(meta ? { meta } : {})
});
