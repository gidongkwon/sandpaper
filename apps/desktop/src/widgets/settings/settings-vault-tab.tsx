import { Show, type Accessor, type Setter } from "solid-js";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { VaultKeyStatus, VaultRecord } from "../../entities/vault/model/vault-types";
import type { VaultId } from "../../shared/model/id-types";
import { Button } from "../../shared/ui/button";
import { SelectField, type SelectFieldOption } from "../../shared/ui/select-field";

type SettingsVaultProps = {
  active: Accessor<VaultRecord | null>;
  list: Accessor<VaultRecord[]>;
  applyActiveVault: (id: VaultId) => void;
  formOpen: Accessor<boolean>;
  setFormOpen: Setter<boolean>;
  newName: Accessor<string>;
  setNewName: Setter<string>;
  newPath: Accessor<string>;
  setNewPath: Setter<string>;
  create: () => void | Promise<void>;
  shadowPendingCount: Accessor<number>;
  keyStatus: Accessor<VaultKeyStatus>;
  passphrase: Accessor<string>;
  setPassphrase: Setter<string>;
  keyBusy: Accessor<boolean>;
  setKey: () => void | Promise<void>;
  keyMessage: Accessor<string | null>;
};

type SettingsVaultTabProps = {
  isTauri: () => boolean;
  vault: SettingsVaultProps;
};

export const SettingsVaultTab = (props: SettingsVaultTabProps) => {
  let vaultFolderPickerRef: HTMLInputElement | undefined;
  const vaultOptions = (): SelectFieldOption[] =>
    props.vault.list().map((entry) => ({
      value: entry.id,
      label: entry.name
    }));

  const getFolderFromFile = (file: File) => {
    const withPath = file as File & { path?: string; webkitRelativePath?: string };
    if (withPath.path) return withPath.path;
    if (withPath.webkitRelativePath) {
      return withPath.webkitRelativePath.split("/")[0] || "";
    }
    return file.name.replace(/\.[^/.]+$/, "");
  };

  const openVaultFolderPicker = async () => {
    if (props.isTauri()) {
      const selection = await openDialog({
        directory: true,
        multiple: false
      });
      if (typeof selection === "string") {
        props.vault.setNewPath(selection);
      }
      return;
    }
    vaultFolderPickerRef?.click();
  };

  const handleVaultFolderPick = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const nextPath = getFolderFromFile(file);
    if (nextPath) {
      props.vault.setNewPath(nextPath);
    }
    input.value = "";
  };

  return (
    <>
      <div class="settings-section">
        <h3 class="settings-section__title">Active Vault</h3>
        <SelectField
          label="Active Vault"
          value={props.vault.active()?.id ?? ""}
          options={vaultOptions()}
          onChange={(value) => props.vault.applyActiveVault(value)}
          triggerClass="settings-select"
          contentClass="settings-select__content"
          listboxClass="settings-select__listbox"
          itemClass="settings-select__item"
          itemLabelClass="settings-select__item-label"
        />
        <Button
          variant="surface"
          size="sm"
          onClick={() => props.vault.setFormOpen((prev) => !prev)}
        >
          {props.vault.formOpen() ? "Cancel" : "New vault"}
        </Button>
        <Show when={props.vault.formOpen()}>
          <div class="settings-form">
            <input
              class="settings-input"
              type="text"
              placeholder="Vault name"
              value={props.vault.newName()}
              onInput={(e) => props.vault.setNewName(e.currentTarget.value)}
            />
            <div class="settings-file-row">
              <input
                class="settings-input"
                type="text"
                placeholder="Vault path"
                value={props.vault.newPath()}
                onInput={(e) => props.vault.setNewPath(e.currentTarget.value)}
              />
              <Button
                variant="surface"
                size="sm"
                onClick={openVaultFolderPicker}
              >
                Browse
              </Button>
            </div>
            <input
              ref={(el) => {
                vaultFolderPickerRef = el;
                el.setAttribute("webkitdirectory", "");
                el.setAttribute("directory", "");
              }}
              data-testid="vault-folder-picker"
              class="settings-file-input"
              type="file"
              onChange={handleVaultFolderPick}
            />
            <Button
              variant="primary"
              size="sm"
              onClick={() => void props.vault.create()}
            >
              Create vault
            </Button>
          </div>
        </Show>
        <div class="settings-row">
          <label class="settings-label">Shadow write queue</label>
          <span
            class={`settings-value ${
              props.vault.shadowPendingCount() > 0 ? "is-warning" : "is-success"
            }`}
          >
            {props.vault.shadowPendingCount()} pending
          </span>
        </div>
      </div>
      <div class="settings-section">
        <h3 class="settings-section__title">Encryption Key</h3>
        <p class="settings-section__desc">
          {props.vault.keyStatus().configured
            ? `Configured (${props.vault.keyStatus().kdf ?? "pbkdf2-sha256"})`
            : "Set a passphrase to enable E2E encryption."}
        </p>
        <input
          class="settings-input"
          type="password"
          placeholder="Passphrase"
          value={props.vault.passphrase()}
          onInput={(e) => props.vault.setPassphrase(e.currentTarget.value)}
        />
        <div class="settings-actions">
          <Button
            variant="primary"
            size="sm"
            disabled={
              props.vault.keyBusy() || !props.vault.passphrase().trim()
            }
            onClick={() => void props.vault.setKey()}
          >
            {props.vault.keyBusy() ? "Deriving..." : "Set passphrase"}
          </Button>
          <Button
            variant="surface"
            size="sm"
            onClick={() => props.vault.setPassphrase("")}
          >
            Clear
          </Button>
        </div>
        <Show when={props.vault.keyMessage()}>
          <div class="settings-message">{props.vault.keyMessage()}</div>
        </Show>
      </div>
    </>
  );
};
