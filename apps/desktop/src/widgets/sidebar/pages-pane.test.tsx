import { render, screen, within } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { createSignal } from "solid-js";
import { vi } from "vitest";
import type { PageSummary } from "../../entities/page/model/page-types";
import { PagesPane } from "./pages-pane";

describe("PagesPane", () => {
  it("renders the page list as an accessible listbox", async () => {
    const [pages] = createSignal<PageSummary[]>([
      { uid: "home", title: "Home" },
      { uid: "project-atlas", title: "Project Atlas" }
    ]);
    const [activePageUid] = createSignal("home");
    const [pageMessage] = createSignal<string | null>(null);
    const onSwitch = vi.fn();
    const onCreate = vi.fn();
    const user = userEvent.setup();

    render(() => (
      <PagesPane
        pages={pages}
        activePageUid={activePageUid}
        resolvePageUid={(value) => value}
        onSwitch={onSwitch}
        pageMessage={pageMessage}
        onCreate={onCreate}
      />
    ));

    const listbox = screen.getByRole("listbox", { name: "Pages" });
    const homeOption = within(listbox).getByRole("option", { name: "Home" });
    const projectOption = within(listbox).getByRole("option", { name: "Project Atlas" });

    expect(homeOption).toHaveAttribute("aria-selected", "true");
    expect(projectOption).toHaveAttribute("aria-selected", "false");

    await user.click(projectOption);
    expect(onSwitch).toHaveBeenCalledWith("project-atlas");
  });
});
