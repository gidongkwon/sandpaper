use anyhow::anyhow;
use gpui::{AssetSource, Result, SharedString};
use rust_embed::RustEmbed;
use std::borrow::Cow;
use std::collections::BTreeSet;

#[derive(RustEmbed)]
#[folder = "assets"]
struct LocalAssets;

pub(crate) struct SandpaperAssets;

impl AssetSource for SandpaperAssets {
    fn load(&self, path: &str) -> Result<Option<Cow<'static, [u8]>>> {
        if path.is_empty() {
            return Ok(None);
        }

        if let Some(file) = LocalAssets::get(path) {
            return Ok(Some(file.data));
        }

        gpui_component_assets::Assets.load(path)
    }

    fn list(&self, path: &str) -> Result<Vec<SharedString>> {
        let mut entries = BTreeSet::<String>::new();
        for local in LocalAssets::iter().filter(|entry| entry.starts_with(path)) {
            entries.insert(local.to_string());
        }
        for fallback in gpui_component_assets::Assets.list(path)? {
            entries.insert(fallback.to_string());
        }
        if entries.is_empty() && !path.is_empty() {
            return Err(anyhow!("could not find assets under path \"{path}\""));
        }
        Ok(entries.into_iter().map(Into::into).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_fluent_icons_are_resolvable() {
        let assets = SandpaperAssets;
        let data = assets
            .load("icons/fluent/search_20_regular.svg")
            .expect("asset load");
        assert!(data.is_some());
    }

    #[test]
    fn fallback_gives_gpui_component_icons() {
        let assets = SandpaperAssets;
        let data = assets.load("icons/close.svg").expect("asset load");
        assert!(data.is_some());
    }
}
