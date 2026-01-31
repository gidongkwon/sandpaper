import { describe, expect, it } from "vitest";
import { createApp } from "./sync-server";
import { openSyncStore } from "./sync-store";

const createTestApp = () => {
  const store = openSyncStore(":memory:");
  return createApp(store, { maxPull: 50 });
};

describe("sync server", () => {
  it("registers vaults, devices, and stores encrypted ops", async () => {
    const app = createTestApp();

    const vaultRes = await app.request("/v1/vaults", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keyFingerprint: "fingerprint-a" })
    });
    expect(vaultRes.status).toBe(200);
    const vault = (await vaultRes.json()) as { vaultId: string };

    const deviceRes = await app.request("/v1/devices", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        vaultId: vault.vaultId,
        keyFingerprint: "fingerprint-a"
      })
    });
    expect(deviceRes.status).toBe(200);
    const device = (await deviceRes.json()) as { deviceId: string };

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

  it("rejects device registration with the wrong fingerprint", async () => {
    const app = createTestApp();

    const vaultRes = await app.request("/v1/vaults", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keyFingerprint: "fingerprint-a" })
    });
    const vault = (await vaultRes.json()) as { vaultId: string };

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
