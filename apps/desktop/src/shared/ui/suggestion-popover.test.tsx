import { render, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SuggestionPopover } from "./suggestion-popover";

describe("SuggestionPopover", () => {
  it("renders a positioned suggestion surface and closes on outside interaction", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(() => (
      <SuggestionPopover
        open={true}
        position={{ x: 24, y: 48 }}
        title="Suggestions"
        onClose={onClose}
      >
        <button type="button">Alpha</button>
        <button type="button">Beta</button>
      </SuggestionPopover>
    ));

    expect(await screen.findByText("Suggestions")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alpha" })).toBeInTheDocument();
    await user.click(document.body);
    expect(onClose).toHaveBeenCalled();
  });
});
