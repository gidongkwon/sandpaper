export type JumpTarget = {
  id: string;
  pageUid?: string | null;
  caret: "start" | "end" | "preserve";
};
