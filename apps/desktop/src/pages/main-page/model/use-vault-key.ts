import { createSignal } from "solid-js";
import type { VaultKeyStatus } from "../../../entities/vault/model/vault-types";
import {
  createEmptyVaultKeyStatus,
  readVaultKeyStatusFromStorage,
  writeVaultKeyStatusToStorage
} from "./vault-key-utils";

type InvokeFn = typeof import("@tauri-apps/api/core").invoke;
type VaultKeyResult = {
  kdf: string;
  iterations: number;
  saltB64: string;
  keyB64: string;
};

type VaultKeyDeps = {
  isTauri: () => boolean;
  invoke: InvokeFn;
  deriveVaultKey: (passphrase: string) => Promise<VaultKeyResult>;
};

export const createVaultKeyState = (deps: VaultKeyDeps) => {
  const [vaultPassphrase, setVaultPassphrase] = createSignal("");
  const [vaultKeyStatus, setVaultKeyStatus] = createSignal<VaultKeyStatus>(
    createEmptyVaultKeyStatus()
  );
  const [vaultKeyBusy, setVaultKeyBusy] = createSignal(false);
  const [vaultKeyMessage, setVaultKeyMessage] = createSignal<string | null>(
    null
  );

  const loadVaultKeyStatus = async () => {
    if (!deps.isTauri()) {
      const status = readVaultKeyStatusFromStorage(
        typeof window === "undefined" ? null : localStorage
      );
      setVaultKeyStatus(status);
      return;
    }

    try {
      const status = (await deps.invoke("vault_key_status")) as VaultKeyStatus;
      setVaultKeyStatus({
        configured: status.configured,
        kdf: status.kdf ?? null,
        iterations: status.iterations ?? null,
        salt_b64: status.salt_b64 ?? null
      });
    } catch (error) {
      console.error("Failed to load vault key status", error);
      setVaultKeyStatus(createEmptyVaultKeyStatus());
    }
  };

  const setVaultKey = async () => {
    const passphrase = vaultPassphrase().trim();
    if (!passphrase) return;
    setVaultKeyBusy(true);
    setVaultKeyMessage(null);
    try {
      const vaultKey = await deps.deriveVaultKey(passphrase);
      if (deps.isTauri()) {
        await deps.invoke("set_vault_key", {
          keyB64: vaultKey.keyB64,
          saltB64: vaultKey.saltB64,
          iterations: vaultKey.iterations
        });
        setVaultKeyStatus({
          configured: true,
          kdf: vaultKey.kdf,
          iterations: vaultKey.iterations,
          salt_b64: vaultKey.saltB64
        });
      } else {
        const status = writeVaultKeyStatusToStorage(
          typeof window === "undefined" ? null : localStorage,
          {
            kdf: vaultKey.kdf,
            iterations: vaultKey.iterations,
            saltB64: vaultKey.saltB64
          }
        );
        setVaultKeyStatus(status);
      }
      setVaultKeyMessage("Vault key derived and stored.");
      setVaultPassphrase("");
    } catch (error) {
      console.error("Failed to derive vault key", error);
      setVaultKeyMessage("Failed to derive vault key.");
    } finally {
      setVaultKeyBusy(false);
    }
  };

  return {
    vaultPassphrase,
    setVaultPassphrase,
    vaultKeyStatus,
    setVaultKeyStatus,
    vaultKeyBusy,
    vaultKeyMessage,
    loadVaultKeyStatus,
    setVaultKey
  };
};
