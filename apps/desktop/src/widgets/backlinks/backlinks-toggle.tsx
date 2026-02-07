import { Show, type Accessor } from "solid-js";
import { Link16Icon } from "../../shared/ui/icons";

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
      <Link16Icon width="14" height="14" />
      <Show when={props.total() > 0}>
        <span class="backlinks-toggle__badge">{props.total()}</span>
      </Show>
    </button>
  );
};
