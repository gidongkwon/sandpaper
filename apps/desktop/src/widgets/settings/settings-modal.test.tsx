import { render, screen, within } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { vi } from "vitest";
import { SettingsModal } from "./settings-modal";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn()
}));

describe("SettingsModal", () => {
  const renderSettingsModal = () => {
    const [open] = createSignal(true);
    const [tab, setTab] = createSignal<
      "general" | "vault" | "sync" | "plugins" | "permissions" | "import"
    >("general");
    const [typeScale, setTypeScale] = createSignal(1);
    const [themeMode, setThemeMode] = createSignal<"light" | "dark" | "system">(
      "system"
    );
    const [showStatusSurfaces, setShowStatusSurfaces] = createSignal(true);
    const [formOpen, setFormOpen] = createSignal(false);
    const [newName, setNewName] = createSignal("");
    const [newPath, setNewPath] = createSignal("");
    const [passphrase, setPassphrase] = createSignal("");
    const [keyBusy] = createSignal(false);
    const [serverUrl, setServerUrl] = createSignal("");
    const [vaultIdInput, setVaultIdInput] = createSignal("");
    const [deviceIdInput, setDeviceIdInput] = createSignal("");
    const [busy] = createSignal(false);
    const [message] = createSignal<string | null>(null);
    const [commandStatus] = createSignal<string | null>(null);
    const [installPath, setInstallPath] = createSignal("");
    const [installing] = createSignal(false);
    const [importText, setImportText] = createSignal("");
    const [importStatus, setImportStatus] = createSignal<{
      state: "success" | "error";
      message: string;
    } | null>(null);
    const [exportStatus] = createSignal<{
      state: "success" | "error";
      message: string;
      preview?: string;
    } | null>(null);
    const [offlineExportStatus] = createSignal<{
      state: "success" | "error";
      message: string;
    } | null>(null);
    const [offlineImportFile, setOfflineImportFile] = createSignal<File | null>(null);
    const [offlineImportStatus, setOfflineImportStatus] = createSignal<{
      state: "success" | "error";
      message: string;
    } | null>(null);
    const [mergeDrafts, setMergeDrafts] = createStore<Record<string, string>>({});

    render(() => (
      <SettingsModal
        open={open}
        onClose={vi.fn()}
        tab={tab}
        setTab={setTab}
        isTauri={() => false}
        typeScale={{
          value: typeScale,
          set: setTypeScale,
          min: 0.8,
          max: 1.2,
          step: 0.05,
          defaultPosition: "50%"
        }}
        theme={{
          mode: themeMode,
          setMode: setThemeMode
        }}
        statusSurfaces={{
          showStatusSurfaces,
          setShowStatusSurfaces
        }}
        vault={{
          active: () => ({
            id: "default",
            name: "Default",
            path: "vault"
          }),
          list: () => [
            {
              id: "default",
              name: "Default",
              path: "vault"
            }
          ],
          applyActiveVault: vi.fn(),
          formOpen,
          setFormOpen,
          newName,
          setNewName,
          newPath,
          setNewPath,
          create: vi.fn(),
          shadowPendingCount: () => 0,
          keyStatus: () => ({
            configured: false,
            kdf: null,
            iterations: null,
            salt_b64: null
          }),
          passphrase,
          setPassphrase,
          keyBusy,
          setKey: vi.fn(),
          keyMessage: () => null
        }}
        sync={{
          status: () => ({
            state: "idle",
            pending_ops: 0,
            last_synced_at: null,
            last_error: null,
            last_push_count: 0,
            last_pull_count: 0,
            last_apply_count: 0
          }),
          stateLabel: () => "Disconnected",
          stateDetail: () => "Not connected",
          serverUrl,
          setServerUrl,
          vaultIdInput,
          setVaultIdInput,
          deviceIdInput,
          setDeviceIdInput,
          busy,
          connected: () => false,
          connect: vi.fn(),
          syncNow: vi.fn(),
          message,
          config: () => null,
          log: () => [],
          copyLog: vi.fn(),
          conflicts: () => [],
          resolveConflict: vi.fn(),
          startMerge: vi.fn(),
          cancelMerge: vi.fn(),
          mergeId: () => null,
          mergeDrafts,
          setMergeDrafts,
          getConflictPageTitle: () => "Untitled"
        }}
        plugins={{
          error: () => null,
          errorDetails: () => null,
          loadRuntime: vi.fn(),
          busy,
          list: () => [],
          commandStatus,
          status: () => null,
          requestGrant: vi.fn(),
          runCommand: vi.fn(),
          openPanel: vi.fn(),
          installPath,
          setInstallPath,
          installStatus: () => null,
          installing,
          installPlugin: vi.fn(),
          updatePlugin: vi.fn(),
          removePlugin: vi.fn(),
          clearInstallStatus: vi.fn(),
          manageStatus: () => ({}),
          settings: () => ({}),
          settingsDirty: () => ({}),
          settingsStatus: () => ({}),
          updateSetting: vi.fn(),
          resetSettings: vi.fn(),
          saveSettings: vi.fn(),
          devMode: () => false,
          setDevMode: vi.fn()
        }}
        importExport={{
          importText,
          setImportText,
          importStatus,
          setImportStatus,
          importing: () => false,
          importMarkdown: vi.fn(),
          exporting: () => false,
          exportMarkdown: vi.fn(),
          exportStatus,
          offlineExporting: () => false,
          exportOfflineArchive: vi.fn(),
          offlineExportStatus,
          offlineImporting: () => false,
          importOfflineArchive: vi.fn(),
          offlineImportFile,
          setOfflineImportFile,
          offlineImportStatus,
          setOfflineImportStatus
        }}
      />
    ));

    return { tab };
  };

  it("renders settings sections as accessible vertical tabs", async () => {
    renderSettingsModal();

    const dialog = screen.getByRole("dialog", { name: "Settings" });
    const tablist = within(dialog).getByRole("tablist", {
      name: "Settings sections"
    });

    expect(tablist).toHaveAttribute("aria-orientation", "vertical");
    expect(within(tablist).getByRole("tab", { name: "General" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByText("Typography")).toBeInTheDocument();
  });

  it("switches sections with click and keyboard navigation", async () => {
    const user = userEvent.setup();
    const { tab } = renderSettingsModal();

    const generalTab = screen.getByRole("tab", { name: "General" });
    const vaultTab = screen.getByRole("tab", { name: "Vault" });

    await user.click(vaultTab);
    expect(tab()).toBe("vault");
    expect(vaultTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Active Vault")).toBeInTheDocument();

    generalTab.focus();
    await user.keyboard("{ArrowDown}");

    expect(tab()).toBe("vault");
    expect(vaultTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Encryption Key")).toBeInTheDocument();
  });
});
