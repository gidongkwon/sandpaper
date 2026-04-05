import * as Combobox from "@kobalte/core/combobox";
import { cva, cx } from "class-variance-authority";
import { Show, createMemo, createSignal } from "solid-js";
import { textFieldVariants } from "./text-field";

export type SearchableComboboxOption = {
  value: string;
  label: string;
  inputLabel?: string;
  description?: string | null;
  disabled?: boolean;
  tone?: "default" | "accent";
};

export const searchableComboboxControlVariants = cva(
  "searchable-combobox__control",
  {
    variants: {
      variant: {
        default: "searchable-combobox__control--default",
        review: "searchable-combobox__control--review"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);

export const searchableComboboxInputVariants = cva("", {
  variants: {
    variant: {
      default: "searchable-combobox__input--default",
      review: "searchable-combobox__input--review"
    }
  },
  defaultVariants: {
    variant: "default"
  }
});

export const searchableComboboxContentVariants = cva(
  "searchable-combobox__content",
  {
    variants: {
      variant: {
        default: "searchable-combobox__content--default",
        review: "searchable-combobox__content--review"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);

export const searchableComboboxListboxVariants = cva(
  "searchable-combobox__listbox",
  {
    variants: {
      variant: {
        default: "searchable-combobox__listbox--default",
        review: "searchable-combobox__listbox--review"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);

export const searchableComboboxItemVariants = cva("searchable-combobox__item", {
  variants: {
    variant: {
      default: "searchable-combobox__item--default",
      review: "searchable-combobox__item--review"
    },
    tone: {
      default: "searchable-combobox__item--tone-default",
      accent: "searchable-combobox__item--tone-accent"
    }
  },
  defaultVariants: {
    variant: "default",
    tone: "default"
  }
});

export const searchableComboboxItemLabelVariants = cva(
  "searchable-combobox__item-label",
  {
    variants: {
      variant: {
        default: "searchable-combobox__item-label--default",
        review: "searchable-combobox__item-label--review"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);

export const searchableComboboxItemDescriptionVariants = cva(
  "searchable-combobox__item-description",
  {
    variants: {
      variant: {
        default: "searchable-combobox__item-description--default",
        review: "searchable-combobox__item-description--review"
      },
      tone: {
        default: "searchable-combobox__item-description--tone-default",
        accent: "searchable-combobox__item-description--tone-accent"
      }
    },
    defaultVariants: {
      variant: "default",
      tone: "default"
    }
  }
);

export const searchableComboboxEmptyVariants = cva("searchable-combobox__empty", {
  variants: {
    variant: {
      default: "searchable-combobox__empty--default",
      review: "searchable-combobox__empty--review"
    }
  },
  defaultVariants: {
    variant: "default"
  }
});

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
  variant?: "default" | "review";
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
  const variant = () => props.variant ?? "default";

  return (
    <Combobox.Root<SearchableComboboxOption>
      options={[...filteredOptions()]}
      value={selectedOption()}
      onChange={(nextOption) => {
        if (!nextOption) return;
        if (!props.onOptionSelect) setQuery("");
        props.onChange(nextOption.value, nextOption);
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
      class={cx("searchable-combobox", props.class)}
      itemComponent={(itemProps) => (
        <Combobox.Item
          item={itemProps.item}
          class={cx(
            searchableComboboxItemVariants({
              variant: variant(),
              tone: itemProps.item.rawValue.tone ?? "default"
            }),
            resolveItemClass(itemProps.item.rawValue)
          )}
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
          data-tone={itemProps.item.rawValue.tone ?? "default"}
        >
          <Combobox.ItemLabel
            class={cx(
              searchableComboboxItemLabelVariants({ variant: variant() }),
              props.itemLabelClass
            )}
          >
            {itemProps.item.rawValue.label}
          </Combobox.ItemLabel>
          <Show when={itemProps.item.rawValue.description}>
            <span
              class={cx(
                searchableComboboxItemDescriptionVariants({
                  variant: variant(),
                  tone: itemProps.item.rawValue.tone ?? "default"
                }),
                props.itemDescriptionClass
              )}
            >
              {itemProps.item.rawValue.description}
            </span>
          </Show>
        </Combobox.Item>
      )}
    >
      <Combobox.Control
        class={cx(
          searchableComboboxControlVariants({ variant: variant() }),
          props.controlClass
        )}
      >
        <Combobox.Input
          aria-label={props.ariaLabel}
          placeholder={props.placeholder ?? selectedOption()?.label ?? ""}
          class={cx(
            textFieldVariants(),
            searchableComboboxInputVariants({ variant: variant() }),
            props.inputClass
          )}
          value={inputValue()}
          onInput={(event) => setQuery(event.currentTarget.value)}
          onFocus={(event) => {
            if (props.selectOnFocus) event.currentTarget.select();
          }}
        />
        <Combobox.Icon class={props.iconClass} aria-hidden="true" />
      </Combobox.Control>

      <Combobox.Portal>
        <Combobox.Content
          class={cx(
            searchableComboboxContentVariants({ variant: variant() }),
            props.contentClass
          )}
        >
          <Show
            when={filteredOptions().length > 0}
            fallback={
              <div
                class={cx(
                  searchableComboboxEmptyVariants({ variant: variant() }),
                  props.emptyClass
                )}
              >
                {props.noResultsLabel ?? "No matches"}
              </div>
            }
          >
            <Combobox.Listbox
              aria-label={props.listboxLabel ?? `${props.ariaLabel} options`}
              class={cx(
                searchableComboboxListboxVariants({ variant: variant() }),
                props.listboxClass
              )}
            />
          </Show>
        </Combobox.Content>
      </Combobox.Portal>
    </Combobox.Root>
  );
};
