use gpui::{App, Global, Hsla};
use gpui_component::{Colorize, Theme, ThemeConfig, ThemeMode, ThemeSet};
use std::path::PathBuf;
use std::rc::Rc;

const DEFAULT_THEME_JSON: &str = include_str!("../../themes/sandpaper.json");

/// Semantic color tokens specific to Sandpaper that extend the base gpui_component theme.
#[allow(dead_code)] // Complete token set — not all fields consumed yet
#[derive(Debug, Clone, Copy)]
pub(crate) struct SemanticColors {
    pub border_subtle: Hsla,
    pub foreground_muted: Hsla,
    pub foreground_faint: Hsla,
    pub background_hover: Hsla,
    pub background_active: Hsla,
    pub accent_subtle: Hsla,
    pub scrollbar_thumb: Hsla,
    pub scrollbar_track: Hsla,
    pub ring: Hsla,
}

/// Sandpaper-specific theme extension stored as a GPUI global.
/// Holds semantic color tokens for both light and dark modes.
#[derive(Debug, Clone)]
pub(crate) struct SandpaperTheme {
    pub light: SemanticColors,
    pub dark: SemanticColors,
}

impl Global for SandpaperTheme {}

impl SandpaperTheme {
    /// Returns the semantic colors for the current theme mode.
    pub fn colors(&self, cx: &App) -> &SemanticColors {
        if Theme::global(cx).mode.is_dark() {
            &self.dark
        } else {
            &self.light
        }
    }
}

/// Parse a hex color string from a JSON colors map.
fn resolve_hex(colors: &serde_json::Map<String, serde_json::Value>, key: &str) -> Option<Hsla> {
    colors
        .get(key)
        .and_then(|v| v.as_str())
        .and_then(|hex| Hsla::parse_hex(hex).ok())
}

/// Parse semantic colors from a theme JSON value, with fallbacks derived from
/// existing colors in the same JSON map.
fn parse_semantic_colors(colors: &serde_json::Map<String, serde_json::Value>) -> SemanticColors {
    // Resolve base colors for fallback computation
    let border = resolve_hex(colors, "border").unwrap_or(Hsla::transparent_black());
    let muted_fg = resolve_hex(colors, "muted.foreground").unwrap_or(Hsla::transparent_black());
    let accent = resolve_hex(colors, "primary.background").unwrap_or(Hsla::transparent_black());
    let list_hover =
        resolve_hex(colors, "list.hover.background").unwrap_or(Hsla::transparent_black());
    let list_active =
        resolve_hex(colors, "list.active.background").unwrap_or(Hsla::transparent_black());
    let scrollbar = resolve_hex(colors, "background").unwrap_or(Hsla::transparent_black());

    let ring = resolve_hex(colors, "ring").unwrap_or(accent);

    SemanticColors {
        border_subtle: resolve_hex(colors, "border_subtle").unwrap_or_else(|| border.opacity(0.5)),
        foreground_muted: resolve_hex(colors, "foreground_muted").unwrap_or(muted_fg),
        foreground_faint: resolve_hex(colors, "foreground_faint")
            .unwrap_or_else(|| muted_fg.opacity(0.5)),
        background_hover: resolve_hex(colors, "background_hover").unwrap_or(list_hover),
        background_active: resolve_hex(colors, "background_active").unwrap_or(list_active),
        accent_subtle: resolve_hex(colors, "accent_subtle").unwrap_or_else(|| accent.opacity(0.15)),
        scrollbar_thumb: resolve_hex(colors, "scrollbar_thumb")
            .unwrap_or_else(|| muted_fg.opacity(0.3)),
        scrollbar_track: resolve_hex(colors, "scrollbar_track").unwrap_or(scrollbar),
        ring,
    }
}

/// Load the raw theme JSON and extract semantic color tokens for both modes.
fn load_sandpaper_theme(json_str: &str) -> Option<SandpaperTheme> {
    let value: serde_json::Value = serde_json::from_str(json_str).ok()?;
    let themes = value.get("themes")?.as_array()?;

    let mut light_colors = None;
    let mut dark_colors = None;

    for theme in themes {
        let mode = theme.get("mode")?.as_str()?;
        let colors = theme.get("colors")?.as_object()?;
        match mode {
            "light" if light_colors.is_none() => {
                light_colors = Some(parse_semantic_colors(colors));
            }
            "dark" if dark_colors.is_none() => {
                dark_colors = Some(parse_semantic_colors(colors));
            }
            _ => {}
        }
    }

    Some(SandpaperTheme {
        light: light_colors?,
        dark: dark_colors?,
    })
}

