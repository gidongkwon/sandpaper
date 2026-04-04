import * as Combobox from "@kobalte/core/combobox";
import { Show, createMemo, createSignal } from "solid-js";

export type SearchableComboboxOption = {
  value: string;
  label: string;
  description?: string | null;
  disabled?: boolean;
};

type SearchableComboboxProps = {
  options: readonly SearchableComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  listboxLabel?: string;
  placeholder?: string;
  noResultsLabel?: string;
  class?: string;
  controlClass?: string;
  inputClass?: string;
  iconClass?: string;
  contentClass?: string;
  listboxClass?: string;
  itemClass?: string;
  itemLabelClass?: string;
  itemDescriptionClass?: string;
  emptyClass?: string;
  selectOnFocus?: boolean;
};

export const SearchableCombobox = (props: SearchableComboboxProps) => {
  const [query, setQuery] = createSignal("");
  const selectedOption = createMemo(
    () => props.options.find((option) => option.value === props.value) ?? null
  );
  const filteredOptions = createMemo(() => {
    const normalizedQuery = query().trim().toLowerCase();
    if (!normalizedQuery) return props.options;
    return props.options.filter((option) => {
      const haystacks = [option.label, option.value, option.description ?? ""];
      return haystacks.some((value) => value.toLowerCase().includes(normalizedQuery));
    });
  });

  return (
    <Combobox.Root
      options={[...props.options]}
      value={selectedOption()}
      onChange={(nextOption) => {
        if (nextOption) props.onChange(nextOption.value);
      }}
      onInputChange={(nextValue) => setQuery(nextValue)}
      onOpenChange={(open) => {
        if (!open) setQuery("");
      }}
      optionValue="value"
      optionTextValue={(option) =>
        `${option.label} ${option.value} ${option.description ?? ""}`.trim()
      }
      optionLabel="label"
      optionDisabled="disabled"
      triggerMode="focus"
      closeOnSelection
      allowsEmptyCollection
      gutter={4}
      sameWidth
      placement="bottom-start"
      class={props.class}
      itemComponent={(itemProps) => (
        <Combobox.Item item={itemProps.item} class={props.itemClass}>
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
          class={props.inputClass}
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
