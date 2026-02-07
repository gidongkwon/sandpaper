mod components;
pub(crate) mod dialogs;
pub(crate) mod icons;
mod root;
pub(crate) mod sandpaper_theme;
#[allow(dead_code)] // Design token scale — not all values consumed yet
pub(crate) mod tokens;

pub(crate) use root::UiRoot;
