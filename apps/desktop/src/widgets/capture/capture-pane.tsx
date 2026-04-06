import {
  For,
  Show,
  createEffect,
  createSignal,
  type Accessor,
  type Setter
} from "solid-js";
import type { Block } from "../../entities/block/model/block-types";
import {
  extractImageFilesFromClipboardData,
  extractImageFilesFromDataTransfer
} from "../../shared/lib/assets/image-files";
import {
  extractFileSource,
  extractImageSource,
  resolveBlockType
} from "../../shared/lib/blocks/block-type-utils";
import { AlertDialog } from "../../shared/ui/alert-dialog";
import { AssetImage } from "../../shared/ui/asset-image";
import { Button } from "../../shared/ui/button";
import { IconButton } from "../../shared/ui/icon-button";
import { InlineEditor } from "../../shared/ui/inline-editor";
import {
  ArrowReply16Icon,
  ArrowUp16FilledIcon,
  Delete16Icon
} from "../../shared/ui/icons";
import type { MarkdownDisplayHandlers } from "../../shared/ui/markdown-display";

export type CaptureDraftAttachment = {
  id: string;
  name: string;
  mimeType: string;
  previewUrl: string;
};

export type CaptureEntry = {
  id: string;
  blocks: Block[];
  position: number;
  capturedAt: number | null;
  text: string;
};

export type CaptureThread = {
  id: string;
  root: CaptureEntry;
  replies: CaptureEntry[];
};

type CapturePaneProps = {
  text: Accessor<string>;
  setText: Setter<string>;
  attachments: Accessor<CaptureDraftAttachment[]>;
  items: Accessor<CaptureThread[]>;
  onCapture: () => void | Promise<void>;
  onAddAttachments: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  onEditItem: (id: string, text: string) => void;
  onDeleteEntry: (id: string) => void;
  onDeleteItem: (id: string) => void;
  onDeleteThread: (id: string) => void;
  onReplyTo: (id: string) => void;
  onCancelReply: () => void;
  replyingToId: Accessor<string | null>;
  replyingTo: Accessor<string | null>;
  focusEpoch: Accessor<number>;
  markdownDisplayHandlers?: MarkdownDisplayHandlers;
};

