import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { createApp } from "./sync-server";
import { openSyncStore } from "./sync-store";

const createTestApp = () => {
  const store = openSyncStore(":memory:");
  return createApp(store, { maxPull: 50 });
};

type SyncOp = {
  opId: string;
  pageId: string;
  blockId: string;
  deviceId: string;
  clock: number;
  timestamp: number;
  kind: "add" | "edit" | "move" | "delete";
  text?: string;
  sortKey?: string;
  indent?: number;
  parentId?: string | null;
};

type BlockState = {
  text: string;
  sortKey: string;
  indent: number;
  deleted: boolean;
};

const mergeOps = (ops: SyncOp[]): SyncOp[] => {
  const byId = new Map<string, SyncOp>();
  for (const op of ops) {
    if (!byId.has(op.opId)) {
      byId.set(op.opId, op);
    }
  }
  return [...byId.values()].sort((a, b) => {
    if (a.clock !== b.clock) return a.clock - b.clock;
    return a.opId.localeCompare(b.opId);
  });
};

const applyOps = (ops: SyncOp[]) => {
  const state = new Map<string, BlockState>();
  for (const op of mergeOps(ops)) {
    const existing = state.get(op.blockId);
    switch (op.kind) {
      case "add": {
        if (existing && !existing.deleted) break;
        if (op.text && op.sortKey && typeof op.indent === "number") {
          state.set(op.blockId, {
            text: op.text,
            sortKey: op.sortKey,
            indent: op.indent,
            deleted: false
          });
        }
        break;
      }
      case "edit": {
        if (!existing || existing.deleted || !op.text) break;
        state.set(op.blockId, {
          ...existing,
          text: op.text
        });
        break;
      }
      case "move": {
        if (!existing || existing.deleted) break;
        state.set(op.blockId, {
          ...existing,
          sortKey: op.sortKey ?? existing.sortKey,
          indent: typeof op.indent === "number" ? op.indent : existing.indent
        });
        break;
      }
      case "delete": {
        if (!existing) break;
        state.set(op.blockId, {
          ...existing,
          deleted: true
        });
        break;
      }
      default:
        break;
    }
  }
  return state;
};

const registerVault = async (app: ReturnType<typeof createTestApp>) => {
  const response = await app.request("/v1/vaults", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ keyFingerprint: "fingerprint-a" })
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { vaultId: string };
};

const registerDevice = async (
  app: ReturnType<typeof createTestApp>,
  vaultId: string,
  deviceId?: string
) => {
  const response = await app.request("/v1/devices", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      vaultId,
      keyFingerprint: "fingerprint-a",
      deviceId
    })
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { deviceId: string };
};

const pushOps = async (
  app: ReturnType<typeof createTestApp>,
  vaultId: string,
  deviceId: string,
  ops: SyncOp[]
) => {
  const response = await app.request("/v1/ops/push", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      vaultId,
      deviceId,
      ops: ops.map((op) => ({
        opId: op.opId,
        payload: JSON.stringify(op)
      }))
    })
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { accepted: number; cursor: number };
};

