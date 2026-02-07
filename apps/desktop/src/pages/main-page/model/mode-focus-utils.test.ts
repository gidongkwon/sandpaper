import { shouldFocusModeInput } from "./mode-focus-utils";

describe("shouldFocusModeInput", () => {
  it("returns false when mode did not change", () => {
    expect(
      shouldFocusModeInput({
        modeChanged: false,
        paletteOpen: false,
        settingsOpen: false,
        notificationsOpen: false,
        pageDialogOpen: false,
        permissionPromptOpen: false
      })
    ).toBe(false);
  });

  it("returns true only when no overlays are open", () => {
    expect(
      shouldFocusModeInput({
        modeChanged: true,
        paletteOpen: false,
        settingsOpen: false,
        notificationsOpen: false,
        pageDialogOpen: false,
        permissionPromptOpen: false
      })
    ).toBe(true);

    expect(
      shouldFocusModeInput({
        modeChanged: true,
        paletteOpen: true,
        settingsOpen: false,
        notificationsOpen: false,
        pageDialogOpen: false,
        permissionPromptOpen: false
      })
    ).toBe(false);

    expect(
      shouldFocusModeInput({
        modeChanged: true,
        paletteOpen: false,
        settingsOpen: true,
        notificationsOpen: false,
        pageDialogOpen: false,
        permissionPromptOpen: false
      })
    ).toBe(false);

    expect(
      shouldFocusModeInput({
        modeChanged: true,
        paletteOpen: false,
        settingsOpen: false,
        notificationsOpen: true,
        pageDialogOpen: false,
        permissionPromptOpen: false
      })
    ).toBe(false);

    expect(
      shouldFocusModeInput({
        modeChanged: true,
        paletteOpen: false,
        settingsOpen: false,
        notificationsOpen: false,
        pageDialogOpen: true,
        permissionPromptOpen: false
      })
    ).toBe(false);

    expect(
      shouldFocusModeInput({
        modeChanged: true,
        paletteOpen: false,
        settingsOpen: false,
        notificationsOpen: false,
        pageDialogOpen: false,
        permissionPromptOpen: true
      })
    ).toBe(false);
  });
});
