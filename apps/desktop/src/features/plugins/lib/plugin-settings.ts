import type {
  PluginSettingSchema,
  PluginSettingsSchema
} from "../../../entities/plugin/model/plugin-types";

export const applySettingsSchemaDefaults = (
  schema: PluginSettingsSchema | null | undefined,
  stored: Record<string, unknown> | null | undefined
) => {
  const base =
    stored && typeof stored === "object" ? { ...stored } : ({} as Record<string, unknown>);
  if (!schema || !schema.properties) return base;
  for (const [key, field] of Object.entries(schema.properties)) {
    if (base[key] === undefined && field.default !== undefined) {
      base[key] = field.default as unknown;
    }
  }
  return base;
};

export const coerceSettingValue = (
  field: Pick<PluginSettingSchema, "type">,
  raw: string | number | boolean
) => {
  const kind = field.type ?? "string";
  if (kind === "boolean") {
    if (typeof raw === "boolean") return raw;
    const normalized = String(raw).toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
    return Boolean(raw);
  }
  if (kind === "integer") {
    const value =
      typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
    return Number.isFinite(value) ? Math.trunc(value) : raw;
  }
  if (kind === "number") {
    const value = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(value) ? value : raw;
  }
  return raw;
};