const formatCaptureTime = (timestamp: number | null) => {
  if (!timestamp) return "Now";
  const date = new Date(timestamp);
  const h = date.getHours();
  const m = date.getMinutes().toString().padStart(2, "0");
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${m} ${period}`;
};

const isTauriRuntime = () =>
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);

const findBodyBlock = (blocks: Block[]) =>
  blocks.find((block) => block.meta?.capture?.role === "body") ??
  blocks.find(
    (block) =>
      block.meta?.capture?.role !== "attachment" && resolveBlockType(block) !== "image"
  );

const findImageBlocks = (blocks: Block[]) =>
  blocks.filter(
    (block) => block.meta?.capture?.role === "attachment" || resolveBlockType(block) === "image"
  );

const MARKDOWN_IMAGE_PATTERN = /^!\[(.*?)\]\((.+)\)$/u;
const MARKDOWN_LINK_PATTERN = /^\[([^\]]+)\]\(([^)]+)\)$/u;
const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "svg",
  "bmp",
  "tif",
  "tiff",
  "ico"
]);

const extractPathExtension = (source: string) => {
  const cleanPath = source.split(/[?#]/u, 1)[0] ?? source;
  const lastSegment = cleanPath.split("/").pop() ?? "";
  if (!lastSegment || !lastSegment.includes(".")) return "";
  return lastSegment.split(".").pop()?.toLowerCase() ?? "";
};

const normalizeRawAttachmentSource = (source: string) => {
  const trimmed = source.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("<") && trimmed.endsWith(">") && trimmed.length > 2
    ? trimmed.slice(1, -1)
    : trimmed;
};

const extractPermissiveAttachmentSource = (value: string) => {
  const trimmed = value.trim();
  const markdownImage = trimmed.match(MARKDOWN_IMAGE_PATTERN);
  if (markdownImage) {
    return normalizeRawAttachmentSource(markdownImage[2] ?? "");
  }
  const markdownLink = trimmed.match(MARKDOWN_LINK_PATTERN);
  if (markdownLink) {
    const href = normalizeRawAttachmentSource(markdownLink[2] ?? "");
    if (!href) return null;
    return IMAGE_EXTENSIONS.has(extractPathExtension(href)) ? href : null;
  }
  return null;
};

const resolveCaptureAttachmentSource = (block: Block) =>
  extractImageSource(block.text) ??
  extractFileSource(block.text)?.source ??
  extractPermissiveAttachmentSource(block.text);

export const CapturePane = (props: CapturePaneProps) => {
  let inputRef: HTMLTextAreaElement | undefined;
  let messagesRef: HTMLDivElement | undefined;
  const [justCaptured, setJustCaptured] = createSignal(false);
  const [dragActive, setDragActive] = createSignal(false);
  const [pendingEntryDelete, setPendingEntryDelete] = createSignal<{
    id: string;
    title: string;
    text: string;
  } | null>(null);
  const [pendingThreadDelete, setPendingThreadDelete] = createSignal<{
    id: string;
    text: string;
    replyCount: number;
  } | null>(null);

  const hasPendingCapture = () =>
    props.text().trim().length > 0 || props.attachments().length > 0;

  createEffect(() => {
    props.focusEpoch();
    requestAnimationFrame(() => {
      inputRef?.focus();
      const length = inputRef?.value.length ?? 0;
      inputRef?.setSelectionRange(length, length);
    });
  });

  createEffect(() => {
    const count = props.items().length;
    if (count > 0 && messagesRef) {
      requestAnimationFrame(() => {
        messagesRef!.scrollTop = messagesRef!.scrollHeight;
      });
    }
  });

  const handleCapture = () => {
    if (!hasPendingCapture()) return;
    void props.onCapture();
    setJustCaptured(false);
    queueMicrotask(() => {
      setJustCaptured(true);
      setTimeout(() => setJustCaptured(false), 600);
    });
    if (inputRef) inputRef.style.height = "auto";
  };

  const handleReplyToLatestCapture = () => {
    if (!hasPendingCapture()) return;
    if (props.replyingToId()) {
      handleCapture();
      return;
    }
    const threads = props.items();
    const latestThread = threads[threads.length - 1];
    if (!latestThread) {
      handleCapture();
      return;
    }
    props.onReplyTo(latestThread.root.id);
    handleCapture();
  };

  const confirmEntryDelete = () => {
    const pending = pendingEntryDelete();
    if (!pending) return;
    props.onDeleteEntry(pending.id);
    setPendingEntryDelete(null);
  };

  const confirmThreadDelete = () => {
    const pending = pendingThreadDelete();
    if (!pending) return;
    props.onDeleteThread(pending.id);
    setPendingThreadDelete(null);
  };

  const threadDeleteDescription = () => {
    const pending = pendingThreadDelete();
    if (!pending) return undefined;
    const replyLabel = pending.replyCount === 1 ? "1 reply" : `${pending.replyCount} replies`;
    return `Delete "${pending.text}" and ${replyLabel} from capture?`;
  };

  const handleAttachmentPaste = (event: ClipboardEvent) => {
    const files = extractImageFilesFromClipboardData(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    props.onAddAttachments(files);
  };

  const handleDragOver = (event: DragEvent) => {
    const files = extractImageFilesFromDataTransfer(event.dataTransfer);
    if (files.length === 0) return;
    event.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = () => {
    setDragActive(false);
  };

  const handleDrop = (event: DragEvent) => {
    const files = extractImageFilesFromDataTransfer(event.dataTransfer);
    if (files.length === 0) return;
    event.preventDefault();
    setDragActive(false);
    props.onAddAttachments(files);
  };

  const renderAttachmentGrid = (imageBlocks: Block[]) => {
    if (imageBlocks.length === 0) return null;
    return (
      <div class="capture-chat__attachment-grid">
        <For each={imageBlocks}>
          {(block) => {
            const source = resolveCaptureAttachmentSource(block);
            if (!source) return null;
            return (
              <div class="capture-chat__attachment-tile">
                <button
                  type="button"
                  class="capture-chat__attachment-preview"
                  aria-label={`Open image ${block.id}`}
                  onClick={() => window.open(source, "_blank", "noopener,noreferrer")}
                >
                  <AssetImage
                    class="capture-chat__attachment-image"
                    source={source}
                    isTauri={isTauriRuntime()}
                  />
                </button>
                <IconButton
                  variant="inline"
                  class="capture-chat__attachment-remove"
                  aria-label={`Delete attachment ${block.id}`}
                  onClick={() =>
                    setPendingEntryDelete({
                      id: block.id,
                      title: "Delete attachment",
                      text: source
                    })
                  }
                >
                  <Delete16Icon width="16" height="16" />
                </IconButton>
              </div>
            );
          }}
        </For>
      </div>
    );
  };

  const renderEntryContent = (entry: CaptureEntry) => {
    const bodyBlock = findBodyBlock(entry.blocks);
    const imageBlocks = findImageBlocks(entry.blocks);
    return (
      <>
        <Show when={bodyBlock}>
          {(block) => (
            <div class="capture-chat__bubble">
              <InlineEditor
                class="capture-chat__bubble-text"
                rows={1}
                autoResize
                maxHeight={120}
                displayMode="markdown"
                markdownDisplayHandlers={props.markdownDisplayHandlers}
                aria-label={`Captured item ${entry.position}`}
                value={block().text}
                onInput={(event) => {
                  props.onEditItem(block().id, event.currentTarget.value);
                }}
              />
            </div>
          )}
        </Show>
        <Show when={imageBlocks.length > 0}>
          <div class="capture-chat__attachments">{renderAttachmentGrid(imageBlocks)}</div>
        </Show>
      </>
    );
  };

  return (
    <>
      <div class="capture-chat">
        <div
          class="capture-chat__messages"
          role="log"
          aria-live="polite"
          ref={(el) => {
            messagesRef = el;
          }}
        >
          <Show
            when={props.items().length > 0}
            fallback={
              <div class="capture-chat__empty">
                <div class="capture-chat__empty-icon" aria-hidden="true">
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.25"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <p class="capture-chat__empty-text">
                  Capture a thought, link, task, or screenshot...
                </p>
              </div>
            }
          >
            <For each={props.items()}>
              {(thread) => (
                <section
                  class="capture-chat__thread"
                  classList={{
                    "capture-chat__thread--reply-target":
                      props.replyingToId() === thread.root.id,
                    "capture-chat__thread--with-replies": thread.replies.length > 0
                  }}
                  role="group"
                  aria-label={`Thread ${thread.root.text}`}
                >
                  <div class="capture-chat__bubble-row capture-chat__bubble-row--root">
                    <div class="capture-chat__content">
                      <time class="capture-chat__item-time">
                        {formatCaptureTime(thread.root.capturedAt)}
                      </time>
                      {renderEntryContent(thread.root)}
                    </div>
                    <div class="capture-chat__actions">
                      <IconButton
                        variant="inline"
                        class="capture-chat__icon-button"
                        aria-label={`Reply to ${thread.root.text}`}
                        onClick={() => props.onReplyTo(thread.root.id)}
                      >
                        <ArrowReply16Icon width="16" height="16" />
                      </IconButton>
                      <IconButton
                        variant="inline"
                        class="capture-chat__icon-button"
                        aria-label={`Delete ${thread.root.text}`}
                        onClick={() =>
                          setPendingThreadDelete({
                            id: thread.root.id,
                            text: thread.root.text,
                            replyCount: thread.replies.length
                          })
                        }
                      >
                        <Delete16Icon width="16" height="16" />
                      </IconButton>
                    </div>
                  </div>
                  <For each={thread.replies}>
                    {(reply) => (
                      <div class="capture-chat__bubble-row capture-chat__bubble-row--reply">
                        <div class="capture-chat__content">
                          <time class="capture-chat__item-time">
                            {formatCaptureTime(reply.capturedAt)}
                          </time>
                          {renderEntryContent(reply)}
                        </div>
                        <div class="capture-chat__actions">
                          <IconButton
                            variant="inline"
                            class="capture-chat__icon-button"
                            aria-label={`Delete ${reply.text}`}
                            onClick={() =>
                              setPendingEntryDelete({
                                id: reply.id,
                                title: "Delete reply",
                                text: reply.text
                              })
                            }
                          >
                            <Delete16Icon width="16" height="16" />
                          </IconButton>
                        </div>
                      </div>
                    )}
                  </For>
                </section>
              )}
            </For>
          </Show>
        </div>

        <div class="capture-chat__composer">
          <Show when={props.replyingTo()}>
            {(replyingTo) => (
              <div class="capture-chat__replying">
                <span class="capture-chat__replying-label">Replying to</span>
                <div class="capture-chat__replying-row">
                  <span class="capture-chat__replying-target">{replyingTo()}</span>
                  <Button
                    class="capture-chat__reply-cancel"
                    variant="unstyled"
                    aria-label="Cancel reply"
                    onClick={() => props.onCancelReply()}
                  >
                    <kbd class="capture-chat__kbd">Esc</kbd>
                    <span>Cancel</span>
                  </Button>
                </div>
              </div>
            )}
          </Show>
          <div
            class="capture-chat__composer-surface"
            classList={{ "is-drag-active": dragActive() }}
            onDragOver={(event) => handleDragOver(event)}
            onDragLeave={handleDragLeave}
            onDrop={(event) => handleDrop(event)}
          >
            <Show when={props.attachments().length > 0}>
              <div class="capture-chat__draft-grid">
                <For each={props.attachments()}>
                  {(attachment) => (
                    <div class="capture-chat__attachment-tile">
                      <button
                        type="button"
                        class="capture-chat__attachment-preview"
                        aria-label={`Open staged image ${attachment.name}`}
                        onClick={() =>
                          window.open(attachment.previewUrl, "_blank", "noopener,noreferrer")
                        }
                      >
                        <img
                          class="capture-chat__attachment-image"
                          src={attachment.previewUrl}
                          alt=""
                          loading="lazy"
                        />
                      </button>
                      <IconButton
                        variant="inline"
                        class="capture-chat__attachment-remove"
                        aria-label={`Remove staged image ${attachment.name}`}
                        onClick={() => props.onRemoveAttachment(attachment.id)}
                      >
                        <Delete16Icon width="16" height="16" />
                      </IconButton>
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <div class="capture-chat__composer-row">
              <div class="capture-chat__input-wrap">
                <InlineEditor
                  ref={(el) => {
                    inputRef = el;
                  }}
                  class="capture-chat__input"
                  rows={1}
                  autoResize
                  maxHeight={120}
                  placeholder="Capture a thought, link, or task..."
                  value={props.text()}
                  onInput={(event) => {
                    props.setText(event.currentTarget.value);
                  }}
                  onPaste={(event) => handleAttachmentPaste(event)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape" && props.replyingTo()) {
                      event.preventDefault();
                      props.onCancelReply();
                      return;
                    }
                    if (event.key !== "Enter" || event.shiftKey) return;
                    event.preventDefault();
                    if (event.ctrlKey) {
                      handleReplyToLatestCapture();
                      return;
                    }
                    handleCapture();
                  }}
                />
                <div
                  class="capture-chat__flash"
                  classList={{ "is-visible": justCaptured() }}
                  aria-hidden="true"
                />
              </div>
            </div>
            <div class="capture-chat__composer-footer">
              <div class="capture-chat__shortcut-hint" aria-label="Capture composer shortcuts">
                <span class="capture-chat__shortcut">
                  <kbd class="capture-chat__kbd">Enter</kbd>
                  <span>Capture</span>
                </span>
                <span class="capture-chat__shortcut">
                  <kbd class="capture-chat__kbd">Ctrl</kbd>
                  <span>+</span>
                  <kbd class="capture-chat__kbd">Enter</kbd>
                  <span>Reply</span>
                </span>
              </div>
              <Button
                class="capture-chat__send"
                variant="primary"
                disabled={!hasPendingCapture()}
                onClick={() => handleCapture()}
                aria-label="Send capture"
              >
                <ArrowUp16FilledIcon width="16" height="16" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <AlertDialog
        open={() => pendingEntryDelete() !== null}
        title={pendingEntryDelete()?.title ?? "Delete capture entry"}
        description={pendingEntryDelete()?.text}
        confirmLabel="Delete"
        onConfirm={confirmEntryDelete}
        onCancel={() => setPendingEntryDelete(null)}
      />
      <AlertDialog
        open={() => pendingThreadDelete() !== null}
        title="Delete thread"
        description={threadDeleteDescription()}
        confirmLabel="Delete thread"
        onConfirm={confirmThreadDelete}
        onCancel={() => setPendingThreadDelete(null)}
      />
    </>
  );
};
