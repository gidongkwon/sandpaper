import { JSDOM } from "jsdom";
import mermaid from "mermaid";

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
};

const source = (await readStdin()).trim();
if (!source) {
  process.stderr.write("empty diagram source");
  process.exit(2);
}

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;

try {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict"
  });
  const result = await mermaid.render(`mermaid-${Date.now()}`, source);
  process.stdout.write(result?.svg ?? "");
} catch (err) {
  const message =
    err && typeof err === "object" && "message" in err ? err.message : String(err);
  process.stderr.write(message);
  process.exit(1);
}

