pub(crate) mod prelude;
pub mod store;

use crate::ui::icons::SandpaperAssets;
use gpui::{px, size, App, AppContext, Application, Bounds, WindowBounds, WindowOptions};
use gpui_component::{Root, TitleBar};

fn window_options(bounds: Bounds<gpui::Pixels>) -> WindowOptions {
    WindowOptions {
        window_bounds: Some(WindowBounds::Windowed(bounds)),
        titlebar: Some(TitleBar::title_bar_options()),
        window_decorations: Some(gpui::WindowDecorations::Client),
        ..Default::default()
    }
}

pub fn run() {
    let app = Application::new().with_assets(SandpaperAssets);

    app.run(|cx: &mut App| {
        gpui_component::init(cx);
        crate::ui::sandpaper_theme::init(cx);
        store::bind_keys(cx);

        let bounds = Bounds::centered(None, size(px(1200.0), px(760.0)), cx);

        cx.open_window(window_options(bounds), |window, cx| {
            window.set_window_title("Sandpaper");
            let store = cx.new(|cx| store::AppStore::new(window, cx));
            let root_view = cx.new(|cx| crate::ui::UiRoot::new(store.clone(), cx));
            cx.new(|cx| Root::new(root_view, window, cx))
        })
        .expect("open window");

        cx.activate(true);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_uses_custom_title_bar_and_client_decorations() {
        let bounds = Bounds::new(gpui::point(px(0.0), px(0.0)), size(px(800.0), px(600.0)));
        let options = window_options(bounds);

        let titlebar = options
            .titlebar
            .as_ref()
            .expect("expected WindowOptions.titlebar to be set");
        assert!(
            titlebar.appears_transparent,
            "expected titlebar.appears_transparent=true for custom chrome"
        );
        assert!(
            titlebar.traffic_light_position.is_some(),
            "expected titlebar.traffic_light_position to be set for macOS traffic lights"
        );
        assert_eq!(
            options.window_decorations,
            Some(gpui::WindowDecorations::Client),
            "expected WindowOptions.window_decorations=Client for Linux/Windows support"
        );
    }
}
