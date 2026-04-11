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

const getModeControl = (name: "Capture" | "Review" | "Refine" | "Editor") =>
  screen.getByRole("radio", { name: name === "Review" ? "Refine" : name });

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
    const createSpy = vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
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
    await user.click(screen.getByRole("tab", { name: "Import" }));
    const exportButton = await screen.findByRole("button", {
      name: /export offline archive/i
    });
    await user.click(exportButton);

    expect(await screen.findByText(/offline export ready/i)).toBeInTheDocument();
    expect(capturedBlob).not.toBeNull();
    const blob = capturedBlob!;
    await readBlobAsArrayBuffer(blob);
    expect(blob.size).toBeGreaterThan(0);
    expect(clickSpy).toHaveBeenCalled();

    createSpy.mockRestore();
    revokeSpy.mockRestore();
    clickSpy.mockRestore();
  });

  it("excludes the hidden inbox from offline archive exports", async () => {
    const user = userEvent.setup();
    let capturedBlob: Blob | null = null;
    const createSpy = vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      capturedBlob = blob as Blob;
      return "blob:hidden-inbox";
    });
    const revokeSpy = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    render(() => <App />);
    await user.click(getModeControl("Capture"));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;
    await user.type(captureInput, "Temporary capture");
    await user.click(screen.getByRole("button", { name: "Send capture" }));

    await user.click(screen.getByRole("button", { name: /open settings/i }));
    await user.click(screen.getByRole("tab", { name: "Import" }));
    await user.click(
      await screen.findByRole("button", { name: /export offline archive/i })
    );

    expect(await screen.findByText(/offline export ready/i)).toBeInTheDocument();
    expect(capturedBlob).not.toBeNull();

    const archiveBytes = new Uint8Array(await readBlobAsArrayBuffer(capturedBlob!));
    const archiveIndex = new TextDecoder("latin1").decode(archiveBytes);
    expect(archiveIndex).toContain("pages/home.md");
    expect(archiveIndex).not.toContain("pages/inbox.md");

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
    await user.click(screen.getByRole("tab", { name: "Import" }));
    await user.click(screen.getByRole("button", { name: /import format/i }));
    await user.click(
      await screen.findByRole("option", { name: "Offline archive" })
    );

    const picker = screen.getByTestId(
      "offline-archive-picker"
    ) as HTMLInputElement;
    const archiveBuffer = new Uint8Array(archive).buffer;
    const previewEntries = unzipSync(archive);
    expect(Object.keys(previewEntries).length).toBeGreaterThan(0);
    expect(previewEntries["pages/travel-log.md"]).toBeDefined();
    const file = new File([archiveBuffer], "backup.zip", {
      type: "application/zip"
    });
    await user.upload(picker, file);
    expect(screen.getByText("backup.zip")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Import" }));

    expect(
      await screen.findByText("Travel Log", {
        selector: ".page-item__title"
      })
    ).toBeInTheDocument();
  });

  it("ignores reserved Inbox pages when importing an offline archive", async () => {
    const user = userEvent.setup();
    const manifest = JSON.stringify({
      version: 1,
      exported_at: "2026-01-31T00:00:00Z",
      page_count: 2,
      asset_count: 0,
      pages: [
        { uid: "inbox", title: "Inbox", file: "pages/inbox.md" },
        { uid: "travel-log", title: "Travel Log", file: "pages/travel-log.md" }
      ]
    });
    const archive = zipSync({
      "manifest.json": strToU8(manifest, true),
      "pages/inbox.md": strToU8("# Inbox\n- Temporary capture\n", true),
      "pages/travel-log.md": strToU8("# Travel Log\n- First stop\n", true)
    });

    render(() => <App />);
    await user.click(screen.getByRole("button", { name: /open settings/i }));
    await user.click(screen.getByRole("tab", { name: "Import" }));
    await user.click(screen.getByRole("button", { name: /import format/i }));
    await user.click(
      await screen.findByRole("option", { name: "Offline archive" })
    );

    const picker = screen.getByTestId(
      "offline-archive-picker"
    ) as HTMLInputElement;
    const archiveBuffer = new Uint8Array(archive).buffer;
    const file = new File([archiveBuffer], "backup.zip", {
      type: "application/zip"
    });
    await user.upload(picker, file);
    await user.click(screen.getByRole("button", { name: "Import" }));

    expect(
      await screen.findByText("Travel Log", {
        selector: ".page-item__title"
      })
    ).toBeInTheDocument();

    await user.click(getModeControl("Capture"));
    expect(
      await screen.findByPlaceholderText("Capture a thought, link, or task...")
    ).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Temporary capture")).not.toBeInTheDocument();
  });
});
