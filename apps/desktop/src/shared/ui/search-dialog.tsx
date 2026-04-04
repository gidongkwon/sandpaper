import * as Dialog from "@kobalte/core/dialog";
import { Show, type Accessor, type JSX, type Setter } from "solid-js";

type SearchDialogProps = {
  open: Accessor<boolean>;
  onClose: () => void;
  title: string;
  query: Accessor<string>;
  setQuery: Setter<string>;
  inputRef?: (el: HTMLInputElement) => void;
  inputPlaceholder: string;
  listLabel: string;
  onInputKeyDown?: JSX.EventHandler<HTMLInputElement, KeyboardEvent>;
  class?: string;
  children: JSX.Element;
};

export const SearchDialog = (props: SearchDialogProps) => {
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
            <Dialog.Content class={`search-dialog ${props.class ?? ""}`.trim()}>
              <Dialog.Title class="search-dialog__title">
                {props.title}
              </Dialog.Title>
              <input
                ref={props.inputRef}
                class="search-dialog__input"
                type="search"
                placeholder={props.inputPlaceholder}
                value={props.query()}
                onInput={(event) => props.setQuery(event.currentTarget.value)}
                onKeyDown={(event) => props.onInputKeyDown?.(event)}
              />
              <div
                class="search-dialog__list"
                role="listbox"
                aria-label={props.listLabel}
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
