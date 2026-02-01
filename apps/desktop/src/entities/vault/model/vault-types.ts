import type { VaultId } from "../../../shared/model/id-types";

export type VaultRecord = {
  id: VaultId;
  name: string;
  path: string;
};

export type VaultConfig = {
  active_id?: VaultId | null;
  vaults: VaultRecord[];
};

export type VaultKeyStatus = {
  configured: boolean;
  kdf: string | null;
  iterations: number | null;
  salt_b64: string | null;
};
