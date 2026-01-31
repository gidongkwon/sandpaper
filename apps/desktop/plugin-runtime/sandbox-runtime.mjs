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
    rl.close();
    return;
  }

  const { id, method, params } = message ?? {};

  if (method === "ping") {
    respond({ id, result: { ok: true, runtime: "sandbox-runtime" } });
    rl.close();
    return;
  }

  if (method === "loadPlugins") {
    const plugins = Array.isArray(params?.plugins) ? params.plugins : [];
    const loaded = plugins
      .map((plugin) => plugin?.id)
      .filter((item) => typeof item === "string");
    respond({ id, result: { loaded } });
    rl.close();
    return;
  }

  respond({ id, error: "unknown-method" });
  rl.close();
});
