import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import appCssRaw from "./app/app.css?raw";

const readCss = () => {
  if (appCssRaw.includes(":root")) return appCssRaw;
  const runtime = globalThis as {
    process?: {
      cwd?: () => string;
    };
  };
  const cwd = runtime.process?.cwd?.() ?? "";
  if (cwd) {
    try {
      return readFileSync(new URL(`file://${cwd}/src/app/app.css`), "utf8");
    } catch {
      return readFileSync(
        new URL(`file://${cwd}/apps/desktop/src/app/app.css`),
        "utf8"
      );
    }
  }
  return readFileSync(new URL("./app/app.css", import.meta.url), "utf8");
};

const getFontSize = (css: string, selector: string) => {
  const pattern = /([^{}]+)\{([^{}]*?)\}/gu;
  for (const match of css.matchAll(pattern)) {
    const selectors = (match[1] ?? "")
      .split(",")
      .map((value) => value.trim());
    if (!selectors.includes(selector)) continue;
    const body = match[2] ?? "";
    const sizeMatch = body.match(/font-size:\s*([^;]+);/u);
    if (sizeMatch?.[1]) {
      return sizeMatch[1].trim();
    }
    throw new Error(`Missing font-size for selector ${selector}`);
  }
  throw new Error(`Missing selector ${selector}`);
};

const toRem = (value: string) => {
  const match = value.match(/^([0-9]*\.?[0-9]+)rem$/u);
  if (!match?.[1]) {
    throw new Error(`Expected rem size, got ${value}`);
  }
  return Number.parseFloat(match[1]);
};

describe("Heading typography", () => {
  const css = readCss();

  it("uses explicit heading display selectors with descending sizes", () => {
    const h1 = toRem(getFontSize(css, ".block__display.block__display--heading1"));
    const h2 = toRem(getFontSize(css, ".block__display.block__display--heading2"));
    const h3 = toRem(getFontSize(css, ".block__display.block__display--heading3"));

    expect(h1).toBeGreaterThan(h2);
    expect(h2).toBeGreaterThan(h3);
  });
});
