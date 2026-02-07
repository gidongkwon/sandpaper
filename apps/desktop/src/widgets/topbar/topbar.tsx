import { For, Show, type Accessor, type Setter } from "solid-js";
import type { SyncStatus } from "../../entities/sync/model/sync-types";
import type { Mode } from "../../shared/model/mode";
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
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="9" y1="3" x2="9" y2="21" />
          </svg>
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
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 7h18s-3 0-3-7" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
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
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </IconButton>
      </div>
    </header>
  );
};
