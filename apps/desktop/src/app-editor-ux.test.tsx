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

import App from "./app/app";

describe("App editor UX", () => {
  beforeEach(() => {
    localStorage.clear();
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
    await user.clear(capturedItemInput);
    await user.type(capturedItemInput, "Quick note updated");

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
    expect(screen.getByText("Replying to Root post")).toBeInTheDocument();

    await user.type(captureInput, "Follow up");
    await user.click(screen.getByRole("button", { name: "Send capture" }));

    const updatedThread = await screen.findByRole("group", {
      name: "Thread Root post"
    });
    expect(within(updatedThread).getByDisplayValue("Follow up")).toBeInTheDocument();
    expect(screen.getByText("Replying to Root post")).toBeInTheDocument();
  });

  it("bumps a thread to the top when it receives a new reply", async () => {
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
    expect(threads[0]).toHaveAttribute("aria-label", "Thread Older thread");
    expect(within(threads[0] as HTMLElement).getByDisplayValue("Older reply")).toBeInTheDocument();
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
    const queueButtons = within(queue).getAllByRole("button");
    expect(queueButtons[0]).toHaveTextContent("Older thread");
    expect(queueButtons[1]).toHaveTextContent("Newer thread");

    expect(
      screen.getByRole("heading", { name: "Capture thread" })
    ).toBeInTheDocument();
    expect(screen.getByText("Older reply")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Destination note" })
    ).toBeInTheDocument();
  });

});
