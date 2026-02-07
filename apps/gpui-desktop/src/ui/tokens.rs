use gpui::{px, Pixels};
use std::time::Duration;

// ── Spacing scale ──────────────────────────────────────────────────

pub const SPACE_0: Pixels = px(0.0);
pub const SPACE_1: Pixels = px(2.0);
pub const SPACE_2: Pixels = px(4.0);
pub const SPACE_3: Pixels = px(6.0);
pub const SPACE_4: Pixels = px(8.0);
pub const SPACE_5: Pixels = px(12.0);
pub const SPACE_6: Pixels = px(16.0);
pub const SPACE_7: Pixels = px(20.0);
pub const SPACE_8: Pixels = px(24.0);
pub const SPACE_9: Pixels = px(32.0);
pub const SPACE_10: Pixels = px(40.0);
pub const SPACE_11: Pixels = px(48.0);
pub const SPACE_12: Pixels = px(64.0);

// ── Typography scale ───────────────────────────────────────────────

pub const FONT_XS: Pixels = px(11.0);
pub const FONT_SM: Pixels = px(12.0);
pub const FONT_BASE: Pixels = px(14.0);
pub const FONT_LG: Pixels = px(16.0);
pub const FONT_XL: Pixels = px(18.0);
pub const FONT_2XL: Pixels = px(22.0);
pub const FONT_3XL: Pixels = px(28.0);

pub const LINE_HEIGHT_XS: Pixels = px(16.0);
pub const LINE_HEIGHT_SM: Pixels = px(18.0);
pub const LINE_HEIGHT_BASE: Pixels = px(22.0);
pub const LINE_HEIGHT_LG: Pixels = px(24.0);
pub const LINE_HEIGHT_XL: Pixels = px(28.0);
pub const LINE_HEIGHT_2XL: Pixels = px(32.0);
pub const LINE_HEIGHT_3XL: Pixels = px(40.0);

// ── Icon sizes ─────────────────────────────────────────────────────

pub const ICON_SM: Pixels = px(14.0);
pub const ICON_MD: Pixels = px(16.0);
pub const ICON_LG: Pixels = px(20.0);
pub const ICON_XL: Pixels = px(24.0);

// ── Animation durations ────────────────────────────────────────────

pub const DURATION_FAST: Duration = Duration::from_millis(100);
pub const DURATION_NORMAL: Duration = Duration::from_millis(200);
pub const DURATION_SLOW: Duration = Duration::from_millis(300);

// ── Layout dimensions ──────────────────────────────────────────────

pub const SIDEBAR_WIDTH: Pixels = px(240.0);
pub const SIDEBAR_RAIL_WIDTH: Pixels = px(48.0);
pub const CONTEXT_PANEL_WIDTH: Pixels = px(360.0);
pub const TOPBAR_HEIGHT: Pixels = px(38.0);
pub const STATUS_BAR_HEIGHT: Pixels = px(22.0);
