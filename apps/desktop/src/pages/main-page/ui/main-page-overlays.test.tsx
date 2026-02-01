import { render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import type { PageDialogMode } from "../model/page-dialog-utils";
import {
  MainPageProvider,
  type MainPageContextValue
} from "../model/main-page-context";

vi.mock("../../../features/command-palette/ui/command-palette", () => ({
  CommandPalette: () => <div data-testid="command-palette" />
}));
vi.mock("../../../widgets/settings/settings-modal", () => ({
  SettingsModal: () => <div data-testid="settings-modal" />
}));
vi.mock("../../../widgets/notifications/notification-panel", () => ({
  NotificationPanel: () => <div data-testid="notification-panel" />
}));
vi.mock("../../../widgets/permissions/permission-prompt-modal", () => ({
  PermissionPromptModal: () => <div data-testid="permission-prompt" />
}));

import { MainPageOverlays } from "./main-page-overlays";

describe("MainPageOverlays", () => {
  const buildContext = (mode: PageDialogMode) => {
    const [open] = createSignal(true);
    const [dialogMode, setDialogMode] = createSignal<PageDialogMode>(mode);
    const [value, setValue] = createSignal("");

    const overlays = {
      commandPalette: {} as MainPageContextValue["overlays"]["commandPalette"],
      settings: {} as MainPageContextValue["overlays"]["settings"],
      pageDialog: {
        open,
        title: () => "Dialog",
        confirmLabel: () => "Confirm",
        confirmDisabled: () => false,
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
        mode: dialogMode,
        value,
        setValue
      },
      notifications: {} as MainPageContextValue["overlays"]["notifications"],
      permissionPrompt: {} as MainPageContextValue["overlays"]["permissionPrompt"]
    } satisfies MainPageContextValue["overlays"];

    const contextValue = {
      workspace: {} as MainPageContextValue["workspace"],
      overlays
    } satisfies MainPageContextValue;

    return { contextValue, setDialogMode };
  };

  it("shows new page placeholder by default", () => {
    const { contextValue } = buildContext("new");

    render(() => (
      <MainPageProvider value={contextValue}>
        <MainPageOverlays />
      </MainPageProvider>
    ));

    expect(screen.getByPlaceholderText("New page title")).toBeInTheDocument();
  });

  it("updates placeholder when renaming", async () => {
    const { contextValue, setDialogMode } = buildContext("new");

    render(() => (
      <MainPageProvider value={contextValue}>
        <MainPageOverlays />
      </MainPageProvider>
    ));

    setDialogMode("rename");

    expect(await screen.findByPlaceholderText("Page title")).toBeInTheDocument();
  });
});
