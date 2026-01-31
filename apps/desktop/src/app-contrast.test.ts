import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import appCssRaw from "./app.css?raw";

type ThemeVars = Record<string, string>;

const extractVars = (block: string) => {
  const vars: ThemeVars = {};
  const regex = /--([\w-]+):\s*([^;]+);/g;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(block))) {
    vars[`--${match[1]}`] = match[2].trim();
  }
  return vars;
};

const findRootBlock = (css: string) => {
  const match = css.match(/:root\s*\{([\s\S]*?)\}/);
  if (!match) throw new Error("Missing :root block in app.css");
  return match[1];
};

const findDarkRootBlock = (css: string) => {
  const match = css.match(
    /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{[\s\S]*?:root\s*\{([\s\S]*?)\}\s*\}/
  );
  if (!match) throw new Error("Missing dark :root block in app.css");
  return match[1];
};

const hexToRgb = (hex: string) => {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) {
    throw new Error(`Unsupported color format: ${hex}`);
  }
  const value = parseInt(normalized, 16);
  return [value >> 16 & 255, value >> 8 & 255, value & 255];
};

const luminance = ([r, g, b]: number[]) => {
  const channels = [r, g, b].map((value) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};

const contrastRatio = (foreground: string, background: string) => {
  const l1 = luminance(hexToRgb(foreground));
  const l2 = luminance(hexToRgb(background));
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
};

describe("App color contrast", () => {
  const getCwd = () => {
    const runtime = globalThis as {
      process?: {
        cwd?: () => string;
      };
    };
    return runtime.process?.cwd?.() ?? "";
  };

  const css = (() => {
    if (appCssRaw.includes(":root")) return appCssRaw;
    const cwd = getCwd();
    if (cwd) {
      try {
        return readFileSync(new URL(`file://${cwd}/src/app.css`), "utf8");
      } catch {
        return readFileSync(
          new URL(`file://${cwd}/apps/desktop/src/app.css`),
          "utf8"
        );
      }
    }
    return readFileSync(new URL("./app.css", import.meta.url), "utf8");
  })();
  const lightVars = extractVars(findRootBlock(css));
  const darkVars = extractVars(findDarkRootBlock(css));

  const textTokens = ["--text-primary", "--text-secondary", "--text-tertiary"];
  const backgroundTokens = ["--bg-primary", "--bg-tertiary"];

  const assertContrast = (theme: "light" | "dark", vars: ThemeVars) => {
    for (const textToken of textTokens) {
      const fg = vars[textToken];
      if (!fg) throw new Error(`Missing ${textToken} in ${theme} theme`);
      let worst = Infinity;
      for (const bgToken of backgroundTokens) {
        const bg = vars[bgToken];
        if (!bg) throw new Error(`Missing ${bgToken} in ${theme} theme`);
        const ratio = contrastRatio(fg, bg);
        if (ratio < worst) worst = ratio;
      }
      expect(
        worst,
        `${theme} ${textToken} contrast ${worst.toFixed(2)} failed`
      ).toBeGreaterThanOrEqual(4.5);
    }
  };

  it("meets AA contrast for core text tokens in light theme", () => {
    assertContrast("light", lightVars);
  });

  it("meets AA contrast for core text tokens in dark theme", () => {
    assertContrast("dark", darkVars);
  });
});
