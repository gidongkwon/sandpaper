use gpui::App;
use gpui_component::{Theme, ThemeConfig, ThemeMode, ThemeSet};
use std::path::PathBuf;
use std::rc::Rc;

const DEFAULT_THEME_JSON: &str = include_str!("../../themes/sandpaper.json");

pub(crate) fn init(cx: &mut App) {
    let config = load_theme_set()
        .or_else(load_default_theme_set)
        .unwrap_or_default();

    let mut light_theme: Option<Rc<ThemeConfig>> = None;
    let mut dark_theme: Option<Rc<ThemeConfig>> = None;

    for theme in config.themes {
        match theme.mode {
            ThemeMode::Light if light_theme.is_none() => light_theme = Some(Rc::new(theme)),
            ThemeMode::Dark if dark_theme.is_none() => dark_theme = Some(Rc::new(theme)),
            _ => {}
        }
    }

    let (Some(light_theme), Some(dark_theme)) = (light_theme, dark_theme) else {
        return;
    };

    let mode = Theme::global(cx).mode;
    let theme = Theme::global_mut(cx);
    theme.light_theme = light_theme;
    theme.dark_theme = dark_theme;

    Theme::change(mode, None, cx);
    cx.refresh_windows();
}

fn load_theme_set() -> Option<ThemeSet> {
    let path = PathBuf::from("./themes/sandpaper.json");
    let json = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<ThemeSet>(&json).ok()
}

fn load_default_theme_set() -> Option<ThemeSet> {
    serde_json::from_str::<ThemeSet>(DEFAULT_THEME_JSON).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::TestAppContext;
    use gpui_component::{ActiveTheme as _, Theme};

    #[gpui::test]
    fn sandpaper_theme_init_sets_light_and_dark(cx: &mut TestAppContext) {
        cx.skip_drawing();

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
            init(&mut app);

            assert_eq!(
                Theme::global(&app).light_theme.name.as_ref(),
                "Sandpaper Light"
            );
            assert_eq!(
                Theme::global(&app).dark_theme.name.as_ref(),
                "Sandpaper Dark"
            );
            assert_eq!(app.theme().font_size, gpui::px(14.));
            assert_eq!(app.theme().radius, gpui::px(8.));

            Theme::change(ThemeMode::Dark, None, &mut app);
            assert_eq!(app.theme().theme_name().as_ref(), "Sandpaper Dark");
        }
    }
}
