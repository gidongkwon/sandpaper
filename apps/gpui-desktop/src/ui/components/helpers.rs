use crate::app::prelude::*;
use crate::app::store::*;
use crate::ui::tokens;

impl AppStore {
    pub(super) fn render_settings_row(
        &self,
        label: &str,
        description: &str,
        control: gpui::AnyElement,
        cx: &App,
    ) -> gpui::AnyElement {
        let theme = cx.theme();
        div()
            .flex()
            .items_start()
            .gap_6()
            .py_3()
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_0()
                    .flex_1()
                    .min_w_0()
                    .child(
                        div()
                            .text_size(tokens::FONT_BASE)
                            .text_color(theme.foreground)
                            .child(label.to_string()),
                    )
                    .child(
                        div()
                            .text_size(tokens::FONT_SM)
                            .text_color(theme.muted_foreground)
                            .child(description.to_string()),
                    ),
            )
            .child(div().mt(tokens::SPACE_1).flex_shrink_0().child(control))
            .into_any_element()
    }

    pub(super) fn render_settings_section_header(
        &self,
        title: &str,
        subtitle: &str,
        cx: &App,
    ) -> gpui::AnyElement {
        let theme = cx.theme();
        div()
            .flex()
            .flex_col()
            .gap(tokens::SPACE_1)
            .child(
                div()
                    .text_size(tokens::FONT_LG)
                    .text_color(theme.foreground)
                    .font_weight(gpui::FontWeight::MEDIUM)
                    .child(title.to_string()),
            )
            .child(
                div()
                    .text_size(tokens::FONT_SM)
                    .text_color(theme.muted_foreground)
                    .child(subtitle.to_string()),
            )
            .into_any_element()
    }

    pub(super) fn render_plugin_card(
        &self,
        plugin: &PluginPermissionInfo,
        title_color: gpui::Hsla,
        background: gpui::Hsla,
        right_slot: gpui::AnyElement,
        include_description: bool,
        cx: &App,
    ) -> gpui::Div {
        let theme = cx.theme();
        let mut card = div()
            .flex()
            .flex_col()
            .gap_2()
            .px_3()
            .py_3()
            .rounded_md()
            .bg(background)
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .child(
                        div()
                            .text_size(tokens::FONT_BASE)
                            .text_color(title_color)
                            .child(crate::app::store::helpers::single_line_text(&plugin.name)),
                    )
                    .child(right_slot),
            );

        if include_description {
            if let Some(description) = plugin.description.clone() {
                card = card.child(
                    div()
                        .text_size(tokens::FONT_SM)
                        .text_color(theme.muted_foreground)
                        .child(crate::app::store::helpers::single_line_text(&description)),
                );
            }
        }

        card
    }
}
