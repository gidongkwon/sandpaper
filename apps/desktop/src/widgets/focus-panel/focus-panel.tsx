import { Show, type Accessor, type Component, type JSX } from "solid-js";
import type { Mode } from "../../shared/model/mode";

type FocusPanelProps = {
  mode: Accessor<Mode>;
  sectionJump: Component<{ id: string; label: string }>;
  capture: JSX.Element;
  refine: JSX.Element;
};

export const FocusPanel = (props: FocusPanelProps) => {
  return (
    <section
      class={`focus-panel ${props.mode() === "refine" ? "is-review" : "is-capture"}`}
      data-focus-mode={props.mode() === "refine" ? "refine" : "capture"}
      data-transition-slot={props.mode() === "quick-capture" ? "capture" : undefined}
      style={{
        "view-transition-name": props.mode() === "quick-capture" ? "mode-pane-capture" : "none"
      }}
    >
      <props.sectionJump
        id={props.mode() === "quick-capture" ? "capture" : "refine"}
        label={props.mode() === "quick-capture" ? "Capture" : "Refine"}
      />
      <Show when={props.mode() === "quick-capture"} fallback={props.refine}>
        {props.capture}
      </Show>
    </section>
  );
};
