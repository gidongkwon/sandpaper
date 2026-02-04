use crate::app::prelude::*;
use crate::app::store::*;
impl AppStore {
    pub(in super::super) fn render_settings_general_panel(
        &mut self,
        cx: &mut Context<Self>,
    ) -> gpui::AnyElement {
        let theme = cx.theme();
        let vault_label: SharedString = self
            .app
            .active_vault_id
            .as_ref()
            .and_then(|id| self.app.vaults.iter().find(|vault| &vault.id == id))
            .map(|vault| vault.name.clone().into())
            .unwrap_or_else(|| "No vault selected".into());
        let vault_path = self
            .app
            .active_vault_root
            .as_ref()
            .map(|path| path.display().to_string())
            .unwrap_or_else(|| "—".to_string());

        let mut content = div().flex().flex_col().gap_3().child(
            div()
                .text_sm()
                .text_color(theme.foreground)
                .font_weight(gpui::FontWeight::SEMIBOLD)
                .child("General"),
        );

        content = content.child(
            div()
                .flex()
                .flex_col()
                .gap_1()
                .child(
                    div()
                        .text_xs()
                        .text_color(theme.muted_foreground)
                        .child("Active vault"),
                )
                .child(
                    div()
                        .text_sm()
                        .text_color(theme.foreground)
                        .child(vault_label.clone()),
                )
                .child(
                    div()
                        .text_xs()
                        .text_color(theme.muted_foreground)
                        .child(vault_path),
                ),
        );

        content = content.child(
            div()
                .flex()
                .flex_col()
                .gap_2()
                .child(
                    div()
                        .text_sm()
                        .text_color(theme.foreground)
                        .font_weight(gpui::FontWeight::SEMIBOLD)
                        .child("Editor"),
                )
                .child(
                    self.render_settings_row(
                        "Sync scroll across panes",
                        "Keep primary and split panes aligned.",
                        Switch::new("settings-sync-scroll")
                            .checked(self.settings.sync_scroll)
                            .on_click(cx.listener(|this, checked, _window, cx| {
                                this.settings.sync_scroll = *checked;
                                this.persist_settings();
                                cx.notify();
                            }))
                            .into_any_element(),
                        cx,
                    ),
                )
                .child(
                    self.render_settings_row(
                        "Show backlinks panel",
                        "Toggle the backlinks sidebar section.",
                        Switch::new("settings-backlinks")
                            .checked(self.settings.backlinks_open)
                            .on_click(cx.listener(|this, checked, _window, cx| {
                                this.settings.backlinks_open = *checked;
                                this.persist_settings();
                                cx.notify();
                            }))
                            .into_any_element(),
                        cx,
                    ),
                ),
        );

        content.into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::TestAppContext;
    use gpui_component::Root;
    use std::cell::RefCell;
    use std::rc::Rc;

    #[gpui::test]
    fn settings_modal_render_smoke(cx: &mut TestAppContext) {
        cx.skip_drawing();
        let app_handle: Rc<RefCell<Option<Entity<AppStore>>>> = Rc::new(RefCell::new(None));

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
        }

        let app_handle_for_window = app_handle.clone();
        let window = cx.add_window(|window, cx| {
            let app = cx.new(|cx| AppStore::new(window, cx));
            *app_handle_for_window.borrow_mut() = Some(app.clone());
            Root::new(app, window, cx)
        });

        let app = app_handle.borrow().clone().expect("app");
        cx.update_window(*window, |_root, window, cx| {
            app.update(cx, |app, cx| {
                app.open_settings(SettingsTab::General, window, cx);
            });
            assert!(window.has_active_sheet(cx));
        })
        .unwrap();
    }
}
