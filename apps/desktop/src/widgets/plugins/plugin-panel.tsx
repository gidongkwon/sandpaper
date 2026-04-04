import { Show, type Accessor } from "solid-js";
import type { PluginPanel } from "../../entities/plugin/model/plugin-types";
import { Dismiss12Icon } from "../../shared/ui/icons";
import { IconButton } from "../../shared/ui/icon-button";

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
            <IconButton
              class="plugin-panel__close"
              variant="panel"
              label="Close plugin panel"
              onClick={() => props.onClose()}
            >
              <Dismiss12Icon />
            </IconButton>
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
