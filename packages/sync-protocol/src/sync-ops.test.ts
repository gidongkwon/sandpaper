import { describe, expect, it } from "vitest";
import {
  applyOp,
  applyOps,
  createEmptyPageState,
  sortOpsByClock,
  type SyncOp
} from "./sync-ops";

describe("sync ops", () => {
  it("applies add/edit/move/delete in order", () => {
    const ops: SyncOp[] = [
      {
        opId: "dev1-1",
        pageId: "page-1",
        blockId: "block-1",
        deviceId: "dev1",
        clock: 1,
        timestamp: 1,
        kind: "add",
        parentId: null,
        sortKey: "a",
        indent: 0,
        text: "First"
      },
      {
        opId: "dev1-2",
        pageId: "page-1",
        blockId: "block-1",
        deviceId: "dev1",
        clock: 2,
        timestamp: 2,
        kind: "edit",
        text: "First updated"
      },
      {
        opId: "dev1-3",
        pageId: "page-1",
        blockId: "block-1",
        deviceId: "dev1",
        clock: 3,
        timestamp: 3,
        kind: "move",
        parentId: null,
        sortKey: "b",
        indent: 1
      },
      {
        opId: "dev1-4",
        pageId: "page-1",
        blockId: "block-1",
        deviceId: "dev1",
        clock: 4,
        timestamp: 4,
        kind: "delete"
      }
    ];

    const state = applyOps(createEmptyPageState("page-1"), ops);
    const block = state.blocks.get("block-1");

    expect(block).toBeTruthy();
    expect(block?.text).toBe("First updated");
    expect(block?.indent).toBe(1);
    expect(block?.sortKey).toBe("b");
    expect(block?.deleted).toBe(true);
  });

  it("ignores duplicate ops for idempotency", () => {
    const op: SyncOp = {
      opId: "dev1-1",
      pageId: "page-1",
      blockId: "block-1",
      deviceId: "dev1",
      clock: 1,
      timestamp: 1,
      kind: "add",
      parentId: null,
      sortKey: "a",
      indent: 0,
      text: "First"
    };

    const state = applyOp(createEmptyPageState("page-1"), op);
    const next = applyOp(state, op);

    expect(next.appliedOps.size).toBe(1);
  });

  it("sorts ops by clock then opId", () => {
    const ops: SyncOp[] = [
      {
        opId: "dev1-2",
        pageId: "page-1",
        blockId: "block-1",
        deviceId: "dev1",
        clock: 2,
        timestamp: 2,
        kind: "edit",
        text: "Second"
      },
      {
        opId: "dev1-1",
        pageId: "page-1",
        blockId: "block-1",
        deviceId: "dev1",
        clock: 1,
        timestamp: 1,
        kind: "add",
        parentId: null,
        sortKey: "a",
        indent: 0,
        text: "First"
      }
    ];

    const sorted = sortOpsByClock(ops);
    expect(sorted.map((op) => op.opId)).toEqual(["dev1-1", "dev1-2"]);
  });
});
