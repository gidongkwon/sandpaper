import { describe, expect, it } from "vitest";
import {
  readAppSourceFile,
  readAppStyleFile,
  readAppStyles
} from "./test/read-app-styles";

describe("App style structure", () => {
  it("loads the layered styles entrypoint from app.tsx", () => {
    const appSource = readAppSourceFile("app/app.tsx");

    expect(appSource).toContain('import "./styles/index.css";');
  });

  it("declares a single layer order and explicit imports in index.css", () => {
    const indexCss = readAppStyleFile("app/styles/index.css");

    expect(indexCss).toContain(
      "@layer reset, tokens, theme, primitives, layout, features, utilities;"
    );
    expect(indexCss).toContain('@import "./tokens.css";');
    expect(indexCss).toContain('@import "./themes/light.css";');
    expect(indexCss).toContain('@import "./themes/dark.css";');
    expect(indexCss).toContain('@import "./base.css";');
    expect(indexCss).toContain('@import "./primitives/button.css";');
    expect(indexCss).toContain('@import "./layout/app-shell.css";');
    expect(indexCss).toContain('@import "./features/editor.css";');
  });

  it("keeps theme files token-only", () => {
    const darkCss = readAppStyleFile("app/styles/themes/dark.css");

    expect(darkCss).not.toMatch(/:root\[data-theme="dark"\]\s+\./u);
  });

  it("assembles primitive, layout, and feature selectors into the app bundle", () => {
    const css = readAppStyles();

    expect(css).toContain(".ui-button");
    expect(css).toContain(".main-pane");
    expect(css).toContain(".editor-pane");
    expect(css).toContain(".capture-chat");
    expect(css).toContain(".review-workbench__layout");
  });
});
