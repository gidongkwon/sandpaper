import { render, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { Switch } from "./switch";

describe("Switch", () => {
  it("toggles through the full row", async () => {
    const user = userEvent.setup();
    const [checked, setChecked] = createSignal(true);

    render(() => (
      <Switch
        checked={checked()}
        onChange={setChecked}
        label="Show status chips"
      />
    ));

    const toggle = screen.getByRole("switch", { name: "Show status chips" });
    expect(toggle).toBeChecked();

    await user.click(screen.getByText("Show status chips"));
    expect(toggle).not.toBeChecked();
  });
});
