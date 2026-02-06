mod assets;

use gpui::SharedString;
use gpui_component::IconNamed;

pub(crate) use assets::SandpaperAssets;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) enum SandpaperIcon {
    Search,
    Warning,
    Menu,
    DragHandle,
    PanelLeftExpand,
    PanelLeftContract,
    PanelRightExpand,
    PanelRightContract,
    ChevronDown,
    ChevronRight,
    ArrowLeft,
    ArrowRight,
    Checkmark,
    Add,
    Subtract,
    Dismiss,
    Copy,
    Open,
    ArrowSwap,
    Eye,
    Alert,
    Settings,
    ArrowMinimize,
    Grid,
    SplitVertical,
    LinkMultiple,
}

impl SandpaperIcon {
    pub(crate) const ALL: [Self; 26] = [
        Self::Search,
        Self::Warning,
        Self::Menu,
        Self::DragHandle,
        Self::PanelLeftExpand,
        Self::PanelLeftContract,
        Self::PanelRightExpand,
        Self::PanelRightContract,
        Self::ChevronDown,
        Self::ChevronRight,
        Self::ArrowLeft,
        Self::ArrowRight,
        Self::Checkmark,
        Self::Add,
        Self::Subtract,
        Self::Dismiss,
        Self::Copy,
        Self::Open,
        Self::ArrowSwap,
        Self::Eye,
        Self::Alert,
        Self::Settings,
        Self::ArrowMinimize,
        Self::Grid,
        Self::SplitVertical,
        Self::LinkMultiple,
    ];
}

impl IconNamed for SandpaperIcon {
    fn path(self) -> SharedString {
        match self {
            Self::Search => "icons/fluent/search_20_regular.svg",
            Self::Warning => "icons/fluent/warning_20_regular.svg",
            Self::Menu => "icons/fluent/menu_20_regular.svg",
            Self::DragHandle => "icons/fluent/drag_handle_20_regular.svg",
            Self::PanelLeftExpand => "icons/fluent/panel_left_expand_20_regular.svg",
            Self::PanelLeftContract => "icons/fluent/panel_left_contract_20_regular.svg",
            Self::PanelRightExpand => "icons/fluent/panel_right_expand_20_regular.svg",
            Self::PanelRightContract => "icons/fluent/panel_right_contract_20_regular.svg",
            Self::ChevronDown => "icons/fluent/chevron_down_20_regular.svg",
            Self::ChevronRight => "icons/fluent/chevron_right_20_regular.svg",
            Self::ArrowLeft => "icons/fluent/arrow_left_20_regular.svg",
            Self::ArrowRight => "icons/fluent/arrow_right_20_regular.svg",
            Self::Checkmark => "icons/fluent/checkmark_20_regular.svg",
            Self::Add => "icons/fluent/add_20_regular.svg",
            Self::Subtract => "icons/fluent/subtract_20_regular.svg",
            Self::Dismiss => "icons/fluent/dismiss_20_regular.svg",
            Self::Copy => "icons/fluent/copy_20_regular.svg",
            Self::Open => "icons/fluent/open_20_regular.svg",
            Self::ArrowSwap => "icons/fluent/arrow_swap_20_regular.svg",
            Self::Eye => "icons/fluent/eye_20_regular.svg",
            Self::Alert => "icons/fluent/alert_20_regular.svg",
            Self::Settings => "icons/fluent/settings_20_regular.svg",
            Self::ArrowMinimize => "icons/fluent/arrow_minimize_20_regular.svg",
            Self::Grid => "icons/fluent/grid_20_regular.svg",
            Self::SplitVertical => "icons/fluent/split_vertical_20_regular.svg",
            Self::LinkMultiple => "icons/fluent/link_multiple_20_regular.svg",
        }
        .into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::AssetSource;

    #[test]
    fn all_icon_paths_use_fluent_namespace() {
        for icon in SandpaperIcon::ALL {
            let path = icon.path();
            assert!(
                path.as_ref().starts_with("icons/fluent/"),
                "unexpected icon path: {}",
                path
            );
        }
    }

    #[test]
    fn all_icon_paths_resolve_in_assets() {
        let assets = SandpaperAssets;
        for icon in SandpaperIcon::ALL {
            let path = icon.path();
            let found = assets.load(path.as_ref()).expect("load icon");
            assert!(found.is_some(), "missing embedded icon: {}", path);
        }
    }
}
