import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

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
import { formatRefineDate as formatReviewDate } from "./pages/main-page/model/refine-utils";
import { clearResolvedAssetSrcCache } from "./shared/lib/assets/resolve-asset-src";

const REFINE_MODE_LABEL = "Refine";
const TO_REFINE_TAB_LABEL = "To Refine";
const REFINE_QUEUE_LABEL = "Refine queue";
const ARCHIVED_REFINE_QUEUE_LABEL = "Archived refine queue";
const REFINE_SURFACE_LABEL = "Refine surface";
const RESIZE_REFINE_PANES_LABEL = "Resize refine panes";
const COMPLETE_REFINEMENT_LABEL = "Complete Refinement";

const getModeControl = (name: "Capture" | "Review" | "Refine" | "Editor") =>
  screen.getByRole("radio", { name: name === "Review" ? REFINE_MODE_LABEL : name });

const getReviewTabControl = (name: "To Review" | "To Refine" | "Archived") =>
  screen.getByRole("radio", { name: name === "To Review" ? TO_REFINE_TAB_LABEL : name });

const findDestinationSearch = () =>
  screen.findByRole("textbox", { name: "Destination page" });

const getDestinationSearch = () =>
  screen.getByRole("textbox", { name: "Destination page" });

const getPageOption = (name: string) =>
  within(screen.getByRole("listbox", { name: "Pages" })).getByRole("option", {
    name
  });

const selectDestinationOption = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  const listbox = await screen.findByRole("listbox", {
    name: "Destination page options"
  });
  await user.click(within(listbox).getByRole("option", { name }));
};

