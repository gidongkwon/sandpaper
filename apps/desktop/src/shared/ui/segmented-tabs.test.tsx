import { render, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { SegmentedTabs } from "./segmented-tabs";

describe("SegmentedTabs", () => {
  it("renders tabs and updates the selected value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    const Test = () => {
      const [value, setValue] = createSignal<"first" | "second">("first");
      return (
        <SegmentedTabs
          value={value()}
          onChange={(next) => {
            setValue(next);
            onChange(next);
          }}
          items={[
            { value: "first", label: "First" },
            { value: "second", label: "Second" }
          ]}
          aria-label="Example tabs"
        />
      );
    };

    render(() => <Test />);

    expect(screen.getByRole("radio", { name: "First" })).toBeChecked();

    await user.click(screen.getByRole("radio", { name: "Second" }));

    expect(onChange).toHaveBeenCalledWith("second");
    expect(screen.getByRole("radio", { name: "Second" })).toBeChecked();
  });
});
