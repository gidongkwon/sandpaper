import { Show, createMemo, type Accessor, type Setter } from "solid-js";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { VaultKeyStatus, VaultRecord } from "../../entities/vault/model/vault-types";
import type { VaultId } from "../../shared/model/id-types";
import { Button } from "../../shared/ui/button";
import { SelectField, type SelectFieldOption } from "../../shared/ui/select-field";
import { TextField } from "../../shared/ui/text-field";

export type RagEmbeddingModelId = string;
export type RagEmbeddingModelOption = {
  id: RagEmbeddingModelId;
  label: string;
  requiresDownload: boolean;
  experimental: boolean;
};
export type RagModelDownloadState =
  | "downloading"
  | "verifying"
  | "cancel_requested"
  | "completed"
  | "failed"
  | "canceled";

export type RagModelDownloadStatus = {
  model: RagEmbeddingModelId;
  state: RagModelDownloadState;
  progress: number;
  message: string;
  canCancel: boolean;
};

export type RagRebuildState = "queued" | "running" | "completed" | "failed";

export type RagRebuildStatus = {
  state: RagRebuildState;
  progress: number;
  processedPages: number;
  totalPages: number;
  currentPageTitle?: string | null;
  message: string;
  canCancel: boolean;
  summary?: {
    pagesIndexed: number;
    changedPages: number;
    chunksWritten: number;
    elapsedMs: number;
    pageLoadMs: number;
    chunkingMs: number;
    providerInitMs: number;
    firstBatchMs: number;
    embeddingMs: number;
    writeMs: number;
    slowPages?: Array<{
      pageUid: string;
      title: string;
      chunkCount: number;
      pageLoadMs: number;
      chunkingMs: number;
      providerInitMs: number;
      firstBatchMs: number;
      embeddingMs: number;
      writeMs: number;
      totalMs: number;
    }>;
  } | null;
  error?: string | null;
};

export type RagStatus = {
  indexExists: boolean;
  indexedPages: number;
  indexedChunks: number;
  dirtyPages: number;
  availableEmbeddingModels: RagEmbeddingModelOption[];
  selectedEmbeddingModel: RagEmbeddingModelId;
  selectedEmbeddingModelReady: boolean;
  selectedEmbeddingModelActive: boolean;
  embeddingStatusMessage?: string | null;
  lastFullRebuildAt?: number | null;
  lastIncrementalRunAt?: number | null;
  embeddingProvider?: string | null;
  embeddingModel?: string | null;
  modelDownload?: RagModelDownloadStatus | null;
  rebuildStatus?: RagRebuildStatus | null;
};

type SettingsVaultProps = {
  active: Accessor<VaultRecord | null>;
  list: Accessor<VaultRecord[]>;
  applyActiveVault: (id: VaultId) => void;
  formOpen: Accessor<boolean>;
  setFormOpen: Setter<boolean>;
  newName: Accessor<string>;
  setNewName: Setter<string>;
  newPath: Accessor<string>;
  setNewPath: Setter<string>;
  create: () => void | Promise<void>;
  shadowPendingCount: Accessor<number>;
  keyStatus: Accessor<VaultKeyStatus>;
  passphrase: Accessor<string>;
  setPassphrase: Setter<string>;
  keyBusy: Accessor<boolean>;
  setKey: () => void | Promise<void>;
  keyMessage: Accessor<string | null>;
  ragStatus: Accessor<RagStatus | null>;
  ragBusy: Accessor<boolean>;
  ragUpdatingModel: Accessor<boolean>;
  setRagEmbeddingModel: (model: RagEmbeddingModelId) => void | Promise<void>;
  prepareRagEmbeddingModel: () => void | Promise<void>;
  cancelRagEmbeddingModelDownload: () => void | Promise<void>;
  rebuildRagIndex: () => void | Promise<void>;
  ragMessage: Accessor<string | null>;
};

