use crate::ui::sandpaper_theme::SandpaperTheme;
use crate::ui::tokens;
use gpui::{
    div, ease_in_out, percentage, Animation, AnimationExt as _, App, IntoElement, ParentElement,
    RenderOnce, Styled as _, Transformation, Window,
};
use gpui_component::{Icon, IconName, Sizable, Size};
use std::time::Duration;

/// A size for the Spinner component.
#[derive(Clone, Copy, Default)]
pub(crate) enum SpinnerSize {
    /// 16px spinner.
    Small,
    /// 24px spinner.
    #[default]
    Medium,
}

/// A cycling loading spinner that rotates a loader icon.
pub(crate) struct Spinner {
    size: SpinnerSize,
}

impl Spinner {
    pub(crate) fn new() -> Self {
        Self {
            size: SpinnerSize::default(),
        }
    }

    pub(crate) fn small(mut self) -> Self {
        self.size = SpinnerSize::Small;
        self
    }

    pub(crate) fn medium(mut self) -> Self {
        self.size = SpinnerSize::Medium;
        self
    }
}

impl RenderOnce for Spinner {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        let semantic = cx.global::<SandpaperTheme>().colors(cx);
        let color = semantic.foreground_muted;

        let icon_size = match self.size {
            SpinnerSize::Small => Size::Size(tokens::ICON_MD), // 16px
            SpinnerSize::Medium => Size::Size(tokens::ICON_XL), // 24px
        };

        div().child(
            Icon::new(IconName::Loader)
                .with_size(icon_size)
                .text_color(color)
                .with_animation(
                    "spinner",
                    Animation::new(Duration::from_millis(800))
                        .repeat()
                        .with_easing(ease_in_out),
                    |icon, delta| icon.transform(Transformation::rotate(percentage(delta))),
                ),
        )
    }
}
