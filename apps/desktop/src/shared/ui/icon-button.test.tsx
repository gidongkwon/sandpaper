import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { IconButton } from "./icon-button";

describe("IconButton", () => {
  it("applies icon button variants", () => {
    render(() => (
      <IconButton label="Open settings" variant="toolbar">
        <span aria-hidden="true">*</span>
      </IconButton>
    ));

    const button = screen.getByRole("button", { name: "Open settings" });
    expect(button.className).toContain("ui-icon-button");
    expect(button.className).toContain("ui-icon-button--toolbar");
  });
});
