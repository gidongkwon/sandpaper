import * as Listbox from "@kobalte/core/listbox";
import { Show, type JSX } from "solid-js";

export type ActionListboxOption<TData = string> = {
  value: string;
  label: string;
  ariaLabel?: string;
  description?: string | null;
  disabled?: boolean;
  data: TData;
};

type ActionListboxProps<TData> = {
  options: readonly ActionListboxOption<TData>[];
  onSelect: (option: ActionListboxOption<TData>) => void;
  ariaLabel: string;
  class?: string;
  selectedValue?: string | null;
  itemClass?: string | ((option: ActionListboxOption<TData>) => string);
  itemLabelClass?: string;
  itemDescriptionClass?: string;
  emptyState?: JSX.Element;
  renderLabel?: (option: ActionListboxOption<TData>) => JSX.Element;
};

const EMPTY_SELECTION: string[] = [];

export const ActionListbox = <TData,>(props: ActionListboxProps<TData>) => {
  const resolveItemClass = (option: ActionListboxOption<TData>) => {
    return typeof props.itemClass === "function"
      ? props.itemClass(option)
      : props.itemClass;
  };

  const handleChange = (selection: Set<string>) => {
    const selectedValue = selection.values().next().value as string | undefined;
    if (!selectedValue) return;
    const selectedOption = props.options.find((option) => option.value === selectedValue);
    if (selectedOption) props.onSelect(selectedOption);
  };

  return (
    <Show when={props.options.length > 0} fallback={props.emptyState}>
      <Listbox.Root<ActionListboxOption<TData>>
        options={[...props.options]}
        value={props.selectedValue ? [props.selectedValue] : EMPTY_SELECTION}
        selectionMode="single"
        allowDuplicateSelectionEvents
        optionValue="value"
        optionTextValue={(option) =>
          `${option.ariaLabel ?? option.label} ${option.description ?? ""}`.trim()
        }
        optionDisabled="disabled"
        onChange={handleChange}
        aria-label={props.ariaLabel}
        class={props.class}
        renderItem={(item) => (
          <Listbox.Item
            item={item}
            aria-label={item.rawValue.ariaLabel}
            class={resolveItemClass(item.rawValue)}
          >
            <Listbox.ItemLabel class={props.itemLabelClass}>
              {props.renderLabel ? props.renderLabel(item.rawValue) : item.rawValue.label}
            </Listbox.ItemLabel>
            <Show when={item.rawValue.description}>
              <Listbox.ItemDescription class={props.itemDescriptionClass}>
                {item.rawValue.description}
              </Listbox.ItemDescription>
            </Show>
          </Listbox.Item>
        )}
      />
    </Show>
  );
};
