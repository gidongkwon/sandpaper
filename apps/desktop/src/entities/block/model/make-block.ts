import type { Block, BlockType } from "./block-types";

export const makeBlock = (
  id: string,
  text = "",
  indent = 0,
  blockType: BlockType = "text"
): Block => ({
  id,
  text,
  indent,
  block_type: blockType
});
