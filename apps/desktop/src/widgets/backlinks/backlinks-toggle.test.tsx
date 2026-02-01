import { render, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { createSignal } from "solid-js";
import { vi } from "vitest";
import { BacklinksToggle } from "./backlinks-toggle";

describe("BacklinksToggle", () => {
  it("toggles label and calls onToggle", async () => {
    const [open, setOpen] = createSignal(false);
    const [total] = createSignal(2);
    const onToggle = vi.fn(() => setOpen((prev) => !prev));
    const user = userEvent.setup();

    render(() => (
      <BacklinksToggle open={open} total={total} onToggle={onToggle} />
    ));

    expect(
      screen.getByRole("button", { name: /show backlinks/i })
    ).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /show backlinks/i }));

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: /hide backlinks/i })
    ).toBeInTheDocument();
  });

  it("hides the badge when there are no backlinks", () => {
    const [open] = createSignal(false);
    const [total] = createSignal(0);

    const { container } = render(() => (
      <BacklinksToggle open={open} total={total} onToggle={() => {}} />
    ));

    expect(container.querySelector(".backlinks-toggle__badge")).toBeNull();
  });
});
