export type BacklinkEntry = {
  id: string;
  text: string;
  pageUid?: string;
  pageTitle?: string;
};

export type PageLinkBlock = {
  id: string;
  text: string;
  pageUid: string;
  pageTitle: string;
};

export type PageBacklinkRecord = {
  block_uid: string;
  text: string;
  page_uid: string;
  page_title: string;
};

export type UnlinkedReference = {
  pageTitle: string;
  pageUid: string;
  blockId: string;
  blockIndex: number;
  snippet: string;
};
