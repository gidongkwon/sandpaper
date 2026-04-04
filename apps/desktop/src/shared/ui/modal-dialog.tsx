import * as Dialog from "@kobalte/core/dialog";
import { Show, type Accessor, type JSX } from "solid-js";
import { Button } from "./button";
import { DialogShell } from "./dialog-shell";

type ModalDialogProps = {
  open: Accessor<boolean>;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmDisabled?: boolean | Accessor<boolean>;
  children?: JSX.Element;
};

export const ModalDialog = (props: ModalDialogProps) => {
  const confirmDisabled = () => {
    if (typeof props.confirmDisabled === "function") {
      return props.confirmDisabled();
    }
    return props.confirmDisabled ?? false;
  };

  return (
    <Show when={props.open()}>
      <Dialog.Root
        open={true}
        modal={false}
        preventScroll={false}
        onOpenChange={(open) => {
          if (!open) props.onCancel();
        }}
      >
        <Dialog.Portal>
          <div class="modal-backdrop">
            <Dialog.Overlay class="modal-backdrop__overlay" />
            <Dialog.Content class="modal">
              <DialogShell
                title={<Dialog.Title>{props.title}</Dialog.Title>}
                description={
                  <Show when={props.description}>
                    {(description) => (
                      <Dialog.Description>{description()}</Dialog.Description>
                    )}
                  </Show>
                }
                actions={
                  <>
                    <Button class="modal__button" onClick={() => props.onCancel()}>
                      {props.cancelLabel ?? "Cancel"}
                    </Button>
                    <Button
                      class="modal__button is-primary"
                      onClick={() => props.onConfirm()}
                      disabled={confirmDisabled()}
                    >
                      {props.confirmLabel ?? "Confirm"}
                    </Button>
                  </>
                }
              >
                {props.children}
              </DialogShell>
            </Dialog.Content>
          </div>
        </Dialog.Portal>
      </Dialog.Root>
    </Show>
  );
};
