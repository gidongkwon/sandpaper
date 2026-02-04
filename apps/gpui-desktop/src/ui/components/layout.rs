use crate::app::prelude::*;
use crate::app::store::*;

impl AppStore {
    fn render_topbar(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let mode_label = match self.app.mode {
            Mode::Editor => "Editor",
            Mode::Capture => "Capture",
            Mode::Review => "Review",
        };

        let vault_label: SharedString = self
            .app
            .active_vault_id
            .as_ref()
            .and_then(|id| self.app.vaults.iter().find(|vault| &vault.id == id))
            .map(|vault| vault.name.clone().into())
            .unwrap_or_else(|| "Vaults".into());

        let save_label: SharedString = match &self.app.save_state {
            SaveState::Saved => "Saved".into(),
            SaveState::Dirty => "Unsaved changes".into(),
            SaveState::Saving => "Saving…".into(),
            SaveState::Error(err) => format!("Save failed: {err}").into(),
        };

        let mut status_group = div()
            .flex()
            .items_center()
            .gap_2()
            .child(
                div()
                    .text_sm()
                    .text_color(theme.foreground)
                    .font_weight(gpui::FontWeight::SEMIBOLD)
                    .child(format!("Sandpaper · {mode_label}")),
            )
            .child(
                div()
                    .ml_2()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .child(self.app.boot_status.clone()),
            );

        if let Some(note) = self.ui.capture_confirmation.clone() {
            status_group = status_group.child(
                div()
                    .ml_2()
                    .px_2()
                    .py(px(1.0))
                    .rounded_sm()
                    .bg(theme.success)
                    .text_xs()
                    .text_color(theme.success_foreground)
                    .child(note),
            );
        }

        let right_group = div()
            .flex()
            .items_center()
            .gap_2()
            .child(
                div()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .child(save_label),
            )
            .child(
                Button::new("settings-button")
                    .xsmall()
                    .ghost()
                    .icon(IconName::Settings)
                    .tooltip("Settings")
                    .on_click(cx.listener(|this, _event, window, cx| {
                        this.open_settings(SettingsTab::General, window, cx);
                    })),
            )
            .child(
                Button::new("vaults-button")
                    .label(vault_label)
                    .xsmall()
                    .icon(IconName::FolderOpen)
                    .on_click(cx.listener(|this, _event, window, cx| {
                        this.open_vaults(&OpenVaults, window, cx);
                    })),
            );

        div()
            .h(px(48.0))
            .px_3()
            .flex()
            .items_center()
            .justify_between()
            .bg(theme.title_bar)
            .border_b_1()
            .border_color(theme.title_bar_border)
            .child(status_group)
            .child(right_group)
    }

    pub(crate) fn render_root(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let mut root = div()
            .id("sandpaper-app")
            .key_context("Sandpaper")
            .on_action(cx.listener(Self::open_vaults))
            .on_action(cx.listener(Self::new_page))
            .on_action(cx.listener(Self::rename_page))
            .on_action(cx.listener(Self::toggle_mode_editor))
            .on_action(cx.listener(Self::toggle_mode_capture))
            .on_action(cx.listener(Self::toggle_mode_review))
            .on_action(cx.listener(Self::open_command_palette_action))
            .on_action(cx.listener(Self::close_command_palette_action))
            .on_action(cx.listener(Self::palette_move_up))
            .on_action(cx.listener(Self::palette_move_down))
            .on_action(cx.listener(Self::palette_run))
            .on_mouse_move(cx.listener(|this, _event: &MouseMoveEvent, _window, cx| {
                if this.editor.link_preview.is_some() && !this.editor.link_preview_hovering_link {
                    this.schedule_link_preview_close(cx);
                }
            }))
            .track_focus(self.focus_handle())
            .flex()
            .flex_col()
            .size_full()
            .bg(cx.theme().background)
            .child(self.render_topbar(cx));

        if let Some(banner) = self.render_plugin_error_banner(cx) {
            root = root.child(banner);
        }

        root = root.child(
            div()
                .flex()
                .flex_1()
                .min_h_0()
                .child(self.render_sidebar(cx))
                .child(self.render_editor(cx)),
        );

        if let Some(preview) = self.render_link_preview(window, cx) {
            root = root.child(gpui::deferred(preview).with_priority(10));
        }

        if let Some(panel) = self.render_plugin_panel(cx) {
            root = root.child(panel);
        }

        root = root
            .children(Root::render_dialog_layer(window, cx))
            .children(Root::render_sheet_layer(window, cx))
            .children(Root::render_notification_layer(window, cx));

        root
    }
}
