import { Show, type Accessor, type Setter } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

type StatusMessage = {
  state: "success" | "error";
  message: string;
};

type ExportStatus = {
  state: "success" | "error";
  message: string;
  preview?: string;
};

type SettingsImportExportProps = {
  importText: Accessor<string>;
  setImportText: Setter<string>;
  importStatus: Accessor<StatusMessage | null>;
  setImportStatus: Setter<StatusMessage | null>;
  importing: Accessor<boolean>;
  importMarkdown: () => void | Promise<void>;
  exporting: Accessor<boolean>;
  exportMarkdown: () => void | Promise<void>;
  exportStatus: Accessor<ExportStatus | null>;
  offlineExporting: Accessor<boolean>;
  exportOfflineArchive: () => void | Promise<void>;
  offlineExportStatus: Accessor<StatusMessage | null>;
  offlineImporting: Accessor<boolean>;
  importOfflineArchive: () => void | Promise<void>;
  offlineImportFile: Accessor<File | null>;
  setOfflineImportFile: Setter<File | null>;
  offlineImportStatus: Accessor<StatusMessage | null>;
  setOfflineImportStatus: Setter<StatusMessage | null>;
};

type SettingsImportTabProps = {
  isTauri: () => boolean;
  importExport: SettingsImportExportProps;
};

export const SettingsImportTab = (props: SettingsImportTabProps) => {
  let markdownFilePickerRef: HTMLInputElement | undefined;
  let offlineArchivePickerRef: HTMLInputElement | undefined;

  const readTextFile = async (file: File) => {
    if (typeof file.text === "function") {
      return file.text();
    }
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error ?? new Error("read-failed"));
      reader.readAsText(file);
    });
  };

  const openMarkdownFilePicker = async () => {
    if (props.isTauri()) {
      const selection = await openDialog({
        multiple: false,
        filters: [{ name: "Markdown", extensions: ["md", "markdown"] }]
      });
      const picked =
        typeof selection === "string" ? selection : selection?.[0] ?? null;
      if (!picked) return;
      try {
        const text = (await invoke("read_text_file", { path: picked })) as string;
        props.importExport.setImportText(text);
        props.importExport.setImportStatus(null);
      } catch (error) {
        console.error("Failed to read import file", error);
        props.importExport.setImportStatus({
          state: "error",
          message: "Failed to read the selected file."
        });
      }
      return;
    }
    markdownFilePickerRef?.click();
  };

  const openOfflineArchivePicker = () => {
    offlineArchivePickerRef?.click();
  };

  const handleMarkdownFilePick = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await readTextFile(file);
      props.importExport.setImportText(text);
      props.importExport.setImportStatus(null);
    } catch (error) {
      console.error("Failed to read import file", error);
      props.importExport.setImportStatus({
        state: "error",
        message: "Failed to read the selected file."
      });
    } finally {
      input.value = "";
    }
  };

  const handleOfflineArchivePick = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    props.importExport.setOfflineImportFile(file);
    props.importExport.setOfflineImportStatus(null);
  };

  return (
    <>
      <div class="settings-section">
        <h3 class="settings-section__title">Import Markdown</h3>
        <p class="settings-section__desc">
          Paste shadow Markdown to create or update a page.
        </p>
        <textarea
          class="settings-textarea"
          rows={5}
          placeholder="Paste markdown here..."
          value={props.importExport.importText()}
          onInput={(e) => props.importExport.setImportText(e.currentTarget.value)}
        />
        <div class="settings-actions">
          <button
            class="settings-action"
            type="button"
            onClick={openMarkdownFilePicker}
          >
            Choose file
          </button>
          <button
            class="settings-action is-primary"
            onClick={() => void props.importExport.importMarkdown()}
            disabled={props.importExport.importing()}
          >
            {props.importExport.importing() ? "Importing..." : "Import"}
          </button>
          <button
            class="settings-action"
            onClick={() => {
              props.importExport.setImportText("");
              props.importExport.setImportStatus(null);
            }}
          >
            Clear
          </button>
        </div>
        <input
          ref={(el) => {
            markdownFilePickerRef = el;
          }}
          data-testid="markdown-file-picker"
          class="settings-file-input"
          type="file"
          accept=".md,text/markdown"
          onChange={(event) => void handleMarkdownFilePick(event)}
        />
        <Show when={props.importExport.importStatus()}>
          {(status) => (
            <div
              class={`settings-message ${
                status().state === "success" ? "is-success" : "is-error"
              }`}
            >
              {status().message}
            </div>
          )}
        </Show>
      </div>
      <div class="settings-section">
        <h3 class="settings-section__title">Export Markdown</h3>
        <p class="settings-section__desc">
          Export all pages as read-only Markdown with stable block IDs.
        </p>
        <button
          class="settings-action is-primary"
          onClick={() => void props.importExport.exportMarkdown()}
          disabled={props.importExport.exporting()}
        >
          {props.importExport.exporting() ? "Exporting..." : "Export all pages"}
        </button>
        <Show when={props.importExport.exportStatus()}>
          {(status) => (
            <div
              class={`settings-message ${
                status().state === "success" ? "is-success" : "is-error"
              }`}
            >
              {status().message}
            </div>
          )}
        </Show>
        <Show when={props.importExport.exportStatus()?.preview}>
          {(preview) => (
            <pre class="settings-preview">
              <code>{preview()}</code>
            </pre>
          )}
        </Show>
      </div>
      <div class="settings-section">
        <h3 class="settings-section__title">Offline backup</h3>
        <p class="settings-section__desc">
          Export a zip archive with pages and assets for offline restore.
        </p>
        <button
          class="settings-action is-primary"
          onClick={() => void props.importExport.exportOfflineArchive()}
          disabled={props.importExport.offlineExporting()}
        >
          {props.importExport.offlineExporting()
            ? "Exporting..."
            : "Export offline archive"}
        </button>
        <Show when={props.importExport.offlineExportStatus()}>
          {(status) => (
            <div
              class={`settings-message ${
                status().state === "success" ? "is-success" : "is-error"
              }`}
            >
              {status().message}
            </div>
          )}
        </Show>
      </div>
      <div class="settings-section">
        <h3 class="settings-section__title">Offline restore</h3>
        <p class="settings-section__desc">
          Import a zip archive to restore pages and assets.
        </p>
        <div class="settings-actions">
          <button
            class="settings-action"
            type="button"
            onClick={openOfflineArchivePicker}
          >
            Choose archive
          </button>
          <button
            class="settings-action is-primary"
            onClick={() => void props.importExport.importOfflineArchive()}
            disabled={props.importExport.offlineImporting()}
          >
            {props.importExport.offlineImporting()
              ? "Importing..."
              : "Import archive"}
          </button>
          <Show when={props.importExport.offlineImportFile()}>
            {(file) => <span class="settings-value">{file().name}</span>}
          </Show>
        </div>
        <input
          ref={(el) => {
            offlineArchivePickerRef = el;
          }}
          data-testid="offline-archive-picker"
          class="settings-file-input"
          type="file"
          accept=".zip,application/zip"
          onChange={(event) => handleOfflineArchivePick(event)}
        />
        <Show when={props.importExport.offlineImportStatus()}>
          {(status) => (
            <div
              class={`settings-message ${
                status().state === "success" ? "is-success" : "is-error"
              }`}
            >
              {status().message}
            </div>
          )}
        </Show>
      </div>
    </>
  );
};
