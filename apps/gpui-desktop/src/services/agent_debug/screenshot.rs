use std::process::Command;

pub(crate) trait ScreenshotProvider {
    fn capture_png(&self) -> Result<String, String>;
}

pub(crate) struct PlatformScreenshotProvider;

impl ScreenshotProvider for PlatformScreenshotProvider {
    fn capture_png(&self) -> Result<String, String> {
        #[cfg(target_os = "macos")]
        {
            capture_png_macos()
        }
        #[cfg(not(target_os = "macos"))]
        {
            Err("screenshot capture is not implemented on this platform yet".to_string())
        }
    }
}

#[cfg(target_os = "macos")]
fn capture_png_macos() -> Result<String, String> {
    let out_dir = std::env::temp_dir().join("sandpaper-qa");
    std::fs::create_dir_all(&out_dir).map_err(|err| format!("create screenshot dir: {err}"))?;

    let ts = chrono::Local::now().format("%H%M%S");
    let out_path = out_dir.join(format!("agent-debug-{ts}.png"));

    let swift = r#"
import CoreGraphics
let opts = CGWindowListOption(arrayLiteral: .optionOnScreenOnly, .excludeDesktopElements)
if let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] {
    for w in list {
        let name = w["kCGWindowOwnerName"] as? String ?? ""
        let width = (w["kCGWindowBounds"] as? [String: Any])?["Width"] as? Int ?? 0
        if name.lowercased().contains("sandpaper") && width > 100 {
            print(w["kCGWindowNumber"] as? Int ?? 0)
            break
        }
    }
}
"#;

    let swift_out = Command::new("swift")
        .arg("-e")
        .arg(swift)
        .output()
        .map_err(|err| format!("run swift for window id: {err}"))?;
    if !swift_out.status.success() {
        return Err("failed to query macOS window list".to_string());
    }
    let window_id = String::from_utf8_lossy(&swift_out.stdout)
        .trim()
        .to_string();
    if window_id.is_empty() || window_id == "0" {
        return Err("sandpaper window not found".to_string());
    }

    let status = Command::new("screencapture")
        .arg(format!("-l{window_id}"))
        .arg("-x")
        .arg(&out_path)
        .status()
        .map_err(|err| format!("run screencapture: {err}"))?;
    if !status.success() {
        return Err(format!("screencapture failed for window id {window_id}"));
    }
    Ok(out_path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct StubProvider(Result<String, String>);

    impl ScreenshotProvider for StubProvider {
        fn capture_png(&self) -> Result<String, String> {
            self.0.clone()
        }
    }

    #[test]
    fn screenshot_provider_returns_stubbed_path() {
        let provider = StubProvider(Ok("/tmp/sandpaper-qa/test.png".to_string()));
        let result = provider.capture_png().expect("path");
        assert_eq!(result, "/tmp/sandpaper-qa/test.png");
    }

    #[test]
    fn screenshot_provider_returns_stubbed_error() {
        let provider = StubProvider(Err("boom".to_string()));
        let result = provider.capture_png();
        assert!(result.is_err());
    }
}
