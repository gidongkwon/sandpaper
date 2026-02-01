import { describe, expect, it } from "vitest";
import { applySettingsSchemaDefaults, coerceSettingValue } from "./plugin-settings";
import type { PluginSettingsSchema } from "../../../entities/plugin/model/plugin-types";

describe("plugin settings helpers", () => {
  it("applies schema defaults while preserving stored values", () => {
    const schema: PluginSettingsSchema = {
      type: "object",
      properties: {
        units: { type: "string", default: "c" },
        interval: { type: "number" }
      }
    };
    const stored = { interval: 30 };
    const result = applySettingsSchemaDefaults(schema, stored);
    expect(result.units).toBe("c");
    expect(result.interval).toBe(30);
  });

  it("coerces values based on schema type", () => {
    expect(coerceSettingValue({ type: "number" }, "1.5")).toBe(1.5);
    expect(coerceSettingValue({ type: "integer" }, "2")).toBe(2);
    expect(coerceSettingValue({ type: "boolean" }, "true")).toBe(true);
    expect(coerceSettingValue({ type: "boolean" }, "false")).toBe(false);
  });
});
