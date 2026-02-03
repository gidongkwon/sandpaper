mod sandpaper_app;

use gpui::{App, AppContext, Application, Bounds, WindowBounds, WindowOptions, px, size};
use gpui_component::Root;

fn main() {
    Application::new().run(|cx: &mut App| {
        gpui_component::init(cx);
        sandpaper_app::bind_keys(cx);

        let bounds = Bounds::centered(None, size(px(1200.0), px(760.0)), cx);

        cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                ..Default::default()
            },
            |window, cx| {
                let app = cx.new(|cx| sandpaper_app::SandpaperApp::new(window, cx));
                cx.new(|cx| Root::new(app, window, cx))
            },
        )
        .expect("open window");

        cx.activate(true);
    });
}
