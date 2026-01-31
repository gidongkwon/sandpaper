export type OpKind = "add" | "edit" | "move" | "delete";

export type BaseOp = {
  opId: string;
  pageId: string;
  blockId: string;
  deviceId: string;
  clock: number;
  timestamp: number;
  kind: OpKind;
};

export type AddOp = BaseOp & {
  kind: "add";
  parentId: string | null;
  sortKey: string;
  indent: number;
  text: string;
};

export type EditOp = BaseOp & {
  kind: "edit";
  text: string;
};

export type MoveOp = BaseOp & {
  kind: "move";
  parentId: string | null;
  sortKey: string;
  indent: number;
};

export type DeleteOp = BaseOp & {
  kind: "delete";
};

export type SyncOp = AddOp | EditOp | MoveOp | DeleteOp;

export type BlockRecord = {
  id: string;
  text: string;
  parentId: string | null;
  sortKey: string;
  indent: number;
  deleted: boolean;
};

export type PageState = {
  pageId: string;
  blocks: Map<string, BlockRecord>;
  appliedOps: Set<string>;
};

export const createEmptyPageState = (pageId: string): PageState => ({
  pageId,
  blocks: new Map(),
  appliedOps: new Set()
});

const cloneState = (state: PageState): PageState => ({
  pageId: state.pageId,
  blocks: new Map(state.blocks),
  appliedOps: new Set(state.appliedOps)
});

export const applyOp = (state: PageState, op: SyncOp): PageState => {
  if (state.appliedOps.has(op.opId)) return state;
  if (op.pageId !== state.pageId) return state;

  const next = cloneState(state);
  next.appliedOps.add(op.opId);

  const existing = next.blocks.get(op.blockId);

  switch (op.kind) {
    case "add": {
      next.blocks.set(op.blockId, {
        id: op.blockId,
        text: op.text,
        parentId: op.parentId,
        sortKey: op.sortKey,
        indent: op.indent,
        deleted: false
      });
      return next;
    }
    case "edit": {
      if (!existing) return next;
      next.blocks.set(op.blockId, {
        ...existing,
        text: op.text
      });
      return next;
    }
    case "move": {
      if (!existing) return next;
      next.blocks.set(op.blockId, {
        ...existing,
        parentId: op.parentId,
        sortKey: op.sortKey,
        indent: op.indent
      });
      return next;
    }
    case "delete": {
      if (!existing) return next;
      next.blocks.set(op.blockId, {
        ...existing,
        deleted: true
      });
      return next;
    }
    default: {
      return next;
    }
  }
};

export const applyOps = (state: PageState, ops: SyncOp[]): PageState => {
  return ops.reduce((acc, op) => applyOp(acc, op), state);
};

export const sortOpsByClock = (ops: SyncOp[]): SyncOp[] => {
  return [...ops].sort((a, b) => {
    if (a.clock !== b.clock) return a.clock - b.clock;
    return a.opId.localeCompare(b.opId);
  });
};

export const mergeOps = (opSets: SyncOp[][]): SyncOp[] => {
  const byId = new Map<string, SyncOp>();
  for (const ops of opSets) {
    for (const op of ops) {
      if (!byId.has(op.opId)) {
        byId.set(op.opId, op);
      }
    }
  }
  return sortOpsByClock([...byId.values()]);
};
