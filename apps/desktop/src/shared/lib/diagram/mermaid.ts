import mermaid from "mermaid";

export const DIAGRAM_LANGS = new Set(["mermaid", "diagram"]);

let mermaidInitialized = false;

export const ensureMermaid = () => {
  if (!mermaidInitialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict"
    });
    mermaidInitialized = true;
  }
  return mermaid;
};
