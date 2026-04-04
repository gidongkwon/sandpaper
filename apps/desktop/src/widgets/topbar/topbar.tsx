import { Show, createSignal, onCleanup, onMount, type Accessor, type Setter } from "solid-js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Mode } from "../../shared/model/mode";
import { Alert16Icon, Dismiss12Icon, PanelLeft16Icon, Settings16Icon, Square12Icon, Subtract12Icon } from "../../shared/ui/icons";
import { IconButton } from "../../shared/ui/icon-button";

const isMac = () => document.documentElement.dataset.platform === "macos";

type TopbarProps = {
  sidebarOpen: Accessor<boolean>;
  toggleSidebar: () => void;
  mode: Accessor<Mode>;
  setMode: Setter<Mode>;
  showStatusSurfaces: Accessor<boolean>;
  autosaveError: Accessor<string | null>;
  autosaved: Accessor<boolean>;
  autosaveStamp: Accessor<string | null>;
  notificationsOpen: Accessor<boolean>;
  notificationCount: Accessor<number>;
  onOpenNotifications: () => void;
  onOpenSettings: () => void;
};

export const Topbar = (props: TopbarProps) => {
  const [modeSwitchCentered, setModeSwitchCentered] = createSignal(false);
  let headerRef: HTMLElement | undefined;
  let leftRef: HTMLDivElement | undefined;
  let rightRef: HTMLDivElement | undefined;
  let modeSwitchRef: HTMLElement | undefined;

  const switchMode = (nextMode: Mode) => {
    if (props.mode() === nextMode) return;
    const nextState = () => props.setMode(nextMode);
    const documentWithTransition = document as Document & {
      startViewTransition?: (
        callback: () => void
      ) => {
        finished?: Promise<void>;
        ready?: Promise<void>;
        updateCallbackDone?: Promise<void>;
        skipTransition?: () => void;
      };
    };
    if (typeof documentWithTransition.startViewTransition === "function") {
      documentWithTransition.startViewTransition(nextState);
      return;
    }
    nextState();
  };

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

  const updateModeSwitchLayout = () => {
    if (!headerRef || !leftRef || !rightRef || !modeSwitchRef) {
      setModeSwitchCentered(false);
      return;
    }
    const headerWidth = headerRef.getBoundingClientRect().width;
    const leftWidth = leftRef.getBoundingClientRect().width;
    const rightWidth = rightRef.getBoundingClientRect().width;
    const modeWidth = modeSwitchRef.getBoundingClientRect().width;
    const safetyGap = 48;
    const widestSide = Math.max(leftWidth, rightWidth);
    setModeSwitchCentered(headerWidth >= modeWidth + widestSide * 2 + safetyGap * 2);
  };

  onMount(() => {
    updateModeSwitchLayout();
    const resizeObserver =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => updateModeSwitchLayout())
        : null;
    if (resizeObserver) {
      if (headerRef) resizeObserver.observe(headerRef);
      if (leftRef) resizeObserver.observe(leftRef);
      if (rightRef) resizeObserver.observe(rightRef);
      if (modeSwitchRef) resizeObserver.observe(modeSwitchRef);
    }
    window.addEventListener("resize", updateModeSwitchLayout);
    onCleanup(() => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateModeSwitchLayout);
    });
  });

  return (
    <header
      ref={headerRef}
      class={`topbar ${modeSwitchCentered() ? "is-mode-centered" : ""}`}
      data-tauri-drag-region
    >
      <div ref={leftRef} class="topbar__left">
        <button
          class="topbar__sidebar-toggle"
          onClick={() => props.toggleSidebar()}
          aria-label={props.sidebarOpen() ? "Hide sidebar" : "Show sidebar"}
        >
          <PanelLeft16Icon width="16" height="16" />
        </button>
      </div>

      <nav ref={modeSwitchRef} class="mode-switch">
        <button
          class={`mode-switch__button ${props.mode() === "quick-capture" ? "is-active" : ""}`}
          onClick={() => switchMode("quick-capture")}
        >
          Capture
        </button>
        <button
          class={`mode-switch__button ${props.mode() === "review" ? "is-active" : ""}`}
          onClick={() => switchMode("review")}
        >
          Review
        </button>
        <button
          class={`mode-switch__button ${props.mode() === "editor" ? "is-active" : ""}`}
          onClick={() => switchMode("editor")}
        >
          Editor
        </button>
      </nav>

      <div ref={rightRef} class="topbar__right">
        <Show when={props.showStatusSurfaces()}>
          <span
            class={`topbar__autosave topbar__status-chip is-${autosaveState()}`}
            title={props.autosaveError() ?? props.autosaveStamp() ?? "Autosave status"}
          >
            {autosaveLabel()}
          </span>
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
        <Show when={!isMac()}>
          <div class="window-controls">
            <button
              class="window-control"
              onClick={() => getCurrentWindow().minimize()}
              aria-label="Minimize"
            >
              <Subtract12Icon width="12" height="12" />
            </button>
            <button
              class="window-control"
              onClick={() => getCurrentWindow().toggleMaximize()}
              aria-label="Maximize"
            >
              <Square12Icon width="12" height="12" />
            </button>
            <button
              class="window-control window-control--close"
              onClick={() => getCurrentWindow().close()}
              aria-label="Close"
            >
              <Dismiss12Icon width="12" height="12" />
            </button>
          </div>
        </Show>
      </div>
    </header>
  );
};
