import * as Combobox from "@kobalte/core/combobox";
import { cx } from "class-variance-authority";
import { Show, createMemo, createSignal } from "solid-js";
import { textFieldVariants } from "./text-field";

export type SearchableComboboxOption = {
  value: string;
  label: string;
  inputLabel?: string;
  description?: string | null;
  disabled?: boolean;
};

type SearchableComboboxProps = {
  options: readonly SearchableComboboxOption[];
  value?: string | null;
  onChange: (value: string, option: SearchableComboboxOption) => void;
  onOptionSelect?: (option: SearchableComboboxOption) => void | Promise<void>;
  ariaLabel: string;
  listboxLabel?: string;
  placeholder?: string;
  noResultsLabel?: string;
  queryValue?: string;
  onQueryChange?: (value: string) => void;
  shouldFilter?: boolean;
  class?: string;
  controlClass?: string;
  inputClass?: string;
  iconClass?: string;
  contentClass?: string;
  listboxClass?: string;
  itemClass?: string | ((option: SearchableComboboxOption) => string);
  itemLabelClass?: string;
  itemDescriptionClass?: string;
  emptyClass?: string;
  selectOnFocus?: boolean;
};

export const SearchableCombobox = (props: SearchableComboboxProps) => {
  const [localQuery, setLocalQuery] = createSignal("");
  const query = createMemo(() => props.queryValue ?? localQuery());
  const setQuery = (value: string) => {
    props.onQueryChange?.(value);
    if (props.queryValue === undefined) setLocalQuery(value);
  };
  const selectedOption = createMemo(
    () =>
      (props.value
        ? props.options.find((option) => option.value === props.value) ?? null
        : null)
  );
  const inputValue = createMemo(() => {
    const currentQuery = query();
    if (currentQuery.length > 0) return currentQuery;
    return selectedOption()?.inputLabel ?? selectedOption()?.label ?? "";
  });
  const filteredOptions = createMemo(() => {
    if (props.shouldFilter === false) return props.options;
    const normalizedQuery = query().trim().toLowerCase();
    if (!normalizedQuery) return props.options;
    return props.options.filter((option) => {
      const haystacks = [option.label, option.value, option.description ?? ""];
      return haystacks.some((value) => value.toLowerCase().includes(normalizedQuery));
    });
  });

  const resolveItemClass = (option: SearchableComboboxOption) => {
    return typeof props.itemClass === "function"
      ? props.itemClass(option)
      : props.itemClass;
  };

  return (
    <Combobox.Root<SearchableComboboxOption>
      options={[...filteredOptions()]}
      value={selectedOption()}
      onChange={(nextOption) => {
        if (nextOption) props.onChange(nextOption.value, nextOption);
      }}
      onOpenChange={(open) => {
        if (!open && props.queryValue === undefined) setQuery("");
      }}
      optionValue="value"
      optionTextValue={(option) =>
        `${option.inputLabel ?? option.label} ${option.label} ${option.value} ${option.description ?? ""}`.trim()
      }
      optionLabel={(option) => option.inputLabel ?? option.label}
      optionDisabled="disabled"
      triggerMode="focus"
      noResetInputOnBlur={props.queryValue !== undefined}
      closeOnSelection
      allowsEmptyCollection
      gutter={4}
      sameWidth
      placement="bottom-start"
      class={props.class}
      itemComponent={(itemProps) => (
        <Combobox.Item
          item={itemProps.item}
          class={resolveItemClass(itemProps.item.rawValue)}
          onPointerDown={(event) => {
            if (!props.onOptionSelect) return;
            event.preventDefault();
            event.stopPropagation();
            void props.onOptionSelect(itemProps.item.rawValue);
          }}
          onMouseDown={(event) => {
            if (!props.onOptionSelect) return;
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <Combobox.ItemLabel class={props.itemLabelClass}>
            {itemProps.item.rawValue.label}
          </Combobox.ItemLabel>
          <Show when={itemProps.item.rawValue.description}>
            <span class={props.itemDescriptionClass}>
              {itemProps.item.rawValue.description}
            </span>
          </Show>
        </Combobox.Item>
      )}
    >
      <Combobox.Control class={props.controlClass}>
        <Combobox.Input
          aria-label={props.ariaLabel}
          placeholder={props.placeholder ?? selectedOption()?.label ?? ""}
          class={cx(textFieldVariants(), props.inputClass)}
          value={inputValue()}
          onInput={(event) => setQuery(event.currentTarget.value)}
          onFocus={(event) => {
            if (props.selectOnFocus) event.currentTarget.select();
          }}
        />
        <Combobox.Icon class={props.iconClass} aria-hidden="true" />
      </Combobox.Control>

      <Combobox.Content class={props.contentClass}>
        <Show
          when={filteredOptions().length > 0}
          fallback={
            <div class={props.emptyClass}>
              {props.noResultsLabel ?? "No matches"}
            </div>
          }
        >
          <Combobox.Listbox
            aria-label={props.listboxLabel ?? `${props.ariaLabel} options`}
            class={props.listboxClass}
          />
        </Show>
      </Combobox.Content>
    </Combobox.Root>
  );
};
