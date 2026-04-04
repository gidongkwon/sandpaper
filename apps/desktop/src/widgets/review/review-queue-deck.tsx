import { For, Show, createMemo, createSignal, onCleanup } from "solid-js";
import type { ReviewThread } from "../../entities/review/model/review-types";
import { ReviewReferenceCard } from "./review-reference-card";

type ReviewQueueDeckProps = {
  threads: ReviewThread[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  formatCapturedRange: (thread: ReviewThread) => string;
};

export const ReviewQueueDeck = (props: ReviewQueueDeckProps) => {
  const [promotingThreadId, setPromotingThreadId] = createSignal<string | null>(null);
  let promoteTimer: ReturnType<typeof setTimeout> | undefined;

  const queuePromotion = (id: string) => {
    if (promotingThreadId() === id) return;
    if (promoteTimer) clearTimeout(promoteTimer);
    setPromotingThreadId(id);
    promoteTimer = setTimeout(() => {
      props.onSelectThread(id);
      setPromotingThreadId(null);
      promoteTimer = undefined;
    }, 140);
  };

  onCleanup(() => {
    if (promoteTimer) clearTimeout(promoteTimer);
  });

  const orderedThreads = createMemo(() => {
    const activeThread =
      props.threads.find((thread) => thread.id === props.activeThreadId) ?? props.threads[0];
    if (!activeThread) return [];
    return [
      activeThread,
      ...props.threads.filter((thread) => thread.id !== activeThread.id)
    ];
  });

  const visibleThreads = createMemo(() => orderedThreads().slice(0, 3));

  return (
    <div class="review-queue-deck">
      <Show
        when={orderedThreads().length > 0}
        fallback={<div class="review-queue-deck__empty">No capture threads to review.</div>}
      >
        <nav class="review-queue-deck__stack" aria-label="Review queue">
          <For each={visibleThreads()}>
            {(thread, index) => (
              <div
                class={`review-queue-deck__layer layer-${index()}`}
                data-promoting={promotingThreadId() === thread.id}
              >
                <ReviewReferenceCard
                  thread={thread}
                  capturedLabel={props.formatCapturedRange(thread)}
                  active={index() === 0}
                  clickable={index() > 0}
                  peekLevel={index() === 0 ? 0 : ((index() as 1 | 2) ?? 1)}
                  onSelect={() => queuePromotion(thread.id)}
                />
              </div>
            )}
          </For>
        </nav>
      </Show>
    </div>
  );
};
