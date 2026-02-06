use std::hash::{Hash, Hasher};
use std::io::Write;
use std::process::{Command, Stdio};

pub(crate) fn diagram_cache_key(source: &str) -> String {
    let trimmed = source.trim();
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    trimmed.hash(&mut hasher);
    format!("mermaid:{:x}", hasher.finish())
}

pub(crate) fn render_mermaid_svg(source: &str) -> Result<String, String> {
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return Err("empty diagram source".to_string());
    }

    let script_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("scripts")
        .join("mermaid-render.mjs");

    let mut child = Command::new("node")
        .arg(script_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("failed to spawn node: {err}"))?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(trimmed.as_bytes())
            .map_err(|err| format!("failed to write diagram source: {err}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|err| format!("failed to render diagram: {err}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let message = stderr.trim();
        return Err(if message.is_empty() {
            "diagram render failed".to_string()
        } else {
            message.to_string()
        });
    }

    let stdout = String::from_utf8(output.stdout).map_err(|err| format!("{err}"))?;
    let svg = stdout.trim().to_string();
    if svg.is_empty() {
        return Err("diagram render returned empty output".to_string());
    }
    Ok(svg)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagram_cache_key_trims_whitespace() {
        assert_eq!(
            diagram_cache_key("graph TD Start-->End;"),
            diagram_cache_key("  graph TD Start-->End;  ")
        );
    }

    #[test]
    fn render_mermaid_svg_rejects_empty_source() {
        assert!(render_mermaid_svg("").is_err());
        assert!(render_mermaid_svg("   ").is_err());
    }
}
