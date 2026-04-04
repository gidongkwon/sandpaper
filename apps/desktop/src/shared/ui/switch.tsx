import * as SwitchPrimitive from "@kobalte/core/switch";
import { Show } from "solid-js";
import { cx } from "class-variance-authority";

type SwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  class?: string;
  labelClass?: string;
  descriptionClass?: string;
  controlClass?: string;
  thumbClass?: string;
  name?: string;
  value?: string;
  required?: boolean;
};

export const Switch = (props: SwitchProps) => (
  <SwitchPrimitive.Root
    checked={props.checked}
    disabled={props.disabled}
    name={props.name}
    value={props.value}
    required={props.required}
    class={cx("ui-switch", props.class)}
    onChange={(checked) => props.onChange(checked === true)}
  >
    <div class="ui-switch__copy">
      <SwitchPrimitive.Label class={cx("ui-switch__label", props.labelClass)}>
        {props.label}
      </SwitchPrimitive.Label>
      <Show when={props.description}>
        {(description) => (
          <div class={cx("ui-switch__description", props.descriptionClass)}>
            {description()}
          </div>
        )}
      </Show>
    </div>
    <SwitchPrimitive.Input />
    <SwitchPrimitive.Control class={cx("ui-switch__control", props.controlClass)}>
      <SwitchPrimitive.Thumb class={cx("ui-switch__thumb", props.thumbClass)} />
    </SwitchPrimitive.Control>
  </SwitchPrimitive.Root>
);
