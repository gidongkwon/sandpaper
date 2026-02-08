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

/** Resolve a CSS var reference to its declared px value, or parse a rem/px literal. */
const toNumericPx = (value: string, css: string): number => {
  // Handle rem literal
  const remMatch = value.match(/^([0-9]*\.?[0-9]+)rem$/u);
  if (remMatch?.[1]) return Number.parseFloat(remMatch[1]) * 16;

  // Handle px literal
  const pxMatch = value.match(/^([0-9]*\.?[0-9]+)px$/u);
  if (pxMatch?.[1]) return Number.parseFloat(pxMatch[1]);

  // Handle calc(Npx * var(--type-scale)) — extract the px constant
  const calcMatch = value.match(/calc\(\s*([0-9]*\.?[0-9]+)px\s*\*/u);
  if (calcMatch?.[1]) return Number.parseFloat(calcMatch[1]);

  // Handle var(--custom-prop) by looking up the declaration in :root
  const varMatch = value.match(/^var\((--[\w-]+)\)$/u);
  if (varMatch?.[1]) {
    const propName = varMatch[1];
    const declPattern = new RegExp(
      String.raw`${propName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\s*([^;]+);`,
      "u"
    );
    const declMatch = css.match(declPattern);
    if (declMatch?.[1]) {
      return toNumericPx(declMatch[1].trim(), css);
    }
  }
  throw new Error(`Cannot resolve size: ${value}`);
};

describe("Heading typography", () => {
  const css = readCss();

  it("uses explicit heading display selectors with descending sizes", () => {
    const h1 = toNumericPx(getFontSize(css, ".block__display.block__display--heading1"), css);
    const h2 = toNumericPx(getFontSize(css, ".block__display.block__display--heading2"), css);
    const h3 = toNumericPx(getFontSize(css, ".block__display.block__display--heading3"), css);

    expect(h1).toBeGreaterThan(h2);
    expect(h2).toBeGreaterThan(h3);
  });
});