describe("App editor UX", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(invoke).mockReset();
  });

  afterEach(() => {
    delete (window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> })
      .__TAURI_INTERNALS__;
    clearResolvedAssetSrcCache();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("focuses the textarea at the end when clicking display", async () => {
    render(() => <App />);
    await screen.findByText(/saved/i);
    const initialDisplayText = await screen.findByText("Sandpaper outline prototype");
    const initialBlock = initialDisplayText.closest(".block");
    expect(initialBlock).not.toBeNull();
    const firstInput = initialBlock?.querySelector(
      'textarea[data-block-id]'
    ) as HTMLTextAreaElement | null;
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
      target: { value: "Hello world" }
    });

    const displayText = await screen.findByText("Hello world");
    const display = displayText.closest(".block__display") as HTMLElement;
    expect(display).not.toBeNull();
    await userEvent.click(display);

    await waitFor(() => {
      const active = document.activeElement as HTMLElement | null;
      expect(active?.getAttribute("data-block-id")).toBe(blockId);
    });
    expect(getInput()?.selectionStart).toBe("Hello world".length);
    expect(getInput()?.selectionEnd).toBe("Hello world".length);
  });

  it("preserves caret position when exiting edit mode with Escape", async () => {
    render(() => <App />);
    await screen.findByText(/saved/i);
    const initialDisplayText = await screen.findByText("Sandpaper outline prototype");
    const initialBlock = initialDisplayText.closest(".block");
    expect(initialBlock).not.toBeNull();
    const firstInput = initialBlock?.querySelector(
      'textarea[data-block-id]'
    ) as HTMLTextAreaElement | null;
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
      target: { value: "Hello world" }
    });
    fireEvent.focus(getInput() as HTMLTextAreaElement);
    getInput()?.setSelectionRange(2, 2);

    fireEvent.keyDown(getInput() as HTMLTextAreaElement, { key: "Escape" });
    expect(document.activeElement?.getAttribute("data-block-id")).not.toBe(blockId);

    const displayText = await screen.findByText("Hello world");
    const display = displayText.closest(".block__display") as HTMLElement;
    expect(display).not.toBeNull();
    await userEvent.click(display);

    await waitFor(() => {
      const active = document.activeElement as HTMLElement | null;
      expect(active?.getAttribute("data-block-id")).toBe(blockId);
    });
    expect(getInput()?.selectionStart).toBe(2);
    expect(getInput()?.selectionEnd).toBe(2);
  });

  it("keeps editor focus after Backspace removes an empty block", async () => {
    render(() => <App />);
    await screen.findByText(/saved/i);
    const initialDisplayText = await screen.findByText("Sandpaper outline prototype");
    const initialBlock = initialDisplayText.closest(".block");
    expect(initialBlock).not.toBeNull();
    const firstInput = initialBlock?.querySelector(
      'textarea[data-block-id]'
    ) as HTMLTextAreaElement | null;
    expect(firstInput).not.toBeNull();
    if (!firstInput) return;
    const removedBlockId = firstInput.dataset.blockId;
    expect(removedBlockId).toBeTruthy();
    if (!removedBlockId) return;

    const display = initialDisplayText.closest(".block__display") as HTMLElement;
    await userEvent.click(display);

    const getActiveInput = () =>
      document.querySelector(
        ".editor-pane textarea[data-block-id][aria-hidden=\"false\"]"
      ) as HTMLTextAreaElement | null;

    await waitFor(() => {
      const active = getActiveInput();
      expect(active?.dataset.blockId).toBe(removedBlockId);
    });

    fireEvent.input(getActiveInput() as HTMLTextAreaElement, {
      target: { value: "" }
    });
    fireEvent.keyDown(getActiveInput() as HTMLTextAreaElement, { key: "Backspace" });

    await waitFor(() => {
      const nextActive = getActiveInput();
      expect(nextActive).not.toBeNull();
      expect(nextActive?.dataset.blockId).not.toBe(removedBlockId);
      expect(document.activeElement).toBe(nextActive);
    });
  });

  it("keeps focus on the same block while typing", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await screen.findByText(/saved/i);
    const initialDisplayText = await screen.findByText("Sandpaper outline prototype");
    const initialBlock = initialDisplayText.closest(".block");
    expect(initialBlock).not.toBeNull();
    const firstInput = initialBlock?.querySelector(
      'textarea[data-block-id]'
    ) as HTMLTextAreaElement | null;
    expect(firstInput).not.toBeNull();
    if (!firstInput) return;
    const blockId = firstInput.dataset.blockId;
    expect(blockId).toBeTruthy();
    if (!blockId) return;

    const display = initialDisplayText.closest(".block__display") as HTMLElement;
    await user.click(display);

    const getActiveInput = () =>
      document.querySelector(
        ".editor-pane textarea[data-block-id][aria-hidden=\"false\"]"
      ) as HTMLTextAreaElement | null;

    await waitFor(() => {
      expect(getActiveInput()?.dataset.blockId).toBe(blockId);
    });

    await user.type(getActiveInput() as HTMLTextAreaElement, "a");

    await waitFor(() => {
      const active = getActiveInput();
      expect(active?.dataset.blockId).toBe(blockId);
      expect(document.activeElement).toBe(active);
    });
  });

  it("shows slash command menu and inserts command text", { timeout: 15000 }, async () => {
    const user = userEvent.setup();

    render(() => <App />);
    await screen.findByText(/saved/i);

    const displayText = await screen.findByText("Sandpaper outline prototype");
    const sourceBlock = displayText.closest(".block");
    expect(sourceBlock).not.toBeNull();
    const firstInput = sourceBlock?.querySelector(
      'textarea[data-block-id]'
    ) as HTMLTextAreaElement | null;
    expect(firstInput).not.toBeNull();
    if (!firstInput) return;
    const blockId = firstInput.dataset.blockId;
    expect(blockId).toBeTruthy();
    if (!blockId) return;
    const getInput = () =>
      document.querySelector(
        `textarea[data-block-id="${blockId}"]`
      ) as HTMLTextAreaElement | null;
    const display = sourceBlock?.querySelector(".block__display") as HTMLElement;
    await user.click(display);
    await waitFor(() => {
      const active = document.activeElement as HTMLElement | null;
      expect(active?.getAttribute("data-block-id")).toBe(blockId);
    });
    fireEvent.input(getInput() as HTMLTextAreaElement, { target: { value: "/" } });
    expect(getInput()?.value).toContain("/");
    const menu = await screen.findByText("Commands");
    const menuScope = within(menu.closest(".slash-menu") as HTMLElement);
    await user.click(menuScope.getByRole("option", { name: "Link to page" }));
    await waitFor(() => {
      expect(getInput()?.value).toContain("[[Page]]");
    });

    fireEvent.input(getInput() as HTMLTextAreaElement, {
      target: { value: `${getInput()?.value ?? ""}/` }
    });
    const menuAgain = await screen.findByText("Commands");
    const menuAgainScope = within(menuAgain.closest(".slash-menu") as HTMLElement);
    await user.click(menuAgainScope.getByRole("option", { name: "Insert date" }));
    await waitFor(() => {
      expect(getInput()?.value).toMatch(/\d{4}-\d{2}-\d{2}/);
    });

    fireEvent.input(getInput() as HTMLTextAreaElement, { target: { value: "/" } });
    const menuHeading = await screen.findByText("Commands");
    const menuHeadingScope = within(menuHeading.closest(".slash-menu") as HTMLElement);
    await user.click(menuHeadingScope.getByRole("option", { name: "Heading 1" }));
    await waitFor(() => {
      expect((getInput()?.value ?? "").startsWith("# ")).toBe(true);
    });

    fireEvent.input(getInput() as HTMLTextAreaElement, { target: { value: "Follow up" } });
    fireEvent.input(getInput() as HTMLTextAreaElement, { target: { value: "Follow up/" } });
    const menuTask = await screen.findByText("Commands");
    const menuTaskScope = within(menuTask.closest(".slash-menu") as HTMLElement);
    await user.click(menuTaskScope.getByRole("option", { name: "To-do" }));
    await waitFor(() => {
      expect((getInput()?.value ?? "").startsWith("- [ ] ")).toBe(true);
    });

    fireEvent.input(getInput() as HTMLTextAreaElement, { target: { value: "/" } });
    const menuCode = await screen.findByText("Commands");
    const menuCodeScope = within(menuCode.closest(".slash-menu") as HTMLElement);
    await user.click(menuCodeScope.getByRole("option", { name: "Code block" }));
    await waitFor(() => {
      expect((getInput()?.value ?? "").startsWith("```")).toBe(true);
    });

    fireEvent.input(getInput() as HTMLTextAreaElement, { target: { value: "/" } });
    const menuTable = await screen.findByText("Commands");
    const menuTableScope = within(menuTable.closest(".slash-menu") as HTMLElement);
    await user.click(menuTableScope.getByRole("option", { name: "Table" }));
    await waitFor(() => {
      expect(getInput()?.value).toContain("| --- | --- |");
    });

    fireEvent.input(getInput() as HTMLTextAreaElement, { target: { value: "/" } });
    const menuOrdered = await screen.findByText("Commands");
    const menuOrderedScope = within(menuOrdered.closest(".slash-menu") as HTMLElement);
    await user.click(menuOrderedScope.getByRole("option", { name: "Numbered list" }));
    await waitFor(() => {
      expect((getInput()?.value ?? "").startsWith("1. ")).toBe(true);
    });

    fireEvent.input(getInput() as HTMLTextAreaElement, { target: { value: "/" } });
    const menuBookmark = await screen.findByText("Commands");
    const menuBookmarkScope = within(menuBookmark.closest(".slash-menu") as HTMLElement);
    await user.click(menuBookmarkScope.getByRole("option", { name: "Bookmark" }));
    await waitFor(() => {
      expect((getInput()?.value ?? "").startsWith("https://")).toBe(true);
    });

    fireEvent.input(getInput() as HTMLTextAreaElement, { target: { value: "/" } });
    const menuMath = await screen.findByText("Commands");
    const menuMathScope = within(menuMath.closest(".slash-menu") as HTMLElement);
    await user.click(menuMathScope.getByRole("option", { name: "Math" }));
    await waitFor(() => {
      expect(getInput()?.value).toContain("$$");
    });

    fireEvent.input(getInput() as HTMLTextAreaElement, { target: { value: "/" } });
    const menuToc = await screen.findByText("Commands");
    const menuTocScope = within(menuToc.closest(".slash-menu") as HTMLElement);
    await user.click(menuTocScope.getByRole("option", { name: "Table of contents" }));
    await waitFor(() => {
      expect((getInput()?.value ?? "").trim()).toBe("[TOC]");
    });

    fireEvent.input(getInput() as HTMLTextAreaElement, { target: { value: "/" } });
    const menuDatabase = await screen.findByText("Commands");
    const menuDatabaseScope = within(menuDatabase.closest(".slash-menu") as HTMLElement);
    await user.click(menuDatabaseScope.getByRole("option", { name: "Database view" }));
    await waitFor(() => {
      expect((getInput()?.value ?? "").startsWith("```database")).toBe(true);
    });
  });

  it("does not show the old block hover toolbar actions", async () => {
    render(() => <App />);
    await screen.findByText(/saved/i);
    expect(screen.queryByRole("button", { name: "Insert block below" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add to refine" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Link to page" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Duplicate block" })).toBeNull();
  });

  it("keeps quick capture open and refocuses composer after sending", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await user.click(getModeControl("Capture"));
    const captureInput = screen.getByPlaceholderText(
      "Capture a thought, link, or task..."
    ) as HTMLTextAreaElement;
    await user.type(captureInput, "Quick note");
    fireEvent.keyDown(captureInput, { key: "Enter" });

    await waitFor(() => {
      expect(captureInput.value).toBe("");
      expect(document.activeElement).toBe(captureInput);
    });
    expect(getModeControl("Capture")).toBeChecked();
    expect(await screen.findByText("Quick note")).toBeInTheDocument();
  }, 15000);

  it("stages pasted images in capture and sends an image-only thread", async () => {
    vi.mocked(invoke).mockImplementation((command, payload) => {
      if (command === "import_image_asset_bytes") {
        expect(payload).toMatchObject({
          payload: {
            filename: "pasted.png",
            mime_type: "image/png"
          }
        });
        return Promise.resolve({
          asset_path: "/assets/pasted.png",
          markdown: "![](/assets/pasted.png)",
          mime_type: "image/png",
          original_name: "pasted.png"
        });
      }
      if (command === "resolve_asset_path") {
        return Promise.resolve("C:/vault/assets/pasted.png");
      }
      return Promise.resolve(null);
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:staged-image");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    render(() => <App />);
    const user = userEvent.setup();
    await user.click(getModeControl("Capture"));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    const image = new File(["image"], "pasted.png", { type: "image/png" });
    Object.defineProperty(image, "arrayBuffer", {
      configurable: true,
      value: () => Promise.resolve(new TextEncoder().encode("image").buffer)
    });
    fireEvent.paste(captureInput, {
      clipboardData: {
        files: [],
        items: [
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => image
          }
        ]
      }
    });

    expect(
      await screen.findByRole("button", { name: "Open staged image pasted.png" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send capture" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Send capture" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Open staged image pasted.png" })
      ).not.toBeInTheDocument();
    });

    const thread = await screen.findByRole("group", { name: "Thread 1 image" });
    expect(within(thread).getAllByRole("button", { name: /Open image / }).length).toBe(1);
    expect(thread.querySelector("img")).not.toBeNull();
    expect(within(thread).queryByRole("link", { name: "pasted.png" })).toBeNull();

    await user.click(getModeControl("Review"));

    await waitFor(() => {
      expect(document.querySelector(".review-reference-card__thumb-image")).not.toBeNull();
    });
  });

  it("keeps edited captures in the hidden inbox when returning to editor", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await screen.findByText(/saved/i);
    await user.click(getModeControl("Capture"));
    const captureInput = screen.getByPlaceholderText(
      "Capture a thought, link, or task..."
    );
    await user.type(captureInput, "Quick note");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    await waitFor(() => {
      expect(document.activeElement).toBe(captureInput);
    });

    const capturedItemDisplay = await screen.findByText("Quick note");
    await user.click(capturedItemDisplay);
    const capturedItemInput = (await screen.findByRole("textbox", {
      name: "Captured item 1"
    })) as HTMLTextAreaElement;
    fireEvent.input(capturedItemInput, {
      target: { value: "Quick note updated" }
    });

    await user.click(getModeControl("Editor"));
    expect(
      await screen.findByText("Home", { selector: ".editor-pane__title" })
    ).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Quick note updated")).not.toBeInTheDocument();

    await user.click(getModeControl("Capture"));
    expect(await screen.findByText("Quick note updated")).toBeInTheDocument();
  });

  it("stores quick captures in a hidden inbox instead of the active editor page", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await screen.findByText(/saved/i);

    await user.click(screen.getByRole("button", { name: /create new page/i }));
    const dialog = await screen.findByRole("dialog", { name: "New page title" });
    const titleInput = within(dialog).getByRole("textbox");
    await user.type(titleInput, "Project Atlas");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await screen.findByText("Project Atlas", { selector: ".editor-pane__title" });

    expect(screen.queryByRole("option", { name: "Inbox" })).not.toBeInTheDocument();

    await user.click(getModeControl("Capture"));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;
    await user.type(captureInput, "Quick note");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    expect(await screen.findByText("Quick note")).toBeInTheDocument();

    await user.click(getModeControl("Editor"));

    expect(
      await screen.findByText("Project Atlas", { selector: ".editor-pane__title" })
    ).toBeInTheDocument();
    expect(screen.queryByText("Quick note")).not.toBeInTheDocument();
  });

  it("routes hidden inbox wikilinks to capture mode instead of opening inbox in editor", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await screen.findByText(/saved/i);

    await user.click(getModeControl("Capture"));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;
    await user.type(captureInput, "Inbox thread");
    await user.click(screen.getByRole("button", { name: "Send capture" }));

    await user.click(getModeControl("Editor"));
    expect(
      await screen.findByText("Home", { selector: ".editor-pane__title" })
    ).toBeInTheDocument();

    const editorInput = (document.querySelector(
      ".editor-pane textarea[data-block-id][aria-hidden=\"false\"]"
    ) ?? document.querySelector(".editor-pane textarea[data-block-id]")) as
      | HTMLTextAreaElement
      | null;
    expect(editorInput).not.toBeNull();
    if (!editorInput) return;

    fireEvent.input(editorInput, {
      target: { value: "See [[Inbox]]" }
    });
    fireEvent.keyDown(editorInput, { key: "Escape", code: "Escape" });
    fireEvent.blur(editorInput);

    const inboxLabel = await screen.findByText("Inbox");
    const inboxLink = inboxLabel.closest("button");
    expect(inboxLink).not.toBeNull();
    if (!inboxLink) return;
    await user.click(inboxLink);

    expect(getModeControl("Capture")).toBeChecked();
    expect(
      await screen.findByPlaceholderText("Capture a thought, link, or task...")
    ).toBeInTheDocument();
    expect(screen.getByText("Inbox thread")).toBeInTheDocument();
    expect(
      screen.queryByText("Inbox", { selector: ".editor-pane__title" })
    ).not.toBeInTheDocument();
  });

  it("opens rendered capture wikilinks in the editor workspace", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await screen.findByText(/saved/i);

    await user.click(screen.getByRole("button", { name: /create new page/i }));
    const dialog = await screen.findByRole("dialog", { name: "New page title" });
    const titleInput = within(dialog).getByRole("textbox");
    await user.type(titleInput, "Project Atlas");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await screen.findByText("Project Atlas", { selector: ".editor-pane__title" });

    await user.click(getModeControl("Capture"));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;
    fireEvent.input(captureInput, {
      target: { value: "See [[Project Atlas]]" }
    });
    await user.click(screen.getByRole("button", { name: "Send capture" }));

    const captureLinkLabel = await waitFor(() => {
      const label = document.querySelector(".capture-chat .wikilink");
      expect(label).not.toBeNull();
      return label as HTMLElement;
    });
    expect(captureLinkLabel).toHaveTextContent("Project Atlas");
    const captureLink = captureLinkLabel.closest("button");
    expect(captureLink).not.toBeNull();
    if (!captureLink) return;
    await user.click(captureLink);

    expect(getModeControl("Editor")).toBeChecked();
    expect(
      await screen.findByText("Project Atlas", { selector: ".editor-pane__title" })
    ).toBeInTheDocument();
  });

  it("reuses the shared composer for replies and keeps reply mode active", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await user.click(getModeControl("Capture"));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    await user.type(captureInput, "Root post");
    await user.click(screen.getByRole("button", { name: "Send capture" }));

    const thread = await screen.findByRole("group", { name: "Thread Root post" });
    await user.click(
      within(thread).getByRole("button", { name: "Reply to Root post" })
    );
    const replying = screen.getByText("Replying to").closest(".capture-chat__replying");
    expect(replying).not.toBeNull();
    expect(replying?.closest(".capture-chat__composer-surface")).toBeNull();
    expect(screen.getAllByText("Root post").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Cancel reply" })).toBeInTheDocument();
    expect(screen.getByText("Esc")).toBeInTheDocument();

    await user.type(captureInput, "Follow up");
    await user.click(screen.getByRole("button", { name: "Send capture" }));

    const updatedThread = await screen.findByRole("group", {
      name: "Thread Root post"
    });
    expect(within(updatedThread).getByText("Follow up")).toBeInTheDocument();
    expect(
      within(updatedThread).getAllByText(/\d{1,2}:\d{2} [AP]M|Now/)
    ).toHaveLength(2);
    expect(screen.getByText("Replying to")).toBeInTheDocument();
    expect(screen.getAllByText("Root post").length).toBeGreaterThan(0);
  });

  it("uses Ctrl+Enter to reply to the latest thread root from the capture composer", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await user.click(getModeControl("Capture"));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    const composerSurface = captureInput.closest(".capture-chat__composer-surface");
    expect(composerSurface).not.toBeNull();
    if (!composerSurface) return;

    const shortcuts = screen.getByLabelText("Capture composer shortcuts");
    expect(composerSurface).toContainElement(shortcuts);
    expect(composerSurface).toContainElement(screen.getByRole("button", { name: "Send capture" }));
    expect(within(shortcuts).getByText("Reply")).toBeInTheDocument();
    expect(within(shortcuts).getByText("Ctrl")).toBeInTheDocument();
    expect(within(shortcuts).getAllByText("Enter").length).toBeGreaterThan(0);

    await user.type(captureInput, "Older thread");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    await user.type(captureInput, "Latest thread");
    await user.click(screen.getByRole("button", { name: "Send capture" }));

    await user.type(captureInput, "Latest reply");
    fireEvent.keyDown(captureInput, { key: "Enter", ctrlKey: true });

    await waitFor(() => {
      expect(captureInput.value).toBe("");
      expect(document.activeElement).toBe(captureInput);
    });

    const latestThread = await screen.findByRole("group", { name: "Thread Latest thread" });
    expect(within(latestThread).getByText("Latest reply")).toBeInTheDocument();
    const replying = screen.getByText("Replying to").closest(".capture-chat__replying");
    expect(replying).not.toBeNull();
    if (!replying) return;
    expect(within(replying).getByText("Latest thread")).toBeInTheDocument();
  });

  it("moves an active thread to the bottom when it receives a new reply", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await user.click(getModeControl("Capture"));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    await user.type(captureInput, "Older thread");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    await user.type(captureInput, "Newer thread");
    await user.click(screen.getByRole("button", { name: "Send capture" }));

    const olderThread = await screen.findByRole("group", {
      name: "Thread Older thread"
    });
    await user.click(
      within(olderThread).getByRole("button", { name: "Reply to Older thread" })
    );
    await user.type(captureInput, "Older reply");
    await user.click(screen.getByRole("button", { name: "Send capture" }));

    const threads = screen.getAllByRole("group");
    const lastThread = threads[threads.length - 1] as HTMLElement;
    expect(lastThread).toHaveAttribute("aria-label", "Thread Older thread");
    expect(within(lastThread).getByText("Older reply")).toBeInTheDocument();
  });

  it("confirms before deleting a reply", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await user.click(getModeControl("Capture"));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    await user.type(captureInput, "Root post");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    const thread = await screen.findByRole("group", { name: "Thread Root post" });
    await user.click(
      within(thread).getByRole("button", { name: "Reply to Root post" })
    );
    await user.type(captureInput, "Reply post");
    await user.click(screen.getByRole("button", { name: "Send capture" }));

    const updatedThread = await screen.findByRole("group", {
      name: "Thread Root post"
    });
    await user.click(
      within(updatedThread).getByRole("button", { name: "Delete Reply post" })
    );

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Delete reply");
    expect(dialog).toHaveTextContent("Reply post");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(
        screen.queryByDisplayValue("Reply post")
      ).not.toBeInTheDocument();
    });
    expect(
      within(screen.getByRole("group", { name: "Thread Root post" })).getByText("Root post")
    ).toBeInTheDocument();
  });

  it("confirms before deleting a thread root and removes the whole thread", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await user.click(getModeControl("Capture"));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    await user.type(captureInput, "Root post");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    const thread = await screen.findByRole("group", { name: "Thread Root post" });
    await user.click(
      within(thread).getByRole("button", { name: "Reply to Root post" })
    );
    await user.type(captureInput, "Reply post");
    await user.click(screen.getByRole("button", { name: "Send capture" }));

    const updatedThread = await screen.findByRole("group", {
      name: "Thread Root post"
    });
    await user.click(
      within(updatedThread).getByRole("button", { name: "Delete Root post" })
    );

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Delete thread");
    expect(dialog).toHaveTextContent("Root post");
    expect(dialog).toHaveTextContent("1 reply");
    await user.click(within(dialog).getByRole("button", { name: "Delete thread" }));

    await waitFor(() => {
      expect(screen.queryByDisplayValue("Root post")).not.toBeInTheDocument();
      expect(screen.queryByDisplayValue("Reply post")).not.toBeInTheDocument();
    });
  });

  it("shows capture threads in the review workbench FIFO even after capture reordering", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await user.click(getModeControl("Capture"));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    await user.type(captureInput, "Older thread");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    await user.type(captureInput, "Newer thread");
    await user.click(screen.getByRole("button", { name: "Send capture" }));

    const olderThread = await screen.findByRole("group", {
      name: "Thread Older thread"
    });
    await user.click(
      within(olderThread).getByRole("button", { name: "Reply to Older thread" })
    );
    await user.type(captureInput, "Older reply");
    await user.click(screen.getByRole("button", { name: "Send capture" }));

    await user.click(getModeControl("Review"));

    const queue = await screen.findByRole("navigation", { name: REFINE_QUEUE_LABEL });
    const queueCards = Array.from(queue.querySelectorAll(".review-reference-card"));
    expect(queueCards[0]).toHaveTextContent("Older thread");
    expect(queueCards[1]).toHaveTextContent("Newer thread");

    expect(screen.getByText("Older reply")).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Destination note" })
    ).toBeInTheDocument();
  });

  it("shows review tabs and keeps the destination selector visible", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await user.click(getModeControl("Capture"));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    await user.type(captureInput, "Thread root");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    await user.click(getModeControl("Review"));

    expect(
      await screen.findByRole("radio", { name: TO_REFINE_TAB_LABEL })
    ).toBeInTheDocument();
    expect(
      getReviewTabControl("Archived")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Thread root")
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search or create a page...")).toBeInTheDocument();
    expect(
      document.querySelector(".review .editor-pane textarea[data-block-id]")
    ).toBeNull();
  });

  it("uses a full-width split review workspace", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await user.click(getModeControl("Capture"));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    await user.type(captureInput, "Split workspace thread");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    await user.click(getModeControl("Review"));

    const reviewSurface = await screen.findByRole("region", { name: REFINE_SURFACE_LABEL });
    const reviewLayout = reviewSurface.closest(".review-workbench")?.querySelector(
      ".review-workbench__layout"
    );
    const focusPanel = reviewSurface.closest(".focus-panel");

    expect(reviewLayout).toHaveAttribute("data-layout", "split");
    expect(focusPanel).toHaveAttribute("data-focus-mode", "refine");
  });

  it("lets the review divider resize the split panes", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await user.click(getModeControl("Capture"));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    await user.type(captureInput, "Resizable workspace thread");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    await user.click(getModeControl("Review"));

    const reviewSurface = await screen.findByRole("region", { name: REFINE_SURFACE_LABEL });
    const reviewLayout = reviewSurface.closest(".review-workbench")?.querySelector(
      ".review-workbench__layout"
    ) as HTMLDivElement | null;
    expect(reviewLayout).not.toBeNull();
    if (!reviewLayout) return;

    Object.defineProperty(reviewLayout, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 1000,
        bottom: 600,
        width: 1000,
        height: 600,
        toJSON: () => ({})
      })
    });

    const divider = screen.getByRole("separator", { name: RESIZE_REFINE_PANES_LABEL });

    expect(reviewLayout.style.getPropertyValue("--review-left-pane")).toBe("50%");

    fireEvent.pointerDown(divider, { clientX: 500 });
    fireEvent.pointerMove(window, { clientX: 650 });
    fireEvent.pointerUp(window, { clientX: 650 });

    expect(reviewLayout.style.getPropertyValue("--review-left-pane")).toBe("65%");

    fireEvent.doubleClick(divider);

    expect(reviewLayout.style.getPropertyValue("--review-left-pane")).toBe("50%");
  });

  it("shows each review thread with a captured time range", async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(() => <App />);
    await user.click(getModeControl("Capture"));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    const capturedStart = new Date("2026-04-04T10:00:00Z");
    vi.setSystemTime(capturedStart);
    await user.type(captureInput, "Thread root");
    await user.click(screen.getByRole("button", { name: "Send capture" }));

    const thread = await screen.findByRole("group", { name: "Thread Thread root" });
    await user.click(within(thread).getByRole("button", { name: "Reply to Thread root" }));

    const capturedEnd = new Date("2026-04-04T10:05:00Z");
    vi.setSystemTime(capturedEnd);
    await user.type(captureInput, "Thread reply");
    await user.click(screen.getByRole("button", { name: "Send capture" }));

    await user.click(getModeControl("Review"));

    expect(
      await screen.findByText(
        `Captured ${formatReviewDate(capturedStart.getTime())} - ${formatReviewDate(capturedEnd.getTime())}`
      )
    ).toBeInTheDocument();
  });

  it("preloads a recommended destination inside the review workbench", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await user.click(getModeControl("Capture"));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    await user.type(captureInput, "Home follow up");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    await user.click(getModeControl("Review"));

    const destinationPanel = await screen.findByRole("region", {
      name: "Destination note"
    });
    expect(within(destinationPanel).getByText("Recommended")).toBeInTheDocument();
    expect(
      within(destinationPanel).getByPlaceholderText("Search or create a page...")
    ).toBeInTheDocument();
    expect(
      within(destinationPanel).getByRole("option", { name: "Home" })
    ).toBeInTheDocument();
    expect(
      document.querySelector(".review .editor-pane textarea[data-block-id]")
    ).toBeNull();
    expect(getReviewTabControl("To Review")).toBeChecked();
    expect(getReviewTabControl("Archived")).toBeInTheDocument();
  });

  it("filters destination suggestions inline without rendering a combobox popup", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await user.click(getModeControl("Capture"));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    await user.type(captureInput, "Thread root");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    await user.click(getModeControl("Review"));

    expect(screen.queryByRole("combobox", { name: "Destination page" })).not.toBeInTheDocument();
    expect(screen.queryByText("Refreshing suggestions")).not.toBeInTheDocument();

    const destinationSearch = await findDestinationSearch();
    const destinationList = await screen.findByRole("listbox", {
      name: "Destination page options"
    });

    await user.type(destinationSearch, "Home");
    expect(within(destinationList).getByRole("option", { name: "Open Home" })).toBeInTheDocument();
    expect(
      within(destinationList).queryByRole("option", { name: 'Create "Home"' })
    ).not.toBeInTheDocument();

    await user.clear(destinationSearch);
    await user.type(destinationSearch, "Research Note");
    expect(
      within(destinationList).getByRole("option", { name: 'Create "Research Note"' })
    ).toBeInTheDocument();
  });

  it("turns a recommended destination into a hard-selected destination after editing", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await user.click(getModeControl("Capture"));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    await user.type(captureInput, "Home follow up");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    await user.click(getModeControl("Review"));

    const destinationPanel = await screen.findByRole("region", {
      name: "Destination note"
    });
    expect(within(destinationPanel).getByText("Recommended")).toBeInTheDocument();
    expect(
      within(destinationPanel).getByPlaceholderText("Search or create a page...")
    ).toBeInTheDocument();

    await user.click(
      within(destinationPanel).getByRole("option", { name: /home/i })
    );
    const editorInput = await waitFor(() => {
      const input = document.querySelector(
        ".review .editor-pane textarea[data-block-id]"
      ) as HTMLTextAreaElement | null;
      expect(input).not.toBeNull();
      return input as HTMLTextAreaElement;
    });

    fireEvent.input(editorInput, {
      target: { value: "Home summary" }
    });

    await waitFor(() => {
      expect(within(destinationPanel).queryByText("Recommended")).not.toBeInTheDocument();
      expect(
        within(destinationPanel).queryByPlaceholderText("Search or create a page...")
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Change Destination" })
      ).toBeInTheDocument();
    });
  });

  it("enables review completion even when editing immediately after opening review", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await user.click(getModeControl("Capture"));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    await user.type(captureInput, "Home follow up");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    await user.click(getModeControl("Review"));
    const destinationPanel = await screen.findByRole("region", {
      name: "Destination note"
    });
    await user.click(
      within(destinationPanel).getByRole("option", { name: /home/i })
    );

    const editorInput = await waitFor(() => {
      const input = document.querySelector(
        ".review .editor-pane textarea[data-block-id]"
      ) as HTMLTextAreaElement | null;
      expect(input).not.toBeNull();
      return input as HTMLTextAreaElement;
    });

    await user.click(editorInput);
    await user.clear(editorInput);
    await user.type(editorInput, "Immediate review summary");

    await waitFor(() => {
      expect(screen.queryByPlaceholderText("Search or create a page...")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: COMPLETE_REFINEMENT_LABEL })).toBeEnabled();
    });
  });

  it("treats the visible page as the destination after editing when no recommendation exists", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await user.click(getModeControl("Capture"));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    await user.type(captureInput, "Hello");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    await user.click(getModeControl("Review"));

    expect(screen.getByPlaceholderText("Search or create a page...")).toBeInTheDocument();
    await user.type(await findDestinationSearch(), "Home");
    await selectDestinationOption(user, "Open Home");

    const editorInput = await waitFor(() => {
      const input = document.querySelector(
        ".review .editor-pane textarea[data-block-id]"
      ) as HTMLTextAreaElement | null;
      expect(input).not.toBeNull();
      return input as HTMLTextAreaElement;
    });

    await user.click(editorInput);
    await user.clear(editorInput);
    await user.type(editorInput, "Hello summary");

    await waitFor(() => {
      expect(screen.queryByPlaceholderText("Search or create a page...")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Change Destination" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: COMPLETE_REFINEMENT_LABEL })).toBeEnabled();
    });
  });

  it("toggles the destination panel between editor and selection modes", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await user.click(getModeControl("Capture"));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    await user.type(captureInput, "Home follow up");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    await user.click(getModeControl("Review"));

    const destinationPanel = await screen.findByRole("region", {
      name: "Destination note"
    });
    expect(
      within(destinationPanel).getByPlaceholderText("Search or create a page...")
    ).toBeInTheDocument();
    expect(
      document.querySelector(".review .editor-pane textarea[data-block-id]")
    ).toBeNull();

    await user.click(
      within(destinationPanel).getByRole("option", { name: /home/i })
    );
    const editorInput = await waitFor(() => {
      const input = document.querySelector(
        ".review .editor-pane textarea[data-block-id]"
      ) as HTMLTextAreaElement | null;
      expect(input).not.toBeNull();
      return input as HTMLTextAreaElement;
    });

    fireEvent.input(editorInput, {
      target: { value: "Home summary" }
    });

    await waitFor(() => {
      expect(
        within(destinationPanel).queryByPlaceholderText("Search or create a page...")
      ).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Change Destination" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Change Destination" }));
    expect(screen.getByRole("button", { name: "Cancel Change" })).toBeInTheDocument();
    expect(
      within(destinationPanel).getByPlaceholderText("Search or create a page...")
    ).toBeInTheDocument();
    expect(
      document.querySelector(".review .editor-pane textarea[data-block-id]")
    ).toBeNull();

    await user.click(screen.getByRole("button", { name: "Cancel Change" }));
    await waitFor(() => {
      expect(
        within(destinationPanel).queryByPlaceholderText("Search or create a page...")
      ).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Change Destination" })).toBeInTheDocument();
      expect(
        document.querySelector(".review .editor-pane textarea[data-block-id]")
      ).not.toBeNull();
    });
  });

  it("switches the review surface into flattened archived state", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await user.click(getModeControl("Capture"));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    await user.type(captureInput, "Archived thread");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    await user.click(getModeControl("Review"));

    const reviewSurface = screen.getByRole("region", { name: REFINE_SURFACE_LABEL });
    expect(reviewSurface).toHaveAttribute("data-review-tab", "to-refine");
    expect(
      within(reviewSurface).getByRole("navigation", { name: REFINE_QUEUE_LABEL })
    ).toBeInTheDocument();

    await user.type(await findDestinationSearch(), "Archive Target");
    await selectDestinationOption(user, 'Create "Archive Target"');

    const editorInput = document.querySelector(
      ".review .editor-pane textarea[data-block-id]"
    ) as HTMLTextAreaElement | null;
    expect(editorInput).not.toBeNull();
    if (!editorInput) return;

    fireEvent.input(editorInput, {
      target: { value: "Archived summary" }
    });
    await user.click(screen.getByRole("button", { name: COMPLETE_REFINEMENT_LABEL }));
    await user.click(getReviewTabControl("Archived"));

    await waitFor(() => {
      expect(reviewSurface).toHaveAttribute("data-review-tab", "archived");
    });
    expect(
      within(reviewSurface).getByRole("navigation", { name: ARCHIVED_REFINE_QUEUE_LABEL })
    ).toBeInTheDocument();
    expect(
      within(reviewSurface).queryByRole("navigation", { name: REFINE_QUEUE_LABEL })
    ).not.toBeInTheDocument();
  });

  it("shows how many review cards remain beyond the visible deck", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await user.click(getModeControl("Capture"));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    for (const title of ["First thread", "Second thread", "Third thread", "Fourth thread"]) {
      await user.clear(captureInput);
      await user.type(captureInput, title);
      await user.click(screen.getByRole("button", { name: "Send capture" }));
    }

    await user.click(getModeControl("Review"));

    const footer = (await screen.findByRole("radio", { name: TO_REFINE_TAB_LABEL })).closest(
      ".review-workbench__footer"
    );
    expect(footer).not.toBeNull();
    expect(footer).toContainElement(screen.getByText("1 more"));
  });

  it("reorders the review deck when selecting a peek card", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await user.click(getModeControl("Capture"));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    await user.type(captureInput, "First thread");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    await user.type(captureInput, "Second thread");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    await user.click(getModeControl("Review"));

    const queue = await screen.findByRole("navigation", { name: REFINE_QUEUE_LABEL });
    let queueCards = Array.from(queue.querySelectorAll(".review-reference-card"));
    expect(queueCards[0]).toHaveTextContent("First thread");
    expect(queueCards[1]).toHaveTextContent("Second thread");

    await user.click(within(queue).getByRole("button", { name: /second thread/i }));

    await waitFor(() => {
      queueCards = Array.from(queue.querySelectorAll(".review-reference-card"));
      expect(queueCards[0]).toHaveTextContent("Second thread");
      expect(queueCards[1]).toHaveTextContent("First thread");
    });
  });

  it("confirms before switching review cards with a draft", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await user.click(getModeControl("Capture"));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    await user.type(captureInput, "First thread");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    await user.type(captureInput, "Second thread");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    await user.click(getModeControl("Review"));

    await user.type(await findDestinationSearch(), "Project Atlas");
    await selectDestinationOption(user, 'Create "Project Atlas"');
    await waitFor(() => {
      expect(
        screen.getByText("Project Atlas", { selector: ".editor-pane__title" })
      ).toBeInTheDocument();
    });

    const editorInput = document.querySelector(
      ".review .editor-pane textarea[data-block-id]"
    ) as HTMLTextAreaElement | null;
    expect(editorInput).not.toBeNull();
    if (!editorInput) return;

    fireEvent.input(editorInput, {
      target: { value: "Draft summary" }
    });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: COMPLETE_REFINEMENT_LABEL })
      ).toBeEnabled();
    });

    const queue = await screen.findByRole("navigation", { name: REFINE_QUEUE_LABEL });
    await user.click(within(queue).getByRole("button", { name: /second thread/i }));

    let queueCards = Array.from(queue.querySelectorAll(".review-reference-card"));
    expect(queueCards[0]).toHaveTextContent("First thread");

    const continueDialog = await screen.findByRole("alertdialog", {
      name: "Discard current draft?"
    });
    await user.click(within(continueDialog).getByRole("button", { name: "Continue writing" }));
    await waitFor(() => {
      expect(
        screen.queryByRole("alertdialog", { name: "Discard current draft?" })
      ).not.toBeInTheDocument();
    });
    queueCards = Array.from(queue.querySelectorAll(".review-reference-card"));
    expect(queueCards[0]).toHaveTextContent("First thread");

    await user.click(within(queue).getByRole("button", { name: /second thread/i }));
    const discardDialog = await screen.findByRole("alertdialog", {
      name: "Discard current draft?"
    });
    await user.click(within(discardDialog).getByRole("button", { name: "Discard and switch" }));

    await waitFor(() => {
      queueCards = Array.from(queue.querySelectorAll(".review-reference-card"));
      expect(queueCards[0]).toHaveTextContent("Second thread");
    });
  });

  it("confirms before changing destination with a draft", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await user.click(getModeControl("Capture"));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    await user.type(captureInput, "Thread root");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    await user.click(getModeControl("Review"));

    await user.type(await findDestinationSearch(), "Project Atlas");
    await selectDestinationOption(user, 'Create "Project Atlas"');

    const editorInput = document.querySelector(
      ".review .editor-pane textarea[data-block-id]"
    ) as HTMLTextAreaElement | null;
    expect(editorInput).not.toBeNull();
    if (!editorInput) return;

    fireEvent.input(editorInput, {
      target: { value: "Draft summary" }
    });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: COMPLETE_REFINEMENT_LABEL })
      ).toBeEnabled();
    });

    await user.click(screen.getByRole("button", { name: "Change Destination" }));
    const destinationSearch = await findDestinationSearch();
    await user.type(destinationSearch, "Research Note");
    await selectDestinationOption(user, 'Create "Research Note"');

    expect(
      await screen.findByRole("alertdialog", { name: "Discard current draft?" })
    ).toBeInTheDocument();
    expect(
      screen.getByText("Project Atlas", { selector: ".editor-pane__title" })
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Continue writing" }));
    await waitFor(() => {
      expect(
        screen.queryByRole("alertdialog", { name: "Discard current draft?" })
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByText("Project Atlas", { selector: ".editor-pane__title" })
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Change Destination" }));
    const retryDestinationSearch = await findDestinationSearch();
    await user.clear(retryDestinationSearch);
    await user.type(retryDestinationSearch, "Research Note");
    await selectDestinationOption(user, 'Create "Research Note"');
    await user.click(screen.getByRole("button", { name: "Discard and switch" }));

    await waitFor(() => {
      expect(
        screen.getByText("Research Note", { selector: ".editor-pane__title" })
      ).toBeInTheDocument();
    });
  });

  it("keeps review completion disabled until the destination note changes", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await user.click(getModeControl("Capture"));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    await user.type(captureInput, "Thread root");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    await user.click(getModeControl("Review"));

    await user.type(await findDestinationSearch(), "Project Atlas");
    await selectDestinationOption(user, 'Create "Project Atlas"');

    const completeButton = await screen.findByRole("button", {
      name: COMPLETE_REFINEMENT_LABEL
    });
    expect(completeButton).toBeDisabled();

    const editorInput = document.querySelector(
      ".review .editor-pane textarea[data-block-id]"
    ) as HTMLTextAreaElement | null;
    expect(editorInput).not.toBeNull();
    if (!editorInput) return;

    fireEvent.input(editorInput, {
      target: { value: "Review summary" }
    });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: COMPLETE_REFINEMENT_LABEL })
      ).toBeEnabled();
    });
  });

  it("preserves review queue FIFO order across app restart", async () => {
    const firstRender = render(() => <App />);
    const user = userEvent.setup();
    await user.click(getModeControl("Capture"));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    await user.type(captureInput, "First thread");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    await user.type(captureInput, "Second thread");
    await user.click(screen.getByRole("button", { name: "Send capture" }));

    await user.click(getModeControl("Review"));
    let queue = await screen.findByRole("navigation", { name: REFINE_QUEUE_LABEL });
    let queueCards = Array.from(queue.querySelectorAll(".review-reference-card"));
    expect(queueCards[0]).toHaveTextContent("First thread");
    expect(queueCards[1]).toHaveTextContent("Second thread");

    firstRender.unmount();

    render(() => <App />);
    await user.click(getModeControl("Review"));

    queue = await screen.findByRole("navigation", { name: REFINE_QUEUE_LABEL });
    queueCards = Array.from(queue.querySelectorAll(".review-reference-card"));
    expect(queueCards[0]).toHaveTextContent("First thread");
    expect(queueCards[1]).toHaveTextContent("Second thread");
  });

  it("allows switching editor pages while a review destination is configured", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await user.click(getModeControl("Capture"));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    await user.type(captureInput, "Thread root");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    await user.click(getModeControl("Review"));

    await user.type(await findDestinationSearch(), "Project Atlas");
    await selectDestinationOption(user, 'Create "Project Atlas"');

    await waitFor(() => {
      expect(
        screen.getByText("Project Atlas", { selector: ".editor-pane__title" })
      ).toBeInTheDocument();
    });

    await user.click(getModeControl("Editor"));
    await user.click(getPageOption("Home"));

    await waitFor(() => {
      expect(
        screen.getByText("Home", { selector: ".editor-pane__title" })
      ).toBeInTheDocument();
    });
  });

  it("restores the active review session across app restart when safe", async () => {
    const firstRender = render(() => <App />);
    const user = userEvent.setup();
    await user.click(getModeControl("Capture"));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    await user.type(captureInput, "Thread root");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    await user.click(getModeControl("Review"));

    await user.type(await findDestinationSearch(), "Project Atlas");
    await selectDestinationOption(user, 'Create "Project Atlas"');

    const editorInput = document.querySelector(
      ".review .editor-pane textarea[data-block-id]"
    ) as HTMLTextAreaElement | null;
    expect(editorInput).not.toBeNull();
    if (!editorInput) return;

    fireEvent.input(editorInput, {
      target: { value: "Draft summary" }
    });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: COMPLETE_REFINEMENT_LABEL })
      ).toBeEnabled();
    });

    firstRender.unmount();

    render(() => <App />);
    await user.click(getModeControl("Review"));

    await waitFor(() => {
      expect(
        screen.getByText("Project Atlas", { selector: ".editor-pane__title" })
      ).toBeInTheDocument();
    });
    expect(screen.queryByText("Restored review became stale. Pick a destination again.")).not.toBeInTheDocument();
    expect(screen.getByText("Draft summary")).toBeInTheDocument();
  });

  it("invalidates a restored review session when the destination changed outside the session", async () => {
    const firstRender = render(() => <App />);
    const user = userEvent.setup();
    await user.click(getModeControl("Capture"));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    await user.type(captureInput, "Thread root");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    await user.click(getModeControl("Review"));

    await user.type(await findDestinationSearch(), "Project Atlas");
    await selectDestinationOption(user, 'Create "Project Atlas"');

    const editorInput = document.querySelector(
      ".review .editor-pane textarea[data-block-id]"
    ) as HTMLTextAreaElement | null;
    expect(editorInput).not.toBeNull();
    if (!editorInput) return;

    fireEvent.input(editorInput, {
      target: { value: "Draft summary" }
    });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: COMPLETE_REFINEMENT_LABEL })
      ).toBeEnabled();
    });

    firstRender.unmount();

    const storedPages = JSON.parse(
      window.localStorage.getItem("sandpaper:local:pages") ?? "{}"
    ) as Record<
      string,
      {
        uid: string;
        title: string;
        blocks: Array<{ id: string; text: string; indent: number; block_type?: string }>;
      }
    >;
    storedPages["project-atlas"] = {
      ...storedPages["project-atlas"],
      blocks: [
        {
          id: "external-edit",
          text: "Externally changed summary",
          indent: 0,
          block_type: "text"
        }
      ]
    };
    window.localStorage.setItem("sandpaper:local:pages", JSON.stringify(storedPages));

    render(() => <App />);
    await user.click(getModeControl("Review"));

    expect(
      await screen.findByText("Pick a destination again")
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByPlaceholderText("Search or create a page...")
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Change Destination" })
      ).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: COMPLETE_REFINEMENT_LABEL })).toBeDisabled();
  });

  it("persists review queue FIFO order through the tauri page store", async () => {
    let storedBlocks: Array<{
      uid: string;
      text: string;
      indent: number;
      block_type?: string;
      meta?: unknown;
    }> = [];
    let storedReviewThreadOrder: string[] = [];

    vi.mocked(invoke).mockImplementation((command, payload) => {
      if (command === "list_vaults") {
        return Promise.resolve({
          active_id: "vault-1",
          vaults: [{ id: "vault-1", name: "Vault", path: "/vault" }]
        });
      }
      if (command === "get_active_page") return Promise.resolve("inbox");
      if (command === "list_pages") {
        return Promise.resolve([{ uid: "inbox", title: "Inbox" }]);
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
            blocks: storedBlocks
          });
        }
        return Promise.resolve({
          page_uid: "home",
          title: "Home",
          blocks: [{ uid: "home-1", text: "Home block", indent: 0 }]
        });
      }
      if (command === "save_page_blocks") {
        if (
          payload &&
          typeof payload === "object" &&
          "pageUid" in payload &&
          payload.pageUid === "inbox" &&
          "blocks" in payload &&
          Array.isArray(payload.blocks)
        ) {
          storedBlocks = payload.blocks.map((block) => ({
            uid: String(block.uid),
            text: String(block.text),
            indent: Number(block.indent),
            block_type:
              typeof block.block_type === "string" ? block.block_type : undefined,
            meta: "meta" in block ? block.meta : undefined
          }));
        }
        return Promise.resolve(null);
      }
      if (command === "get_capture_review_thread_order") {
        return Promise.resolve(storedReviewThreadOrder);
      }
      if (command === "set_capture_review_thread_order") {
        if (
          payload &&
          typeof payload === "object" &&
          "order" in payload &&
          Array.isArray(payload.order)
        ) {
          storedReviewThreadOrder = payload.order.map((entry) => String(entry));
        }
        return Promise.resolve(null);
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
      if (command === "refine_queue_summary") {
        return Promise.resolve({ due_count: 0, next_due_at: null });
      }
      if (command === "list_refine_queue_due") return Promise.resolve([]);
      if (command === "write_shadow_markdown") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    (window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> })
      .__TAURI_INTERNALS__ = {};

    const firstRender = render(() => <App />);
    const user = userEvent.setup();
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    await user.type(captureInput, "Older thread");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    await user.type(captureInput, "Newer thread");
    await user.click(screen.getByRole("button", { name: "Send capture" }));

    const olderThread = await screen.findByRole("group", {
      name: "Thread Older thread"
    });
    await user.click(
      within(olderThread).getByRole("button", { name: "Reply to Older thread" })
    );
    await user.type(captureInput, "Older reply");
    await user.click(screen.getByRole("button", { name: "Send capture" }));

    await user.click(getModeControl("Review"));
    let queue = await screen.findByRole("navigation", { name: REFINE_QUEUE_LABEL });
    let queueCards = Array.from(queue.querySelectorAll(".review-reference-card"));
    expect(queueCards[0]).toHaveTextContent("Older thread");
    expect(queueCards[1]).toHaveTextContent("Newer thread");
    expect(storedReviewThreadOrder).toHaveLength(2);

    localStorage.clear();
    firstRender.unmount();

    render(() => <App />);
    await user.click(await screen.findByRole("radio", { name: REFINE_MODE_LABEL }));

    queue = await screen.findByRole("navigation", { name: REFINE_QUEUE_LABEL });
    queueCards = Array.from(queue.querySelectorAll(".review-reference-card"));
    expect(queueCards[0]).toHaveTextContent("Older thread");
    expect(queueCards[1]).toHaveTextContent("Newer thread");
  });

  it("persists hidden inbox thread changes through the tauri page store", async () => {
    vi.mocked(invoke).mockImplementation((command, payload) => {
      if (command === "list_vaults") {
        return Promise.resolve({
          active_id: "vault-1",
          vaults: [{ id: "vault-1", name: "Vault", path: "/vault" }]
        });
      }
      if (command === "get_active_page") return Promise.resolve("inbox");
      if (command === "list_pages") {
        return Promise.resolve([{ uid: "inbox", title: "Inbox" }]);
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
            blocks: []
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
      if (command === "refine_queue_summary") {
        return Promise.resolve({ due_count: 0, next_due_at: null });
      }
      if (command === "list_refine_queue_due") return Promise.resolve([]);
      if (command === "save_page_blocks") return Promise.resolve(null);
      if (command === "write_shadow_markdown") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    (window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> })
      .__TAURI_INTERNALS__ = {};

    render(() => <App />);
    const user = userEvent.setup();
    await user.click(getModeControl("Capture"));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    await user.type(captureInput, "Persisted root");
    await user.click(screen.getByRole("button", { name: "Send capture" }));

    const thread = await screen.findByRole("group", {
      name: "Thread Persisted root"
    });
    await user.click(
      within(thread).getByRole("button", { name: "Reply to Persisted root" })
    );
    await user.type(captureInput, "Persisted reply");
    await user.click(screen.getByRole("button", { name: "Send capture" }));

    const persistedThread = await screen.findByRole("group", {
      name: "Thread Persisted root"
    });
    await user.click(within(persistedThread).getByText("Persisted root"));
    const rootInput = await screen.findByRole("textbox", { name: "Captured item 1" });
    fireEvent.input(rootInput, {
      target: { value: "Edited root" }
    });

    const saveCalls = vi
      .mocked(invoke)
      .mock.calls.filter(([command]) => command === "save_page_blocks");

    expect(saveCalls.length).toBeGreaterThan(0);
    const lastSave = saveCalls[saveCalls.length - 1];
    expect(lastSave?.[1]).toMatchObject({
      pageUid: "inbox",
      page_uid: "inbox",
      blocks: [
        expect.objectContaining({ text: "Edited root", indent: 0 }),
        expect.objectContaining({ text: "Persisted reply", indent: 1 })
      ]
    });
  });

  it("archives a completed review thread and reopens its destination note from archived", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await user.click(getModeControl("Capture"));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    await user.type(captureInput, "Thread root");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    await user.click(getModeControl("Review"));

    const destinationSearch = await findDestinationSearch();
    await user.type(destinationSearch, "Project Atlas");
    await selectDestinationOption(user, 'Create "Project Atlas"');

    const destinationPanel = await screen.findByRole("region", {
      name: "Destination note"
    });
    expect(
      within(destinationPanel).getByText("Project Atlas", {
        selector: ".editor-pane__title"
      })
    ).toBeInTheDocument();

    const editorInput = document.querySelector(
      ".review .editor-pane textarea[data-block-id]"
    ) as HTMLTextAreaElement | null;
    expect(editorInput).not.toBeNull();
    if (!editorInput) return;

    fireEvent.input(editorInput, {
      target: { value: "Project Atlas summary" }
    });

    await user.click(screen.getByRole("button", { name: COMPLETE_REFINEMENT_LABEL }));

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /thread root/i })
      ).not.toBeInTheDocument();
    });

    await user.click(getReviewTabControl("Archived"));
    expect(
      await screen.findByRole("button", { name: /thread root/i })
    ).toBeInTheDocument();
    expect(
      screen.getByText("Project Atlas", { selector: ".editor-pane__title" })
    ).toBeInTheDocument();
  });

  it("reopens each archived thread in its own destination note", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await user.click(getModeControl("Capture"));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    await user.type(captureInput, "Alpha thread");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    await user.type(captureInput, "Beta thread");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    await user.click(getModeControl("Review"));

    const destinationSearch = await findDestinationSearch();
    await user.type(destinationSearch, "Project Atlas");
    await selectDestinationOption(user, 'Create "Project Atlas"');
    let editorInput = document.querySelector(
      ".review .editor-pane textarea[data-block-id]"
    ) as HTMLTextAreaElement | null;
    expect(editorInput).not.toBeNull();
    if (!editorInput) return;
    fireEvent.input(editorInput, {
      target: { value: "Alpha summary" }
    });
    await user.click(screen.getByRole("button", { name: COMPLETE_REFINEMENT_LABEL }));

    await waitFor(() => {
      expect(
        screen.getByText("Beta thread")
      ).toBeInTheDocument();
    });

    await user.clear(getDestinationSearch());
    await user.type(getDestinationSearch(), "Research Note");
    await selectDestinationOption(user, 'Create "Research Note"');
    editorInput = document.querySelector(
      ".review .editor-pane textarea[data-block-id]"
    ) as HTMLTextAreaElement | null;
    expect(editorInput).not.toBeNull();
    if (!editorInput) return;
    fireEvent.input(editorInput, {
      target: { value: "Beta summary" }
    });
    await user.click(screen.getByRole("button", { name: COMPLETE_REFINEMENT_LABEL }));

    const archivedStorageKey = Array.from({ length: window.localStorage.length }, (_, index) =>
      window.localStorage.key(index)
    ).find((key): key is string => Boolean(key?.startsWith("sandpaper:refine:archived-threads:")));
    expect(archivedStorageKey).toBeTruthy();
    if (!archivedStorageKey) return;

    const archivedSnapshots = JSON.parse(
      window.localStorage.getItem(archivedStorageKey) ?? "[]"
    ) as Array<{ root_text: string; destination_title?: string }>;
    expect(archivedSnapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          root_text: "Alpha thread",
          destination_title: "Project Atlas"
        }),
        expect.objectContaining({
          root_text: "Beta thread",
          destination_title: "Research Note"
        })
      ])
    );

    await user.click(getReviewTabControl("Archived"));

    await user.click(await screen.findByRole("button", { name: /alpha thread/i }));
    await waitFor(() => {
      expect(
        screen.getByText("Project Atlas", { selector: ".editor-pane__title" })
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /beta thread/i }));
    await waitFor(() => {
      expect(
        screen.getByText("Research Note", { selector: ".editor-pane__title" })
      ).toBeInTheDocument();
    });
  });

  it("opens an existing destination page from review search", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await user.click(getModeControl("Capture"));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    await user.type(captureInput, "Thread root");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    await user.click(getModeControl("Review"));

    const destinationSearch = await findDestinationSearch();
    await user.type(destinationSearch, "Home");
    await selectDestinationOption(user, "Open Home");

    const destinationPanel = await screen.findByRole("region", {
      name: "Destination note"
    });
    expect(
      within(destinationPanel).getByText("Home", {
        selector: ".editor-pane__title"
      })
    ).toBeInTheDocument();
  });

});
