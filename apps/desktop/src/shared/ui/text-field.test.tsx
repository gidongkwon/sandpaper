import { render, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { createSignal, untrack } from "solid-js";
import { describe, expect, it } from "vitest";
import { TextField } from "./text-field";

describe("TextField", () => {
  it("renders cva classes and updates through input", async () => {
    const user = userEvent.setup();
    const [value, setValue] = createSignal("");

    render(() => (
      <TextField
        aria-label="Vault name"
        value={value()}
        onInput={(event) => setValue(event.currentTarget.value)}
        font="mono"
      />
    ));

    const input = screen.getByRole("textbox", { name: "Vault name" });
    expect(input.className).toContain("ui-input");
    expect(input.className).toContain("ui-input--mono");

    await user.type(input, "Inbox");
    expect(untrack(value)).toBe("Inbox");
  });
});
