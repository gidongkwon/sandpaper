import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
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

import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import App from "./app/app";

describe("App", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(openDialog).mockReset();
    vi.mocked(invoke).mockReset();
  });

  afterEach(() => {
    delete (window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> })
      .__TAURI_INTERNALS__;
    vi.restoreAllMocks();
  });

  it("renders the mode switch", () => {
    render(() => <App />);
    const modeSwitch = screen.getByRole("navigation");
    const labels = within(modeSwitch)
      .getAllByRole("button")
      .map((button) => button.textContent?.trim());
    expect(labels).toEqual(["Capture", "Review", "Editor"]);
    expect(
      screen.queryByRole("button", { name: "Viewer" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /graph/i })
    ).not.toBeInTheDocument();
  });

  it("shows autosave status after load", async () => {
    render(() => <App />);
    expect(await screen.findByText(/saved/i)).toBeInTheDocument();
  });

  it("positions the default text size label at the correct scale", async () => {
    render(() => <App />);
    await userEvent.click(
      screen.getByRole("button", { name: /open settings/i })
    );
    const labels = await screen.findByText("Default");
    const container = labels.closest(
      ".settings-slider__labels"
    ) as HTMLElement | null;
    expect(container).not.toBeNull();
    expect(container?.style.getPropertyValue("--default-position")).toBe(
      "33.33%"
    );
  });

  it("shows search results for matching blocks", async () => {
    render(() => <App />);
    const input = screen.getByPlaceholderText("Search...");
    await userEvent.type(input, "Draft line 1");
    const results = await screen.findAllByText("Draft line 1", {
      selector: ".search-highlight"
    });
    expect(results.length).toBeGreaterThan(0);
  });

  it("does not render search filter chips", async () => {
    render(() => <App />);
    const input = screen.getByPlaceholderText("Search...");
    await userEvent.type(input, "Draft line 1");
    const results = await screen.findAllByText("Draft line 1", {
      selector: ".search-highlight"
    });
    expect(results.length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "All" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Links" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tasks" })).not.toBeInTheDocument();
  });

  it("prompts for plugin permission grants", async () => {
    render(() => <App />);
    await userEvent.click(
      screen.getByRole("button", { name: /open settings/i })
    );
    await userEvent.click(screen.getByRole("button", { name: "Plugins" }));
    const grantButton = await screen.findByRole("button", { name: /grant network/i });
    await userEvent.click(grantButton);
    expect(await screen.findByText("Grant permission")).toBeInTheDocument();
  });

  it("shows plugin commands and panels", async () => {
    render(() => <App />);
    await userEvent.click(
      screen.getByRole("button", { name: /open settings/i })
    );
    await userEvent.click(screen.getByRole("button", { name: "Plugins" }));
    expect(await screen.findByText("Plugin Commands")).toBeInTheDocument();
    expect(await screen.findByText("Plugin Panels")).toBeInTheDocument();
    expect(await screen.findByText("Calendar panel")).toBeInTheDocument();
    expect(await screen.findByText("Capture highlight")).toBeInTheDocument();
  });

  it("renders the vault key section", async () => {
    render(() => <App />);
    await userEvent.click(
      screen.getByRole("button", { name: /open settings/i })
    );
    await userEvent.click(screen.getByRole("button", { name: "Vault" }));
    expect(await screen.findByText("Encryption Key")).toBeInTheDocument();
    const setButton = screen.getByRole("button", { name: /set passphrase/i });
    expect(setButton).toBeDisabled();
  });

  it("fills the vault path from a picked folder", async () => {
    render(() => <App />);
    await userEvent.click(
      screen.getByRole("button", { name: /open settings/i })
    );
    await userEvent.click(screen.getByRole("button", { name: "Vault" }));
    await userEvent.click(screen.getByRole("button", { name: /new vault/i }));
    const pathInput = screen.getByPlaceholderText("Vault path") as HTMLInputElement;
    const picker = screen.getByTestId("vault-folder-picker") as HTMLInputElement;
    const file = new File(["hello"], "note.md", { type: "text/markdown" });
    Object.defineProperty(file, "webkitRelativePath", {
      value: "MyVault/note.md"
    });
    fireEvent.change(picker, { target: { files: [file] } });
    expect(pathInput.value).toBe("MyVault");
  });

  it("uses the native dialog to pick a vault folder when available", async () => {
    render(() => <App />);
    vi.mocked(openDialog).mockResolvedValueOnce("/Users/demo/Vault");
    await userEvent.click(
      screen.getByRole("button", { name: /open settings/i })
    );
    await userEvent.click(screen.getByRole("button", { name: "Vault" }));
    await userEvent.click(screen.getByRole("button", { name: /new vault/i }));
    (window as typeof window & { __TAURI_INTERNALS__: Record<string, unknown> })
      .__TAURI_INTERNALS__ = {};
    const browseButton = screen.getByRole("button", { name: "Browse" });
    await userEvent.click(browseButton);
    expect(vi.mocked(openDialog)).toHaveBeenCalledWith(
      expect.objectContaining({ directory: true, multiple: false })
    );
    expect(
      await screen.findByDisplayValue("/Users/demo/Vault")
    ).toBeInTheDocument();
  });

  it("renders the sync section in browser mode", async () => {
    render(() => <App />);
    await userEvent.click(
      screen.getByRole("button", { name: /open settings/i })
    );
    await userEvent.click(screen.getByRole("button", { name: "Sync" }));
    const connectButton = screen.getByRole("button", { name: /connect/i });
    expect(connectButton).toBeDisabled();
    expect(
      await screen.findByText(/desktop app required/i)
    ).toBeInTheDocument();
  });

  it("renders the review mode panel", async () => {
    render(() => <App />);
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(
      await screen.findByText("Capture a thread first, then refine it here.")
    ).toBeInTheDocument();
  });

  it("renders the review empty state in review mode", async () => {
    render(() => <App />);
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(
      await screen.findByText("No capture threads to review.")
    ).toBeInTheDocument();
  });

  it("renders the review destination shell in review mode", async () => {
    render(() => <App />);
    await userEvent.click(screen.getByRole("button", { name: "Capture" }));
    const captureInput = await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    );
    await userEvent.type(captureInput, "Thread root");
    await userEvent.click(screen.getByRole("button", { name: "Send capture" }));

    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(
      await screen.findByRole("region", { name: "Destination note" })
    ).toBeInTheDocument();
  });

  it("starts in capture mode when the persisted active page is the hidden inbox", async () => {
    vi.mocked(invoke).mockImplementation((command, payload) => {
      if (command === "list_vaults") {
        return Promise.resolve({
          active_id: "vault-1",
          vaults: [{ id: "vault-1", name: "Vault", path: "/vault" }]
        });
      }
      if (command === "get_active_page") return Promise.resolve("inbox");
      if (command === "list_pages") {
        return Promise.resolve([
          { uid: "home", title: "Home" },
          { uid: "inbox", title: "Inbox" }
        ]);
      }
      if (command === "load_page_blocks") {
        if (
          payload &&
          typeof payload === "object" &&
          "pageUid" in payload &&
          payload.pageUid === "inbox"
        ) {
          return Promise.resolve({
            page_uid: "inbox",
            title: "Inbox",
            blocks: [{ uid: "inbox-1", text: "Persisted capture", indent: 0 }]
          });
        }
        return Promise.resolve({
          page_uid: "home",
          title: "Home",
          blocks: [{ uid: "home-1", text: "Home block", indent: 0 }]
        });
      }
      if (command === "list_page_wikilink_backlinks") return Promise.resolve([]);
      if (command === "list_plugins_command") return Promise.resolve([]);
      if (command === "load_plugins_command") {
        return Promise.resolve({
          loaded: [],
          blocked: [],
          commands: [],
          panels: [],
          toolbar_actions: [],
          renderers: []
        });
      }
      if (command === "vault_key_status") {
        return Promise.resolve({
          configured: false,
          kdf: null,
          iterations: null,
          salt_b64: null
        });
      }
      if (command === "get_sync_config") {
        return Promise.resolve({
          server_url: null,
          vault_id: null,
          device_id: null,
          key_fingerprint: null,
          last_push_cursor: 0,
          last_pull_cursor: 0
        });
      }
      if (command === "review_queue_summary") {
        return Promise.resolve({ due_count: 0, next_due_at: null });
      }
      if (command === "list_review_queue_due") return Promise.resolve([]);
      if (command === "write_shadow_markdown") return Promise.resolve(null);
      if (command === "save_page_blocks") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    (window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> })
      .__TAURI_INTERNALS__ = {};

    render(() => <App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Capture" })).toHaveClass("is-active");
    });
    expect(
      await screen.findByPlaceholderText("Capture a thought, link, or task...")
    ).toBeInTheDocument();
    expect(await screen.findByDisplayValue("Persisted capture")).toBeInTheDocument();
    expect(
      screen.queryByText("Inbox", { selector: ".editor-pane__title" })
    ).not.toBeInTheDocument();
  });

  it("renders a code preview for fenced blocks", async () => {
    render(() => <App />);
    await screen.findByText(/saved/i);
    const inputs = await screen.findAllByPlaceholderText("Write something...");
    const firstInput = inputs[0];
    fireEvent.input(firstInput, { target: { value: "```ts const x = 1;" } });
    const languageSelectors = await screen.findAllByRole("combobox", {
      name: "Code language"
    });
    expect(languageSelectors.length).toBeGreaterThan(0);
    expect(languageSelectors[0]).toHaveValue("TypeScript");
    const snippets = await screen.findAllByText("const x = 1;");
    expect(snippets.length).toBeGreaterThan(0);
  });

  it("renders a diagram preview for fenced mermaid blocks", async () => {
    render(() => <App />);
    await screen.findByText(/saved/i);
    const inputs = await screen.findAllByPlaceholderText("Write something...");
    const firstInput = inputs[0];
    fireEvent.input(firstInput, {
      target: { value: "```mermaid graph TD A-->B;" }
    });
    const previews = await screen.findAllByText("Diagram preview");
    expect(previews.length).toBeGreaterThan(0);
    const snippets = await screen.findAllByText("graph TD A-->B;");
    expect(snippets.length).toBeGreaterThan(0);
  });

  it("shows backlinks for referenced blocks", async () => {
    render(() => <App />);
    await screen.findByRole("button", { name: "Editor" });
    const inputs = await screen.findAllByPlaceholderText("Write something...");
    const firstInput = inputs[0];
    const secondInput = inputs[1];
    const targetId = firstInput.getAttribute("data-block-id");
    expect(targetId).toBeTruthy();
    fireEvent.input(secondInput, { target: { value: `See ((${targetId}))` } });
    fireEvent.focus(firstInput);
    await userEvent.click(
      screen.getByRole("button", { name: /show backlinks/i })
    );
    expect(
      await screen.findByText("Backlinks", {
        selector: ".backlinks-panel__title"
      })
    ).toBeInTheDocument();
    const backlinks = await screen.findAllByText(/see/i, {
      selector: ".backlink-item__text"
    });
    expect(backlinks.length).toBeGreaterThan(0);
  });

  it("shows backlinks for wiki-linked pages", async () => {
    render(() => <App />);
    await screen.findByText(/saved/i);
    const inputs = await screen.findAllByPlaceholderText("Write something...");
    const firstInput = inputs[0];
    const secondInput = inputs[1];
    fireEvent.input(secondInput, { target: { value: "See [[Home]]" } });
    fireEvent.focus(firstInput);
    await userEvent.click(
      screen.getByRole("button", { name: /show backlinks/i })
    );
    expect(await screen.findByText("Page backlinks")).toBeInTheDocument();
    const backlinks = await screen.findAllByText("See [[Home]]", {
      selector: ".backlink-item__text"
    });
    expect(backlinks.length).toBeGreaterThan(0);
  });

  it("shows page backlinks from other pages", async () => {
    render(() => <App />);
    await screen.findByText(/saved/i);
    const createButton = screen.getByRole("button", { name: /create new page/i });
    await userEvent.click(createButton);
    const dialog = await screen.findByRole("dialog", { name: "New page title" });
    const input = within(dialog).getByRole("textbox");
    await userEvent.type(input, "Project Atlas");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(
      await screen.findByText("Project Atlas", { selector: ".editor-pane__title" })
    ).toBeInTheDocument();
    const inputs = await screen.findAllByPlaceholderText("Write something...");
    fireEvent.input(inputs[0], { target: { value: "See [[Home]]" } });
    await userEvent.click(screen.getByRole("button", { name: "Open Home" }));
    expect(
      await screen.findByText("Home", { selector: ".editor-pane__title" })
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /show backlinks/i })
    );
    const backlinks = await screen.findAllByText("See [[Home]]", {
      selector: ".backlink-item__text"
    });
    expect(backlinks.length).toBeGreaterThan(0);
    expect(
      await screen.findByText("Project Atlas", {
        selector: ".backlink-group__title"
      })
    ).toBeInTheDocument();
  });

  it("renders markdown display with wikilinks and opens the linked page", async () => {
    render(() => <App />);
    await screen.findByText(/saved/i);
    const createButton = screen.getByRole("button", { name: /create new page/i });
    await userEvent.click(createButton);
    const dialog = await screen.findByRole("dialog", { name: "New page title" });
    const input = within(dialog).getByRole("textbox");
    await userEvent.type(input, "Project Atlas");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(
      await screen.findByText("Project Atlas", { selector: ".editor-pane__title" })
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open Home" }));
    expect(
      await screen.findByText("Home", { selector: ".editor-pane__title" })
    ).toBeInTheDocument();
    const inputs = await screen.findAllByPlaceholderText("Write something...");
    fireEvent.input(inputs[0], {
      target: { value: "See [[Project Atlas]] and **bold**" }
    });
    const wikilink = await screen.findByRole("button", { name: "Project Atlas" });
    expect(wikilink).toBeInTheDocument();
    const bold = screen.getByText("bold");
    expect(bold.tagName).toBe("STRONG");
    await userEvent.click(wikilink);
    expect(
      await screen.findByText("Project Atlas", { selector: ".editor-pane__title" })
    ).toBeInTheDocument();
  });

  it("creates and opens a linked page from the editor", async () => {
    render(() => <App />);
    await screen.findByText(/saved/i);
    let firstInput = document.querySelector(
      ".editor-pane textarea[data-block-id][aria-hidden=\"false\"]"
    ) as HTMLTextAreaElement | null;
    if (!firstInput) {
      const firstDisplay = document.querySelector(
        ".editor-pane .block .block__display"
      ) as HTMLElement | null;
      expect(firstDisplay).not.toBeNull();
      if (firstDisplay) {
        await userEvent.click(firstDisplay);
      }
      firstInput = document.querySelector(
        ".editor-pane textarea[data-block-id][aria-hidden=\"false\"]"
      ) as HTMLTextAreaElement | null;
    }
    expect(firstInput).not.toBeNull();
    if (!firstInput) return;
    const blockId = firstInput.dataset.blockId;
    expect(blockId).toBeTruthy();
    if (!blockId) return;
    const getInput = () =>
      document.querySelector(
        `textarea[data-block-id="${blockId}"]`
      ) as HTMLTextAreaElement | null;
    fireEvent.input(getInput() as HTMLTextAreaElement, {
      target: { value: "[[Project Atlas" }
    });
    const menu = await screen.findByRole("listbox", {
      name: /wikilink suggestions/i
    });
    const menuScope = within(menu);
    await userEvent.click(
      menuScope.getByRole("button", { name: /create page "Project Atlas"/i })
    );
    expect(getInput()?.value).toContain("[[Project Atlas]]");
    expect(
      await screen.findByText("Project Atlas", { selector: ".page-item__title" })
    ).toBeInTheDocument();
    (getInput() as HTMLTextAreaElement).blur();
    const wikilink = await screen.findByRole("button", { name: "Project Atlas" });
    await userEvent.click(wikilink);
    expect(
      await screen.findByText("Project Atlas", {
        selector: ".editor-pane__title"
      })
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /show backlinks/i })
    );
    expect(await screen.findByText("Page backlinks")).toBeInTheDocument();
    const backlinks = await screen.findAllByText(/\[\[Project Atlas\]\]/, {
      selector: ".backlink-item__text"
    });
    expect(backlinks.length).toBeGreaterThan(0);
  });

  it("exports markdown in browser mode", async () => {
    render(() => <App />);
    await userEvent.click(
      screen.getByRole("button", { name: /open settings/i })
    );
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    const exportButton = await screen.findByRole("button", { name: /export all pages/i });
    await userEvent.click(exportButton);
    expect(
      await screen.findByText(/preview generated in browser/i)
    ).toBeInTheDocument();
  });

  it("imports markdown into a new page in browser mode", async () => {
    render(() => <App />);
    await userEvent.click(
      screen.getByRole("button", { name: /open settings/i })
    );
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    const input = screen.getByPlaceholderText(/paste markdown here/i);
    await userEvent.type(
      input,
      `# Import
- Imported line ^import-1`
    );
    const importSection = screen
      .getByRole("heading", { name: "Import Markdown" })
      .closest(".settings-section");
    expect(importSection).not.toBeNull();
    const importButton = within(importSection as HTMLElement).getByRole(
      "button",
      { name: "Import" }
    );
    await userEvent.click(importButton);
    expect(await screen.findByText(/imported 1 blocks?/i)).toBeInTheDocument();
    expect(
      await screen.findByText("Import", { selector: ".page-item__title" })
    ).toBeInTheDocument();
    const pageButton = screen.getByRole("button", { name: "Open Import" });
    await userEvent.click(pageButton);
    expect(
      await screen.findByText("Import", { selector: ".editor-pane__title" })
    ).toBeInTheDocument();
    const searchInput = screen.getByPlaceholderText("Search...");
    await userEvent.type(searchInput, "Imported line");
    const results = await screen.findAllByText("Imported line", {
      selector: ".search-highlight"
    });
    expect(results.length).toBeGreaterThan(0);
  });

  it("loads markdown import text from a picked file", async () => {
    render(() => <App />);
    await userEvent.click(
      screen.getByRole("button", { name: /open settings/i })
    );
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    const picker = screen.getByTestId("markdown-file-picker") as HTMLInputElement;
    const file = new File(["# Import\n- Line"], "note.md", {
      type: "text/markdown"
    });
    fireEvent.change(picker, { target: { files: [file] } });
    expect(
      await screen.findByDisplayValue(/# Import/)
    ).toBeInTheDocument();
  });

  it("uses the native dialog to import markdown when available", async () => {
    render(() => <App />);
    vi.mocked(openDialog).mockResolvedValueOnce("/Users/demo/note.md");
    vi.mocked(invoke).mockResolvedValueOnce("# Import\n- Item");
    await userEvent.click(
      screen.getByRole("button", { name: /open settings/i })
    );
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    (window as typeof window & { __TAURI_INTERNALS__: Record<string, unknown> })
      .__TAURI_INTERNALS__ = {};
    const pickButton = screen.getByRole("button", { name: "Choose file" });
    await userEvent.click(pickButton);
    expect(vi.mocked(openDialog)).toHaveBeenCalledWith(
      expect.objectContaining({
        multiple: false,
        filters: [{ name: "Markdown", extensions: ["md", "markdown"] }]
      })
    );
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("read_text_file", {
      path: "/Users/demo/note.md"
    });
    expect(
      await screen.findByDisplayValue(/# Import/)
    ).toBeInTheDocument();
  });

  it("creates a new page and switches to it", async () => {
    render(() => <App />);
    const createButton = screen.getByRole("button", { name: /create new page/i });
    await userEvent.click(createButton);
    const dialog = await screen.findByRole("dialog", { name: "New page title" });
    const input = within(dialog).getByRole("textbox");
    await userEvent.type(input, "Project Atlas");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(
      await screen.findByText("Project Atlas", { selector: ".page-item__title" })
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Project Atlas", { selector: ".editor-pane__title" })
    ).toBeInTheDocument();
  });

  it("does not allow creating a normal page named Inbox", async () => {
    render(() => <App />);
    await screen.findByText(/saved/i);
    await userEvent.click(screen.getByRole("button", { name: /create new page/i }));
    const dialog = await screen.findByRole("dialog", { name: "New page title" });
    const input = within(dialog).getByRole("textbox");
    await userEvent.type(input, "Inbox");

    expect(within(dialog).getByRole("button", { name: "Create" })).toBeDisabled();
  });

  it("renames the active page", async () => {
    render(() => <App />);
    const renameButton = await screen.findByRole("button", { name: "Rename" });
    await userEvent.click(renameButton);
    const dialog = await screen.findByRole("dialog", { name: "Rename page" });
    const input = within(dialog).getByRole("textbox");
    await userEvent.clear(input);
    await userEvent.type(input, "Inbox Zero");
    await userEvent.click(within(dialog).getByRole("button", { name: "Rename" }));
    expect(
      await screen.findByText("Inbox Zero", { selector: ".page-item__title" })
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Inbox Zero", { selector: ".editor-pane__title" })
    ).toBeInTheDocument();
  });

  it("does not allow renaming a normal page to Inbox", async () => {
    render(() => <App />);
    await screen.findByText(/saved/i);
    const renameButton = await screen.findByRole("button", { name: "Rename" });
    await userEvent.click(renameButton);
    const dialog = await screen.findByRole("dialog", { name: "Rename page" });
    const input = within(dialog).getByRole("textbox");
    await userEvent.clear(input);
    await userEvent.type(input, "Inbox");

    await waitFor(() => {
      expect(within(dialog).getByRole("button", { name: "Rename" })).toBeDisabled();
    });
  });

  it("opens a plugin panel from the list", async () => {
    render(() => <App />);
    await userEvent.click(
      screen.getByRole("button", { name: /open settings/i })
    );
    await userEvent.click(screen.getByRole("button", { name: "Plugins" }));
    const openButtons = await screen.findAllByRole("button", { name: "Open" });
    await userEvent.click(openButtons[0]);
    expect(await screen.findByText(/active panel/i)).toBeInTheDocument();
  });

  it("blocks panel open when permission is missing", async () => {
    render(() => <App />);
    await userEvent.click(
      screen.getByRole("button", { name: /open settings/i })
    );
    await userEvent.click(screen.getByRole("button", { name: "Plugins" }));
    const openButtons = await screen.findAllByRole("button", { name: "Open" });
    await userEvent.click(openButtons[1]);
    expect(await screen.findByText("Grant permission")).toBeInTheDocument();
  });

  it("runs a plugin command to append a block", async () => {
    render(() => <App />);
    await userEvent.click(
      screen.getByRole("button", { name: /open settings/i })
    );
    await userEvent.click(screen.getByRole("button", { name: "Plugins" }));
    const runButtons = await screen.findAllByRole("button", { name: "Run" });
    await userEvent.click(runButtons[0]);
    const matches = await screen.findAllByDisplayValue(/plugin action/i);
    expect(matches.length).toBeGreaterThan(0);
  });

  it("blocks command run when permission is missing", async () => {
    render(() => <App />);
    await userEvent.click(
      screen.getByRole("button", { name: /open settings/i })
    );
    await userEvent.click(screen.getByRole("button", { name: "Plugins" }));
    const runButtons = await screen.findAllByRole("button", { name: "Run" });
    await userEvent.click(runButtons[1]);
    expect(await screen.findByText("Grant permission")).toBeInTheDocument();
  });
});
