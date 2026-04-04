import { render, screen, within } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { createSignal } from "solid-js";
import { vi } from "vitest";
import type { UnlinkedReference } from "../../entities/page/model/backlink-types";
import { UnlinkedReferencesPane } from "./unlinked-references-pane";

describe("UnlinkedReferencesPane", () => {
  it("renders references as an accessible listbox", async () => {
    const [query] = createSignal("");
    const expectedReference: UnlinkedReference = {
      pageTitle: "Project Atlas",
      pageUid: "project-atlas",
      blockId: "block-1",
      blockIndex: 0,
      snippet: "Mentioned in notes"
    };
    const [references] = createSignal<UnlinkedReference[]>([expectedReference]);
    const onLink = vi.fn();
    const user = userEvent.setup();

    render(() => (
      <UnlinkedReferencesPane
        query={query}
        references={references}
        onLink={onLink}
      />
    ));

    const listbox = screen.getByRole("listbox", { name: "Unlinked references" });
    const option = within(listbox).getByRole("option", { name: "Project Atlas" });

    expect(option).toHaveTextContent("Mentioned in notes");
    await user.click(option);
    expect(onLink).toHaveBeenCalledWith(expectedReference);
  });
});
