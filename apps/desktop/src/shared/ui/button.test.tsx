import { render, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";

describe("Button", () => {
  it("defaults to button type and handles click", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(() => <Button onClick={onClick}>Click me</Button>);

    const button = screen.getByRole("button", { name: "Click me" });
    expect(button).toHaveAttribute("type", "button");

    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("applies cva variants", () => {
    render(() => (
      <Button variant="primary" size="sm">
        Save
      </Button>
    ));

    const button = screen.getByRole("button", { name: "Save" });
    expect(button.className).toContain("ui-button");
    expect(button.className).toContain("ui-button--primary");
    expect(button.className).toContain("ui-button--sm");
  });
});
