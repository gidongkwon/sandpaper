import { Show, type Accessor } from "solid-js";
import type { PermissionPrompt } from "../../entities/plugin/model/plugin-types";
import { AlertDialog } from "../../shared/ui/alert-dialog";

type PermissionPromptModalProps = {
  prompt: Accessor<PermissionPrompt | null>;
  onDeny: () => void;
  onAllow: () => void;
};

export const PermissionPromptModal = (props: PermissionPromptModalProps) => {
  return (
    <Show when={props.prompt()}>
      {(prompt) => (
        <AlertDialog
          open={() => props.prompt() !== null}
          title="Grant permission"
          cancelLabel="Deny"
          confirmLabel="Allow"
          onCancel={props.onDeny}
          onConfirm={props.onAllow}
        >
          <p>
            Allow <strong>{prompt().pluginName}</strong> to use{" "}
            <strong>{prompt().permission}</strong>?
          </p>
        </AlertDialog>
      )}
    </Show>
  );
};
