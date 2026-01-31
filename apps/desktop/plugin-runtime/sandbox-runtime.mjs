/* global process */
import readline from "node:readline";

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

const respond = (payload) => {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
};

rl.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    respond({ id: null, error: "invalid-json" });
    return;
  }

  const { id, method, params } = message ?? {};

  if (method === "ping") {
    respond({ id, result: { ok: true, runtime: "sandbox-runtime" } });
    return;
  }

  if (method === "loadPlugins") {
    const plugins = Array.isArray(params?.plugins) ? params.plugins : [];
    const loaded = plugins
      .map((plugin) => plugin?.id)
      .filter((item) => typeof item === "string");
    const commands = loaded.map((pluginId) => ({
      plugin_id: pluginId,
      id: `${pluginId}.open`,
      title: `Open ${pluginId}`,
      description: `Open ${pluginId} panel`
    }));
    const panels = loaded.map((pluginId) => ({
      plugin_id: pluginId,
      id: `${pluginId}.panel`,
      title: `${pluginId} panel`,
      location: "sidebar"
    }));
    const toolbar_actions = loaded.map((pluginId) => ({
      plugin_id: pluginId,
      id: `${pluginId}.toolbar`,
      title: `Launch ${pluginId}`,
      tooltip: `Launch ${pluginId}`
    }));
    const renderers = loaded.flatMap((pluginId) => ([
      {
        plugin_id: pluginId,
        id: `${pluginId}.renderer.code`,
        title: "Code block renderer",
        kind: "code"
      },
      {
        plugin_id: pluginId,
        id: `${pluginId}.renderer.diagram`,
        title: "Diagram renderer",
        kind: "diagram"
      }
    ]));
    respond({ id, result: { loaded, commands, panels, toolbar_actions, renderers } });
    return;
  }

  if (method === "emitEvent") {
    respond({ id, result: { ok: true } });
    return;
  }

  if (method === "shutdown") {
    respond({ id, result: { ok: true } });
    rl.close();
    return;
  }

  respond({ id, error: "unknown-method" });
});
