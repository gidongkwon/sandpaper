import { For, Show, type Accessor } from "solid-js";
import type { NotificationEntry } from "../../entities/notification/model/notification-types";
import type { AnchorRect } from "../../shared/model/position";
import { EmptyState } from "../../shared/ui/empty-state";
import { FloatingPanelPopover } from "../../shared/ui/floating-panel-popover";

type NotificationPanelProps = {
  open: Accessor<boolean>;
  anchorRect: Accessor<AnchorRect | null>;
  onClose: () => void;
  notifications: Accessor<NotificationEntry[]>;
  onMarkAllRead: () => void;
  onClear: () => void;
  onDismiss: (id: string) => void;
};

const formatTimestamp = (value: number) =>
  new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));

export const NotificationPanel = (props: NotificationPanelProps) => {
  return (
    <FloatingPanelPopover
      open={props.open()}
      anchorRect={props.anchorRect()}
      title="Notifications"
      class="notification-panel"
      placement="bottom-end"
      onClose={props.onClose}
    >
      <>
        <div class="notification-panel__header">
          <div>
            <h2 class="notification-panel__title">Notifications</h2>
            <span class="notification-panel__count">
              {props.notifications().length}
            </span>
          </div>
          <button
            class="notification-panel__close"
            type="button"
            aria-label="Close notifications"
            onClick={() => props.onClose()}
          >
            x
          </button>
        </div>

        <div class="notification-panel__actions">
          <button
            class="notification-panel__action"
            type="button"
            onClick={() => props.onMarkAllRead()}
            disabled={props.notifications().length === 0}
          >
            Mark all read
          </button>
          <button
            class="notification-panel__action is-muted"
            type="button"
            onClick={() => props.onClear()}
            disabled={props.notifications().length === 0}
          >
            Clear
          </button>
        </div>

        <div class="notification-panel__list">
          <Show
            when={props.notifications().length > 0}
            fallback={
              <EmptyState
                class="notification-panel__empty"
                message="No notifications yet."
              />
            }
          >
            <For each={props.notifications()}>
              {(item) => (
                <div
                  class={`notification-panel__item is-${item.kind} ${
                    item.read ? "is-read" : "is-unread"
                  }`}
                >
                  <div class="notification-panel__item-header">
                    <span class="notification-panel__item-title">
                      {item.title}
                    </span>
                    <span class="notification-panel__item-time">
                      {formatTimestamp(item.createdAt)}
                    </span>
                  </div>
                  <div class="notification-panel__item-message">
                    {item.message}
                  </div>
                  <button
                    class="notification-panel__dismiss"
                    type="button"
                    aria-label="Dismiss notification"
                    onClick={() => props.onDismiss(item.id)}
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </For>
          </Show>
        </div>
      </>
    </FloatingPanelPopover>
  );
};
