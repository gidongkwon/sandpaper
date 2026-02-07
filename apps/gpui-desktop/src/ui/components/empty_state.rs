use crate::ui::sandpaper_theme::SandpaperTheme;
use crate::ui::tokens;
use gpui::{
    div, App, ClickEvent, FontWeight, IntoElement, ParentElement, RenderOnce, SharedString,
    Styled as _, Window,
};
use gpui_component::{button::Button, Icon, IconName, Sizable, Size};
use std::rc::Rc;

/// A centered empty state placeholder with optional icon, heading, description,
/// and action button.
pub(crate) struct EmptyState {
    icon: Option<IconName>,
    heading: SharedString,
    description: SharedString,
    action_label: Option<SharedString>,
    action_handler: Option<Rc<dyn Fn(&ClickEvent, &mut Window, &mut App)>>,
}

impl EmptyState {
    pub(crate) fn new(
        heading: impl Into<SharedString>,
        description: impl Into<SharedString>,
    ) -> Self {
        Self {
            icon: None,
            heading: heading.into(),
            description: description.into(),
            action_label: None,
            action_handler: None,
        }
    }

    pub(crate) fn icon(mut self, icon: IconName) -> Self {
        self.icon = Some(icon);
        self
    }

    pub(crate) fn action(
        mut self,
        label: impl Into<SharedString>,
        handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.action_label = Some(label.into());
        self.action_handler = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for EmptyState {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        let semantic = cx.global::<SandpaperTheme>().colors(cx);
        let muted = semantic.foreground_muted;

        let mut container = div()
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap(tokens::SPACE_4) // 8px between elements
            .py(tokens::SPACE_9) // 32px vertical padding
            .px(tokens::SPACE_6); // 16px horizontal padding

        if let Some(icon_name) = self.icon {
            container = container.child(
                Icon::new(icon_name)
                    .with_size(Size::Size(tokens::ICON_XL))
                    .text_color(muted),
            );
        }

        container = container.child(
            div()
                .text_size(tokens::FONT_LG)
                .font_weight(FontWeight::MEDIUM)
                .child(self.heading),
        );

        container = container.child(
            div()
                .text_size(tokens::FONT_SM)
                .text_color(muted)
                .text_center()
                .child(self.description),
        );

        if let (Some(label), Some(handler)) = (self.action_label, self.action_handler) {
            container = container.child(
                div().mt(tokens::SPACE_2).child(
                    Button::new("empty-state-action")
                        .label(label)
                        .small()
                        .on_click(move |ev, window, cx| handler(ev, window, cx)),
                ),
            );
        }

        container
    }
}
