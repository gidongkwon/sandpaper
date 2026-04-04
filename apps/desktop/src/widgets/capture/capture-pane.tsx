import {
  For,
  Show,
  createEffect,
  createSignal,
  type Accessor,
  type Setter
} from "solid-js";
import { AlertDialog } from "../../shared/ui/alert-dialog";
import { Button } from "../../shared/ui/button";
import { IconButton } from "../../shared/ui/icon-button";
import { InlineEditor } from "../../shared/ui/inline-editor";
import {
  ArrowReply16Icon,
  ArrowUp16FilledIcon,
  Delete16Icon
} from "../../shared/ui/icons";

export type CaptureItem = {
  block: {
    id: string;
    text: string;
    indent: number;
  };
  position: number;
  capturedAt: number | null;
};

export type CaptureThread = {
  id: string;
  root: CaptureItem;
  replies: CaptureItem[];
};

type CapturePaneProps = {
  text: Accessor<string>;
  setText: Setter<string>;
  items: Accessor<CaptureThread[]>;
  onCapture: () => void;
  onEditItem: (id: string, text: string) => void;
  onDeleteItem: (id: string) => void;
  onDeleteThread: (id: string) => void;
  onReplyTo: (id: string) => void;
  onCancelReply: () => void;
  replyingToId: Accessor<string | null>;
  replyingTo: Accessor<string | null>;
  focusEpoch: Accessor<number>;
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

export const CapturePane = (props: CapturePaneProps) => {
  let inputRef: HTMLTextAreaElement | undefined;
  let messagesRef: HTMLDivElement | undefined;
  const [justCaptured, setJustCaptured] = createSignal(false);
  const [pendingReplyDelete, setPendingReplyDelete] = createSignal<{
    id: string;
    text: string;
  } | null>(null);
  const [pendingThreadDelete, setPendingThreadDelete] = createSignal<{
    id: string;
    text: string;
    replyCount: number;
  } | null>(null);

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
    const text = props.text().trim();
    if (!text) return;
    props.onCapture();
    setJustCaptured(false);
    queueMicrotask(() => {
      setJustCaptured(true);
      setTimeout(() => setJustCaptured(false), 600);
    });
    if (inputRef) inputRef.style.height = "auto";
  };

  const confirmReplyDelete = () => {
    const pending = pendingReplyDelete();
    if (!pending) return;
    props.onDeleteItem(pending.id);
    setPendingReplyDelete(null);
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

  const syncThreadLine = (
    threadEl: HTMLElement | undefined,
    lastReplyEl: HTMLDivElement | undefined
  ) => {
    requestAnimationFrame(() => {
      if (!threadEl) return;
      if (!lastReplyEl) {
        threadEl.style.removeProperty("--thread-line-end");
        return;
      }
      const end = Math.max(lastReplyEl.offsetTop - 6, 18);
      threadEl.style.setProperty("--thread-line-end", `${end}px`);
    });
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
                  Capture a thought, link, or task...
                </p>
              </div>
            }
          >
            <For each={props.items()}>
              {(thread) => {
                let threadRef: HTMLElement | undefined;
                let lastReplyRef: HTMLDivElement | undefined;

                return (
                  <section
                    class="capture-chat__thread"
                    classList={{
                      "capture-chat__thread--reply-target":
                        props.replyingToId() === thread.root.block.id,
                      "capture-chat__thread--with-replies":
                        thread.replies.length > 0
                    }}
                    role="group"
                    aria-label={`Thread ${thread.root.block.text}`}
                    ref={(el) => {
                      threadRef = el;
                      syncThreadLine(threadRef, lastReplyRef);
                    }}
                  >
                    <div class="capture-chat__bubble-row capture-chat__bubble-row--root">
                    <time class="capture-chat__item-time">
                      {formatCaptureTime(thread.root.capturedAt)}
                    </time>
                    <div class="capture-chat__bubble">
                      <InlineEditor
                        class="capture-chat__bubble-text"
                        rows={1}
                        autoResize
                        maxHeight={120}
                        displayMode="markdown"
                        aria-label={`Captured item ${thread.root.position}`}
                        value={thread.root.block.text}
                        onInput={(event) => {
                          props.onEditItem(thread.root.block.id, event.currentTarget.value);
                          syncThreadLine(threadRef, lastReplyRef);
                        }}
                      />
                    </div>
                    <div class="capture-chat__actions">
                      <IconButton
                        variant="inline"
                        class="capture-chat__icon-button"
                        aria-label={`Reply to ${thread.root.block.text}`}
                        onClick={() => props.onReplyTo(thread.root.block.id)}
                      >
                        <ArrowReply16Icon width="16" height="16" />
                      </IconButton>
                      <IconButton
                        variant="inline"
                        class="capture-chat__icon-button"
                        aria-label={`Delete ${thread.root.block.text}`}
                        onClick={() =>
                          setPendingThreadDelete({
                            id: thread.root.block.id,
                            text: thread.root.block.text,
                            replyCount: thread.replies.length
                          })
                        }
                      >
                        <Delete16Icon width="16" height="16" />
                      </IconButton>
                    </div>
                  </div>
                  <For each={thread.replies}>
                    {(reply, index) => (
                      <div
                        class="capture-chat__bubble-row capture-chat__bubble-row--reply"
                        ref={(el) => {
                          if (index() === thread.replies.length - 1) {
                            lastReplyRef = el;
                            syncThreadLine(threadRef, lastReplyRef);
                          }
                        }}
                      >
                        <time class="capture-chat__item-time">
                          {formatCaptureTime(reply.capturedAt)}
                        </time>
                        <div class="capture-chat__bubble">
                          <InlineEditor
                            class="capture-chat__bubble-text"
                            rows={1}
                            autoResize
                            maxHeight={120}
                            displayMode="markdown"
                            aria-label={`Captured item ${reply.position}`}
                            value={reply.block.text}
                            onInput={(event) => {
                              props.onEditItem(reply.block.id, event.currentTarget.value);
                              syncThreadLine(threadRef, lastReplyRef);
                            }}
                          />
                        </div>
                        <div class="capture-chat__actions">
                          <IconButton
                            variant="inline"
                            class="capture-chat__icon-button"
                            aria-label={`Delete ${reply.block.text}`}
                            onClick={() =>
                              setPendingReplyDelete({
                                id: reply.block.id,
                                text: reply.block.text
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
                );
              }}
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
                    <span>Cancel</span>
                    <kbd class="capture-chat__kbd">Esc</kbd>
                  </Button>
                </div>
              </div>
            )}
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
                onKeyDown={(event) => {
                  if (event.key === "Escape" && props.replyingTo()) {
                    event.preventDefault();
                    props.onCancelReply();
                    return;
                  }
                  if (event.key !== "Enter" || event.shiftKey) return;
                  event.preventDefault();
                  handleCapture();
                }}
              />
              <div
                class="capture-chat__flash"
                classList={{ "is-visible": justCaptured() }}
                aria-hidden="true"
              />
            </div>
            <Button
              class="capture-chat__send"
              variant="primary"
              disabled={props.text().trim().length === 0}
              onClick={() => handleCapture()}
              aria-label="Send capture"
            >
              <ArrowUp16FilledIcon width="16" height="16" />
            </Button>
          </div>
        </div>
      </div>

      <AlertDialog
        open={() => pendingReplyDelete() !== null}
        title="Delete reply"
        description={pendingReplyDelete()?.text}
        confirmLabel="Delete"
        onConfirm={confirmReplyDelete}
        onCancel={() => setPendingReplyDelete(null)}
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
