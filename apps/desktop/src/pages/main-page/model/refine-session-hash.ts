import type { Block } from "../../../entities/block/model/block-types";

export type ReviewPageHashInput = {
  pageUid: string;
  title: string;
  blocks: Block[];
};

const normalizeHashInput = (input: ReviewPageHashInput) => ({
  pageUid: input.pageUid,
  title: input.title,
  blocks: input.blocks.map((block) => ({
    id: block.id,
    text: block.text,
    indent: block.indent,
    block_type: block.block_type ?? "text"
  }))
});

export const createRefinePageHash = (input: ReviewPageHashInput) =>
  JSON.stringify(normalizeHashInput(input));
