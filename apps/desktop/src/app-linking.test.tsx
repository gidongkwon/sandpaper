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

describe("App linking UX", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    delete (window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> })
      .__TAURI_INTERNALS__;
    vi.restoreAllMocks();
  });

  it("suggests pages on [[ and inserts the selected link", async () => {
    const user = userEvent.setup();
    render(() => <App />);
    await screen.findByText(/saved/i);
    const inputs = await screen.findAllByPlaceholderText("Write something...");
    const firstInput = inputs[0] as HTMLTextAreaElement;
    const displayText = await screen.findByText("Sandpaper outline prototype");
    await user.click(displayText.closest(".block__display") as HTMLElement);
    await waitFor(() => {
      expect(document.activeElement).toBe(firstInput);
    });

    fireEvent.input(firstInput, { target: { value: "[[" } });
    const menu = await screen.findByRole("listbox", {
      name: /wikilink suggestions/i
    });
    const menuScope = within(menu);
    await user.click(menuScope.getByRole("button", { name: "Inbox" }));
    await waitFor(() => {
      expect(firstInput.value).toContain("[[Inbox]]");
    });
  });

  it("creates a new page from the wikilink menu", async () => {
    const user = userEvent.setup();
    render(() => <App />);
    await screen.findByText(/saved/i);
    const inputs = await screen.findAllByPlaceholderText("Write something...");
    const firstInput = inputs[0] as HTMLTextAreaElement;
    const displayText = await screen.findByText("Sandpaper outline prototype");
    await user.click(displayText.closest(".block__display") as HTMLElement);
    await waitFor(() => {
      expect(document.activeElement).toBe(firstInput);
    });

    fireEvent.input(firstInput, { target: { value: "[[Project Orbit" } });
    const menu = await screen.findByRole("listbox", {
      name: /wikilink suggestions/i
    });
    const menuScope = within(menu);
    await user.click(
      menuScope.getByRole("button", { name: /create page "Project Orbit"/i })
    );

    await waitFor(() => {
      expect(firstInput.value).toContain("[[Project Orbit]]");
    });
    expect(
      screen.getByRole("button", { name: "Open Project Orbit" })
    ).toBeInTheDocument();
  });

  it("updates wikilinks when renaming a page", async () => {
    const user = userEvent.setup();
    render(() => <App />);
    await screen.findByText(/saved/i);
    await user.click(
      screen.getByRole("button", { name: /create new page/i })
    );
    const createDialog = await screen.findByRole("dialog", {
      name: "New page title"
    });
    const createInput = within(createDialog).getByRole("textbox");
    await user.type(createInput, "Project Atlas");
    await user.click(
      within(createDialog).getByRole("button", { name: "Create" })
    );
    await screen.findByText("Project Atlas", { selector: ".editor-pane__title" });

    const atlasInputs = await screen.findAllByPlaceholderText("Write something...");
    fireEvent.input(atlasInputs[0] as HTMLTextAreaElement, {
      target: { value: "Alpha" }
    });
    fireEvent.keyDown(atlasInputs[0], { key: "Enter" });
    const atlasInputsAfter = await screen.findAllByPlaceholderText("Write something...");
    fireEvent.input(atlasInputsAfter[1] as HTMLTextAreaElement, {
      target: { value: "Beta" }
    });

    await user.click(screen.getByRole("button", { name: "Open Inbox" }));
    await screen.findByText("Inbox", { selector: ".editor-pane__title" });
    const inboxInputs = await screen.findAllByPlaceholderText("Write something...");
    fireEvent.input(inboxInputs[0] as HTMLTextAreaElement, {
      target: {
        value: "See [[Project Atlas]] and [[Project Atlas|Alias]] soon."
      }
    });

    await user.click(screen.getByRole("button", { name: "Open Project Atlas" }));
    await screen.findByText("Project Atlas", { selector: ".editor-pane__title" });
    await user.click(screen.getByRole("button", { name: "Rename" }));
    const renameDialog = await screen.findByRole("dialog", {
      name: "Rename page"
    });
    const renameInput = within(renameDialog).getByRole("textbox");
    await user.clear(renameInput);
    await user.type(renameInput, "Project Nova");
    await user.click(
      within(renameDialog).getByRole("button", { name: "Rename" })
    );
    await screen.findByText("Project Nova", { selector: ".editor-pane__title" });

    await user.click(screen.getByRole("button", { name: "Open Inbox" }));
    await screen.findByText("Inbox", { selector: ".editor-pane__title" });
    const inboxInputsAfter = await screen.findAllByPlaceholderText("Write something...");
    await waitFor(() => {
      expect((inboxInputsAfter[0] as HTMLTextAreaElement).value).toContain(
        "[[Project Nova]]"
      );
    });
    expect((inboxInputsAfter[0] as HTMLTextAreaElement).value).toContain(
      "[[Project Nova|Alias]]"
    );
  });

  it("shows a link preview on hover with the top blocks", async () => {
    const user = userEvent.setup();
    render(() => <App />);
    await screen.findByText(/saved/i);
    await user.click(
      screen.getByRole("button", { name: /create new page/i })
    );
    const dialog = await screen.findByRole("dialog", { name: "New page title" });
    const input = within(dialog).getByRole("textbox");
    await user.type(input, "Preview Page");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await screen.findByText("Preview Page", { selector: ".editor-pane__title" });

    const previewInputs = await screen.findAllByPlaceholderText("Write something...");
    fireEvent.input(previewInputs[0] as HTMLTextAreaElement, {
      target: { value: "First block" }
    });
    fireEvent.keyDown(previewInputs[0], { key: "Enter" });
    const previewInputsAfter = await screen.findAllByPlaceholderText("Write something...");
    fireEvent.input(previewInputsAfter[1] as HTMLTextAreaElement, {
      target: { value: "Second block" }
    });

    await user.click(screen.getByRole("button", { name: "Open Inbox" }));
    await screen.findByText("Inbox", { selector: ".editor-pane__title" });
    const inboxInputs = await screen.findAllByPlaceholderText("Write something...");
    fireEvent.input(inboxInputs[0] as HTMLTextAreaElement, {
      target: { value: "Jump to [[Preview Page]]" }
    });

    const wikilink = await screen.findByRole("button", { name: "Preview Page" });
    fireEvent.mouseEnter(wikilink);
    const preview = await screen.findByRole("dialog", { name: /link preview/i });
    expect(preview).toHaveTextContent("First block");
    expect(preview).toHaveTextContent("Second block");
    expect(within(preview).getByRole("button", { name: "Open" })).toBeInTheDocument();
  });
});
