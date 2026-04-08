import { Show, createMemo, createSignal, type Accessor, type Setter } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "../../shared/ui/button";
import { SelectField, type SelectFieldOption } from "../../shared/ui/select-field";
import { TextareaField } from "../../shared/ui/textarea-field";
import type { MarkdownImportEntry } from "../../pages/main-page/model/use-import-export";

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
  importMarkdownFolder: (entries: MarkdownImportEntry[]) => void | Promise<void>;
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

type ImportFormatId = "markdown-page" | "markdown-folder" | "offline-archive";

const IMPORT_FORMAT_OPTIONS: SelectFieldOption[] = [
  { value: "markdown-page", label: "Markdown page" },
  { value: "markdown-folder", label: "Markdown folder" },
  { value: "offline-archive", label: "Offline archive" }
];

export const SettingsImportTab = (props: SettingsImportTabProps) => {
  let markdownFilePickerRef: HTMLInputElement | undefined;
  let markdownFolderPickerRef: HTMLInputElement | undefined;
  let offlineArchivePickerRef: HTMLInputElement | undefined;
  const [importFormat, setImportFormat] =
    createSignal<ImportFormatId>("markdown-page");
  const [markdownFolderEntries, setMarkdownFolderEntries] = createSignal<
    MarkdownImportEntry[]
  >([]);
  const [markdownFolderLabel, setMarkdownFolderLabel] = createSignal<string | null>(
    null
  );

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

  const markdownFolderStatusMessage = createMemo(() => {
    const entries = markdownFolderEntries();
    if (entries.length === 0) return null;
    const label = markdownFolderLabel();
    return `${entries.length} Markdown file${
      entries.length === 1 ? "" : "s"
    } ready${label ? ` from ${label}` : ""}.`;
  });

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

  const openMarkdownFolderPicker = async () => {
    if (props.isTauri()) {
      const selection = await openDialog({
        directory: true,
        multiple: false
      });
      if (typeof selection !== "string") return;
      try {
        const entries = (await invoke("read_markdown_directory", {
          path: selection
        })) as MarkdownImportEntry[];
        setMarkdownFolderEntries(entries);
        const folderLabel = selection.split(/[\\/]/u).pop() ?? selection;
        setMarkdownFolderLabel(folderLabel);
        props.importExport.setImportStatus(null);
      } catch (error) {
        console.error("Failed to read markdown folder", error);
        props.importExport.setImportStatus({
          state: "error",
          message: "Failed to read the selected folder."
        });
      }
      return;
    }
    markdownFolderPickerRef?.click();
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

  const handleMarkdownFolderPick = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) return;
    try {
      const markdownFiles = files.filter((file) =>
        /\.(md|markdown)$/iu.test(file.name)
      );
      const entries = await Promise.all(
        markdownFiles.map(async (file) => ({
          path:
            (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
            file.name,
          text: await readTextFile(file)
        }))
      );
      setMarkdownFolderEntries(
        entries.sort((left, right) => left.path.localeCompare(right.path))
      );
      const firstPath =
        (markdownFiles[0] as File & { webkitRelativePath?: string })
          ?.webkitRelativePath ?? "";
      const folderLabel = firstPath.split("/")[0] || "selected folder";
      setMarkdownFolderLabel(folderLabel);
      props.importExport.setImportStatus(null);
    } catch (error) {
      console.error("Failed to read markdown folder", error);
      props.importExport.setImportStatus({
        state: "error",
        message: "Failed to read the selected folder."
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

  const activeImportStatus = createMemo(() =>
    importFormat() === "offline-archive"
      ? props.importExport.offlineImportStatus()
      : props.importExport.importStatus()
  );

  const importBusy = createMemo(() =>
    importFormat() === "offline-archive"
      ? props.importExport.offlineImporting()
      : props.importExport.importing()
  );

  const chooseButtonLabel = createMemo(() => {
    switch (importFormat()) {
      case "markdown-folder":
        return "Choose folder";
      case "offline-archive":
        return "Choose archive";
      default:
        return "Choose file";
    }
  });

  const openImportSourcePicker = async () => {
    switch (importFormat()) {
      case "markdown-folder":
        await openMarkdownFolderPicker();
        return;
      case "offline-archive":
        openOfflineArchivePicker();
        return;
      default:
        await openMarkdownFilePicker();
    }
  };

  const importSelectedFormat = async () => {
    switch (importFormat()) {
      case "markdown-folder":
        await props.importExport.importMarkdownFolder(markdownFolderEntries());
        return;
      case "offline-archive":
        await props.importExport.importOfflineArchive();
        return;
      default:
        await props.importExport.importMarkdown();
    }
  };

  const clearImportSelection = () => {
    if (importFormat() === "offline-archive") {
      props.importExport.setOfflineImportFile(null);
      props.importExport.setOfflineImportStatus(null);
      return;
    }

    if (importFormat() === "markdown-folder") {
      setMarkdownFolderEntries([]);
      setMarkdownFolderLabel(null);
      props.importExport.setImportStatus(null);
      return;
    }

    props.importExport.setImportText("");
    props.importExport.setImportStatus(null);
  };

  return (
    <>
      <div class="settings-section">
        <h3 class="settings-section__title">Import Data</h3>
        <p class="settings-section__desc">
          Choose an import format and bring Markdown pages or an offline archive
          into this vault.
        </p>
        <SelectField
          label="Import format"
          value={importFormat()}
          options={IMPORT_FORMAT_OPTIONS}
          onChange={(value) => setImportFormat(value as ImportFormatId)}
        />
        <Show when={importFormat() === "markdown-page"}>
          <TextareaField
            font="mono"
            rows={5}
            placeholder="Paste markdown here..."
            value={props.importExport.importText()}
            onInput={(e) => props.importExport.setImportText(e.currentTarget.value)}
          />
        </Show>
        <div class="settings-actions">
          <Button
            variant="surface"
            size="sm"
            onClick={() => void openImportSourcePicker()}
          >
            {chooseButtonLabel()}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void importSelectedFormat()}
            disabled={importBusy()}
          >
            {importBusy() ? "Importing..." : "Import"}
          </Button>
          <Button
            variant="surface"
            size="sm"
            onClick={clearImportSelection}
          >
            Clear
          </Button>
        </div>
        <Show when={importFormat() === "markdown-folder" && markdownFolderStatusMessage()}>
          {(message) => <div class="settings-value">{message()}</div>}
        </Show>
        <Show when={importFormat() === "offline-archive" && props.importExport.offlineImportFile()}>
          {(file) => <div class="settings-value">{file().name}</div>}
        </Show>
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
        <input
          ref={(el) => {
            markdownFolderPickerRef = el;
            el.setAttribute("webkitdirectory", "");
            el.setAttribute("directory", "");
          }}
          data-testid="markdown-folder-picker"
          class="settings-file-input"
          type="file"
          accept=".md,.markdown,text/markdown"
          multiple
          onChange={(event) => void handleMarkdownFolderPick(event)}
        />
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
        <Show when={activeImportStatus()}>
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
        <Button
          variant="primary"
          size="sm"
          onClick={() => void props.importExport.exportMarkdown()}
          disabled={props.importExport.exporting()}
        >
          {props.importExport.exporting() ? "Exporting..." : "Export all pages"}
        </Button>
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
        <Button
          variant="primary"
          size="sm"
          onClick={() => void props.importExport.exportOfflineArchive()}
          disabled={props.importExport.offlineExporting()}
        >
          {props.importExport.offlineExporting()
            ? "Exporting..."
            : "Export offline archive"}
        </Button>
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
    </>
  );
};
