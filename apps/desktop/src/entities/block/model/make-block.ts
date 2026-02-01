import type { Block } from "./block-types";

export const makeBlock = (id: string, text = "", indent = 0): Block => ({
  id,
  text,
  indent
});
