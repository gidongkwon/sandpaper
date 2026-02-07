import { For, Show, type Accessor, type Setter } from "solid-js";
import type { SyncStatus } from "../../entities/sync/model/sync-types";
import type { Mode } from "../../shared/model/mode";
import { Alert16Icon, PanelLeft16Icon, Settings16Icon } from "../../shared/ui/icons";
import { IconButton } from "../../shared/ui/icon-button";

type TopbarProps = {
  sidebarOpen: Accessor<boolean>;
  toggleSidebar: () => void;
  mode: Accessor<Mode>;
  setMode: Setter<Mode>;
  showStatusSurfaces: Accessor<boolean>;
  showShortcutHints: Accessor<boolean>;
  shortcutHints: Accessor<string[]>;
  syncStatus: Accessor<SyncStatus>;
  syncStateLabel: Accessor<string>;
  syncStateDetail: Accessor<string>;
  autosaveError: Accessor<string | null>;
  autosaved: Accessor<boolean>;
  autosaveStamp: Accessor<string | null>;
  notificationsOpen: Accessor<boolean>;
  notificationCount: Accessor<number>;
  onOpenNotifications: () => void;
  onOpenSettings: () => void;
};

export const Topbar = (props: TopbarProps) => {
  const autosaveState = () => {
    if (props.autosaveError()) return "error";
    if (props.autosaved()) return "saved";
    return "saving";
  };

  const autosaveLabel = () => {
    if (props.autosaveError()) return "Save failed";
    if (props.autosaved()) return "Saved";
    return "Saving...";
  };

  return (
    <header class="topbar">
      <div class="topbar__left">
        <button
          class="topbar__sidebar-toggle"
          onClick={() => props.toggleSidebar()}
          aria-label={props.sidebarOpen() ? "Hide sidebar" : "Show sidebar"}
        >
          <PanelLeft16Icon width="16" height="16" />
        </button>
      </div>

      <nav class="mode-switch">
        <button
          class={`mode-switch__button ${props.mode() === "quick-capture" ? "is-active" : ""}`}
          onClick={() => props.setMode("quick-capture")}
        >
          Capture
        </button>
        <button
          class={`mode-switch__button ${props.mode() === "editor" ? "is-active" : ""}`}
          onClick={() => props.setMode("editor")}
        >
          Editor
        </button>
        <button
          class={`mode-switch__button ${props.mode() === "review" ? "is-active" : ""}`}
          onClick={() => props.setMode("review")}
        >
          Review
        </button>
      </nav>

      <div class="topbar__right">
        <Show when={props.showStatusSurfaces()}>
          <span class={`topbar__sync-indicator topbar__status-chip ${props.syncStatus().state}`} title={props.syncStateDetail()}>
            <span class="topbar__sync-dot" />
            <span class="topbar__sync-label">{props.syncStateLabel()}</span>
          </span>
          <span
            class={`topbar__autosave topbar__status-chip is-${autosaveState()}`}
            title={props.autosaveError() ?? props.autosaveStamp() ?? "Autosave status"}
          >
            {autosaveLabel()}
          </span>
          <Show when={props.showShortcutHints()}>
            <div class="topbar__shortcut-hints" aria-label={`${props.mode()} shortcuts`}>
              <For each={props.shortcutHints()}>
                {(hint) => <span class="topbar__shortcut-hint">{hint}</span>}
              </For>
            </div>
          </Show>
        </Show>
        <IconButton
          class="topbar__notifications"
          label="Open notifications"
          aria-haspopup="dialog"
          aria-expanded={props.notificationsOpen()}
          onClick={() => props.onOpenNotifications()}
        >
          <Alert16Icon width="16" height="16" />
          <Show when={props.notificationCount() > 0}>
            <span class="topbar__notification-badge">
              {props.notificationCount()}
            </span>
          </Show>
        </IconButton>
        <IconButton
          class="topbar__settings"
          label="Open settings"
          onClick={() => props.onOpenSettings()}
        >
          <Settings16Icon width="16" height="16" />
        </IconButton>
      </div>
    </header>
  );
};
