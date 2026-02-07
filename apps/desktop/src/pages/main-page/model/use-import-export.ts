import { createSignal, type Accessor, type Setter } from "solid-js";
import type { SetStoreFunction } from "solid-js/store";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  parseMarkdownPage,
  serializePageToMarkdown
} from "@sandpaper/core-model";
import type { Block, BlockPayload } from "../../../entities/block/model/block-types";
import type {
  LocalPageRecord,
  PageBlocksResponse,
  PageSummary
} from "../../../entities/page/model/page-types";
import type { VaultRecord } from "../../../entities/vault/model/vault-types";
import type { MarkdownExportStatus } from "../../../shared/model/markdown-export-types";
import { makeBlock } from "../../../entities/block/model/make-block";
import { resolveBlockType } from "../../../shared/lib/blocks/block-type-utils";
import { buildOfflineExportManifest } from "./offline-archive-utils";

type InvokeFn = typeof import("@tauri-apps/api/core").invoke;

type StatusMessage = {
  state: "success" | "error";
  message: string;
};

type ExportStatus = {
  state: "success" | "error";
  message: string;
  preview?: string;
};

type JumpTarget = {
  id: string;
  caret: "start" | "end" | "preserve";
};

type ShadowWriter = {
  scheduleWrite: (pageUid: string, content: string) => void;
};

type ImportExportDeps = {
  isTauri: () => boolean;
  invoke: InvokeFn;
  blocks: Accessor<Block[]>;
  setBlocks: SetStoreFunction<Block[]>;
  pageTitle: Accessor<string>;
  setPageTitle: Setter<string>;
  pages: Accessor<PageSummary[]>;
  localPages: Record<string, LocalPageRecord>;
  saveLocalPageSnapshot: (pageUid: string, title: string, items: Block[]) => void;
  snapshotBlocks: (source: Block[]) => Block[];
  resolvePageUid: (value: string) => string;
  activePageUid: Accessor<string>;
  setActiveId: Setter<string | null>;
  setJumpTarget: Setter<JumpTarget | null>;
  persistActivePage: (pageUid: string) => Promise<void>;
  loadPages: () => Promise<void>;
  switchPage: (pageUid: string) => Promise<void>;
  makeRandomId: () => string;
  toPayload: (block: Block) => BlockPayload;
  shadowWriter: ShadowWriter;
  markSaved: () => void;
  activeVault: Accessor<VaultRecord | null>;
  defaultPageUid: string;
};

