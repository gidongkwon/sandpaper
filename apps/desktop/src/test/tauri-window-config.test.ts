import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readJson = (relativePath: string) =>
  JSON.parse(readFileSync(resolve(process.cwd(), relativePath), "utf8")) as {
    app?: { windows?: Array<Record<string, unknown>> };
  };

describe("Tauri window config", () => {
  it("enables shadow for the undecorated Windows window", () => {
    const baseConfig = readJson("src-tauri/tauri.conf.json");
    const windowsConfig = readJson("src-tauri/tauri.windows.conf.json");

    expect(baseConfig.app?.windows?.[0]).toMatchObject({
      decorations: false,
      transparent: true,
      shadow: true
    });
    expect(windowsConfig.app?.windows?.[0]).toMatchObject({
      decorations: false,
      transparent: true,
      shadow: true
    });
  });
});
