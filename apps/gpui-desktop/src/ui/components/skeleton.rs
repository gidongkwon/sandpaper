use crate::ui::sandpaper_theme::SandpaperTheme;
use crate::ui::tokens;
use gpui::{
    div, ease_in_out, Animation, AnimationExt as _, App, IntoElement, Pixels, RenderOnce,
    Styled as _, Window,
};

/// A placeholder loading element that pulses to indicate content is loading.
pub(crate) struct Skeleton {
    width: Pixels,
    height: Pixels,
    radius: Pixels,
}

impl Skeleton {
    pub(crate) fn new(width: Pixels, height: Pixels) -> Self {
        Self {
            width,
            height,
            radius: tokens::SPACE_3, // 6px default
        }
    }

    pub(crate) fn radius(mut self, radius: Pixels) -> Self {
        self.radius = radius;
        self
    }
}

impl RenderOnce for Skeleton {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        let semantic = cx.global::<SandpaperTheme>().colors(cx);
        let bg = semantic.background_hover;

        div()
            .w(self.width)
            .h(self.height)
            .rounded(self.radius)
            .bg(bg)
            .with_animation(
                "skeleton-pulse",
                Animation::new(tokens::DURATION_SLOW * 4) // 1.2s full cycle
                    .repeat()
                    .with_easing(ease_in_out),
                |el, delta| {
                    // Oscillate opacity between 0.4 and 1.0
                    let opacity = 0.4 + 0.6 * (1.0 - (delta * 2.0 - 1.0).abs()) as f32;
                    el.opacity(opacity)
                },
            )
    }
}
