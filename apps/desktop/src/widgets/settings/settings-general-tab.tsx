import type { Accessor, Setter } from "solid-js";
import type { VaultRecord } from "../../entities/vault/model/vault-types";
import type { MotionMode } from "../../pages/main-page/model/use-motion-mode";
import type { ThemeMode } from "../../pages/main-page/model/use-theme-mode";
import { SelectField, type SelectFieldOption } from "../../shared/ui/select-field";
import { Switch } from "../../shared/ui/switch";

type SettingsGeneralTabProps = {
  typeScale: {
    value: Accessor<number>;
    set: Setter<number>;
    min: number;
    max: number;
    step: number;
    defaultPosition: string;
  };
  theme: {
    mode: Accessor<ThemeMode>;
    setMode: Setter<ThemeMode>;
  };
  motion: {
    mode: Accessor<MotionMode>;
    setMode: Setter<MotionMode>;
  };
  statusSurfaces: {
    showStatusSurfaces: Accessor<boolean>;
    setShowStatusSurfaces: Setter<boolean>;
  };
  activeVault: Accessor<VaultRecord | null>;
};

export const SettingsGeneralTab = (props: SettingsGeneralTabProps) => {
  const themeOptions: SelectFieldOption[] = [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
    { value: "system", label: "System" }
  ];
  const motionOptions: SelectFieldOption[] = [
    { value: "full", label: "Full" },
    { value: "reduced", label: "Reduced" },
    { value: "system", label: "System" }
  ];
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const moveShortcut = isMac ? "Option+Command+Up/Down" : "Alt+Up/Down";

  return (
    <>
      <div class="settings-section">
        <h3 class="settings-section__title">Typography</h3>
        <p class="settings-section__desc">
          Adjust the text size across the interface.
        </p>
        <div class="settings-slider">
          <div class="settings-slider__header">
            <label class="settings-label">Text size</label>
            <span class="settings-value">
              {Math.round(props.typeScale.value() * 100)}%
            </span>
          </div>
          <input
            type="range"
            class="settings-slider__input"
            min={props.typeScale.min}
            max={props.typeScale.max}
            step={props.typeScale.step}
            value={props.typeScale.value()}
            onInput={(e) => props.typeScale.set(parseFloat(e.currentTarget.value))}
          />
          <div
            class="settings-slider__labels"
            style={{ "--default-position": props.typeScale.defaultPosition }}
          >
            <span class="settings-slider__label is-min">Compact</span>
            <span class="settings-slider__label is-default">Default</span>
            <span class="settings-slider__label is-max">Large</span>
          </div>
        </div>
      </div>
      <div class="settings-section">
        <h3 class="settings-section__title">Appearance</h3>
        <p class="settings-section__desc">Choose how Sandpaper renders color themes.</p>
        <div class="settings-row">
          <label class="settings-label" for="settings-theme-mode">
            Theme
          </label>
          <SelectField
            label="Theme"
            value={props.theme.mode()}
            options={themeOptions}
            onChange={(value) => props.theme.setMode(value as ThemeMode)}
            triggerClass="settings-select"
            contentClass="settings-select__content"
            listboxClass="settings-select__listbox"
            itemClass="settings-select__item"
            itemLabelClass="settings-select__item-label"
          />
        </div>
        <div class="settings-row">
          <label class="settings-label" for="settings-motion-mode">
            Motion
          </label>
          <SelectField
            label="Motion"
            value={props.motion.mode()}
            options={motionOptions}
            onChange={(value) => props.motion.setMode(value as MotionMode)}
            triggerClass="settings-select"
            contentClass="settings-select__content"
            listboxClass="settings-select__listbox"
            itemClass="settings-select__item"
            itemLabelClass="settings-select__item-label"
          />
        </div>
        <div class="settings-row">
          <label class="settings-label">Current vault</label>
          <span class="settings-value">
            {props.activeVault()?.name ?? "Default"}
          </span>
        </div>
      </div>
      <div class="settings-section">
        <h3 class="settings-section__title">Status surfaces</h3>
        <p class="settings-section__desc">
          Control status chips shown in the top bar.
        </p>
        <Switch
          class="settings-row settings-row--checkbox"
          labelClass="settings-label"
          checked={props.statusSurfaces.showStatusSurfaces()}
          onChange={props.statusSurfaces.setShowStatusSurfaces}
          label="Show status chips"
        />
      </div>
      <div class="settings-section">
        <h3 class="settings-section__title">Keyboard shortcuts</h3>
        <p class="settings-section__desc">
          Editor shortcuts for quick block actions.
        </p>
        <div class="settings-row">
          <span class="settings-label">Move block(s) up/down</span>
          <span class="settings-value">{moveShortcut}</span>
        </div>
        <div class="settings-row">
          <span class="settings-label">Insert line break</span>
          <span class="settings-value">Shift+Enter</span>
        </div>
      </div>
    </>
  );
};
