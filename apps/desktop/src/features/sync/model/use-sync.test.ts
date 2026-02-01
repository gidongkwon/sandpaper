import { describe, expect, it } from "vitest";
import type { SyncStatus } from "../../../entities/sync/model/sync-types";
import {
  buildSyncStateDetail,
  buildSyncStateLabel
} from "./use-sync";

describe("sync view helpers", () => {
  const baseStatus: SyncStatus = {
    state: "idle",
    pending_ops: 0,
    last_synced_at: null,
    last_error: null,
    last_push_count: 0,
    last_pull_count: 0,
    last_apply_count: 0
  };

  it("builds sync state labels", () => {
    expect(buildSyncStateLabel(false, baseStatus)).toBe("Not connected");
    expect(buildSyncStateLabel(true, { ...baseStatus, state: "syncing" })).toBe(
      "Syncing"
    );
    expect(buildSyncStateLabel(true, { ...baseStatus, state: "offline" })).toBe(
      "Offline"
    );
    expect(buildSyncStateLabel(true, { ...baseStatus, state: "error" })).toBe(
      "Error"
    );
    expect(buildSyncStateLabel(true, baseStatus)).toBe("Ready");
  });

  it("builds sync state details", () => {
    expect(
      buildSyncStateDetail({
        isTauri: false,
        connected: true,
        status: baseStatus
      })
    ).toBe("Desktop app required for background sync.");

    expect(
      buildSyncStateDetail({
        isTauri: true,
        connected: false,
        status: baseStatus
      })
    ).toBe("Connect a server to sync across devices.");

    expect(
      buildSyncStateDetail({
        isTauri: true,
        connected: true,
        status: { ...baseStatus, state: "offline" }
      })
    ).toBe("Offline. Edits stay queued until you reconnect.");

    expect(
      buildSyncStateDetail({
        isTauri: true,
        connected: true,
        status: { ...baseStatus, state: "error", last_error: "bad" }
      })
    ).toBe("bad");

    expect(
      buildSyncStateDetail({
        isTauri: true,
        connected: true,
        status: { ...baseStatus, state: "syncing" }
      })
    ).toBe("Syncing in the background.");

    expect(
      buildSyncStateDetail({
        isTauri: true,
        connected: true,
        status: { ...baseStatus, last_synced_at: "10:32" }
      })
    ).toBe("Last sync 10:32");

    expect(
      buildSyncStateDetail({
        isTauri: true,
        connected: true,
        status: baseStatus
      })
    ).toBe("Ready to sync.");
  });
});
