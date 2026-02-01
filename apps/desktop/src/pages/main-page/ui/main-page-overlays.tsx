import { CommandPalette } from "../../../features/command-palette/ui/command-palette";
import { ConfirmDialog } from "../../../shared/ui/confirm-dialog";
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
      <ConfirmDialog
        open={overlays.pageDialog.open}
        title={overlays.pageDialog.title()}
        confirmLabel={overlays.pageDialog.confirmLabel()}
        onConfirm={overlays.pageDialog.onConfirm}
        onCancel={overlays.pageDialog.onCancel}
        confirmDisabled={overlays.pageDialog.confirmDisabled}
      >
        <input
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
      </ConfirmDialog>
      <PermissionPromptModal {...overlays.permissionPrompt} />
    </>
  );
};
