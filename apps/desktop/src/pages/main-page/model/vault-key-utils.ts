import type { VaultKeyStatus } from "../../../entities/vault/model/vault-types";

type VaultKeyPayload = {
  kdf?: string;
  iterations?: number;
  salt_b64?: string;
};

type VaultKeyStored = {
  kdf: string;
  iterations: number;
  saltB64: string;
};

const STORAGE_KEY = "sandpaper:vault-key";

export const createEmptyVaultKeyStatus = (): VaultKeyStatus => ({
  configured: false,
  kdf: null,
  iterations: null,
  salt_b64: null
});

export const readVaultKeyStatusFromStorage = (
  storage: Storage | null | undefined
): VaultKeyStatus => {
  if (!storage) return createEmptyVaultKeyStatus();
  const stored = storage.getItem(STORAGE_KEY);
  if (!stored) return createEmptyVaultKeyStatus();
  try {
    const parsed = JSON.parse(stored) as VaultKeyPayload;
    return {
      configured: true,
      kdf: parsed.kdf ?? "pbkdf2-sha256",
      iterations: parsed.iterations ?? null,
      salt_b64: parsed.salt_b64 ?? null
    };
  } catch {
    return createEmptyVaultKeyStatus();
  }
};

export const writeVaultKeyStatusToStorage = (
  storage: Storage | null | undefined,
  vaultKey: VaultKeyStored
) => {
  const payload = {
    kdf: vaultKey.kdf,
    iterations: vaultKey.iterations,
    salt_b64: vaultKey.saltB64
  };
  if (storage) {
    storage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }
  return {
    configured: true,
    kdf: vaultKey.kdf,
    iterations: vaultKey.iterations,
    salt_b64: vaultKey.saltB64
  } satisfies VaultKeyStatus;
};
