import { describe, expect, it } from "vitest";
import { buildOfflineExportManifest } from "./offline-archive-utils";

describe("offline archive utils", () => {
  it("builds a manifest with page records", () => {
    const manifest = buildOfflineExportManifest({
      pages: [
        { uid: "one", title: "One" },
        { uid: "two", title: "Two" }
      ],
      exportedAt: "2026-02-01T00:00:00Z",
      vaultName: "Vault"
    });

    expect(manifest.version).toBe(1);
    expect(manifest.page_count).toBe(2);
    expect(manifest.vault_name).toBe("Vault");
    expect(manifest.pages[0]).toEqual({
      uid: "one",
      title: "One",
      file: "pages/one.md"
    });
  });
});
