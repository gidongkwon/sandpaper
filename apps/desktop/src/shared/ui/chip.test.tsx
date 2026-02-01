import { render, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Chip } from "./chip";

describe("Chip", () => {
  it("applies active class and handles click", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(() => (
      <Chip active={true} onClick={onClick}>
        Filters
      </Chip>
    ));

    const chip = screen.getByRole("button", { name: "Filters" });
    expect(chip).toHaveClass("chip");
    expect(chip).toHaveClass("is-active");

    await user.click(chip);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
