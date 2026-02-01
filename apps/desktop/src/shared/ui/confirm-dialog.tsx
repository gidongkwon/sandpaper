import { Show, createUniqueId, type Accessor, type JSX } from "solid-js";
import { Button } from "./button";

type ConfirmDialogProps = {
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

export const ConfirmDialog = (props: ConfirmDialogProps) => {
  const titleId = createUniqueId();
  const descriptionId = createUniqueId();
  const confirmDisabled = () => {
    if (typeof props.confirmDisabled === "function") {
      return props.confirmDisabled();
    }
    return props.confirmDisabled ?? false;
  };

  return (
    <Show when={props.open()}>
      <div class="modal-backdrop" role="presentation">
        <div
          class="modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={props.description ? descriptionId : undefined}
        >
          <div class="modal__header">
            <h3 id={titleId}>{props.title}</h3>
          </div>
          <div class="modal__body">
            <Show when={props.description}>
              {(description) => <p id={descriptionId}>{description()}</p>}
            </Show>
            {props.children}
          </div>
          <div class="modal__actions">
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
          </div>
        </div>
      </div>
    </Show>
  );
};
