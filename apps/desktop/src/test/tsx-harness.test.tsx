import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";

describe("tsx harness", () => {
  it("renders a simple Solid component", () => {
    render(() => <button>Harness</button>);

    expect(screen.getByRole("button", { name: "Harness" })).toBeInTheDocument();
  });
});
