import { createSignal, type Accessor } from "solid-js";
import type { VaultConfig, VaultRecord } from "../../../entities/vault/model/vault-types";

type InvokeFn = typeof import("@tauri-apps/api/core").invoke;

type VaultDeps = {
  isTauri: () => boolean;
  invoke: InvokeFn;
  activePageUid: Accessor<string>;
  persistActivePage: (pageUid: string) => Promise<void>;
  loadActivePage: () => Promise<void>;
  loadBlocks: (pageUid: string) => Promise<void>;
  loadPages: () => Promise<void>;
  ensureDailyNote: () => Promise<void>;
  loadPlugins: () => Promise<void>;
  loadVaultKeyStatus: () => Promise<void>;
  loadSyncConfig: () => Promise<void>;
  loadReviewSummary: () => Promise<void>;
  loadReviewQueue: () => Promise<void>;
  markSaved: () => void;
  clearExportStatus: () => void;
  clearActivePanel: () => void;
  clearCommandStatus: () => void;
  defaultPageUid: string;
  state?: {
    vaults: Accessor<VaultRecord[]>;
    setVaults: (value: VaultRecord[] | ((prev: VaultRecord[]) => VaultRecord[])) => void;
    activeVault: Accessor<VaultRecord | null>;
    setActiveVault: (value: VaultRecord | null) => void;
    vaultFormOpen: Accessor<boolean>;
    setVaultFormOpen: (value: boolean) => void;
    newVaultName: Accessor<string>;
    setNewVaultName: (value: string) => void;
    newVaultPath: Accessor<string>;
    setNewVaultPath: (value: string) => void;
  };
};

export const createVaultState = (deps: VaultDeps) => {
  const [internalVaults, setInternalVaults] = createSignal<VaultRecord[]>([]);
  const [internalActiveVault, setInternalActiveVault] =
    createSignal<VaultRecord | null>(null);
  const [internalVaultFormOpen, setInternalVaultFormOpen] =
    createSignal(false);
  const [internalNewVaultName, setInternalNewVaultName] = createSignal("");
  const [internalNewVaultPath, setInternalNewVaultPath] = createSignal("");

  const vaults = deps.state?.vaults ?? internalVaults;
  const setVaults = deps.state?.setVaults ?? setInternalVaults;
  const activeVault = deps.state?.activeVault ?? internalActiveVault;
  const setActiveVault = deps.state?.setActiveVault ?? setInternalActiveVault;
  const vaultFormOpen = deps.state?.vaultFormOpen ?? internalVaultFormOpen;
  const setVaultFormOpen =
    deps.state?.setVaultFormOpen ?? setInternalVaultFormOpen;
  const newVaultName = deps.state?.newVaultName ?? internalNewVaultName;
  const setNewVaultName =
    deps.state?.setNewVaultName ?? setInternalNewVaultName;
  const newVaultPath = deps.state?.newVaultPath ?? internalNewVaultPath;
  const setNewVaultPath =
    deps.state?.setNewVaultPath ?? setInternalNewVaultPath;

  const loadVaults = async () => {
    if (!deps.isTauri()) {
      const fallback = {
        id: "local",
        name: "Sandpaper",
        path: "/vaults/sandpaper"
      };
      setVaults([fallback]);
      setActiveVault(fallback);
      await deps.loadActivePage();
      await deps.loadBlocks(deps.activePageUid());
      await deps.loadPages();
      await deps.ensureDailyNote();
      await deps.loadPlugins();
      await deps.loadVaultKeyStatus();
      await deps.loadSyncConfig();
      await deps.loadReviewSummary();
      await deps.loadReviewQueue();
      return;
    }

    try {
      const config = (await deps.invoke("list_vaults")) as VaultConfig;
      const entries = config.vaults ?? [];
      setVaults(entries);
      const active =
        entries.find((vault) => vault.id === config.active_id) ??
        entries[0] ??
        null;
      setActiveVault(active);
      await deps.loadActivePage();
      await deps.loadBlocks(deps.activePageUid());
      await deps.loadPages();
      await deps.ensureDailyNote();
      await deps.loadPlugins();
      await deps.loadVaultKeyStatus();
      await deps.loadSyncConfig();
      await deps.loadReviewSummary();
      await deps.loadReviewQueue();
    } catch (error) {
      console.error("Failed to load vaults", error);
    }
  };

  const applyActiveVault = async (vaultId: string) => {
    const nextVault = vaults().find((vault) => vault.id === vaultId) ?? null;
    setActiveVault(nextVault);
    if (!deps.isTauri()) return;
    await deps.invoke("set_active_vault", {
      vaultId,
      vault_id: vaultId
    });
    deps.clearExportStatus();
    deps.clearActivePanel();
    deps.clearCommandStatus();
    await deps.loadActivePage();
    await deps.loadBlocks(deps.activePageUid());
    await deps.loadPages();
    await deps.ensureDailyNote();
    await deps.loadPlugins();
    await deps.loadVaultKeyStatus();
    await deps.loadSyncConfig();
    await deps.loadReviewSummary();
    await deps.loadReviewQueue();
  };

  const createVault = async () => {
    const name = newVaultName().trim();
    const path = newVaultPath().trim();
    if (!name || !path) return;

    if (deps.isTauri()) {
      await deps.invoke("create_vault", { name, path });
      await loadVaults();
    } else {
      const id = globalThis.crypto?.randomUUID?.() ?? `local-${Date.now()}`;
      const record = { id, name, path };
      setVaults((prev) => [...prev, record]);
      setActiveVault(record);
      await deps.persistActivePage(deps.defaultPageUid);
      await deps.loadBlocks(deps.activePageUid());
      await deps.loadPages();
      await deps.ensureDailyNote();
      await deps.loadPlugins();
      await deps.loadVaultKeyStatus();
      await deps.loadSyncConfig();
      await deps.loadReviewSummary();
      await deps.loadReviewQueue();
    }

    setVaultFormOpen(false);
    setNewVaultName("");
    setNewVaultPath("");
    deps.markSaved();
  };

  return {
    vaults,
    activeVault,
    vaultFormOpen,
    setVaultFormOpen,
    newVaultName,
    setNewVaultName,
    newVaultPath,
    setNewVaultPath,
    loadVaults,
    applyActiveVault,
    createVault
  };
};
