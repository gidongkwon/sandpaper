import * as Listbox from "@kobalte/core/listbox";
import { cva, cx } from "class-variance-authority";
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
  variant?: "default" | "search-history" | "search-results" | "command" | "page-nav";
  class?: string;
  selectedValue?: string | null;
  itemClass?: string | ((option: ActionListboxOption<TData>) => string);
  itemLabelClass?: string;
  itemDescriptionClass?: string;
  emptyState?: JSX.Element;
  renderLabel?: (option: ActionListboxOption<TData>) => JSX.Element;
  renderDescription?: (option: ActionListboxOption<TData>) => JSX.Element;
};

const EMPTY_SELECTION: string[] = [];

export const actionListboxVariants = cva("action-listbox", {
  variants: {
    variant: {
      default: "action-listbox--default",
      "search-history": "action-listbox--search-history",
      "search-results": "action-listbox--search-results",
      command: "action-listbox--command",
      "page-nav": "action-listbox--page-nav"
    }
  },
  defaultVariants: {
    variant: "default"
  }
});

export const actionListboxItemVariants = cva("action-listbox__item", {
  variants: {
    variant: {
      default: "action-listbox__item--default",
      "search-history": "action-listbox__item--search-history",
      "search-results": "action-listbox__item--search-results",
      command: "action-listbox__item--command",
      "page-nav": "action-listbox__item--page-nav"
    }
  },
  defaultVariants: {
    variant: "default"
  }
});

export const actionListboxItemLabelVariants = cva("action-listbox__label", {
  variants: {
    variant: {
      default: "action-listbox__label--default",
      "search-history": "action-listbox__label--search-history",
      "search-results": "action-listbox__label--search-results",
      command: "action-listbox__label--command",
      "page-nav": "action-listbox__label--page-nav"
    }
  },
  defaultVariants: {
    variant: "default"
  }
});

export const actionListboxItemDescriptionVariants = cva(
  "action-listbox__description",
  {
    variants: {
      variant: {
        default: "action-listbox__description--default",
        "search-history": "action-listbox__description--search-history",
        "search-results": "action-listbox__description--search-results",
        command: "action-listbox__description--command",
        "page-nav": "action-listbox__description--page-nav"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);

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
  const variant = () => props.variant ?? "default";

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
        class={cx(actionListboxVariants({ variant: variant() }), props.class)}
        renderItem={(item) => (
          <Listbox.Item
            item={item}
            aria-label={item.rawValue.ariaLabel}
            class={cx(
              actionListboxItemVariants({ variant: variant() }),
              resolveItemClass(item.rawValue)
            )}
          >
            <Listbox.ItemLabel
              class={cx(
                actionListboxItemLabelVariants({ variant: variant() }),
                props.itemLabelClass
              )}
            >
              {props.renderLabel ? props.renderLabel(item.rawValue) : item.rawValue.label}
            </Listbox.ItemLabel>
            <Show when={item.rawValue.description}>
              <Listbox.ItemDescription
                class={cx(
                  actionListboxItemDescriptionVariants({ variant: variant() }),
                  props.itemDescriptionClass
                )}
              >
                {props.renderDescription
                  ? props.renderDescription(item.rawValue)
                  : item.rawValue.description}
              </Listbox.ItemDescription>
            </Show>
          </Listbox.Item>
        )}
      />
    </Show>
  );
};
