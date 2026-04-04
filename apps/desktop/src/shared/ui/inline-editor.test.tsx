import { fireEvent, render, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { InlineEditor } from "./inline-editor";

describe("InlineEditor", () => {
  it("auto-resizes on input and keeps the shared inline editor class", async () => {
    render(() => <InlineEditor aria-label="Inline note" value="" />);

    const textarea = screen.getByRole("textbox", { name: "Inline note" });
    expect(textarea.className).toContain("ui-inline-editor");

    Object.defineProperty(textarea, "scrollHeight", {
      configurable: true,
      value: 84
    });

    await fireEvent.input(textarea, { target: { value: "Hello" } });

    expect(textarea).toHaveStyle({ height: "84px" });
  });

  it("renders markdown while blurred and switches to raw markdown while editing", async () => {
    const user = userEvent.setup();
    const { container } = render(() => (
      <InlineEditor
        aria-label="Inline note"
        value="Read [Docs](https://example.com) and **ship** it"
        displayMode="markdown"
      />
    ));

    expect(screen.queryByRole("textbox", { name: "Inline note" })).toBeNull();
    expect(screen.getByRole("link", { name: "Docs" })).toHaveAttribute(
      "href",
      "https://example.com"
    );
    expect(screen.getByText("ship").tagName.toLowerCase()).toBe("strong");

    const display = container.querySelector(".ui-inline-editor--display");
    expect(display).not.toBeNull();

    await user.click(display as HTMLElement);

    const textarea = screen.getByRole("textbox", { name: "Inline note" });
    expect(textarea).toHaveValue("Read [Docs](https://example.com) and **ship** it");

    fireEvent.blur(textarea);

    expect(screen.queryByRole("textbox", { name: "Inline note" })).toBeNull();
    expect(screen.getByRole("link", { name: "Docs" })).toBeInTheDocument();
  });

  it("returns to rendered mode when pressing Escape while editing markdown", async () => {
    const user = userEvent.setup();
    render(() => {
      const [value, setValue] = createSignal("Hello **world**");
      return (
        <InlineEditor
          aria-label="Inline note"
          value={value()}
          displayMode="markdown"
          onInput={(event) => setValue(event.currentTarget.value)}
        />
      );
    });

    await user.click(screen.getByText("world"));
    const textarea = screen.getByRole("textbox", { name: "Inline note" });
    fireEvent.keyDown(textarea, { key: "Escape" });

    expect(screen.queryByRole("textbox", { name: "Inline note" })).toBeNull();
    expect(screen.getByText("world").tagName.toLowerCase()).toBe("strong");
  });

  it("re-enters markdown editing and restores focus after Escape", async () => {
    const user = userEvent.setup();
    const { container } = render(() => {
      const [value, setValue] = createSignal("Hello world");
      return (
        <InlineEditor
          aria-label="Inline note"
          value={value()}
          displayMode="markdown"
          onInput={(event) => setValue(event.currentTarget.value)}
        />
      );
    });

    await user.click(screen.getByText("Hello world"));
    const textarea = screen.getByRole("textbox", { name: "Inline note" }) as HTMLTextAreaElement;
    textarea.setSelectionRange(2, 2);
    fireEvent.select(textarea);
    fireEvent.keyDown(textarea, { key: "Escape" });
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const display = container.querySelector(".ui-inline-editor--display");
    expect(display).not.toBeNull();
    await user.click(display as HTMLElement);
    const reopened = screen.getByRole("textbox", { name: "Inline note" }) as HTMLTextAreaElement;
    expect(reopened).toHaveFocus();
  });

  it("wraps the current selection with markdown shortcuts", async () => {
    render(() => {
      const [value, setValue] = createSignal("Hello world");
      return (
        <InlineEditor
          aria-label="Inline note"
          value={value()}
          onInput={(event) => setValue(event.currentTarget.value)}
        />
      );
    });

    const textarea = screen.getByRole("textbox", { name: "Inline note" }) as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(6, 11);
    fireEvent.select(textarea);

    fireEvent.keyDown(textarea, { key: "b", ctrlKey: true });
    expect(textarea.value).toBe("Hello **world**");

    textarea.setSelectionRange(8, 13);
    fireEvent.select(textarea);
    fireEvent.keyDown(textarea, { key: "i", ctrlKey: true });
    expect(textarea.value).toBe("Hello ***world***");

    textarea.setSelectionRange(9, 14);
    fireEvent.select(textarea);
    fireEvent.keyDown(textarea, { key: "`", ctrlKey: true, shiftKey: true });
    expect(textarea.value).toBe("Hello ***`world`***");

    textarea.setSelectionRange(9, 16);
    fireEvent.select(textarea);
    fireEvent.keyDown(textarea, { key: "k", ctrlKey: true, shiftKey: true });
    expect(textarea.value).toBe("Hello ***[[`world`]]***");
  });
});
