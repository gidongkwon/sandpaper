use crate::ui::icons::SandpaperIcon;
use crate::ui::tokens;
use gpui::{
    div, App, ClickEvent, FontWeight, Hsla, IntoElement, ParentElement, RenderOnce,
    SharedString, Styled as _, Window,
};
use gpui_component::{button::Button, button::ButtonVariants as _, ActiveTheme as _, Icon, Sizable, Size};
use std::rc::Rc;

/// A full-width error/warning banner bar with icon, message, and optional action button.
pub(crate) struct ErrorBanner {
    message: SharedString,
    action_label: Option<SharedString>,
    action_handler: Option<Rc<dyn Fn(&ClickEvent, &mut Window, &mut App)>>,
    is_warning: bool,
}

impl ErrorBanner {
    /// Create an error banner (danger colors) with the given message.
    pub(crate) fn new(message: impl Into<SharedString>) -> Self {
        Self {
            message: message.into(),
            action_label: None,
            action_handler: None,
            is_warning: false,
        }
    }

    /// Switch to warning style (warning colors instead of danger).
    pub(crate) fn warning(mut self) -> Self {
        self.is_warning = true;
        self
    }

    /// Add an action button to the banner.
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

impl RenderOnce for ErrorBanner {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = cx.theme();
        let (bg, fg): (Hsla, Hsla) = if self.is_warning {
            (theme.warning, theme.warning_foreground)
        } else {
            (theme.danger, theme.danger_foreground)
        };

        let mut row = div()
            .flex()
            .items_center()
            .gap(tokens::SPACE_4) // 8px
            .w_full()
            .px(tokens::SPACE_5) // 12px
            .py(tokens::SPACE_3) // 6px
            .bg(bg)
            .text_color(fg)
            .text_size(tokens::FONT_SM) // 12px
            .font_weight(FontWeight::MEDIUM);

        row = row.child(
            Icon::new(SandpaperIcon::Warning)
                .with_size(Size::Size(tokens::ICON_MD)) // 16px
                .text_color(fg),
        );

        row = row.child(div().flex_1().child(self.message));

        if let (Some(label), Some(handler)) = (self.action_label, self.action_handler) {
            row = row.child(
                Button::new("error-banner-action")
                    .label(label)
                    .xsmall()
                    .ghost()
                    .on_click(move |ev, window, cx| handler(ev, window, cx)),
            );
        }

        row
    }
}

/// An inline error message with a small icon and red text for form validation.
pub(crate) struct InlineError {
    message: SharedString,
}

impl InlineError {
    pub(crate) fn new(message: impl Into<SharedString>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl RenderOnce for InlineError {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        let fg = cx.theme().danger_foreground;

        div()
            .flex()
            .items_center()
            .gap(tokens::SPACE_2) // 4px
            .child(
                Icon::new(SandpaperIcon::Warning)
                    .with_size(Size::Size(tokens::ICON_SM)) // 14px
                    .text_color(fg),
            )
            .child(
                div()
                    .text_size(tokens::FONT_SM) // 12px
                    .text_color(fg)
                    .child(self.message),
            )
    }
}
