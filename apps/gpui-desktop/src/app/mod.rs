pub(crate) mod prelude;
pub mod store;

use gpui::{px, size, App, AppContext, Application, Bounds, WindowBounds, WindowOptions};
use gpui_component::Root;
use gpui_component_assets::Assets;

pub fn run() {
    let app = Application::new().with_assets(Assets);

    app.run(|cx: &mut App| {
        gpui_component::init(cx);
        crate::ui::sandpaper_theme::init(cx);
        store::bind_keys(cx);

        let bounds = Bounds::centered(None, size(px(1200.0), px(760.0)), cx);

        cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                ..Default::default()
            },
            |window, cx| {
                let store = cx.new(|cx| store::AppStore::new(window, cx));
                let root_view = cx.new(|cx| crate::ui::UiRoot::new(store.clone(), cx));
                cx.new(|cx| Root::new(root_view, window, cx))
            },
        )
        .expect("open window");

        cx.activate(true);
    });
}