pub(crate) fn init(cx: &mut App) {
    let json_str = load_theme_json().unwrap_or_else(|| DEFAULT_THEME_JSON.to_string());

    let config = serde_json::from_str::<ThemeSet>(&json_str).unwrap_or_default();

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

    // Parse and store Sandpaper semantic tokens
    if let Some(sandpaper_theme) = load_sandpaper_theme(&json_str) {
        cx.set_global(sandpaper_theme);
    }

    let mode = Theme::global(cx).mode;
    let theme = Theme::global_mut(cx);
    theme.light_theme = light_theme;
    theme.dark_theme = dark_theme;

    Theme::change(mode, None, cx);
    cx.refresh_windows();
}

fn load_theme_json() -> Option<String> {
    let path = PathBuf::from("./themes/sandpaper.json");
    std::fs::read_to_string(path).ok()
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
            assert_eq!(app.theme().radius, gpui::px(6.));

            Theme::change(ThemeMode::Dark, None, &mut app);
            assert_eq!(app.theme().theme_name().as_ref(), "Sandpaper Dark");
        }
    }

    #[test]
    fn sandpaper_theme_json_includes_semantic_colors() {
        let value: serde_json::Value =
            serde_json::from_str(DEFAULT_THEME_JSON).expect("theme json");
        let themes = value
            .get("themes")
            .and_then(|themes| themes.as_array())
            .expect("themes array");

        for theme in themes {
            let colors = theme
                .get("colors")
                .and_then(|colors| colors.as_object())
                .expect("colors object");
            for key in [
                "overlay",
                "list.active.border",
                "title_bar.border",
                "success.background",
                "success.foreground",
                "warning.background",
                "warning.foreground",
                "danger.background",
                "danger.foreground",
            ] {
                assert!(colors.contains_key(key), "missing theme color: {key}");
            }
        }
    }

    #[test]
    fn sandpaper_theme_json_includes_new_semantic_tokens() {
        let value: serde_json::Value =
            serde_json::from_str(DEFAULT_THEME_JSON).expect("theme json");
        let themes = value
            .get("themes")
            .and_then(|themes| themes.as_array())
            .expect("themes array");

        let semantic_keys = [
            "border_subtle",
            "foreground_muted",
            "foreground_faint",
            "background_hover",
            "background_active",
            "accent_subtle",
            "scrollbar_thumb",
            "scrollbar_track",
        ];

        for theme in themes {
            let name = theme
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or("unknown");
            let colors = theme
                .get("colors")
                .and_then(|colors| colors.as_object())
                .unwrap_or_else(|| panic!("missing colors in theme {name}"));
            for key in &semantic_keys {
                assert!(
                    colors.contains_key(*key),
                    "missing semantic token '{key}' in theme '{name}'"
                );
            }
        }
    }

    #[gpui::test]
    fn sandpaper_theme_exposes_semantic_colors(cx: &mut TestAppContext) {
        cx.skip_drawing();

        {
            let mut app = cx.app.borrow_mut();
            gpui_component::init(&mut app);
            init(&mut app);

            // Verify SandpaperTheme global was set
            assert!(app.has_global::<SandpaperTheme>());

            let st = app.global::<SandpaperTheme>();

            // Light mode colors should have non-zero alpha (i.e., they were parsed)
            assert!(st.light.border_subtle.a > 0.0);
            assert!(st.light.foreground_muted.a > 0.0);
            assert!(st.light.foreground_faint.a > 0.0);
            assert!(st.light.background_hover.a > 0.0);
            assert!(st.light.background_active.a > 0.0);
            assert!(st.light.accent_subtle.a > 0.0);
            assert!(st.light.scrollbar_thumb.a > 0.0);
            assert!(st.light.scrollbar_track.a > 0.0);
            assert!(st.light.ring.a > 0.0);

            // Dark mode colors should also be parsed
            assert!(st.dark.border_subtle.a > 0.0);
            assert!(st.dark.foreground_muted.a > 0.0);
            assert!(st.dark.foreground_faint.a > 0.0);
            assert!(st.dark.background_hover.a > 0.0);
            assert!(st.dark.background_active.a > 0.0);
            assert!(st.dark.accent_subtle.a > 0.0);
            assert!(st.dark.scrollbar_thumb.a > 0.0);
            assert!(st.dark.scrollbar_track.a > 0.0);
            assert!(st.dark.ring.a > 0.0);

            // colors() should return light colors in light mode
            let colors = st.colors(&app);
            assert_eq!(colors.border_subtle.a, st.light.border_subtle.a);

            // Switch to dark mode and verify colors() returns dark
            Theme::change(ThemeMode::Dark, None, &mut app);
            let st = app.global::<SandpaperTheme>();
            let colors = st.colors(&app);
            assert_eq!(colors.border_subtle.a, st.dark.border_subtle.a);
        }
    }
}
