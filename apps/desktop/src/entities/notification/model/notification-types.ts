export type NotificationKind = "info" | "success" | "warning" | "error";

export type NotificationEntry = {
  id: string;
  title: string;
  message: string;
  kind: NotificationKind;
  createdAt: number;
  read: boolean;
};
