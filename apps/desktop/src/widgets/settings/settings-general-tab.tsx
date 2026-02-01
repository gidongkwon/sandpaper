import type { Accessor, Setter } from "solid-js";
import type { VaultRecord } from "../../entities/vault/model/vault-types";

type SettingsGeneralTabProps = {
  typeScale: {
    value: Accessor<number>;
    set: Setter<number>;
    min: number;
    max: number;
    step: number;
    defaultPosition: string;
  };
  activeVault: Accessor<VaultRecord | null>;
};

export const SettingsGeneralTab = (props: SettingsGeneralTabProps) => {
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
        <p class="settings-section__desc">
          Sandpaper follows your system color scheme.
        </p>
        <div class="settings-row">
          <label class="settings-label">Current vault</label>
          <span class="settings-value">
            {props.activeVault()?.name ?? "Default"}
          </span>
        </div>
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
