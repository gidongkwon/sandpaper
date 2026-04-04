import { render, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { createSignal, untrack } from "solid-js";
import { describe, expect, it } from "vitest";
import { TextareaField } from "./textarea-field";

describe("TextareaField", () => {
  it("renders cva classes and updates through input", async () => {
    const user = userEvent.setup();
    const [value, setValue] = createSignal("");

    render(() => (
      <TextareaField
        aria-label="Markdown"
        value={value()}
        onInput={(event) => setValue(event.currentTarget.value)}
        font="mono"
      />
    ));

    const textarea = screen.getByRole("textbox", { name: "Markdown" });
    expect(textarea.className).toContain("ui-textarea");
    expect(textarea.className).toContain("ui-textarea--mono");

    await user.type(textarea, "# Note");
    expect(untrack(value)).toBe("# Note");
  });
});
