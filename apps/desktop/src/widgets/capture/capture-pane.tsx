import {
  For,
  Show,
  createEffect,
  createSignal,
  type Accessor,
  type Setter
} from "solid-js";
import { ConfirmDialog } from "../../shared/ui/confirm-dialog";
import { ArrowUp16FilledIcon } from "../../shared/ui/icons";

export type CaptureItem = {
  block: {
    id: string;
    text: string;
    indent: number;
  };
  position: number;
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
  replyingTo: Accessor<string | null>;
  focusEpoch: Accessor<number>;
};

const formatTime = () => {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes().toString().padStart(2, "0");
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${m} ${period}`;
};

export const CapturePane = (props: CapturePaneProps) => {
  let inputRef: HTMLTextAreaElement | undefined;
  let messagesRef: HTMLDivElement | undefined;
  const [justCaptured, setJustCaptured] = createSignal(false);
  const [lastCaptureTime, setLastCaptureTime] = createSignal<string | null>(
    null
  );
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
    setLastCaptureTime(formatTime());
    props.onCapture();
    setJustCaptured(false);
    queueMicrotask(() => {
      setJustCaptured(true);
      setTimeout(() => setJustCaptured(false), 600);
    });
    if (inputRef) inputRef.style.height = "auto";
  };

  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
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
              {(thread) => (
                <section
                  class="capture-chat__thread"
                  role="group"
                  aria-label={`Thread ${thread.root.block.text}`}
                >
                  <div class="capture-chat__bubble-row">
                    <div class="capture-chat__bubble">
                      <textarea
                        class="capture-chat__bubble-text"
                        aria-label={`Captured item ${thread.root.position}`}
                        value={thread.root.block.text}
                        ref={(el) => {
                          requestAnimationFrame(() => autoResize(el));
                        }}
                        onInput={(event) => {
                          props.onEditItem(thread.root.block.id, event.currentTarget.value);
                          autoResize(event.currentTarget);
                        }}
                      />
                    </div>
                    <button
                      class="capture-chat__reply"
                      type="button"
                      aria-label={`Reply to ${thread.root.block.text}`}
                      onClick={() => props.onReplyTo(thread.root.block.id)}
                    >
                      Reply
                    </button>
                    <button
                      class="capture-chat__reply"
                      type="button"
                      aria-label={`Delete ${thread.root.block.text}`}
                      onClick={() =>
                        setPendingThreadDelete({
                          id: thread.root.block.id,
                          text: thread.root.block.text,
                          replyCount: thread.replies.length
                        })
                      }
                    >
                      Delete
                    </button>
                  </div>
                  <For each={thread.replies}>
                    {(reply) => (
                      <div class="capture-chat__bubble-row capture-chat__bubble-row--reply">
                        <div class="capture-chat__bubble">
                          <textarea
                            class="capture-chat__bubble-text"
                            aria-label={`Captured item ${reply.position}`}
                            value={reply.block.text}
                            ref={(el) => {
                              requestAnimationFrame(() => autoResize(el));
                            }}
                            onInput={(event) => {
                              props.onEditItem(reply.block.id, event.currentTarget.value);
                              autoResize(event.currentTarget);
                            }}
                          />
                        </div>
                        <button
                          class="capture-chat__reply"
                          type="button"
                          aria-label={`Delete ${reply.block.text}`}
                          onClick={() =>
                            setPendingReplyDelete({
                              id: reply.block.id,
                              text: reply.block.text
                            })
                          }
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </For>
                </section>
              )}
            </For>
            <Show when={lastCaptureTime()}>
              <span class="capture-chat__time">{lastCaptureTime()}</span>
            </Show>
          </Show>
        </div>

        <div class="capture-chat__composer">
          <Show when={props.replyingTo()}>
            {(replyingTo) => (
              <div class="capture-chat__replying">
                <span>{`Replying to ${replyingTo()}`}</span>
                <button
                  type="button"
                  class="capture-chat__reply-cancel"
                  aria-label="Cancel reply"
                  onClick={() => props.onCancelReply()}
                >
                  Cancel
                </button>
              </div>
            )}
          </Show>
          <div class="capture-chat__input-wrap">
            <textarea
              ref={(el) => {
                inputRef = el;
              }}
              class="capture-chat__input"
              rows={1}
              placeholder="Capture a thought, link, or task..."
              value={props.text()}
              onInput={(event) => {
                props.setText(event.currentTarget.value);
                autoResize(event.currentTarget);
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
          <button
            class="capture-chat__send"
            disabled={props.text().trim().length === 0}
            onClick={() => handleCapture()}
            aria-label="Send capture"
          >
            <ArrowUp16FilledIcon width="16" height="16" />
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={() => pendingReplyDelete() !== null}
        title="Delete reply"
        description={pendingReplyDelete()?.text}
        confirmLabel="Delete"
        onConfirm={confirmReplyDelete}
        onCancel={() => setPendingReplyDelete(null)}
      />
      <ConfirmDialog
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
