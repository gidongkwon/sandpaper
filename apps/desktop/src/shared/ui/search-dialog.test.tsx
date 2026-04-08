import { render, screen, within } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { createSignal, untrack } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { SearchDialog } from "./search-dialog";

describe("SearchDialog", () => {
  it("renders a searchable dialog and closes on outside interaction", async () => {
    const onClose = vi.fn();
    const [query, setQuery] = createSignal("");
    const user = userEvent.setup();

    render(() => (
      <SearchDialog
        open={() => true}
        onClose={onClose}
        title="Search things"
        ariaLabel="Search things"
        query={query}
        setQuery={setQuery}
        inputPlaceholder="Search..."
        listLabel="Results"
      >
        <button type="button">Alpha</button>
      </SearchDialog>
    ));

    const dialog = await screen.findByRole("dialog", { name: "Search things" });
    const input = within(dialog).getByPlaceholderText("Search...");
    await user.type(input, "ab");
    expect(untrack(query)).toBe("ab");
    await user.click(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it("renders command variant without a visible title and keeps the list container stable", async () => {
    const [query, setQuery] = createSignal("");

    render(() => (
      <SearchDialog
        open={() => true}
        onClose={() => {}}
        ariaLabel="Command palette"
        variant="command"
        query={query}
        setQuery={setQuery}
        inputPlaceholder="Search notes and commands..."
        listLabel="Command results"
      >
        <button type="button">Alpha</button>
      </SearchDialog>
    ));

    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    expect(within(dialog).queryByText("Command palette")).toBeNull();
    const list = dialog.querySelector(".search-dialog__list--command");
    expect(list).not.toBeNull();
  });
});
