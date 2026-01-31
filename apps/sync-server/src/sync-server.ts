import { Hono } from "hono";
import type { SyncStore } from "./sync-store";

export type SyncServerConfig = {
  maxPull?: number;
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const normalizePayload = (payload: unknown): string | null => {
  if (typeof payload === "string") return payload;
  if (payload === null || payload === undefined) return null;
  try {
    return JSON.stringify(payload);
  } catch {
    return null;
  }
};

export const createApp = (store: SyncStore, config: SyncServerConfig = {}) => {
  const app = new Hono();
  const maxPull = config.maxPull ?? 500;

  app.get("/health", (c) => c.json({ ok: true }));

  app.post("/v1/vaults", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || !isNonEmptyString(body.keyFingerprint)) {
      return c.json({ error: "invalid-key-fingerprint" }, 400);
    }

    try {
      const record = store.createVault(body.keyFingerprint, body.vaultId);
      return c.json({ vaultId: record.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : "vault-create-failed";
      return c.json({ error: message }, 409);
    }
  });

  app.post("/v1/devices", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || !isNonEmptyString(body.vaultId) || !isNonEmptyString(body.keyFingerprint)) {
      return c.json({ error: "invalid-device-request" }, 400);
    }

    try {
      const record = store.registerDevice(body.vaultId, body.keyFingerprint, body.deviceId);
      return c.json({ deviceId: record.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : "device-create-failed";
      const status = message === "vault-fingerprint-mismatch" ? 403 : 404;
      return c.json({ error: message }, status);
    }
  });

  app.post("/v1/ops/push", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || !isNonEmptyString(body.vaultId) || !isNonEmptyString(body.deviceId)) {
      return c.json({ error: "invalid-push" }, 400);
    }
    if (!Array.isArray(body.ops)) {
      return c.json({ error: "invalid-ops" }, 400);
    }

    const ops = body.ops
      .map((op: { opId?: unknown; payload?: unknown }) => ({
        opId: isNonEmptyString(op.opId) ? op.opId : null,
        payload: normalizePayload(op.payload)
      }))
      .filter((op: { opId: string | null; payload: string | null }) => op.opId && op.payload)
      .map((op: { opId: string | null; payload: string | null }) => ({
        opId: op.opId as string,
        payload: op.payload as string
      }));

    if (ops.length === 0) {
      return c.json({ error: "empty-ops" }, 400);
    }

    try {
      const result = store.pushOps(body.vaultId, body.deviceId, ops);
      return c.json({ accepted: result.accepted, cursor: result.cursor });
    } catch (error) {
      const message = error instanceof Error ? error.message : "push-failed";
      return c.json({ error: message }, 400);
    }
  });

  app.get("/v1/ops/pull", (c) => {
    const vaultId = c.req.query("vaultId") ?? "";
    const sinceRaw = c.req.query("since") ?? "0";
    const limitRaw = c.req.query("limit");
    const since = Number.parseInt(sinceRaw, 10);
    const limit = limitRaw ? Number.parseInt(limitRaw, 10) : maxPull;

    if (!isNonEmptyString(vaultId) || Number.isNaN(since)) {
      return c.json({ error: "invalid-pull" }, 400);
    }

    const safeLimit = Number.isFinite(limit)
      ? Math.min(maxPull, Math.max(1, limit))
      : maxPull;

    const ops = store.listOps(vaultId, Math.max(0, since), safeLimit);
    const nextCursor = ops.length > 0 ? ops[ops.length - 1]?.cursor ?? since : since;
    return c.json({ ops, nextCursor });
  });

  return app;
};
