import { Show, type Accessor } from "solid-js";

type BacklinksToggleProps = {
  open: Accessor<boolean>;
  total: Accessor<number>;
  onToggle: () => void;
};

export const BacklinksToggle = (props: BacklinksToggleProps) => {
  return (
    <button
      class={`backlinks-toggle ${props.open() ? "is-active" : ""} ${
        props.total() > 0 ? "has-links" : ""
      }`}
      onClick={() => props.onToggle()}
      aria-label={props.open() ? "Hide backlinks" : "Show backlinks"}
      title={`${props.total()} backlinks`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
      <Show when={props.total() > 0}>
        <span class="backlinks-toggle__badge">{props.total()}</span>
      </Show>
    </button>
  );
};
