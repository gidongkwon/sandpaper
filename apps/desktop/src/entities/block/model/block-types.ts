export type { Block } from "@sandpaper/core-model";

export type BlockPayload = {
  uid: string;
  text: string;
  indent: number;
};

export type BlockSearchResult = {
  id: number;
  uid: string;
  text: string;
};
