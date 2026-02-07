type ShouldFocusModeInputArgs = {
  modeChanged: boolean;
  paletteOpen: boolean;
  settingsOpen: boolean;
  notificationsOpen: boolean;
  pageDialogOpen: boolean;
  permissionPromptOpen: boolean;
};

export const shouldFocusModeInput = ({
  modeChanged,
  paletteOpen,
  settingsOpen,
  notificationsOpen,
  pageDialogOpen,
  permissionPromptOpen
}: ShouldFocusModeInputArgs) =>
  modeChanged &&
  !paletteOpen &&
  !settingsOpen &&
  !notificationsOpen &&
  !pageDialogOpen &&
  !permissionPromptOpen;
