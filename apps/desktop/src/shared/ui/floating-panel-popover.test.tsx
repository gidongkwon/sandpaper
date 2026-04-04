import { render, screen, within } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FloatingPanelPopover } from "./floating-panel-popover";

describe("FloatingPanelPopover", () => {
  it("renders an accessible dialog and closes on outside interaction", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(() => (
      <FloatingPanelPopover
        open={true}
        position={{ x: 24, y: 48 }}
        title="Link preview"
        onClose={onClose}
      >
        <button type="button">Open</button>
      </FloatingPanelPopover>
    ));

    const dialog = await screen.findByRole("dialog", { name: "Link preview" });
    expect(within(dialog).getByRole("button", { name: "Open" })).toBeInTheDocument();
    await user.click(document.body);
    expect(onClose).toHaveBeenCalled();
  });
});
