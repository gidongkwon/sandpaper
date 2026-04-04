import * as AlertDialogPrimitive from "@kobalte/core/alert-dialog";
import { Show, type Accessor, type JSX } from "solid-js";
import { Button } from "./button";
import { DialogShell } from "./dialog-shell";

type AlertDialogProps = {
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

export const AlertDialog = (props: AlertDialogProps) => {
  const confirmDisabled = () => {
    if (typeof props.confirmDisabled === "function") {
      return props.confirmDisabled();
    }
    return props.confirmDisabled ?? false;
  };

  return (
    <Show when={props.open()}>
      <AlertDialogPrimitive.Root
        open={true}
        modal={false}
        preventScroll={false}
        onOpenChange={(open) => {
          if (!open) props.onCancel();
        }}
      >
        <AlertDialogPrimitive.Portal>
          <div class="modal-backdrop">
            <AlertDialogPrimitive.Overlay class="modal-backdrop__overlay" />
            <AlertDialogPrimitive.Content class="modal">
              <DialogShell
                title={<AlertDialogPrimitive.Title>{props.title}</AlertDialogPrimitive.Title>}
                description={
                  <Show when={props.description}>
                    {(description) => (
                      <AlertDialogPrimitive.Description>
                        {description()}
                      </AlertDialogPrimitive.Description>
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
            </AlertDialogPrimitive.Content>
          </div>
        </AlertDialogPrimitive.Portal>
      </AlertDialogPrimitive.Root>
    </Show>
  );
};
