import * as Select from "@kobalte/core/select";
import { cx } from "class-variance-authority";
import { createMemo } from "solid-js";

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
  triggerClass?: string;
  contentClass?: string;
  listboxClass?: string;
  itemClass?: string;
  itemLabelClass?: string;
};

export const SelectField = (props: SelectFieldProps) => {
  const selectedOption = createMemo(
    () => props.options.find((option) => option.value === props.value) ?? null
  );

  return (
    <Select.Root<SelectFieldOption>
      options={[...props.options]}
      value={selectedOption() ?? undefined}
      onChange={(option) => {
        if (option) props.onChange(option.value);
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
        class={cx("ui-select", props.triggerClass)}
        aria-label={props.label}
      >
        <Select.Value<SelectFieldOption>>
          {(state) => state.selectedOption()?.label ?? ""}
        </Select.Value>
      </Select.Trigger>
      <Select.Portal>
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
