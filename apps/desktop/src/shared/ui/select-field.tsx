import * as Select from "@kobalte/core/select";
import { cx } from "class-variance-authority";
import { createMemo, createSignal } from "solid-js";

export type SelectFieldOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type SelectFieldProps = {
  label: string;
  value: string;
  options: readonly SelectFieldOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  triggerClass?: string;
  contentClass?: string;
  listboxClass?: string;
  itemClass?: string;
  itemLabelClass?: string;
};

export const SelectField = (props: SelectFieldProps) => {
  const [triggerRef, setTriggerRef] = createSignal<HTMLButtonElement | undefined>(
    undefined
  );
  const selectedOption = createMemo(
    () => props.options.find((option) => option.value === props.value) ?? null
  );
  const portalMount = createMemo(
    () => triggerRef()?.closest(".settings-modal") as HTMLElement | null | undefined
  );

  return (
    <Select.Root<SelectFieldOption>
      options={props.options}
      value={selectedOption() ?? undefined}
      onChange={(option) => {
        if (option && option.value !== props.value) {
          props.onChange(option.value);
        }
      }}
      optionValue="value"
      optionTextValue="label"
      optionDisabled="disabled"
      itemComponent={(itemProps) => (
        <Select.Item
          item={itemProps.item}
          class={cx("ui-select__item", props.itemClass)}
        >
          <Select.ItemLabel class={cx("ui-select__item-label", props.itemLabelClass)}>
            {itemProps.item.rawValue.label}
          </Select.ItemLabel>
        </Select.Item>
      )}
    >
      <Select.HiddenSelect />
      <Select.Trigger
        ref={setTriggerRef}
        class={cx("ui-select", props.triggerClass)}
        aria-label={props.label}
        disabled={props.disabled}
      >
        <Select.Value<SelectFieldOption>>
          {(state) => state.selectedOption()?.label ?? ""}
        </Select.Value>
      </Select.Trigger>
      <Select.Portal mount={portalMount() ?? undefined}>
        <Select.Content class={cx("ui-select__content", props.contentClass)}>
          <Select.Listbox
            aria-label={`${props.label} options`}
            class={cx("ui-select__listbox", props.listboxClass)}
          />
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
};
