import { describe, expect, it } from "vitest";
import {
  formatBacklinkSnippet,
  formatDailyNoteTitle,
  resolveUniqueLocalPageUid,
  stripWikilinks
} from "./page-utils";

describe("page utils", () => {
  it("formats backlink snippets with trimming and truncation", () => {
    expect(formatBacklinkSnippet("   \n  ")).toBe("Untitled");
    expect(formatBacklinkSnippet("Hello world")).toBe("Hello world");

    const longText = "a".repeat(90);
    expect(formatBacklinkSnippet(longText)).toBe(`${"a".repeat(80)}...`);
  });

  it("strips wikilinks from text", () => {
    expect(stripWikilinks("See [[Page]] now")).toBe("See  now");
    expect(stripWikilinks("Start[[Link]]End")).toBe("StartEnd");
  });

  it("generates unique local page ids", () => {
    const localPages = {
      "daily-note": { uid: "daily-note", title: "Daily Note", blocks: [] },
      "daily-note-2": { uid: "daily-note-2", title: "Daily Note", blocks: [] }
    };
    const resolvePageUid = (value: string) =>
      value.trim().toLowerCase().replace(/\s+/g, "-");

    expect(resolveUniqueLocalPageUid("Daily Note", localPages, resolvePageUid)).toBe(
      "daily-note-3"
    );
    expect(resolveUniqueLocalPageUid("New Page", localPages, resolvePageUid)).toBe(
      "new-page"
    );
  });

  it("formats the daily note title", () => {
    expect(formatDailyNoteTitle(new Date(2026, 0, 31))).toBe("2026-01-31");
  });
});
