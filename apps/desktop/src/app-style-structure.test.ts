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

  it("resets collapsed workspace offset on small screens", () => {
    const workspaceCss = readAppStyleFile("app/styles/layout/workspace.css");

    expect(workspaceCss).toContain(".workspace.sidebar-collapsed {");
    expect(workspaceCss).toContain("padding-left: var(--space-2);");
    expect(workspaceCss).toMatch(
      /@media \(max-width: 900px\)\s*\{[\s\S]*\.workspace\.sidebar-collapsed\s*\{[\s\S]*padding-left:\s*0;[\s\S]*\}/u
    );
  });

  it("uses the kobalte combobox caret instead of drawing a second language selector arrow", () => {
    const editorCss = readAppStyleFile("app/styles/features/editor.css");

    expect(editorCss).toMatch(
      /\.block-renderer__lang-caret\s*\{[\s\S]*font-size:\s*10px;[\s\S]*line-height:\s*1;[\s\S]*\}/u
    );
    expect(editorCss).not.toMatch(
      /\.block-renderer__lang-caret\s*\{[\s\S]*border-left:\s*4px solid transparent;[\s\S]*border-right:\s*4px solid transparent;[\s\S]*border-top:\s*5px solid/u
    );
  });

  it("top aligns code language options from flex-start inside the combobox list", () => {
    const editorCss = readAppStyleFile("app/styles/features/editor.css");

    expect(editorCss).toMatch(
      /\.block-renderer__lang-option\s*\{[\s\S]*align-items:\s*flex-start;[\s\S]*\}/u
    );
  });

  it("keeps the desktop window shell transparent so vibrancy stays visible", () => {
    const baseCss = readAppStyleFile("app/styles/base.css");
    const appShellCss = readAppStyleFile("app/styles/layout/app-shell.css");

    expect(baseCss).toMatch(/:root\s*\{[\s\S]*background:\s*transparent;/u);
    expect(baseCss).toMatch(/body\s*\{[\s\S]*background:\s*transparent;/u);
    expect(appShellCss).toMatch(/\.app\s*\{[\s\S]*background:\s*transparent;/u);
  });

});