export const createImportExportState = (deps: ImportExportDeps) => {
  const [importText, setImportText] = createSignal("");
  const [importStatus, setImportStatus] =
    createSignal<StatusMessage | null>(null);
  const [importing, setImporting] = createSignal(false);
  const [exporting, setExporting] = createSignal(false);
  const [exportStatus, setExportStatus] =
    createSignal<ExportStatus | null>(null);
  const [offlineExporting, setOfflineExporting] = createSignal(false);
  const [offlineExportStatus, setOfflineExportStatus] =
    createSignal<StatusMessage | null>(null);
  const [offlineImporting, setOfflineImporting] = createSignal(false);
  const [offlineImportFile, setOfflineImportFile] =
    createSignal<File | null>(null);
  const [offlineImportStatus, setOfflineImportStatus] =
    createSignal<StatusMessage | null>(null);

  const importMarkdown = async () => {
    if (importing()) return;
    const raw = importText().trim();
    if (!raw) {
      setImportStatus({
        state: "error",
        message: "Paste Markdown before importing."
      });
      return;
    }
    setImporting(true);
    setImportStatus(null);

    try {
      const parsed = parseMarkdownPage(raw, deps.makeRandomId);
      if (parsed.page.blocks.length === 0) {
        setImportStatus({
          state: "error",
          message: "No list items found to import."
        });
        return;
      }

      const targetUid = parsed.hasHeader
        ? deps.resolvePageUid(parsed.page.id)
        : deps.resolvePageUid(deps.activePageUid());
      const targetTitle =
        parsed.hasHeader && parsed.page.title.trim()
          ? parsed.page.title.trim()
          : deps.pageTitle();
      const replacePage = parsed.hasHeader;
      const baseBlocks = replacePage ? [] : deps.blocks();
      const existingIds = new Set(baseBlocks.map((block) => block.id));
      const importedBlocks = parsed.page.blocks.map((block) => {
        let nextId = block.id;
        if (existingIds.has(nextId)) {
          nextId = deps.makeRandomId();
        }
        existingIds.add(nextId);
        return { ...block, id: nextId };
      });

      const nextBlocks = replacePage
        ? importedBlocks
        : [...baseBlocks, ...importedBlocks];
      deps.setBlocks(nextBlocks);
      await deps.persistActivePage(targetUid);
      if (importedBlocks[0]) {
        deps.setActiveId(importedBlocks[0].id);
        deps.setJumpTarget({ id: importedBlocks[0].id, caret: "start" });
      }
      if (targetTitle !== deps.pageTitle()) {
        deps.setPageTitle(targetTitle);
      }

      if (deps.isTauri()) {
        if (targetTitle.trim()) {
          await deps.invoke("set_page_title", {
            payload: {
              page_uid: targetUid,
              title: targetTitle.trim()
            }
          });
        }
        await deps.invoke("save_page_blocks", {
          pageUid: targetUid,
          page_uid: targetUid,
          blocks: nextBlocks.map((block) => deps.toPayload(block))
        });
        await deps.loadPages();
      } else {
        deps.saveLocalPageSnapshot(targetUid, targetTitle, nextBlocks);
        await deps.loadPages();
      }

      const warningSuffix =
        parsed.warnings.length > 0
          ? ` ${parsed.warnings.length} warnings.`
          : "";
      const scopeLabel = replacePage ? targetTitle : deps.pageTitle();
      setImportStatus({
        state: "success",
        message: `Imported ${importedBlocks.length} blocks into ${scopeLabel}.${warningSuffix}`
      });
      deps.markSaved();
      deps.shadowWriter.scheduleWrite(
        targetUid,
        serializePageToMarkdown({
          id: targetUid,
          title: targetTitle,
          blocks: nextBlocks.map((block) => ({
            id: block.id,
            text: block.text,
            indent: block.indent,
            block_type: resolveBlockType(block)
          }))
        })
      );
      setImportText("");
    } catch (error) {
      console.error("Import failed", error);
      setImportStatus({
        state: "error",
        message: "Import failed. Check the logs for details."
      });
    } finally {
      setImporting(false);
    }
  };

  const exportMarkdown = async () => {
    if (exporting()) return;
    setExporting(true);
    setExportStatus(null);

    if (!deps.isTauri()) {
      const pageUid = deps.resolvePageUid(deps.activePageUid());
      const markdown = serializePageToMarkdown({
        id: pageUid,
        title: deps.pageTitle(),
        blocks: deps.blocks().map((block) => ({
          id: block.id,
          text: block.text,
          indent: block.indent,
          block_type: resolveBlockType(block)
        }))
      });
      setExportStatus({
        state: "success",
        message: "Preview generated in browser (desktop app required to write files).",
        preview: markdown
      });
      setExporting(false);
      return;
    }

    try {
      const result = (await deps.invoke("export_markdown")) as MarkdownExportStatus;
      setExportStatus({
        state: "success",
        message: `Exported ${result.pages} pages to ${result.path}`
      });
    } catch (error) {
      console.error("Export failed", error);
      setExportStatus({
        state: "error",
        message: "Export failed. Check the logs for details."
      });
    } finally {
      setExporting(false);
    }
  };

  const collectOfflineExportPages = async (): Promise<LocalPageRecord[]> => {
    const result = new Map<string, LocalPageRecord>();
    const upsert = (page: LocalPageRecord) => {
      const uid = deps.resolvePageUid(page.uid);
      if (!result.has(uid)) {
        result.set(uid, {
          uid,
          title: page.title,
          blocks: deps.snapshotBlocks(page.blocks)
        });
      }
    };

    const activeUid = deps.resolvePageUid(
      deps.activePageUid() || deps.defaultPageUid
    );
    if (activeUid) {
      upsert({
        uid: activeUid,
        title: deps.pageTitle() || activeUid,
        blocks: deps.snapshotBlocks(deps.blocks())
      });
    }

    Object.values(deps.localPages).forEach((page) => upsert(page));
    const summaries =
      deps.pages().length > 0
        ? deps.pages()
        : Object.values(deps.localPages).map((page) => ({
            uid: page.uid,
            title: page.title
          }));

    for (const summary of summaries) {
      const uid = deps.resolvePageUid(summary.uid);
      if (result.has(uid)) continue;
      if (!deps.isTauri()) continue;
      try {
        const response = (await deps.invoke("load_page_blocks", {
          pageUid: uid,
          page_uid: uid
        })) as PageBlocksResponse;
        upsert({
          uid,
          title: summary.title || uid,
          blocks: response.blocks.map((block) =>
            makeBlock(
              block.uid,
              block.text,
              block.indent,
              resolveBlockType({ text: block.text, block_type: block.block_type })
            )
          )
        });
      } catch (error) {
        console.error("Failed to load page for export", error);
      }
    }

    return Array.from(result.values());
  };

  const buildOfflineArchive = async () => {
    const pagesToExport = await collectOfflineExportPages();
    if (pagesToExport.length === 0) {
      throw new Error("no-pages");
    }
    const exportedAt = new Date().toISOString();
    const manifest = buildOfflineExportManifest({
      pages: pagesToExport.map((page) => ({
        uid: deps.resolvePageUid(page.uid),
        title: page.title
      })),
      exportedAt,
      vaultName: deps.activeVault()?.name ?? "Default"
    });

    const files: Record<string, Uint8Array> = {
      "manifest.json": strToU8(JSON.stringify(manifest, null, 2)),
      "assets/README.txt": strToU8("Drop assets here when exporting attachments.")
    };

    pagesToExport.forEach((page) => {
      const uid = deps.resolvePageUid(page.uid);
      const markdown = serializePageToMarkdown({
        id: uid,
        title: page.title,
        blocks: page.blocks.map((block) => ({
          id: block.id,
          text: block.text,
          indent: block.indent,
          block_type: resolveBlockType(block)
        }))
      });
      files[`pages/${uid}.md`] = strToU8(markdown);
    });

    return zipSync(files, { level: 6 });
  };

  const exportOfflineArchive = async () => {
    if (offlineExporting()) return;
    setOfflineExporting(true);
    setOfflineExportStatus(null);

    try {
      const archive = await buildOfflineArchive();
      const dateStamp = new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(new Date());
      const blob = new Blob([archive], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `sandpaper-offline-${dateStamp}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
      setOfflineExportStatus({
        state: "success",
        message: "Offline export ready."
      });
    } catch (error) {
      console.error("Offline export failed", error);
      setOfflineExportStatus({
        state: "error",
        message: "Offline export failed. Check the logs for details."
      });
    } finally {
      setOfflineExporting(false);
    }
  };

  const readBinaryFile = async (file: File) => {
    if (typeof file.arrayBuffer === "function") {
      const buffer = await file.arrayBuffer();
      return new Uint8Array(buffer);
    }
    if (typeof FileReader !== "undefined") {
      const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(file);
      });
      return new Uint8Array(buffer);
    }
    if (typeof file.text === "function") {
      const text = await file.text();
      return new TextEncoder().encode(text);
    }
    return new Uint8Array();
  };

  const importOfflineArchive = async () => {
    if (offlineImporting()) return;
    const file = offlineImportFile();
    if (!file) {
      setOfflineImportStatus({
        state: "error",
        message: "Choose a zip archive before importing."
      });
      return;
    }
    setOfflineImporting(true);
    setOfflineImportStatus(null);

    try {
      const bytes = await readBinaryFile(file);
      const entries = unzipSync(bytes);
      const manifestEntry = entries["manifest.json"];
      const manifest = manifestEntry
        ? (JSON.parse(strFromU8(manifestEntry)) as {
            pages?: Array<{ file: string }>;
          })
        : null;
      const pageFiles =
        manifest?.pages
          ?.map((page) => page.file)
          .filter((fileName) => entries[fileName]) ??
        Object.keys(entries).filter(
          (name) => name.startsWith("pages/") && name.endsWith(".md")
        );

      if (pageFiles.length === 0) {
        setOfflineImportStatus({
          state: "error",
          message: "No pages found in the archive."
        });
        return;
      }

      let imported = 0;
      let firstPageUid: string | null = null;
      for (const fileName of pageFiles) {
        const content = entries[fileName];
        if (!content) continue;
        const text = strFromU8(content);
        const parsed = parseMarkdownPage(text, deps.makeRandomId);
        if (parsed.page.blocks.length === 0) continue;
        const uid = deps.resolvePageUid(parsed.page.id);
        const title = parsed.page.title.trim() || "Untitled";
        const snapshot = parsed.page.blocks.map((block) => ({
          id: block.id,
          text: block.text,
          indent: block.indent,
          block_type: resolveBlockType({
            text: block.text,
            block_type: block.block_type
          })
        }));
        if (!firstPageUid) firstPageUid = uid;

        if (deps.isTauri()) {
          try {
            await deps.invoke("create_page", {
              payload: { uid, title }
            });
          } catch {
            // ignore duplicate errors
          }
          if (title.trim()) {
            await deps.invoke("set_page_title", {
              payload: { page_uid: uid, title }
            });
          }
          await deps.invoke("save_page_blocks", {
            pageUid: uid,
            page_uid: uid,
            blocks: snapshot.map((block) => deps.toPayload(block))
          });
        } else {
          deps.saveLocalPageSnapshot(uid, title, snapshot);
        }

        imported += 1;
      }

      await deps.loadPages();
      if (firstPageUid) {
        await deps.switchPage(firstPageUid);
      }
      setOfflineImportStatus({
        state: "success",
        message: `Imported ${imported} page${imported === 1 ? "" : "s"}.`
      });
      setOfflineImportFile(null);
    } catch (error) {
      console.error("Offline import failed", error);
      setOfflineImportStatus({
        state: "error",
        message: "Offline import failed. Check the logs for details."
      });
    } finally {
      setOfflineImporting(false);
    }
  };

  return {
    importText,
    setImportText,
    importStatus,
    setImportStatus,
    importing,
    importMarkdown,
    exporting,
    exportMarkdown,
    exportStatus,
    offlineExporting,
    exportOfflineArchive,
    offlineExportStatus,
    offlineImporting,
    importOfflineArchive,
    offlineImportFile,
    setOfflineImportFile,
    offlineImportStatus,
    setOfflineImportStatus,
    setExportStatus
  };
};
