import { Show, type Accessor } from "solid-js";
import type { PluginPanel } from "../../entities/plugin/model/plugin-types";

type PluginPanelProps = {
  panel: Accessor<PluginPanel | null>;
  onClose: () => void;
};

export const PluginPanelWidget = (props: PluginPanelProps) => {
  return (
    <Show when={props.panel()}>
      {(panel) => (
        <section class="plugin-panel">
          <div class="plugin-panel__header">
            <div>
              <div class="plugin-panel__title">Active panel</div>
              <div class="plugin-panel__meta">
                {panel().title} · {panel().id}
              </div>
            </div>
            <button class="plugin-panel__close" onClick={() => props.onClose()}>
              Close
            </button>
          </div>
          <div class="plugin-panel__body">
            <div class="plugin-panel__content">
              Sandboxed panel placeholder for {panel().plugin_id}.
            </div>
          </div>
        </section>
      )}
    </Show>
  );
};
