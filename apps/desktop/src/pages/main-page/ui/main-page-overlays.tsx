import type { Accessor, Setter } from "solid-js";
import { CommandPalette } from "../../../features/command-palette/ui/command-palette";
import { ConfirmDialog } from "../../../shared/ui/confirm-dialog";
import { PermissionPromptModal } from "../../../widgets/permissions/permission-prompt-modal";
import { SettingsModal } from "../../../widgets/settings/settings-modal";
import type { PageDialogMode } from "../model/page-dialog-utils";

type PropsOf<T> = T extends (props: infer P) => unknown ? P : never;

type PageDialogProps = {
  open: Accessor<boolean>;
  title: Accessor<string>;
  confirmLabel: Accessor<string>;
  confirmDisabled: Accessor<boolean>;
  onConfirm: () => void;
  onCancel: () => void;
  mode: Accessor<PageDialogMode>;
  value: Accessor<string>;
  setValue: Setter<string>;
};

type MainPageOverlaysProps = {
  commandPalette: PropsOf<typeof CommandPalette>;
  settings: PropsOf<typeof SettingsModal>;
  pageDialog: PageDialogProps;
  permissionPrompt: PropsOf<typeof PermissionPromptModal>;
};

export const MainPageOverlays = (props: MainPageOverlaysProps) => {
  return (
    <>
      <CommandPalette {...props.commandPalette} />
      <SettingsModal {...props.settings} />
      <ConfirmDialog
        open={props.pageDialog.open}
        title={props.pageDialog.title()}
        confirmLabel={props.pageDialog.confirmLabel()}
        onConfirm={props.pageDialog.onConfirm}
        onCancel={props.pageDialog.onCancel}
        confirmDisabled={props.pageDialog.confirmDisabled}
      >
        <input
          class="modal__input"
          type="text"
          placeholder={
            props.pageDialog.mode() === "rename"
              ? "Page title"
              : "New page title"
          }
          value={props.pageDialog.value()}
          onInput={(event) => props.pageDialog.setValue(event.currentTarget.value)}
        />
      </ConfirmDialog>
      <PermissionPromptModal {...props.permissionPrompt} />
    </>
  );
};
