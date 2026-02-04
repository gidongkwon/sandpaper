use crate::app::prelude::*;
use crate::app::store::AppStore;

pub(crate) struct UiRoot {
    store: Entity<AppStore>,
    focus_handle: FocusHandle,
    _subscription: Subscription,
}

impl UiRoot {
    pub(crate) fn new(store: Entity<AppStore>, cx: &mut Context<Self>) -> Self {
        let focus_handle = store.read(cx).focus_handle().clone();
        let subscription = cx.observe(&store, |_this, _store, cx| {
            cx.notify();
        });

        Self {
            store,
            focus_handle,
            _subscription: subscription,
        }
    }
}

impl Focusable for UiRoot {
    fn focus_handle(&self, _cx: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl Render for UiRoot {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.store
            .update(cx, |store, cx| store.render_root(window, cx))
    }
}
