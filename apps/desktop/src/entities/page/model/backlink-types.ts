import type { PageId } from "../../../shared/model/id-types";

export type BacklinkEntry = {
  id: string;
  text: string;
  pageUid?: PageId;
  pageTitle?: string;
};

export type PageLinkBlock = {
  id: string;
  text: string;
  pageUid: PageId;
  pageTitle: string;
};

export type PageBacklinkRecord = {
  block_uid: string;
  text: string;
  page_uid: PageId;
  page_title: string;
};

export type UnlinkedReference = {
  pageTitle: string;
  pageUid: PageId;
  blockId: string;
  blockIndex: number;
  snippet: string;
};
