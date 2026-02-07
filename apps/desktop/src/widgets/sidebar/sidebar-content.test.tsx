import { render, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { createSignal } from "solid-js";
import { vi } from "vitest";
import type { SearchResult } from "../../entities/search/model/search-types";
import type { UnlinkedReference } from "../../entities/page/model/backlink-types";
import type { PageSummary } from "../../entities/page/model/page-types";
import { SidebarContent } from "./sidebar-content";

describe("SidebarContent", () => {
  it("renders pages and unlinked references actions", async () => {
    const [query, setQuery] = createSignal("");
    const [history] = createSignal<string[]>([]);
    const [results] = createSignal<SearchResult[]>([]);
    const [references] = createSignal<UnlinkedReference[]>([
      {
        pageTitle: "Project",
        pageUid: "page-1",
        blockId: "block-1",
        blockIndex: 0,
        snippet: "Mentioned in notes"
      }
    ]);
    const [pages] = createSignal<PageSummary[]>([
      { uid: "page-1", title: "Project" }
    ]);
    const [activePageUid] = createSignal("page-1");
    const [pageMessage] = createSignal<string | null>(null);
    const onLink = vi.fn();
    const onSwitch = vi.fn();
    const onCreate = vi.fn();
    const user = userEvent.setup();

    render(() => (
      <SidebarContent
        search={{
          query,
          setQuery,
          commitTerm: () => {},
          history,
          applyTerm: () => {},
          results,
          renderHighlight: (text) => text,
          onResultSelect: () => {}
        }}
        unlinked={{
          query,
          references,
          onLink
        }}
        pages={{
          pages,
          activePageUid,
          resolvePageUid: (value) => value,
          onSwitch,
          pageMessage,
          onCreate
        }}
      />
    ));

    expect(screen.getByPlaceholderText("Search...")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /create new page/i }));
    expect(onCreate).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /open project/i }));
    expect(onSwitch).toHaveBeenCalledWith("page-1");

    await user.click(screen.getByRole("button", { name: /link it/i }));
    expect(onLink).toHaveBeenCalledTimes(1);
  });
});
