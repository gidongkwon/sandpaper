import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./empty-state";

describe("EmptyState", () => {
  it("renders message with status role", () => {
    render(() => <EmptyState class="custom" message="Nothing here" />);

    const status = screen.getByRole("status");
    expect(status).toHaveClass("custom");
    expect(status).toHaveTextContent("Nothing here");
  });
});
