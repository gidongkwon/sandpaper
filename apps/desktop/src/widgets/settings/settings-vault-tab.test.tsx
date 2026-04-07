import { render, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { createSignal } from "solid-js";
import { vi } from "vitest";
import { SettingsVaultTab } from "./settings-vault-tab";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn()
}));

describe("SettingsVaultTab", () => {
  it("renders rag index status and rebuild action", async () => {
    const [formOpen, setFormOpen] = createSignal(false);
    const [newName, setNewName] = createSignal("");
    const [newPath, setNewPath] = createSignal("");
    const [passphrase, setPassphrase] = createSignal("");
    const [ragBusy, setRagBusy] = createSignal(false);
    const rebuild = vi.fn(async () => {
      setRagBusy(true);
      setRagBusy(false);
    });
    const user = userEvent.setup();

    render(() => (
      <SettingsVaultTab
        isTauri={() => false}
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
          keyBusy: () => false,
          setKey: vi.fn(),
          keyMessage: () => null,
          ragStatus: () => ({
            indexExists: true,
            indexedPages: 3,
            indexedChunks: 9,
            dirtyPages: 1,
            availableEmbeddingModels: [
              {
                id: "local",
                label: "Local substring/trigram",
                requiresDownload: false,
                experimental: false
              }
            ],
            selectedEmbeddingModel: "local",
            selectedEmbeddingModelReady: true,
            selectedEmbeddingModelActive: true,
            embeddingStatusMessage: null,
            lastFullRebuildAt: null,
            lastIncrementalRunAt: null,
            embeddingProvider: "local",
            embeddingModel: "hashed-trigram-v1",
            modelDownload: null
          }),
          ragBusy,
          ragUpdatingModel: () => false,
          setRagEmbeddingModel: vi.fn(),
          prepareRagEmbeddingModel: vi.fn(),
          cancelRagEmbeddingModelDownload: vi.fn(),
          rebuildRagIndex: rebuild,
          ragMessage: () => "Index ready"
        }}
      />
    ));

    expect(screen.getByText("RAG Index")).toBeInTheDocument();
    expect(screen.getByText("3 pages / 9 chunks")).toBeInTheDocument();
    expect(screen.getByText("1 dirty")).toBeInTheDocument();
    expect(screen.getByText("local / hashed-trigram-v1")).toBeInTheDocument();
    expect(
      screen.getByText("1 page need reindexing for the current embedding model.")
    ).toBeInTheDocument();
    expect(screen.getByText("Index ready")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /rebuild index/i }));
    expect(rebuild).toHaveBeenCalledTimes(1);
  });

  it("shows generic model download progress and cancel action", async () => {
    const cancelDownload = vi.fn();
    const user = userEvent.setup();

    render(() => (
      <SettingsVaultTab
        isTauri={() => false}
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
          formOpen: () => false,
          setFormOpen: vi.fn(),
          newName: () => "",
          setNewName: vi.fn(),
          newPath: () => "",
          setNewPath: vi.fn(),
          create: vi.fn(),
          shadowPendingCount: () => 0,
          keyStatus: () => ({
            configured: false,
            kdf: null,
            iterations: null,
            salt_b64: null
          }),
          passphrase: () => "",
          setPassphrase: vi.fn(),
          keyBusy: () => false,
          setKey: vi.fn(),
          keyMessage: () => null,
          ragStatus: () => ({
            indexExists: false,
            indexedPages: 0,
            indexedChunks: 0,
            dirtyPages: 4,
            availableEmbeddingModels: [
              {
                id: "local",
                label: "Local substring/trigram",
                requiresDownload: false,
                experimental: false
              },
              {
                id: "pplx",
                label: "pplx-embed-v1-0.6b",
                requiresDownload: true,
                experimental: true
              }
            ],
            selectedEmbeddingModel: "pplx",
            selectedEmbeddingModelReady: false,
            selectedEmbeddingModelActive: false,
            embeddingStatusMessage:
              "pplx-embed-v1-0.6b is selected but not downloaded yet. Download the model before rebuilding the index.",
            lastFullRebuildAt: null,
            lastIncrementalRunAt: null,
            embeddingProvider: "local",
            embeddingModel: "hashed-trigram-v1",
            modelDownload: {
              model: "pplx",
              state: "downloading",
              progress: 0.42,
              message: "Downloading model",
              canCancel: true
            }
          }),
          ragBusy: () => false,
          ragUpdatingModel: () => false,
          setRagEmbeddingModel: vi.fn(),
          prepareRagEmbeddingModel: vi.fn(),
          cancelRagEmbeddingModelDownload: cancelDownload,
          rebuildRagIndex: vi.fn(),
          ragMessage: () => null
        }}
      />
    ));

    expect(screen.getByRole("button", { name: /embedding model/i })).toBeInTheDocument();
    expect(screen.getByTestId("rag-model-download-progress")).toHaveValue(0.42);
    expect(screen.getByText("Downloading model")).toBeInTheDocument();
    expect(
      screen.getByText(
        "pplx-embed-v1-0.6b is selected but not downloaded yet. Download the model before rebuilding the index."
      )
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(cancelDownload).toHaveBeenCalledTimes(1);
  });

  it("shows repair guidance when the selected downloaded model falls back to local provider", async () => {
    const repairModel = vi.fn();
    const user = userEvent.setup();

    render(() => (
      <SettingsVaultTab
        isTauri={() => false}
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
          formOpen: () => false,
          setFormOpen: vi.fn(),
          newName: () => "",
          setNewName: vi.fn(),
          newPath: () => "",
          setNewPath: vi.fn(),
          create: vi.fn(),
          shadowPendingCount: () => 0,
          keyStatus: () => ({
            configured: false,
            kdf: null,
            iterations: null,
            salt_b64: null
          }),
          passphrase: () => "",
          setPassphrase: vi.fn(),
          keyBusy: () => false,
          setKey: vi.fn(),
          keyMessage: () => null,
          ragStatus: () => ({
            indexExists: true,
            indexedPages: 4,
            indexedChunks: 12,
            dirtyPages: 0,
            availableEmbeddingModels: [
              {
                id: "local",
                label: "Local substring/trigram",
                requiresDownload: false,
                experimental: false
              },
              {
                id: "pplx",
                label: "pplx-embed-v1-0.6b",
                requiresDownload: true,
                experimental: true
              }
            ],
            selectedEmbeddingModel: "pplx",
            selectedEmbeddingModelReady: true,
            selectedEmbeddingModelActive: false,
            embeddingStatusMessage:
              "pplx-embed-v1-0.6b is selected but the app fell back to the local provider. Repair the model to retry loading.",
            lastFullRebuildAt: null,
            lastIncrementalRunAt: null,
            embeddingProvider: "local",
            embeddingModel: "hashed-trigram-v1",
            modelDownload: null
          }),
          ragBusy: () => false,
          ragUpdatingModel: () => false,
          setRagEmbeddingModel: vi.fn(),
          prepareRagEmbeddingModel: repairModel,
          cancelRagEmbeddingModelDownload: vi.fn(),
          rebuildRagIndex: vi.fn(),
          ragMessage: () => null
        }}
      />
    ));

    expect(
      screen.getByText(
        "pplx-embed-v1-0.6b is selected but the app fell back to the local provider. Repair the model to retry loading."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /repair/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /repair/i }));
    expect(repairModel).toHaveBeenCalledTimes(1);
  });

  it("disables embedding model actions while the model selection is updating", () => {
    render(() => (
      <SettingsVaultTab
        isTauri={() => false}
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
          formOpen: () => false,
          setFormOpen: vi.fn(),
          newName: () => "",
          setNewName: vi.fn(),
          newPath: () => "",
          setNewPath: vi.fn(),
          create: vi.fn(),
          shadowPendingCount: () => 0,
          keyStatus: () => ({
            configured: false,
            kdf: null,
            iterations: null,
            salt_b64: null
          }),
          passphrase: () => "",
          setPassphrase: vi.fn(),
          keyBusy: () => false,
          setKey: vi.fn(),
          keyMessage: () => null,
          ragStatus: () => ({
            indexExists: true,
            indexedPages: 4,
            indexedChunks: 12,
            dirtyPages: 2,
            availableEmbeddingModels: [
              {
                id: "local",
                label: "Local substring/trigram",
                requiresDownload: false,
                experimental: false
              },
              {
                id: "pplx",
                label: "pplx-embed-v1-0.6b",
                requiresDownload: true,
                experimental: true
              }
            ],
            selectedEmbeddingModel: "pplx",
            selectedEmbeddingModelReady: false,
            selectedEmbeddingModelActive: false,
            embeddingStatusMessage:
              "pplx-embed-v1-0.6b is selected but not downloaded yet. Download the model before rebuilding the index.",
            lastFullRebuildAt: null,
            lastIncrementalRunAt: null,
            embeddingProvider: "local",
            embeddingModel: "hashed-trigram-v1",
            modelDownload: null
          }),
          ragBusy: () => false,
          ragUpdatingModel: () => true,
          setRagEmbeddingModel: vi.fn(),
          prepareRagEmbeddingModel: vi.fn(),
          cancelRagEmbeddingModelDownload: vi.fn(),
          rebuildRagIndex: vi.fn(),
          ragMessage: () => null
        }}
      />
    ));

    expect(screen.getByRole("button", { name: /embedding model/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /download/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /rebuild index/i })).toBeDisabled();
  });

  it("does not reapply the selected embedding model when reopening the dropdown", async () => {
    const setRagEmbeddingModel = vi.fn();
    const user = userEvent.setup();

    render(() => (
      <SettingsVaultTab
        isTauri={() => false}
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
          formOpen: () => false,
          setFormOpen: vi.fn(),
          newName: () => "",
          setNewName: vi.fn(),
          newPath: () => "",
          setNewPath: vi.fn(),
          create: vi.fn(),
          shadowPendingCount: () => 0,
          keyStatus: () => ({
            configured: false,
            kdf: null,
            iterations: null,
            salt_b64: null
          }),
          passphrase: () => "",
          setPassphrase: vi.fn(),
          keyBusy: () => false,
          setKey: vi.fn(),
          keyMessage: () => null,
          ragStatus: () => ({
            indexExists: true,
            indexedPages: 4,
            indexedChunks: 12,
            dirtyPages: 2,
            availableEmbeddingModels: [
              {
                id: "local",
                label: "Local substring/trigram",
                requiresDownload: false,
                experimental: false
              },
              {
                id: "pplx",
                label: "pplx-embed-v1-0.6b",
                requiresDownload: true,
                experimental: true
              }
            ],
            selectedEmbeddingModel: "pplx",
            selectedEmbeddingModelReady: false,
            selectedEmbeddingModelActive: false,
            embeddingStatusMessage:
              "pplx-embed-v1-0.6b is selected but not downloaded yet. Download the model before rebuilding the index.",
            lastFullRebuildAt: null,
            lastIncrementalRunAt: null,
            embeddingProvider: "local",
            embeddingModel: "hashed-trigram-v1",
            modelDownload: null
          }),
          ragBusy: () => false,
          ragUpdatingModel: () => false,
          setRagEmbeddingModel,
          prepareRagEmbeddingModel: vi.fn(),
          cancelRagEmbeddingModelDownload: vi.fn(),
          rebuildRagIndex: vi.fn(),
          ragMessage: () => null
        }}
      />
    ));

    await user.click(screen.getByRole("button", { name: /embedding model/i }));

    expect(setRagEmbeddingModel).not.toHaveBeenCalled();
  });
});