type SettingsVaultTabProps = {
  isTauri: () => boolean;
  vault: SettingsVaultProps;
};

export const SettingsVaultTab = (props: SettingsVaultTabProps) => {
  let vaultFolderPickerRef: HTMLInputElement | undefined;
  const vaultOptions = createMemo<SelectFieldOption[]>(() =>
    props.vault.list().map((entry) => ({
      value: entry.id,
      label: entry.name
    }))
  );

  const ragStatus = createMemo(() => props.vault.ragStatus());

  const getFolderFromFile = (file: File) => {
    const withPath = file as File & { path?: string; webkitRelativePath?: string };
    if (withPath.path) return withPath.path;
    if (withPath.webkitRelativePath) {
      return withPath.webkitRelativePath.split("/")[0] || "";
    }
    return file.name.replace(/\.[^/.]+$/, "");
  };

  const openVaultFolderPicker = async () => {
    if (props.isTauri()) {
      const selection = await openDialog({
        directory: true,
        multiple: false
      });
      if (typeof selection === "string") {
        props.vault.setNewPath(selection);
      }
      return;
    }
    vaultFolderPickerRef?.click();
  };

  const handleVaultFolderPick = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const nextPath = getFolderFromFile(file);
    if (nextPath) {
      props.vault.setNewPath(nextPath);
    }
    input.value = "";
  };

  const ragProviderLabel = () => {
    const status = ragStatus();
    if (!status?.embeddingProvider || !status.embeddingModel) {
      return "Not configured";
    }
    return `${status.embeddingProvider} / ${status.embeddingModel}`;
  };

  const embeddingOptions = createMemo<SelectFieldOption[]>(() =>
    (ragStatus()?.availableEmbeddingModels ?? []).map((model) => ({
      value: model.id,
      label: model.experimental ? `${model.label} (Experimental)` : model.label
    }))
  );

  const selectedModel = createMemo(() => {
    const status = ragStatus();
    return status?.availableEmbeddingModels.find(
      (model) => model.id === status.selectedEmbeddingModel
    );
  });

  const selectedModelRequiresDownload = () => selectedModel()?.requiresDownload ?? false;

  const selectedModelNeedsRepair = () => {
    const status = ragStatus();
    if (!status) return false;
    return (
      selectedModelRequiresDownload() &&
      status.selectedEmbeddingModelReady &&
      !status.selectedEmbeddingModelActive
    );
  };

  const activeDownload = () => {
    const status = ragStatus();
    if (!status?.modelDownload) return null;
    return status.modelDownload.model === status.selectedEmbeddingModel
      ? status.modelDownload
      : null;
  };
  const isDownloadActive = () => {
    const state = activeDownload()?.state;
    return (
      state === "downloading" ||
      state === "verifying" ||
      state === "cancel_requested"
    );
  };

  const ragReadinessMessage = () => {
    const status = ragStatus();
    if (!status) return null;
    if (status.embeddingStatusMessage) {
      return status.embeddingStatusMessage;
    }
    if (status.dirtyPages > 0) {
      return `${status.dirtyPages} page${status.dirtyPages === 1 ? "" : "s"} need reindexing for the current embedding model.`;
    }
    return null;
  };

  const ragReadinessTone = () => {
    const status = ragStatus();
    if (!status) return "info";
    if (status.embeddingStatusMessage) {
      return "warning";
    }
    if (status.dirtyPages > 0) {
      return "warning";
    }
    return "success";
  };

  const embeddingModelBusy = () =>
    props.vault.ragUpdatingModel() || isDownloadActive();

  const rebuildStatus = createMemo(() => ragStatus()?.rebuildStatus ?? null);
  const isRebuildActive = () => {
    const state = rebuildStatus()?.state;
    return state === "queued" || state === "running";
  };

  return (
    <>
      <div class="settings-section">
        <h3 class="settings-section__title">Active Vault</h3>
        <SelectField
          label="Active Vault"
          value={props.vault.active()?.id ?? ""}
          options={vaultOptions()}
          disabled={props.vault.ragUpdatingModel()}
          onChange={(value) => props.vault.applyActiveVault(value)}
          triggerClass="settings-select"
          contentClass="settings-select__content"
          listboxClass="settings-select__listbox"
          itemClass="settings-select__item"
          itemLabelClass="settings-select__item-label"
        />
        <Button
          variant="surface"
          size="sm"
          onClick={() => props.vault.setFormOpen((prev) => !prev)}
        >
          {props.vault.formOpen() ? "Cancel" : "New vault"}
        </Button>
        <Show when={props.vault.formOpen()}>
          <div class="settings-form">
            <TextField
              type="text"
              placeholder="Vault name"
              value={props.vault.newName()}
              onInput={(e) => props.vault.setNewName(e.currentTarget.value)}
            />
            <div class="settings-file-row">
              <TextField
                type="text"
                placeholder="Vault path"
                value={props.vault.newPath()}
                onInput={(e) => props.vault.setNewPath(e.currentTarget.value)}
              />
              <Button
                variant="surface"
                size="sm"
                onClick={openVaultFolderPicker}
              >
                Browse
              </Button>
            </div>
            <input
              ref={(el) => {
                vaultFolderPickerRef = el;
                el.setAttribute("webkitdirectory", "");
                el.setAttribute("directory", "");
              }}
              data-testid="vault-folder-picker"
              class="settings-file-input"
              type="file"
              onChange={handleVaultFolderPick}
            />
            <Button
              variant="primary"
              size="sm"
              onClick={() => void props.vault.create()}
            >
              Create vault
            </Button>
          </div>
        </Show>
        <div class="settings-row">
          <label class="settings-label">Shadow write queue</label>
          <span
            class={`settings-value ${
              props.vault.shadowPendingCount() > 0 ? "is-warning" : "is-success"
            }`}
          >
            {props.vault.shadowPendingCount()} pending
          </span>
        </div>
      </div>
      <div class="settings-section">
        <h3 class="settings-section__title">RAG Index</h3>
        <p class="settings-section__desc">
          Built-in lexical, vector, and answer retrieval index for this vault.
        </p>
        <div class="settings-row">
          <label class="settings-label">Status</label>
          <span
            class={`settings-value ${
              ragStatus()?.indexExists ? "is-success" : "is-warning"
            }`}
          >
            {ragStatus()?.indexExists ? "Ready" : "Not built"}
          </span>
        </div>
        <div class="settings-row">
          <label class="settings-label">Coverage</label>
          <span class="settings-value">
            {ragStatus()?.indexedPages ?? 0} pages /{" "}
            {ragStatus()?.indexedChunks ?? 0} chunks
          </span>
        </div>
        <div class="settings-row">
          <label class="settings-label">Dirty pages</label>
          <span class="settings-value">{ragStatus()?.dirtyPages ?? 0} dirty</span>
        </div>
        <div class="settings-row">
          <label class="settings-label">Embedding model</label>
          <div class="settings-row__controls">
            <SelectField
              label="Embedding model"
              value={ragStatus()?.selectedEmbeddingModel ?? "local"}
              options={embeddingOptions()}
              disabled={embeddingModelBusy()}
              onChange={(value) =>
                void props.vault.setRagEmbeddingModel(value as RagEmbeddingModelId)
              }
              triggerClass="settings-select"
              contentClass="settings-select__content"
              listboxClass="settings-select__listbox"
              itemClass="settings-select__item"
              itemLabelClass="settings-select__item-label"
            />
            <Show
              when={
                selectedModelRequiresDownload() &&
                (!ragStatus()?.selectedEmbeddingModelReady ||
                  selectedModelNeedsRepair()) &&
                !isDownloadActive()
              }
            >
              <Button
                variant="surface"
                size="sm"
                disabled={props.vault.ragUpdatingModel()}
                onClick={() => void props.vault.prepareRagEmbeddingModel()}
              >
                {selectedModelNeedsRepair() ? "Repair" : "Download"}
              </Button>
            </Show>
            <Show when={isDownloadActive()}>
              <Button
                variant="surface"
                size="sm"
                disabled={!activeDownload()?.canCancel}
                onClick={() => void props.vault.cancelRagEmbeddingModelDownload()}
              >
                Cancel
              </Button>
            </Show>
          </div>
        </div>
        <Show when={activeDownload()}>
          <div class="settings-download">
            <div class="settings-download__header">
              <span class="settings-label">Model download</span>
              <span class="settings-value">
                {Math.round((activeDownload()?.progress ?? 0) * 100)}%
              </span>
            </div>
            <progress
              class="settings-progress"
              data-testid="rag-model-download-progress"
              max="1"
              value={Math.min(Math.max(activeDownload()?.progress ?? 0, 0), 1)}
            />
            <div class="settings-download__message">{activeDownload()?.message}</div>
          </div>
        </Show>
        <Show when={rebuildStatus()}>
          <div class="settings-download">
            <div class="settings-download__header">
              <span class="settings-label">Index rebuild</span>
              <span class="settings-value">
                {Math.round((rebuildStatus()?.progress ?? 0) * 100)}%
              </span>
            </div>
            <progress
              class="settings-progress"
              data-testid="rag-rebuild-progress"
              max="1"
              value={Math.min(Math.max(rebuildStatus()?.progress ?? 0, 0), 1)}
            />
            <div class="settings-download__message">{rebuildStatus()?.message}</div>
            <div class="settings-download__message">
              {rebuildStatus()?.processedPages ?? 0} / {rebuildStatus()?.totalPages ?? 0} pages
            </div>
          </div>
        </Show>
        <div class="settings-row">
          <label class="settings-label">Active provider</label>
          <span class="settings-value">{ragProviderLabel()}</span>
        </div>
        <div class="settings-actions">
          <Button
            variant="primary"
            size="sm"
            disabled={
              props.vault.ragBusy() ||
              props.vault.ragUpdatingModel() ||
              isRebuildActive()
            }
            onClick={() => void props.vault.rebuildRagIndex()}
          >
            {isRebuildActive() || props.vault.ragBusy() ? "Rebuilding..." : "Rebuild index"}
          </Button>
        </div>
        <Show when={ragReadinessMessage()}>
          <div class={`settings-callout settings-callout--${ragReadinessTone()}`}>
            {ragReadinessMessage()}
          </div>
        </Show>
        <Show when={props.vault.ragMessage()}>
          <div class="settings-message">{props.vault.ragMessage()}</div>
        </Show>
      </div>
      <div class="settings-section">
        <h3 class="settings-section__title">Encryption Key</h3>
        <p class="settings-section__desc">
          {props.vault.keyStatus().configured
            ? `Configured (${props.vault.keyStatus().kdf ?? "pbkdf2-sha256"})`
            : "Set a passphrase to enable E2E encryption."}
        </p>
        <TextField
          type="password"
          placeholder="Passphrase"
          value={props.vault.passphrase()}
          onInput={(e) => props.vault.setPassphrase(e.currentTarget.value)}
        />
        <div class="settings-actions">
          <Button
            variant="primary"
            size="sm"
            disabled={
              props.vault.keyBusy() || !props.vault.passphrase().trim()
            }
            onClick={() => void props.vault.setKey()}
          >
            {props.vault.keyBusy() ? "Deriving..." : "Set passphrase"}
          </Button>
          <Button
            variant="surface"
            size="sm"
            onClick={() => props.vault.setPassphrase("")}
          >
            Clear
          </Button>
        </div>
        <Show when={props.vault.keyMessage()}>
          <div class="settings-message">{props.vault.keyMessage()}</div>
        </Show>
      </div>
    </>
  );
};
