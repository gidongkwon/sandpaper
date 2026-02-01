import type { Block, BlockPayload } from "../../block/model/block-types";

export type PageSummary = {
  uid: string;
  title: string;
};

export type LocalPageRecord = {
  uid: string;
  title: string;
  blocks: Block[];
};

export type PageBlocksResponse = {
  page_uid: string;
  title: string;
  blocks: BlockPayload[];
};
