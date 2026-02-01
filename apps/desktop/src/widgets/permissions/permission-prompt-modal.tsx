import { Show, type Accessor } from "solid-js";
import type { PermissionPrompt } from "../../entities/plugin/model/plugin-types";

type PermissionPromptModalProps = {
  prompt: Accessor<PermissionPrompt | null>;
  onDeny: () => void;
  onAllow: () => void;
};

export const PermissionPromptModal = (props: PermissionPromptModalProps) => {
  return (
    <Show when={props.prompt()}>
      {(prompt) => (
        <div class="modal-backdrop" role="presentation">
          <div class="modal" role="dialog" aria-modal="true">
            <div class="modal__header">
              <h3>Grant permission</h3>
            </div>
            <div class="modal__body">
              <p>
                Allow <strong>{prompt().pluginName}</strong> to use{" "}
                <strong>{prompt().permission}</strong>?
              </p>
            </div>
            <div class="modal__actions">
              <button class="modal__button" onClick={() => props.onDeny()}>
                Deny
              </button>
              <button class="modal__button is-primary" onClick={() => props.onAllow()}>
                Allow
              </button>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
};
