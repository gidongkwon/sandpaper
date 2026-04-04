import { For, Show } from "solid-js";
import { coerceSettingValue } from "../../features/plugins/lib/plugin-settings";
import type {
  PluginPermissionInfo,
  PluginSettingSchema,
  PluginSettingsSchema
} from "../../entities/plugin/model/plugin-types";
import { Button } from "../../shared/ui/button";
import { Checkbox } from "../../shared/ui/checkbox";
import { SelectField, type SelectFieldOption } from "../../shared/ui/select-field";

type PluginSettingsStatus = {
  state: "idle" | "saving" | "success" | "error";
  message?: string;
};

type PluginSettingsCardProps = {
  plugin: PluginPermissionInfo;
  schema: PluginSettingsSchema;
  values: Record<string, unknown>;
  dirty: boolean;
  busy: boolean;
  status: PluginSettingsStatus | null;
  onChange: (key: string, value: unknown) => void;
  onSave: () => void;
  onReset: () => void;
};

const resolveFieldValue = (
  values: Record<string, unknown>,
  key: string,
  field: PluginSettingSchema
) => {
  if (values[key] !== undefined) return values[key];
  if (field.default !== undefined) return field.default;
  return field.type === "boolean" ? false : "";
};

const renderField = (
  key: string,
  field: PluginSettingSchema,
  values: Record<string, unknown>,
  onChange: (key: string, value: unknown) => void
) => {
  const value = resolveFieldValue(values, key, field);
  const label = field.title ?? key;
  const type = field.type ?? "string";
  const enumValues = field.enum ?? [];

  if (type === "boolean") {
    return (
      <Checkbox
        class="settings-row settings-row--checkbox"
        labelClass="settings-label"
        checked={Boolean(value)}
        onChange={(checked) => onChange(key, coerceSettingValue(field, checked))}
        label={label}
      />
    );
  }

  if (enumValues.length > 0) {
    const options: SelectFieldOption[] = enumValues.map((option) => ({
      value: String(option),
      label: String(option)
    }));

    return (
      <label class="settings-row">
        <span class="settings-label">{label}</span>
        <SelectField
          label={label}
          value={String(value ?? "")}
          options={options}
          onChange={(nextValue) => onChange(key, coerceSettingValue(field, nextValue))}
          triggerClass="settings-select"
          contentClass="settings-select__content"
          listboxClass="settings-select__listbox"
          itemClass="settings-select__item"
          itemLabelClass="settings-select__item-label"
        />
      </label>
    );
  }

  const inputType = type === "number" || type === "integer" ? "number" : "text";

  return (
    <label class="settings-row">
      <span class="settings-label">{label}</span>
      <input
        class="settings-input"
        type={inputType}
        value={String(value ?? "")}
        onInput={(event) =>
          onChange(key, coerceSettingValue(field, event.currentTarget.value))
        }
      />
    </label>
  );
};

export const PluginSettingsCard = (props: PluginSettingsCardProps) => {
  const fields = () =>
    Object.entries(props.schema.properties ?? {}).sort(([a], [b]) =>
      a.localeCompare(b)
    );
  return (
    <div class="settings-plugin settings-plugin--settings">
      <div class="settings-plugin__info">
        <span class="settings-plugin__name">{props.plugin.name}</span>
        <span class="settings-plugin__version">{props.plugin.version}</span>
      </div>
      <Show when={props.schema.description}>
        <p class="settings-plugin__desc">{props.schema.description}</p>
      </Show>
      <div class="settings-form">
        <For each={fields()}>
          {([key, field]) => (
            <div class="settings-field">
              {renderField(key, field, props.values, props.onChange)}
              <Show when={field.description}>
                <div class="settings-help">{field.description}</div>
              </Show>
            </div>
          )}
        </For>
      </div>
      <div class="settings-actions">
        <Button
          variant="primary"
          size="sm"
          onClick={() => props.onSave()}
          disabled={props.busy || !props.dirty || props.status?.state === "saving"}
        >
          {props.status?.state === "saving" ? "Saving..." : "Save"}
        </Button>
        <Button
          variant="surface"
          size="sm"
          onClick={() => props.onReset()}
          disabled={props.busy}
        >
          Reset
        </Button>
      </div>
      <Show when={props.status?.message}>
        {(message) => (
          <div
            class={`settings-message ${
              props.status?.state === "error" ? "is-error" : "is-success"
            }`}
          >
            {message()}
          </div>
        )}
      </Show>
    </div>
  );
};
