import * as Dialog from "@kobalte/core/dialog";
import { cva, cx } from "class-variance-authority";
import { Show, type Accessor, type JSX, type Setter } from "solid-js";
import { TextField } from "./text-field";

type SearchDialogProps = {
  open: Accessor<boolean>;
  onClose: () => void;
  title?: string;
  ariaLabel: string;
  query: Accessor<string>;
  setQuery: Setter<string>;
  inputRef?: (el: HTMLInputElement) => void;
  inputPlaceholder: string;
  listLabel: string;
  variant?: "default" | "command";
  onInputKeyDown?: JSX.EventHandler<HTMLInputElement, KeyboardEvent>;
  class?: string;
  children: JSX.Element;
};

export const searchDialogVariants = cva("search-dialog", {
  variants: {
    variant: {
      default: "search-dialog--default",
      command: "search-dialog--command"
    }
  },
  defaultVariants: {
    variant: "default"
  }
});

export const searchDialogTitleVariants = cva("search-dialog__title", {
  variants: {
    variant: {
      default: "search-dialog__title--default",
      command: "search-dialog__title--command"
    }
  },
  defaultVariants: {
    variant: "default"
  }
});

export const searchDialogInputVariants = cva("search-dialog__input", {
  variants: {
    variant: {
      default: "search-dialog__input--default",
      command: "search-dialog__input--command"
    }
  },
  defaultVariants: {
    variant: "default"
  }
});

export const searchDialogListVariants = cva("search-dialog__list", {
  variants: {
    variant: {
      default: "search-dialog__list--default",
      command: "search-dialog__list--command"
    }
  },
  defaultVariants: {
    variant: "default"
  }
});

export const SearchDialog = (props: SearchDialogProps) => {
  const variant = () => props.variant ?? "default";

  return (
    <Show when={props.open()}>
      <Dialog.Root
        open={true}
        modal={false}
        preventScroll={false}
        onOpenChange={(open) => {
          if (!open) props.onClose();
        }}
      >
        <Dialog.Portal>
          <div class="modal-backdrop">
            <Dialog.Overlay class="modal-backdrop__overlay" />
            <Dialog.Content
              aria-label={props.ariaLabel}
              class={cx(searchDialogVariants({ variant: variant() }), props.class)}
            >
              <Show when={props.title}>
                <Dialog.Title class={searchDialogTitleVariants({ variant: variant() })}>
                  {props.title}
                </Dialog.Title>
              </Show>
              <TextField
                ref={props.inputRef}
                class={searchDialogInputVariants({ variant: variant() })}
                type="search"
                placeholder={props.inputPlaceholder}
                value={props.query()}
                onInput={(event) => props.setQuery(event.currentTarget.value)}
                onKeyDown={(event) => props.onInputKeyDown?.(event)}
              />
              <div
                class={searchDialogListVariants({ variant: variant() })}
                data-list-label={props.listLabel}
              >
                {props.children}
              </div>
            </Dialog.Content>
          </div>
        </Dialog.Portal>
      </Dialog.Root>
    </Show>
  );
};
