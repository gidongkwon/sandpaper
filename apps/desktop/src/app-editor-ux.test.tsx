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
import { formatReviewDate } from "./pages/main-page/model/review-utils";

describe("App editor UX", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(invoke).mockReset();
  });

  afterEach(() => {
    delete (window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> })
      .__TAURI_INTERNALS__;
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

  it("shows slash command menu and inserts command text", async () => {
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
    await user.click(menuScope.getByRole("button", { name: "Link to page" }));
    await waitFor(() => {
      expect(getInput()?.value).toContain("[[Page]]");
    });

    fireEvent.input(getInput() as HTMLTextAreaElement, {
      target: { value: `${getInput()?.value ?? ""}/` }
    });
    const menuAgain = await screen.findByText("Commands");
    const menuAgainScope = within(menuAgain.closest(".slash-menu") as HTMLElement);
    await user.click(menuAgainScope.getByRole("button", { name: "Insert date" }));
    await waitFor(() => {
      expect(getInput()?.value).toMatch(/\d{4}-\d{2}-\d{2}/);
    });

    fireEvent.input(getInput() as HTMLTextAreaElement, { target: { value: "/" } });
    const menuHeading = await screen.findByText("Commands");
    const menuHeadingScope = within(menuHeading.closest(".slash-menu") as HTMLElement);
    await user.click(menuHeadingScope.getByRole("button", { name: "Heading 1" }));
    await waitFor(() => {
      expect((getInput()?.value ?? "").startsWith("# ")).toBe(true);
    });

    fireEvent.input(getInput() as HTMLTextAreaElement, { target: { value: "Follow up" } });
    fireEvent.input(getInput() as HTMLTextAreaElement, { target: { value: "Follow up/" } });
    const menuTask = await screen.findByText("Commands");
    const menuTaskScope = within(menuTask.closest(".slash-menu") as HTMLElement);
    await user.click(menuTaskScope.getByRole("button", { name: "To-do" }));
    await waitFor(() => {
      expect((getInput()?.value ?? "").startsWith("- [ ] ")).toBe(true);
    });

    fireEvent.input(getInput() as HTMLTextAreaElement, { target: { value: "/" } });
    const menuCode = await screen.findByText("Commands");
    const menuCodeScope = within(menuCode.closest(".slash-menu") as HTMLElement);
    await user.click(menuCodeScope.getByRole("button", { name: "Code block" }));
    await waitFor(() => {
      expect((getInput()?.value ?? "").startsWith("```")).toBe(true);
    });

    fireEvent.input(getInput() as HTMLTextAreaElement, { target: { value: "/" } });
    const menuTable = await screen.findByText("Commands");
    const menuTableScope = within(menuTable.closest(".slash-menu") as HTMLElement);
    await user.click(menuTableScope.getByRole("button", { name: "Table" }));
    await waitFor(() => {
      expect(getInput()?.value).toContain("| --- | --- |");
    });

    fireEvent.input(getInput() as HTMLTextAreaElement, { target: { value: "/" } });
    const menuOrdered = await screen.findByText("Commands");
    const menuOrderedScope = within(menuOrdered.closest(".slash-menu") as HTMLElement);
    await user.click(menuOrderedScope.getByRole("button", { name: "Numbered list" }));
    await waitFor(() => {
      expect((getInput()?.value ?? "").startsWith("1. ")).toBe(true);
    });

    fireEvent.input(getInput() as HTMLTextAreaElement, { target: { value: "/" } });
    const menuBookmark = await screen.findByText("Commands");
    const menuBookmarkScope = within(menuBookmark.closest(".slash-menu") as HTMLElement);
    await user.click(menuBookmarkScope.getByRole("button", { name: "Bookmark" }));
    await waitFor(() => {
      expect((getInput()?.value ?? "").startsWith("https://")).toBe(true);
    });

    fireEvent.input(getInput() as HTMLTextAreaElement, { target: { value: "/" } });
    const menuMath = await screen.findByText("Commands");
    const menuMathScope = within(menuMath.closest(".slash-menu") as HTMLElement);
    await user.click(menuMathScope.getByRole("button", { name: "Math" }));
    await waitFor(() => {
      expect(getInput()?.value).toContain("$$");
    });

    fireEvent.input(getInput() as HTMLTextAreaElement, { target: { value: "/" } });
    const menuToc = await screen.findByText("Commands");
    const menuTocScope = within(menuToc.closest(".slash-menu") as HTMLElement);
    await user.click(menuTocScope.getByRole("button", { name: "Table of contents" }));
    await waitFor(() => {
      expect((getInput()?.value ?? "").trim()).toBe("[TOC]");
    });

    fireEvent.input(getInput() as HTMLTextAreaElement, { target: { value: "/" } });
    const menuDatabase = await screen.findByText("Commands");
    const menuDatabaseScope = within(menuDatabase.closest(".slash-menu") as HTMLElement);
    await user.click(menuDatabaseScope.getByRole("button", { name: "Database view" }));
    await waitFor(() => {
      expect((getInput()?.value ?? "").startsWith("```database")).toBe(true);
    });
  });

  it("does not show the old block hover toolbar actions", async () => {
    render(() => <App />);
    await screen.findByText(/saved/i);
    expect(screen.queryByRole("button", { name: "Insert block below" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add to review" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Link to page" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Duplicate block" })).toBeNull();
  });

  it("keeps quick capture open and refocuses composer after sending", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Capture" }));
    const captureInput = screen.getByPlaceholderText(
      "Capture a thought, link, or task..."
    ) as HTMLTextAreaElement;
    await user.type(captureInput, "Quick note");
    fireEvent.keyDown(captureInput, { key: "Enter" });

    await waitFor(() => {
      expect(captureInput.value).toBe("");
      expect(document.activeElement).toBe(captureInput);
    });
    expect(screen.getByRole("button", { name: "Capture" })).toHaveClass(
      "is-active"
    );
    expect(await screen.findByDisplayValue("Quick note")).toBeInTheDocument();
  });

  it("keeps edited captures in the hidden inbox when returning to editor", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await screen.findByText(/saved/i);
    await user.click(screen.getByRole("button", { name: "Capture" }));
    const captureInput = screen.getByPlaceholderText(
      "Capture a thought, link, or task..."
    );
    await user.type(captureInput, "Quick note");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    await waitFor(() => {
      expect(document.activeElement).toBe(captureInput);
    });

    const capturedItemInput = (await screen.findByRole("textbox", {
      name: "Captured item 1"
    })) as HTMLTextAreaElement;
    await user.click(capturedItemInput);
    fireEvent.input(capturedItemInput, {
      target: { value: "Quick note updated" }
    });

    await user.click(screen.getByRole("button", { name: "Editor" }));
    expect(
      await screen.findByText("Home", { selector: ".editor-pane__title" })
    ).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Quick note updated")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Capture" }));
    expect(
      await screen.findByRole("textbox", { name: "Captured item 1" })
    ).toHaveValue("Quick note updated");
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

    expect(screen.queryByRole("button", { name: "Open Inbox" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Capture" }));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;
    await user.type(captureInput, "Quick note");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    expect(await screen.findByDisplayValue("Quick note")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Editor" }));

    expect(
      await screen.findByText("Project Atlas", { selector: ".editor-pane__title" })
    ).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Quick note")).not.toBeInTheDocument();
  });

  it("routes hidden inbox wikilinks to capture mode instead of opening inbox in editor", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await screen.findByText(/saved/i);

    await user.click(screen.getByRole("button", { name: "Capture" }));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;
    await user.type(captureInput, "Inbox thread");
    await user.click(screen.getByRole("button", { name: "Send capture" }));

    await user.click(screen.getByRole("button", { name: "Editor" }));
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
    fireEvent.keyDown(editorInput, { key: "Escape" });

    const inboxLink = await screen.findByRole("button", { name: "Inbox" });
    await user.click(inboxLink);

    expect(screen.getByRole("button", { name: "Capture" })).toHaveClass("is-active");
    expect(
      await screen.findByPlaceholderText("Capture a thought, link, or task...")
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("Inbox thread")).toBeInTheDocument();
    expect(
      screen.queryByText("Inbox", { selector: ".editor-pane__title" })
    ).not.toBeInTheDocument();
  });

  it("reuses the shared composer for replies and keeps reply mode active", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Capture" }));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    await user.type(captureInput, "Root post");
    await user.click(screen.getByRole("button", { name: "Send capture" }));

    const thread = await screen.findByRole("group", { name: "Thread Root post" });
    await user.click(
      within(thread).getByRole("button", { name: "Reply to Root post" })
    );
    expect(screen.getByText("Replying to")).toBeInTheDocument();
    expect(screen.getByText("Root post")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel reply" })).toBeInTheDocument();
    expect(screen.getByText("Esc")).toBeInTheDocument();

    await user.type(captureInput, "Follow up");
    await user.click(screen.getByRole("button", { name: "Send capture" }));

    const updatedThread = await screen.findByRole("group", {
      name: "Thread Root post"
    });
    expect(within(updatedThread).getByDisplayValue("Follow up")).toBeInTheDocument();
    expect(
      within(updatedThread).getAllByText(/\d{1,2}:\d{2} [AP]M|Now/)
    ).toHaveLength(2);
    expect(screen.getByText("Replying to")).toBeInTheDocument();
    expect(screen.getByText("Root post")).toBeInTheDocument();
  });

  it("moves an active thread to the bottom when it receives a new reply", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Capture" }));
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
    expect(within(lastThread).getByDisplayValue("Older reply")).toBeInTheDocument();
  });

  it("confirms before deleting a reply", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Capture" }));
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

    const dialog = await screen.findByRole("dialog", { name: "Delete reply" });
    expect(dialog).toHaveTextContent("Reply post");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(
        screen.queryByDisplayValue("Reply post")
      ).not.toBeInTheDocument();
    });
    expect(screen.getByDisplayValue("Root post")).toBeInTheDocument();
  });

  it("confirms before deleting a thread root and removes the whole thread", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Capture" }));
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

    const dialog = await screen.findByRole("dialog", { name: "Delete thread" });
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
    await user.click(screen.getByRole("button", { name: "Capture" }));
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

    await user.click(screen.getByRole("button", { name: "Review" }));

    const queue = await screen.findByRole("navigation", { name: "Review queue" });
    const queueCards = Array.from(queue.querySelectorAll(".review-reference-card"));
    expect(queueCards[0]).toHaveTextContent("Older thread");
    expect(queueCards[1]).toHaveTextContent("Newer thread");

    expect(screen.getByText("Older reply")).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Destination note" })
    ).toBeInTheDocument();
  });

  it("shows review tabs and keeps the destination editor visible", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Capture" }));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    await user.type(captureInput, "Thread root");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    await user.click(screen.getByRole("button", { name: "Review" }));

    expect(
      await screen.findByRole("tab", { name: "To Review" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Archived" })
    ).toBeInTheDocument();
    expect(
      screen.getByText("Thread root")
    ).toBeInTheDocument();
    expect(screen.getByText("Home", { selector: ".editor-pane__title" })).toBeInTheDocument();
  });

  it("shows each review thread with a captured time range", async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(() => <App />);
    await user.click(screen.getByRole("button", { name: "Capture" }));
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

    await user.click(screen.getByRole("button", { name: "Review" }));

    expect(
      await screen.findByText(
        `Captured ${formatReviewDate(capturedStart.getTime())} - ${formatReviewDate(capturedEnd.getTime())}`
      )
    ).toBeInTheDocument();
  });

  it("preloads a recommended destination inside the review workbench", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Capture" }));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    await user.type(captureInput, "Home follow up");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    await user.click(screen.getByRole("button", { name: "Review" }));

    const destinationPanel = await screen.findByRole("region", {
      name: "Destination note"
    });
    expect(
      within(destinationPanel).getByText("Home", {
        selector: ".editor-pane__title"
      })
    ).toBeInTheDocument();
    expect(within(destinationPanel).getByText("Recommended")).toBeInTheDocument();
    expect(
      within(destinationPanel).getByPlaceholderText("Search or create a page...")
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "To Review" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByRole("tab", { name: "Archived" })).toBeInTheDocument();
  });

  it("keeps review completion disabled until the destination note changes", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Capture" }));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    await user.type(captureInput, "Thread root");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    await user.click(screen.getByRole("button", { name: "Review" }));

    await user.type(
      await screen.findByPlaceholderText("Search or create a page..."),
      "Project Atlas"
    );
    await user.click(
      screen.getByRole("button", { name: 'Create "Project Atlas"' })
    );

    const completeButton = await screen.findByRole("button", {
      name: "Complete review"
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
        screen.getByRole("button", { name: "Complete review" })
      ).toBeEnabled();
    });
  });

  it("preserves review queue FIFO order across app restart", async () => {
    const firstRender = render(() => <App />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Capture" }));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    await user.type(captureInput, "First thread");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    await user.type(captureInput, "Second thread");
    await user.click(screen.getByRole("button", { name: "Send capture" }));

    await user.click(screen.getByRole("button", { name: "Review" }));
    let queue = await screen.findByRole("navigation", { name: "Review queue" });
    let queueCards = Array.from(queue.querySelectorAll(".review-reference-card"));
    expect(queueCards[0]).toHaveTextContent("First thread");
    expect(queueCards[1]).toHaveTextContent("Second thread");

    firstRender.unmount();

    render(() => <App />);
    await user.click(screen.getByRole("button", { name: "Review" }));

    queue = await screen.findByRole("navigation", { name: "Review queue" });
    queueCards = Array.from(queue.querySelectorAll(".review-reference-card"));
    expect(queueCards[0]).toHaveTextContent("First thread");
    expect(queueCards[1]).toHaveTextContent("Second thread");
  });

  it("persists review queue FIFO order through the tauri page store", async () => {
    let storedBlocks: Array<{ uid: string; text: string; indent: number }> = [];
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
            indent: Number(block.indent)
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
      if (command === "review_queue_summary") {
        return Promise.resolve({ due_count: 0, next_due_at: null });
      }
      if (command === "list_review_queue_due") return Promise.resolve([]);
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

    await user.click(screen.getByRole("button", { name: "Review" }));
    let queue = await screen.findByRole("navigation", { name: "Review queue" });
    let queueCards = Array.from(queue.querySelectorAll(".review-reference-card"));
    expect(queueCards[0]).toHaveTextContent("Older thread");
    expect(queueCards[1]).toHaveTextContent("Newer thread");
    expect(storedReviewThreadOrder).toHaveLength(2);

    localStorage.clear();
    firstRender.unmount();

    render(() => <App />);
    await user.click(await screen.findByRole("button", { name: "Review" }));

    queue = await screen.findByRole("navigation", { name: "Review queue" });
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
      if (command === "review_queue_summary") {
        return Promise.resolve({ due_count: 0, next_due_at: null });
      }
      if (command === "list_review_queue_due") return Promise.resolve([]);
      if (command === "save_page_blocks") return Promise.resolve(null);
      if (command === "write_shadow_markdown") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    (window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> })
      .__TAURI_INTERNALS__ = {};

    render(() => <App />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Capture" }));
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

    const rootInput = screen.getByDisplayValue("Persisted root");
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
    await user.click(screen.getByRole("button", { name: "Capture" }));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    await user.type(captureInput, "Thread root");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    await user.click(screen.getByRole("button", { name: "Review" }));

    const destinationSearch = await screen.findByPlaceholderText(
      "Search or create a page..."
    );
    await user.type(destinationSearch, "Project Atlas");
    await user.click(
      screen.getByRole("button", { name: 'Create "Project Atlas"' })
    );

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

    await user.click(
      within(destinationPanel).getByRole("button", { name: "Complete review" })
    );

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /thread root/i })
      ).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("tab", { name: "Archived" }));
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
    await user.click(screen.getByRole("button", { name: "Capture" }));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    await user.type(captureInput, "Alpha thread");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    await user.type(captureInput, "Beta thread");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    await user.click(screen.getByRole("button", { name: "Review" }));

    const destinationSearch = await screen.findByPlaceholderText(
      "Search or create a page..."
    );
    await user.type(destinationSearch, "Project Atlas");
    await user.click(
      screen.getByRole("button", { name: 'Create "Project Atlas"' })
    );
    let editorInput = document.querySelector(
      ".review .editor-pane textarea[data-block-id]"
    ) as HTMLTextAreaElement | null;
    expect(editorInput).not.toBeNull();
    if (!editorInput) return;
    fireEvent.input(editorInput, {
      target: { value: "Alpha summary" }
    });
    await user.click(screen.getByRole("button", { name: "Complete review" }));

    await waitFor(() => {
      expect(
        screen.getByText("Beta thread")
      ).toBeInTheDocument();
    });

    await user.clear(screen.getByPlaceholderText("Search or create a page..."));
    await user.type(screen.getByPlaceholderText("Search or create a page..."), "Research Note");
    await user.click(
      screen.getByRole("button", { name: 'Create "Research Note"' })
    );
    editorInput = document.querySelector(
      ".review .editor-pane textarea[data-block-id]"
    ) as HTMLTextAreaElement | null;
    expect(editorInput).not.toBeNull();
    if (!editorInput) return;
    fireEvent.input(editorInput, {
      target: { value: "Beta summary" }
    });
    await user.click(screen.getByRole("button", { name: "Complete review" }));

    const archivedStorageKey = Array.from({ length: window.localStorage.length }, (_, index) =>
      window.localStorage.key(index)
    ).find((key): key is string => Boolean(key?.startsWith("sandpaper:review:archived-threads:")));
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

    await user.click(screen.getByRole("tab", { name: "Archived" }));

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
    await user.click(screen.getByRole("button", { name: "Capture" }));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    await user.type(captureInput, "Thread root");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    await user.click(screen.getByRole("button", { name: "Review" }));

    const destinationSearch = await screen.findByPlaceholderText(
      "Search or create a page..."
    );
    await user.type(destinationSearch, "Home");
    await user.click(screen.getByRole("button", { name: "Open Home" }));

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
