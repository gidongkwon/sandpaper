import { render, screen, within } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ActionMenu } from "./action-menu";

describe("ActionMenu", () => {
  it("renders menu items and closes after selection", async () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    const user = userEvent.setup();

    render(() => (
      <ActionMenu
        open={true}
        position={{ x: 120, y: 160 }}
        onClose={onClose}
        items={[
          {
            key: "delete",
            label: "Delete",
            onSelect
          }
        ]}
      />
    ));

    const menu = await screen.findByRole("menu");
    await user.click(within(menu).getByRole("menuitem", { name: "Delete" }));
    expect(onSelect).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
