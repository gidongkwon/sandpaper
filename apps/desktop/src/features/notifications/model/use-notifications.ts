import { createMemo, createSignal } from "solid-js";
import type { NotificationEntry, NotificationKind } from "../../../entities/notification/model/notification-types";
import { makeRandomId } from "../../../shared/lib/id/id-factory";

type NotificationInput = {
  title: string;
  message: string;
  kind?: NotificationKind;
};

export const createNotifications = () => {
  const [notifications, setNotifications] = createSignal<NotificationEntry[]>(
    []
  );

  const unreadCount = createMemo(
    () => notifications().filter((item) => !item.read).length
  );

  const addNotification = (input: NotificationInput) => {
    const entry: NotificationEntry = {
      id: makeRandomId(),
      title: input.title,
      message: input.message,
      kind: input.kind ?? "info",
      createdAt: Date.now(),
      read: false
    };
    setNotifications((prev) => [entry, ...prev]);
  };

  const markAllRead = () => {
    setNotifications((prev) => prev.map((item) => ({ ...item, read: true })));
  };

  const dismiss = (id: string) => {
    setNotifications((prev) => prev.filter((item) => item.id !== id));
  };

  const clearAll = () => {
    setNotifications([]);
  };

  return {
    notifications,
    unreadCount,
    addNotification,
    markAllRead,
    dismiss,
    clearAll
  };
};
