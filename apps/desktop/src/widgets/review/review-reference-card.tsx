import { For, Show } from "solid-js";
import { extractImageSource } from "../../shared/lib/blocks/block-type-utils";
import { AssetImage } from "../../shared/ui/asset-image";
import type { ReviewThread } from "../../entities/review/model/review-types";
import { Button } from "../../shared/ui/button";
import { ArrowRight16Icon } from "../../shared/ui/icons";

type ReviewReferenceCardProps = {
  thread: ReviewThread;
  capturedLabel: string;
  clickable?: boolean;
  compact?: boolean;
  active?: boolean;
  peekLevel?: 0 | 1 | 2;
  archivedLabel?: string | null;
  destinationLabel?: string | null;
  onSelect?: () => void;
};

export const ReviewReferenceCard = (props: ReviewReferenceCardProps) => {
  const findBodyText = (entry: ReviewThread["entries"][number]) =>
    entry.blocks.find((block) => block.meta?.capture?.role === "body")?.text ??
    entry.blocks.find((block) => !extractImageSource(block.text))?.text ??
    entry.text;

  const findImageSources = (entry: ReviewThread["entries"][number]) =>
    entry.blocks
      .map((block) => extractImageSource(block.text))
      .filter((source): source is string => source !== null);

  const content = (
    <>
      <div class="review-reference-card__meta">
        <span>{props.capturedLabel}</span>
        <Show when={props.archivedLabel}>
          {(archivedLabel) => <span>{archivedLabel()}</span>}
        </Show>
      </div>
      <div class="review-reference-card__entries">
        <For each={props.thread.entries}>
          {(entry) => {
            const bodyText = findBodyText(entry);
            const imageSources = findImageSources(entry);
            return (
              <section class="review-reference-card__entry-group">
                <Show when={bodyText.trim().length > 0}>
                  <p class="review-reference-card__entry">{bodyText}</p>
                </Show>
                <Show when={imageSources.length > 0}>
                  <div class="review-reference-card__thumb-grid">
                    <For each={imageSources}>
                      {(source) => (
                        <div class="review-reference-card__thumb">
                          <AssetImage
                            class="review-reference-card__thumb-image"
                            source={source}
                            isTauri={source.startsWith("/assets/")}
                          />
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </section>
            );
          }}
        </For>
      </div>
      <Show when={props.destinationLabel}>
        {(destinationLabel) => (
          <div class="review-reference-card__destination">
            <span class="review-reference-card__destination-label">
              <ArrowRight16Icon
                class="review-reference-card__destination-icon"
                width="12"
                height="12"
              />
              <span class="review-reference-card__destination-text">
                {destinationLabel()}
              </span>
            </span>
          </div>
        )}
      </Show>
    </>
  );

  const className = () =>
    [
      "review-reference-card",
      props.compact ? "is-compact" : "",
      props.active ? "is-active" : "",
      props.peekLevel ? `is-peek-${props.peekLevel}` : "",
      props.clickable ? "is-clickable" : ""
    ]
      .filter(Boolean)
      .join(" ");

  return (
    <Show
      when={props.clickable}
      fallback={<article class={className()}>{content}</article>}
    >
      <Button
        class={className()}
        variant="unstyled"
        onClick={() => props.onSelect?.()}
      >
        {content}
      </Button>
    </Show>
  );
};
