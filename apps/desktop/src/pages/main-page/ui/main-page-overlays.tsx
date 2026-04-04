import { CommandPalette } from "../../../features/command-palette/ui/command-palette";
import { ModalDialog } from "../../../shared/ui/modal-dialog";
import { TextField } from "../../../shared/ui/text-field";
import { NotificationPanel } from "../../../widgets/notifications/notification-panel";
import { PermissionPromptModal } from "../../../widgets/permissions/permission-prompt-modal";
import { SettingsModal } from "../../../widgets/settings/settings-modal";
import { useMainPageContext } from "../model/main-page-context";

export const MainPageOverlays = () => {
  const { overlays } = useMainPageContext();

  return (
    <>
      <CommandPalette {...overlays.commandPalette} />
      <NotificationPanel {...overlays.notifications} />
      <SettingsModal {...overlays.settings} />
      <ModalDialog
        open={overlays.pageDialog.open}
        title={overlays.pageDialog.title()}
        confirmLabel={overlays.pageDialog.confirmLabel()}
        onConfirm={overlays.pageDialog.onConfirm}
        onCancel={overlays.pageDialog.onCancel}
        confirmDisabled={overlays.pageDialog.confirmDisabled}
      >
        <TextField
          class="modal__input"
          type="text"
          placeholder={
            overlays.pageDialog.mode() === "rename"
              ? "Page title"
              : "New page title"
          }
          value={overlays.pageDialog.value()}
          onInput={(event) =>
            overlays.pageDialog.setValue(event.currentTarget.value)
          }
        />
      </ModalDialog>
      <PermissionPromptModal {...overlays.permissionPrompt} />
    </>
  );
};
