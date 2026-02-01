import { describe, expect, it } from "vitest";
import type { BacklinkEntry } from "../../../entities/page/model/backlink-types";
import { getPageBacklinkSource, groupPageBacklinks } from "./backlink-utils";

describe("backlink utils", () => {
  const resolvePageUid = (value: string) => value.trim().toLowerCase();

  it("labels backlinks from the current page", () => {
    const entry: BacklinkEntry = {
      id: "1",
      text: "Example",
      pageUid: "Home",
      pageTitle: "Home"
    };

    expect(getPageBacklinkSource(entry, "home", resolvePageUid)).toBe(
      "This page"
    );
  });

  it("groups page backlinks by source and sorts by title", () => {
    const entries: BacklinkEntry[] = [
      { id: "1", text: "Alpha", pageUid: "home", pageTitle: "Home" },
      { id: "2", text: "Beta", pageUid: "notes", pageTitle: "Notes" },
      { id: "3", text: "Gamma", pageUid: "home", pageTitle: "Home" }
    ];

    const grouped = groupPageBacklinks(entries, "home", resolvePageUid);
    expect(grouped).toHaveLength(2);
    expect(grouped[0]?.title).toBe("Notes");
    expect(grouped[1]?.title).toBe("This page");
    expect(grouped[1]?.entries).toHaveLength(2);
  });
});
