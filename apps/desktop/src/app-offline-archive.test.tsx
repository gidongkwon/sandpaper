import { render, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { strToU8, unzipSync, zipSync } from "fflate";
import { vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn()
}));

vi.mock("@tauri-apps/api/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tauri-apps/api/core")>();
  return {
    ...actual,
    invoke: vi.fn()
  };
});

import App from "./app/app";

const readBlobAsArrayBuffer = async (blob: Blob) => {
  return await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("read-failed"));
    reader.readAsArrayBuffer(blob);
  });
};

describe("App offline archive", () => {
  beforeEach(() => {
    localStorage.clear();
    delete (window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> })
      .__TAURI_INTERNALS__;
  });

  afterEach(() => {
    delete (window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> })
      .__TAURI_INTERNALS__;
    vi.restoreAllMocks();
  });

  it("exports an offline archive with pages and manifest", async () => {
    const user = userEvent.setup();
    let capturedBlob: Blob | null = null;
    const createSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation((blob) => {
        capturedBlob = blob as Blob;
        return "blob:offline";
      });
    const revokeSpy = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    render(() => <App />);
    await user.click(screen.getByRole("button", { name: /open settings/i }));
    await user.click(screen.getByRole("button", { name: "Import" }));
    const exportButton = await screen.findByRole("button", {
      name: /export offline archive/i
    });
    await user.click(exportButton);

    expect(
      await screen.findByText(/offline export ready/i)
    ).toBeInTheDocument();
    expect(capturedBlob).not.toBeNull();
    const blob = capturedBlob!;
    await readBlobAsArrayBuffer(blob);
    expect(blob.size).toBeGreaterThan(0);
    expect(clickSpy).toHaveBeenCalled();

    createSpy.mockRestore();
    revokeSpy.mockRestore();
    clickSpy.mockRestore();
  });

  it("imports pages from an offline archive", async () => {
    const user = userEvent.setup();
    const markdown = "# Travel Log ^travel\n- First stop ^t1\n";
    const manifest = JSON.stringify({
      version: 1,
      exported_at: "2026-01-31T00:00:00Z",
      page_count: 1,
      asset_count: 0
    });
    const archive = zipSync({
      "manifest.json": strToU8(manifest, true),
      "pages/travel-log.md": strToU8(markdown, true),
      "assets/README.txt": strToU8("Assets placeholder", true)
    });
    expect(archive.length).toBeGreaterThan(0);

    render(() => <App />);
    await user.click(screen.getByRole("button", { name: /open settings/i }));
    await user.click(screen.getByRole("button", { name: "Import" }));

    const picker = screen.getByTestId(
      "offline-archive-picker"
    ) as HTMLInputElement;
    const archiveBuffer = archive.buffer.slice(
      archive.byteOffset,
      archive.byteOffset + archive.byteLength
    );
    const previewEntries = unzipSync(archive);
    expect(Object.keys(previewEntries).length).toBeGreaterThan(0);
    expect(previewEntries["pages/travel-log.md"]).toBeDefined();
    const file = new File([archiveBuffer], "backup.zip", {
      type: "application/zip"
    });
    await user.upload(picker, file);
    expect(screen.getByText("backup.zip")).toBeInTheDocument();

    const importButton = screen.getByRole("button", {
      name: /import archive/i
    });
    await user.click(importButton);

    expect(
      await screen.findByText("Travel Log", {
        selector: ".page-item__title"
      })
    ).toBeInTheDocument();
  });
});
