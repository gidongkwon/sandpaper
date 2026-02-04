pub(crate) mod prelude;
pub mod store;

use gpui::{App, AppContext, Application, Bounds, WindowBounds, WindowOptions, px, size};
use gpui_component::Root;

pub fn run() {
    Application::new().run(|cx: &mut App| {
        gpui_component::init(cx);
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
