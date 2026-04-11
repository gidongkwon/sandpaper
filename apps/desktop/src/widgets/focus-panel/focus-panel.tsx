import { Show, type Accessor, type Component, type JSX } from "solid-js";
import type { Mode } from "../../shared/model/mode";

type FocusPanelProps = {
  mode: Accessor<Mode>;
  sectionJump: Component<{ id: string; label: string }>;
  capture: JSX.Element;
  review: JSX.Element;
};

export const FocusPanel = (props: FocusPanelProps) => {
  return (
    <section
      class={`focus-panel ${props.mode() === "review" ? "is-review" : "is-capture"}`}
      data-focus-mode={props.mode() === "review" ? "review" : "capture"}
      data-transition-slot={props.mode() === "quick-capture" ? "capture" : undefined}
      style={{
        "view-transition-name": props.mode() === "quick-capture" ? "mode-pane-capture" : "none"
      }}
    >
      <props.sectionJump
        id={props.mode() === "quick-capture" ? "capture" : "review"}
        label={props.mode() === "quick-capture" ? "Capture" : "Refine"}
      />
      <Show when={props.mode() === "quick-capture"} fallback={props.review}>
        {props.capture}
      </Show>
    </section>
  );
};
