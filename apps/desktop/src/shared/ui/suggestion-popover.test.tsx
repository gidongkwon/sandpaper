import { render, screen, within } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SuggestionPopover } from "./suggestion-popover";

describe("SuggestionPopover", () => {
  it("renders a positioned listbox and closes on outside interaction", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(() => (
      <SuggestionPopover
        open={true}
        position={{ x: 24, y: 48 }}
        title="Suggestions"
        listLabel="Suggestion results"
        onClose={onClose}
      >
        <button type="button">Alpha</button>
        <button type="button">Beta</button>
      </SuggestionPopover>
    ));

    const listbox = await screen.findByRole("listbox", {
      name: "Suggestion results"
    });
    expect(within(listbox).getByRole("button", { name: "Alpha" })).toBeInTheDocument();
    await user.click(document.body);
    expect(onClose).toHaveBeenCalled();
  });
});
