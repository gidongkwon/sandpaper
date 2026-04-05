import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { SliderField } from "./slider-field";

describe("SliderField", () => {
  it("renders without producing invalid inline styles and updates the value", async () => {
    const [value, setValue] = createSignal(1);
    let latestValue = 1;

    render(() => (
      <SliderField
        id="test-slider"
        label="Text size"
        class="settings-slider__input"
        minValue={0.8}
        maxValue={1.2}
        step={0.05}
        value={value()}
        onChange={(nextValue) => {
          latestValue = nextValue;
          setValue(nextValue);
        }}
      />
    ));

    const slider = screen.getByRole("slider", { name: "Text size" });
    expect(slider).toHaveAttribute("aria-valuenow", "1");
    expect(slider).not.toHaveAttribute("style", expect.stringContaining("NaN"));

    const nativeInput = document.querySelector(
      'input[type="range"]'
    ) as HTMLInputElement | null;
    expect(nativeInput).not.toBeNull();
    if (!nativeInput) return;
    expect(nativeInput.value).toBe("1");

    fireEvent.change(nativeInput, { target: { value: "1.1" } });

    expect(latestValue).toBeCloseTo(1.1);
  });
});
