import { describe, expect, it } from "vitest";
import {
  getPageDialogConfirmLabel,
  getPageDialogTitle,
  isPageDialogDisabled,
  resolvePageDialogAction
} from "./page-dialog-utils";

describe("page dialog utils", () => {
  it("builds labels based on dialog mode", () => {
    expect(getPageDialogTitle("new")).toBe("New page title");
    expect(getPageDialogTitle("rename")).toBe("Rename page");
    expect(getPageDialogConfirmLabel("new")).toBe("Create");
    expect(getPageDialogConfirmLabel("rename")).toBe("Rename");
  });

  it("disables dialog when the value is invalid", () => {
    expect(isPageDialogDisabled("new", "", "Inbox")).toBe(true);
    expect(isPageDialogDisabled("rename", "Inbox", "Inbox")).toBe(true);
    expect(isPageDialogDisabled("rename", "New Title", "Inbox")).toBe(false);
  });

  it("resolves dialog actions", () => {
    expect(resolvePageDialogAction(null, "", "Inbox")).toBeNull();
    expect(resolvePageDialogAction("new", "", "Inbox")).toBeNull();
    expect(resolvePageDialogAction("rename", "Inbox", "Inbox")).toBeNull();
    expect(resolvePageDialogAction("new", "New Page", "Inbox")).toEqual({
      type: "create",
      value: "New Page"
    });
    expect(resolvePageDialogAction("rename", "Renamed", "Inbox")).toEqual({
      type: "rename",
      value: "Renamed"
    });
  });
});
