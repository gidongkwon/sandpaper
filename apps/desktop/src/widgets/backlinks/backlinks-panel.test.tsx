import { render, screen, within } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { createSignal } from "solid-js";
import { vi } from "vitest";
import type { BacklinkEntry } from "../../entities/page/model/backlink-types";
import { BacklinksPanel } from "./backlinks-panel";

describe("BacklinksPanel", () => {
  it("renders page and block backlinks as accessible listboxes", async () => {
    const pageEntry: BacklinkEntry = {
      id: "page-entry",
      text: "See [[Home]]",
      pageUid: "project-atlas",
      pageTitle: "Project Atlas"
    };
    const blockEntry: BacklinkEntry = {
      id: "block-entry",
      text: "See ((home-1))",
      pageUid: "project-atlas",
      pageTitle: "Project Atlas"
    };
    const openPageBacklink = vi.fn();
    const openPageBacklinkInPane = vi.fn();
    const onBlockBacklinkSelect = vi.fn();
    const user = userEvent.setup();
    const [open] = createSignal(true);
    const [activePageBacklinks] = createSignal([pageEntry]);
    const [activeBacklinks] = createSignal([blockEntry]);
    const [activeBlock] = createSignal({
      id: "home-1",
      text: "Home block",
      indent: 0
    });
    const [pageTitle] = createSignal("Home");
    const [groupedPageBacklinks] = createSignal([
      { title: "Project Atlas", entries: [pageEntry] }
    ]);

    render(() => (
      <BacklinksPanel
        open={open}
        onClose={() => {}}
        sectionJump={(props) => <button type="button">{props.label}</button>}
        activePageBacklinks={activePageBacklinks}
        activeBacklinks={activeBacklinks}
        activeBlock={activeBlock}
        pageTitle={pageTitle}
        groupedPageBacklinks={groupedPageBacklinks}
        supportsMultiPane={true}
        openPageBacklinkInPane={openPageBacklinkInPane}
        openPageBacklink={openPageBacklink}
        formatBacklinkSnippet={(text) => text}
        onBlockBacklinkSelect={onBlockBacklinkSelect}
      />
    ));

    const pageListbox = screen.getByRole("listbox", { name: "Project Atlas backlinks" });
    const blockListbox = screen.getByRole("listbox", { name: "Block backlinks" });

    await user.click(within(pageListbox).getByRole("option", { name: "See [[Home]]" }));
    expect(openPageBacklink).toHaveBeenCalledWith(pageEntry);

    await user.click(within(blockListbox).getByRole("option", { name: "See ((home-1))" }));
    expect(onBlockBacklinkSelect).toHaveBeenCalledWith(blockEntry);

    await user.click(screen.getByRole("button", { name: "Open in pane" }));
    expect(openPageBacklinkInPane).toHaveBeenCalledWith(pageEntry);
  });
});
