import { createEffect, type Accessor, type Setter } from "solid-js";

type CapturePaneProps = {
  text: Accessor<string>;
  setText: Setter<string>;
  onCapture: () => void;
  focusEpoch: Accessor<number>;
};

export const CapturePane = (props: CapturePaneProps) => {
  let inputRef: HTMLTextAreaElement | undefined;

  createEffect(() => {
    props.focusEpoch();
    requestAnimationFrame(() => {
      inputRef?.focus();
      const length = inputRef?.value.length ?? 0;
      inputRef?.setSelectionRange(length, length);
    });
  });

  return (
    <div class="capture">
      <h2>Quick capture</h2>
      <p>Drop a thought and send it straight to your inbox.</p>
      <textarea
        ref={(el) => {
          inputRef = el;
        }}
        class="capture__input"
        rows={4}
        placeholder="Capture a thought, link, or task..."
        value={props.text()}
        onInput={(event) => props.setText(event.currentTarget.value)}
      />
      <div class="capture__actions">
        <button class="capture__button" onClick={() => props.onCapture()}>
          Add to Inbox
        </button>
        <span class="capture__hint">Shift+Enter for newline</span>
      </div>
    </div>
  );
};
