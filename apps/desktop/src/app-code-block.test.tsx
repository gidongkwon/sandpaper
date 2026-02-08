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

vi.mock("./shared/lib/markdown/shiki-highlight", () => ({
  highlightCodeWithShiki: vi.fn(async (code: string, lang: string) => {
    const lines = code.split(/\r?\n/u);
    const renderedLines = lines
      .map((line, index) => {
        const prefix = index === 0 ? `${lang}:` : "";
        return `<span class="line">${prefix}${line}</span>`;
      })
      .join("");
    return `<pre class="shiki"><code>${renderedLines}</code></pre>`;
  })
}));

import App from "./app/app";

describe("App code block preview", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    delete (window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> })
      .__TAURI_INTERNALS__;
    vi.restoreAllMocks();
  });

  it("shows highlighted code, supports searchable language combobox, and copies content", async () => {
    const user = userEvent.setup();

    render(() => <App />);
    await screen.findByText(/saved/i);
    const inputs = await screen.findAllByPlaceholderText("Write something...");
    const firstInput = inputs[0] as HTMLTextAreaElement;
    const blockId = firstInput.dataset.blockId;
    expect(blockId).toBeTruthy();
    if (!blockId) return;

    fireEvent.input(firstInput, {
      target: { value: "```js console.log('hi')" }
    });
    fireEvent.blur(firstInput);

    const getPreview = () =>
      document.querySelector(
        `.block[data-block-id="${blockId}"] .block-renderer--code`
      ) as HTMLElement | null;
    await waitFor(() => {
      expect(getPreview()).not.toBeNull();
    });
    const langSelect = within(getPreview() as HTMLElement).getByRole("combobox", {
      name: "Code language"
    }) as HTMLInputElement;
    expect(getPreview()?.querySelector(".block-renderer__badge")).toBeNull();
    expect(
      within(getPreview() as HTMLElement).queryByText("Code preview")
    ).toBeNull();

    expect(langSelect).toHaveValue("JavaScript");

    fireEvent.focus(langSelect);
    expect(langSelect).toHaveAttribute("aria-expanded", "true");
    fireEvent.input(langSelect, { target: { value: "type" } });
    expect(langSelect).toHaveValue("type");
    fireEvent.blur(langSelect);
    await waitFor(() => {
      const refreshedPreview = getPreview();
      expect(refreshedPreview).not.toBeNull();
      if (!refreshedPreview) return;
      const refreshedSelect = within(refreshedPreview).getByRole("combobox", {
        name: "Code language"
      });
      expect(refreshedSelect).toHaveValue("JavaScript");
      expect(refreshedPreview).toHaveTextContent("js:console.log('hi')");
    });

    const refreshedPreview = getPreview();
    expect(refreshedPreview).not.toBeNull();
    if (!refreshedPreview) return;
    const copyButton = within(refreshedPreview).getByRole("button", {
      name: /copy/i
    });
    await user.click(copyButton);

    await waitFor(() => {
      expect(copyButton).toHaveTextContent("Copied");
    });
  });

  it("keeps code preview display mode on click and exposes an explicit Edit control", async () => {
    const user = userEvent.setup();

    render(() => <App />);
    await screen.findByText(/saved/i);
    const inputs = await screen.findAllByPlaceholderText("Write something...");
    const firstInput = inputs[0] as HTMLTextAreaElement;
    const blockId = firstInput.dataset.blockId;
    expect(blockId).toBeTruthy();
    if (!blockId) return;

    fireEvent.input(firstInput, {
      target: { value: "```ts const sample = 42;" }
    });
    fireEvent.blur(firstInput);

    const getPreview = () =>
      document.querySelector(
        `.block[data-block-id="${blockId}"] .block-renderer--code`
      ) as HTMLElement | null;
    await waitFor(() => {
      expect(getPreview()).not.toBeNull();
    });
    const editorInput = document.querySelector(
      `textarea[data-block-id="${blockId}"]`
    ) as HTMLTextAreaElement | null;
    expect(editorInput).not.toBeNull();
    if (!editorInput) return;
    expect(editorInput.style.display).toBe("none");

    const codeBody = getPreview()?.querySelector(
      ".block-renderer__line-content"
    ) as HTMLElement | null;
    expect(codeBody).not.toBeNull();
    if (!codeBody) return;
    await user.click(codeBody);
    expect(editorInput.style.display).toBe("none");

    const refreshedPreview = getPreview();
    expect(refreshedPreview).not.toBeNull();
    if (!refreshedPreview) return;
    const editButton = within(refreshedPreview).getByRole("button", {
      name: "Edit code"
    });
    expect(editButton).toBeInTheDocument();
    fireEvent.click(editButton);
  });

  it("renders line-number rows that stay aligned with multiline code", async () => {
    render(() => <App />);
    await screen.findByText(/saved/i);
    const inputs = await screen.findAllByPlaceholderText("Write something...");
    const firstInput = inputs[0] as HTMLTextAreaElement;
    const blockId = firstInput.dataset.blockId;
    expect(blockId).toBeTruthy();
    if (!blockId) return;

    fireEvent.input(firstInput, {
      target: { value: "```js\nconsole.log('hi')\nconsole.log('bye')\n```" }
    });
    fireEvent.blur(firstInput);

    const preview = await waitFor(() => {
      const targetPreview = document.querySelector(
        `.block[data-block-id="${blockId}"] .block-renderer--code`
      ) as HTMLElement | null;
      expect(targetPreview).not.toBeNull();
      return targetPreview as HTMLElement;
    });
    expect(preview).not.toBeNull();

    await waitFor(() => {
      expect(preview.querySelectorAll(".block-renderer__code-line")).toHaveLength(2);
    });
    const lines = preview.querySelectorAll(".block-renderer__code-line");
    expect(lines).toHaveLength(2);
    const firstLineNumber = lines[0]?.querySelector(".block-renderer__line-number");
    const secondLineNumber = lines[1]?.querySelector(".block-renderer__line-number");
    expect(firstLineNumber).toHaveTextContent("1");
    expect(secondLineNumber).toHaveTextContent("2");
    expect(firstLineNumber).toHaveAttribute("aria-hidden", "true");
    expect(secondLineNumber).toHaveAttribute("aria-hidden", "true");
  });
});
