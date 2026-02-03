use sandpaper_core::plugins::{parse_plugin_manifest, PluginDescriptor, PluginRuntime};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug)]
struct HarnessArgs {
    plugin_path: PathBuf,
    renderer_id: String,
    block_uid: String,
    text: String,
    action_id: Option<String>,
    action_value: Option<Value>,
    settings: Option<Value>,
}

fn parse_args(args: &[String]) -> Result<HarnessArgs, String> {
    let mut plugin_path: Option<PathBuf> = None;
    let mut renderer_id: Option<String> = None;
    let mut block_uid: Option<String> = None;
    let mut text: Option<String> = None;
    let mut action_id: Option<String> = None;
    let mut action_value: Option<Value> = None;
    let mut settings: Option<Value> = None;

    let mut iter = args.iter().skip(1);
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--plugin" => {
                let value = iter.next().ok_or_else(|| "Missing --plugin value".to_string())?;
                plugin_path = Some(PathBuf::from(value));
            }
            "--renderer" => {
                let value = iter
                    .next()
                    .ok_or_else(|| "Missing --renderer value".to_string())?;
                renderer_id = Some(value.to_string());
            }
            "--block" => {
                let value = iter.next().ok_or_else(|| "Missing --block value".to_string())?;
                block_uid = Some(value.to_string());
            }
            "--text" => {
                let value = iter.next().ok_or_else(|| "Missing --text value".to_string())?;
                text = Some(value.to_string());
            }
            "--action" => {
                let value = iter
                    .next()
                    .ok_or_else(|| "Missing --action value".to_string())?;
                action_id = Some(value.to_string());
            }
            "--value" => {
                let value = iter.next().ok_or_else(|| "Missing --value payload".to_string())?;
                let parsed: Value =
                    serde_json::from_str(value).map_err(|err| format!("{err}"))?;
                action_value = Some(parsed);
            }
            "--settings" => {
                let value = iter
                    .next()
                    .ok_or_else(|| "Missing --settings payload".to_string())?;
                let parsed: Value =
                    serde_json::from_str(value).map_err(|err| format!("{err}"))?;
                settings = Some(parsed);
            }
            "--help" | "-h" => {
                return Err(String::new());
            }
            _ => return Err(format!("Unknown argument: {arg}")),
        }
    }

    let plugin_path = plugin_path.ok_or_else(|| "Missing --plugin".to_string())?;
    let renderer_id = renderer_id.ok_or_else(|| "Missing --renderer".to_string())?;
    let block_uid = block_uid.unwrap_or_else(|| "block-1".to_string());
    let text = text.unwrap_or_else(|| {
        let prefix = renderer_id.split('.').next().unwrap_or("block");
        format!("```{prefix}")
    });

    Ok(HarnessArgs {
        plugin_path,
        renderer_id,
        block_uid,
        text,
        action_id,
        action_value,
        settings,
    })
}

fn main() {
    let args = std::env::args().collect::<Vec<_>>();
    let parsed = match parse_args(&args) {
        Ok(value) => value,
        Err(message) => {
            if !message.is_empty() {
                eprintln!("{message}");
            }
            eprintln!("Usage: plugin-harness --plugin <path> --renderer <id> [--text <block>] [--block <uid>] [--action <id>] [--value <json>] [--settings <json>]");
            std::process::exit(1);
        }
    };

    let manifest_path = parsed.plugin_path.join("plugin.json");
    let raw = match std::fs::read_to_string(&manifest_path) {
        Ok(value) => value,
        Err(err) => {
            eprintln!("Failed to read manifest: {err}");
            std::process::exit(1);
        }
    };
    let manifest = match parse_plugin_manifest(&raw) {
        Ok(value) => value,
        Err(err) => {
            eprintln!("Invalid manifest: {err:?}");
            std::process::exit(1);
        }
    };

    let descriptor = PluginDescriptor {
        manifest: manifest.clone(),
        path: parsed.plugin_path.clone(),
        enabled: true,
    };

    let mut settings = HashMap::new();
    if let Some(payload) = parsed.settings {
        settings.insert(manifest.id.clone(), payload);
    }

    let mut runtime = match PluginRuntime::new() {
        Ok(value) => value,
        Err(err) => {
            eprintln!("Failed to create runtime: {err:?}");
            std::process::exit(1);
        }
    };
    if let Err(err) = runtime.load_plugins(&[descriptor], settings) {
        eprintln!("Failed to load plugin: {err:?}");
        std::process::exit(1);
    }

    let result = if let Some(action_id) = parsed.action_id.as_ref() {
        runtime.handle_block_action(
            &manifest.id,
            &parsed.renderer_id,
            &parsed.block_uid,
            &parsed.text,
            action_id,
            parsed.action_value.clone(),
        )
    } else {
        runtime.render_block(
            &manifest.id,
            &parsed.renderer_id,
            &parsed.block_uid,
            &parsed.text,
        )
    };

    match result {
        Ok(view) => {
            let output = serde_json::to_string_pretty(&view).unwrap_or_default();
            println!("{output}");
        }
        Err(err) => {
            eprintln!("Render failed: {err:?}");
            std::process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::parse_args;

    #[test]
    fn parse_args_requires_plugin_and_renderer() {
        let args = vec!["plugin-harness".to_string()];
        let err = parse_args(&args).expect_err("missing args");
        assert!(err.contains("--plugin"));
    }

    #[test]
    fn parse_args_accepts_minimum_flags() {
        let args = vec![
            "plugin-harness".to_string(),
            "--plugin".to_string(),
            "/tmp/plugin".to_string(),
            "--renderer".to_string(),
            "sample.block".to_string(),
        ];
        let parsed = parse_args(&args).expect("parse");
        assert_eq!(parsed.renderer_id, "sample.block");
        assert_eq!(parsed.block_uid, "block-1");
        assert!(parsed.text.starts_with("```"));
    }
}
