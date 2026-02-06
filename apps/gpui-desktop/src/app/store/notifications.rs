use super::AppStore;
use crate::app::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum NotificationKind {
    PluginError,
}

#[derive(Clone, Debug)]
pub(crate) struct NotificationItem {
    pub(crate) id: String,
    pub(crate) kind: NotificationKind,
    pub(crate) title: SharedString,
    pub(crate) message: SharedString,
    pub(crate) details: Option<SharedString>,
    pub(crate) created_at_ms: i64,
    pub(crate) read: bool,
}

impl NotificationItem {
    pub(crate) fn plugin_error(message: SharedString, details: Option<PluginRuntimeError>) -> Self {
        let details_text: Option<SharedString> = details.and_then(|err| {
            let mut parts = Vec::new();
            if let Some(context) = err.context.as_ref() {
                parts.push(format!("Context: {}", context.phase));
                if let Some(plugin_id) = context.plugin_id.as_ref() {
                    parts.push(format!("Plugin: {plugin_id}"));
                }
                if let Some(renderer_id) = context.renderer_id.as_ref() {
                    parts.push(format!("Renderer: {renderer_id}"));
                }
            }
            if let Some(stack) = err.stack.as_ref() {
                parts.push(stack.clone());
            }
            if parts.is_empty() {
                None
            } else {
                Some(parts.join("\n").into())
            }
        });

        Self {
            id: Uuid::new_v4().to_string(),
            kind: NotificationKind::PluginError,
            title: "Plugin error".into(),
            message,
            details: details_text,
            created_at_ms: chrono::Utc::now().timestamp_millis(),
            read: false,
        }
    }
}

pub(crate) fn unread_count(items: &[NotificationItem]) -> usize {
    items.iter().filter(|item| !item.read).count()
}

pub(crate) fn mark_all_read(items: &mut [NotificationItem]) {
    for item in items {
        item.read = true;
    }
}

impl AppStore {
    pub(crate) fn unread_notifications_count(&self) -> usize {
        unread_count(&self.ui.notifications)
    }

    pub(crate) fn push_plugin_error_notification(
        &mut self,
        message: SharedString,
        details: Option<PluginRuntimeError>,
    ) {
        let item = NotificationItem::plugin_error(message, details);
        self.ui.notifications.push(item);

        const MAX_NOTIFICATIONS: usize = 200;
        if self.ui.notifications.len() > MAX_NOTIFICATIONS {
            let overflow = self.ui.notifications.len() - MAX_NOTIFICATIONS;
            self.ui.notifications.drain(0..overflow);
        }
    }

    pub(crate) fn mark_all_notifications_read(&mut self, cx: &mut Context<Self>) {
        mark_all_read(&mut self.ui.notifications);
        cx.notify();
    }

    pub(crate) fn clear_notifications(&mut self, cx: &mut Context<Self>) {
        self.ui.notifications.clear();
        cx.notify();
    }

    pub(crate) fn open_notifications(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let has_root = window.root::<Root>().flatten().is_some();
        if !has_root {
            return;
        }
        if has_root && self.ui.notifications_open && window.has_active_dialog(cx) {
            return;
        }

        self.ui.notifications_open = true;
        mark_all_read(&mut self.ui.notifications);

        let app = cx.entity();
        let view = cx.new(|cx| crate::ui::dialogs::NotificationsDialogView::new(app.clone(), cx));

        window.open_dialog(cx, move |dialog, _window, _cx| {
            let app = app.clone();
            let view = view.clone();
            dialog
                .title("Notifications")
                .w(px(560.0))
                .keyboard(false)
                .child(view)
                .on_close(move |_event, _window, cx| {
                    app.update(cx, |app, cx| {
                        app.ui.notifications_open = false;
                        cx.notify();
                    });
                })
        });

        cx.notify();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unread_count_counts_unread_items() {
        let items = vec![
            NotificationItem {
                id: "1".into(),
                kind: NotificationKind::PluginError,
                title: "Plugin error".into(),
                message: "Boom".into(),
                details: None,
                created_at_ms: 0,
                read: false,
            },
            NotificationItem {
                id: "2".into(),
                kind: NotificationKind::PluginError,
                title: "Plugin error".into(),
                message: "Also boom".into(),
                details: None,
                created_at_ms: 0,
                read: true,
            },
        ];

        assert_eq!(unread_count(&items), 1);
    }

    #[test]
    fn mark_all_read_marks_everything_read() {
        let mut items = vec![
            NotificationItem {
                id: "1".into(),
                kind: NotificationKind::PluginError,
                title: "Plugin error".into(),
                message: "Boom".into(),
                details: None,
                created_at_ms: 0,
                read: false,
            },
            NotificationItem {
                id: "2".into(),
                kind: NotificationKind::PluginError,
                title: "Plugin error".into(),
                message: "Also boom".into(),
                details: None,
                created_at_ms: 0,
                read: false,
            },
        ];

        mark_all_read(&mut items);
        assert_eq!(unread_count(&items), 0);
        assert!(items.iter().all(|item| item.read));
    }
}
