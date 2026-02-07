use crate::app::prelude::*;
use crate::app::store::*;
use crate::ui::sandpaper_theme::SandpaperTheme;
use crate::ui::tokens;
use gpui_component::button::Button;

/// Create a button for use in segmented button groups.
/// Returns a styled Button ready for `.on_click()`.
pub(super) fn segmented_button(
    id: impl Into<gpui::ElementId>,
    label: impl Into<gpui::SharedString>,
    is_active: bool,
) -> Button {
    let mut button = Button::new(id).label(label).xsmall();
    if is_active {
        button = button.primary();
    } else {
        button = button.ghost();
    }
    button
}

/// Wrap segmented buttons in a connected track container (like macOS segmented controls).
pub(super) fn segmented_button_group(
    id: impl Into<gpui::ElementId>,
    children: gpui::AnyElement,
    cx: &App,
) -> gpui::AnyElement {
    let theme = cx.theme();
    div()
        .id(id)
        .flex()
        .items_center()
        .gap(px(1.0))
        .px(tokens::SPACE_1)
        .py(tokens::SPACE_1)
        .rounded_md()
        .bg(theme.secondary)
        .child(children)
        .into_any_element()
}

pub(super) fn settings_row_has_divider(row_index: usize, row_count: usize) -> bool {
    if row_count == 0 {
        return false;
    }
    row_index.saturating_add(1) < row_count
}

impl AppStore {
    pub(super) fn render_settings_row(
        &self,
        label: &str,
        description: &str,
        control: gpui::AnyElement,
        show_divider: bool,
        cx: &App,
    ) -> gpui::AnyElement {
        let theme = cx.theme();
        let semantic = cx.global::<SandpaperTheme>().colors(cx);
        div()
            .w_full()
            .flex()
            .items_start()
            .gap_6()
            .py_4()
            .when(show_divider, |this| {
                this.border_b_1().border_color(semantic.border_subtle)
            })
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_1()
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
            .child(
                div()
                    .w(px(272.0))
                    .flex_shrink_0()
                    .flex()
                    .justify_end()
                    .items_center()
                    .child(control),
            )
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

    pub(super) fn render_settings_section_card_header(
        &self,
        title: &str,
        subtitle: &str,
        cx: &App,
    ) -> gpui::AnyElement {
        let semantic = cx.global::<SandpaperTheme>().colors(cx);
        div()
            .w_full()
            .pb(tokens::SPACE_5)
            .border_b_1()
            .border_color(semantic.border_subtle)
            .child(self.render_settings_section_header(title, subtitle, cx))
            .into_any_element()
    }

    pub(super) fn render_settings_section_card(
        &self,
        content: gpui::AnyElement,
        cx: &App,
    ) -> gpui::AnyElement {
        let theme = cx.theme();
        let semantic = cx.global::<SandpaperTheme>().colors(cx);
        div()
            .w_full()
            .px(tokens::SPACE_7)
            .py(tokens::SPACE_6)
            .rounded_md()
            .border_1()
            .border_color(semantic.border_subtle)
            .bg(theme.colors.list)
            .child(content)
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

#[cfg(test)]
mod tests {
    use super::settings_row_has_divider;

    #[test]
    fn settings_row_divider_hidden_for_last_item() {
        assert!(settings_row_has_divider(0, 2));
        assert!(!settings_row_has_divider(1, 2));
    }

    #[test]
    fn settings_row_divider_hidden_for_single_item_sections() {
        assert!(!settings_row_has_divider(0, 1));
        assert!(!settings_row_has_divider(0, 0));
    }
}
