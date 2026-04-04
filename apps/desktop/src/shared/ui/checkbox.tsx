import * as CheckboxPrimitive from "@kobalte/core/checkbox";
import { Show } from "solid-js";
import { cx } from "class-variance-authority";

type CheckboxProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  class?: string;
  labelClass?: string;
  descriptionClass?: string;
  controlClass?: string;
  indicatorClass?: string;
  name?: string;
  value?: string;
  required?: boolean;
};

export const Checkbox = (props: CheckboxProps) => (
  <CheckboxPrimitive.Root
    checked={props.checked}
    disabled={props.disabled}
    name={props.name}
    value={props.value}
    required={props.required}
    class={cx("ui-checkbox", props.class)}
    onChange={(checked) => props.onChange(checked === true)}
  >
    <div class="ui-checkbox__copy">
      <CheckboxPrimitive.Label class={cx("ui-checkbox__label", props.labelClass)}>
        {props.label}
      </CheckboxPrimitive.Label>
      <Show when={props.description}>
        {(description) => (
          <div class={cx("ui-checkbox__description", props.descriptionClass)}>
            {description()}
          </div>
        )}
      </Show>
    </div>
    <CheckboxPrimitive.Input />
    <CheckboxPrimitive.Control class={cx("ui-checkbox__control", props.controlClass)}>
      <CheckboxPrimitive.Indicator
        class={cx("ui-checkbox__indicator", props.indicatorClass)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M4 8.5 6.5 11 12 5.5"
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.8"
          />
        </svg>
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Control>
  </CheckboxPrimitive.Root>
);
