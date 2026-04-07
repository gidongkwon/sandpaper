export type SearchResultSource = "local" | "lexical" | "vector" | "hybrid";
export type SearchMode = "lexical" | "vector" | "hybrid" | "answer";

export type SearchCitation = {
  pageUid: string;
  blockUid: string;
  chunkId: string;
  title: string;
  breadcrumb?: string | null;
  snippet: string;
  rank: number;
};

export type SearchAnswerResult = {
  answer: string;
  citations: SearchCitation[];
  usedChunks: string[];
  latencyMs: number;
  provider: string;
  model: string;
};

export type SearchResult = {
  id: string;
  text: string;
  title?: string | null;
  pageUid?: string | null;
  blockUid?: string | null;
  breadcrumb?: string | null;
  source?: SearchResultSource | null;
};
