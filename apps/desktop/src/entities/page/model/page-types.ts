import type { Block, BlockPayload } from "../../block/model/block-types";
import type { PageId } from "../../../shared/model/id-types";

export type PageSummary = {
  uid: PageId;
  title: string;
};

export type LocalPageRecord = {
  uid: PageId;
  title: string;
  blocks: Block[];
};

export type PageBlocksResponse = {
  page_uid: PageId;
  title: string;
  blocks: BlockPayload[];
};
