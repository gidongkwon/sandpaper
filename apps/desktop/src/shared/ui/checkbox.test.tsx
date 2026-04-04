import { render, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { Checkbox } from "./checkbox";

describe("Checkbox", () => {
  it("toggles through the label row", async () => {
    const user = userEvent.setup();
    const [checked, setChecked] = createSignal(false);

    render(() => (
      <Checkbox
        checked={checked()}
        onChange={setChecked}
        label="Enable plugin"
      />
    ));

    const checkbox = screen.getByRole("checkbox", { name: "Enable plugin" });
    expect(checkbox).not.toBeChecked();

    await user.click(screen.getByText("Enable plugin"));
    expect(checkbox).toBeChecked();
  });
});
