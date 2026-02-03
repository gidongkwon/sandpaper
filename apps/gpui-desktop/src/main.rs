mod sandpaper_app;
mod ui;

use gpui::{App, AppContext, Application, Bounds, WindowBounds, WindowOptions, px, size};

fn main() {
    Application::new().run(|cx: &mut App| {
        sandpaper_app::bind_keys(cx);
        ui::text_input::bind_keys(cx);

        let bounds = Bounds::centered(None, size(px(1200.0), px(760.0)), cx);

        cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                ..Default::default()
            },
            |_, cx| cx.new(sandpaper_app::SandpaperApp::new),
        )
        .expect("open window");

        cx.activate(true);
    });
}
