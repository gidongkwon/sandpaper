import * as Slider from "@kobalte/core/slider";
import { cva, cx, type VariantProps } from "class-variance-authority";
import { createMemo, splitProps } from "solid-js";

export const sliderFieldVariants = cva("ui-slider", {
  variants: {
    size: {
      md: "ui-slider--md"
    }
  },
  defaultVariants: {
    size: "md"
  }
});

export type SliderFieldProps = VariantProps<typeof sliderFieldVariants> & {
  id?: string;
  value: number;
  minValue: number;
  maxValue: number;
  step?: number;
  onChange: (value: number) => void;
  label: string;
  class?: string;
};

export const SliderField = (props: SliderFieldProps) => {
  const [local] = splitProps(props, [
    "class",
    "size",
    "id",
    "value",
    "minValue",
    "maxValue",
    "step",
    "onChange",
    "label"
  ]);

  const normalizedMaxValue = createMemo(
    () =>
      local.minValue +
      Math.round((local.maxValue - local.minValue) / (local.step ?? 1)) *
        (local.step ?? 1)
  );

  return (
    <Slider.Root
      class={cx(
        sliderFieldVariants({
          size: local.size
        }),
        local.class
      )}
      id={local.id}
      value={[local.value]}
      minValue={local.minValue}
      maxValue={normalizedMaxValue()}
      step={local.step}
      onChange={(next) => local.onChange(next[0] ?? local.minValue)}
    >
      <Slider.Track class="ui-slider__track">
        <Slider.Fill class="ui-slider__fill" />
        <Slider.Thumb class="ui-slider__thumb" aria-label={local.label}>
          <Slider.Input />
        </Slider.Thumb>
      </Slider.Track>
    </Slider.Root>
  );
};