describe("sync server", () => {
  it("registers vaults, devices, and stores encrypted ops", async () => {
    const app = createTestApp();

    const vault = await registerVault(app);
    const device = await registerDevice(app, vault.vaultId);

    const pushRes = await app.request("/v1/ops/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        vaultId: vault.vaultId,
        deviceId: device.deviceId,
        ops: [
          {
            opId: "op-1",
            payload: { ciphertextB64: "abc", ivB64: "def" }
          }
        ]
      })
    });
    expect(pushRes.status).toBe(200);
    const pushPayload = (await pushRes.json()) as { accepted: number; cursor: number };
    expect(pushPayload.accepted).toBe(1);

    const pullRes = await app.request(
      `/v1/ops/pull?vaultId=${vault.vaultId}&since=0`
    );
    expect(pullRes.status).toBe(200);
    const pullPayload = (await pullRes.json()) as {
      ops: Array<{ opId: string; payload: string }>;
      nextCursor: number;
    };
    expect(pullPayload.ops).toHaveLength(1);
    expect(pullPayload.ops[0]?.payload).toContain("ciphertextB64");
    expect(pullPayload.nextCursor).toBeGreaterThan(0);
  });

  it("treats payloads as opaque strings", async () => {
    const app = createTestApp();
    const vault = await registerVault(app);
    const device = await registerDevice(app, vault.vaultId);

    const opaquePayload = "ciphertext:ABCDEF==";
    const pushRes = await app.request("/v1/ops/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        vaultId: vault.vaultId,
        deviceId: device.deviceId,
        ops: [
          {
            opId: "opaque-1",
            payload: opaquePayload
          }
        ]
      })
    });

    expect(pushRes.status).toBe(200);

    const pullRes = await app.request(
      `/v1/ops/pull?vaultId=${vault.vaultId}&since=0`
    );
    const pullPayload = (await pullRes.json()) as {
      ops: Array<{ opId: string; payload: string }>;
    };
    expect(pullPayload.ops[0]?.payload).toBe(opaquePayload);
  });

  it("syncs two clients without conflicts", async () => {
    const app = createTestApp();
    const vault = await registerVault(app);
    const deviceA = await registerDevice(app, vault.vaultId, "dev-a");
    const deviceB = await registerDevice(app, vault.vaultId, "dev-b");

    const baseTime = Date.now();
    const opsA: SyncOp[] = [
      {
        opId: "dev-a-1",
        pageId: "page-1",
        blockId: "b1",
        deviceId: deviceA.deviceId,
        clock: 1,
        timestamp: baseTime,
        kind: "add",
        text: "Alpha",
        sortKey: "000001",
        indent: 0,
        parentId: null
      },
      {
        opId: "dev-a-2",
        pageId: "page-1",
        blockId: "b1",
        deviceId: deviceA.deviceId,
        clock: 2,
        timestamp: baseTime + 1,
        kind: "edit",
        text: "Alpha edit"
      }
    ];

    const opsB: SyncOp[] = [
      {
        opId: "dev-b-1",
        pageId: "page-1",
        blockId: "b1",
        deviceId: deviceB.deviceId,
        clock: 1,
        timestamp: baseTime,
        kind: "add",
        text: "Beta",
        sortKey: "000001",
        indent: 0,
        parentId: null
      },
      {
        opId: "dev-b-2",
        pageId: "page-1",
        blockId: "b1",
        deviceId: deviceB.deviceId,
        clock: 2,
        timestamp: baseTime + 2,
        kind: "edit",
        text: "Beta edit"
      },
      {
        opId: "dev-b-3",
        pageId: "page-1",
        blockId: "b2",
        deviceId: deviceB.deviceId,
        clock: 3,
        timestamp: baseTime + 3,
        kind: "add",
        text: "Second",
        sortKey: "000010",
        indent: 1,
        parentId: null
      }
    ];

    await pushOps(app, vault.vaultId, deviceA.deviceId, opsA);
    await pushOps(app, vault.vaultId, deviceB.deviceId, opsB);

    const pullRes = await app.request(
      `/v1/ops/pull?vaultId=${vault.vaultId}&since=0`
    );
    expect(pullRes.status).toBe(200);
    const pullPayload = (await pullRes.json()) as {
      ops: Array<{ opId: string; payload: string }>;
    };
    const pulledOps = pullPayload.ops.map((op) =>
      JSON.parse(op.payload)
    ) as SyncOp[];

    const stateA = applyOps(pulledOps);
    const stateB = applyOps(pulledOps);

    expect(stateA).toEqual(stateB);
    expect(stateA.get("b1")?.text).toBe("Beta edit");
    expect(stateA.get("b2")?.text).toBe("Second");
  });

  it("propagates small edits under target latency", async () => {
    const app = createTestApp();
    const vault = await registerVault(app);
    const device = await registerDevice(app, vault.vaultId, "dev-latency");

    const baseTime = Date.now();
    const ops: SyncOp[] = Array.from({ length: 12 }, (_, index) => ({
      opId: `latency-${index}`,
      pageId: "page-1",
      blockId: `b-${index}`,
      deviceId: device.deviceId,
      clock: index + 1,
      timestamp: baseTime + index,
      kind: "add",
      text: `Block ${index}`,
      sortKey: `${index}`.padStart(6, "0"),
      indent: 0,
      parentId: null
    }));

    const start = performance.now();
    await pushOps(app, vault.vaultId, device.deviceId, ops);
    const pullRes = await app.request(
      `/v1/ops/pull?vaultId=${vault.vaultId}&since=0`
    );
    expect(pullRes.status).toBe(200);
    const pullPayload = (await pullRes.json()) as {
      ops: Array<{ opId: string; payload: string }>;
    };
    const elapsed = performance.now() - start;

    expect(pullPayload.ops).toHaveLength(ops.length);
    expect(elapsed).toBeLessThan(2000);
  });

  it("rejects device registration with the wrong fingerprint", async () => {
    const app = createTestApp();

    const vault = await registerVault(app);

    const deviceRes = await app.request("/v1/devices", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        vaultId: vault.vaultId,
        keyFingerprint: "fingerprint-b"
      })
    });

    expect(deviceRes.status).toBe(403);
  });
});
