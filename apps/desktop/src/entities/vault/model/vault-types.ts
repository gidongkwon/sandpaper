export type VaultRecord = {
  id: string;
  name: string;
  path: string;
};

export type VaultConfig = {
  active_id?: string | null;
  vaults: VaultRecord[];
};

export type VaultKeyStatus = {
  configured: boolean;
  kdf: string | null;
  iterations: number | null;
  salt_b64: string | null;
};
