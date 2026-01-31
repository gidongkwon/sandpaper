import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

export type VaultRecord = {
  id: string;
  keyFingerprint: string;
  createdAt: number;
};

export type DeviceRecord = {
  id: string;
  vaultId: string;
  createdAt: number;
  lastSeen: number;
};

export type StoredOp = {
  cursor: number;
  opId: string;
  payload: string;
  deviceId: string;
  createdAt: number;
};

export type PushOp = {
  opId: string;
  payload: string;
};

export type PushResult = {
  accepted: number;
  cursor: number | null;
};

export class SyncStore {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.init();
  }

  private init() {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS vaults (
        id TEXT PRIMARY KEY,
        key_fingerprint TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        vault_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        FOREIGN KEY (vault_id) REFERENCES vaults(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS ops (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vault_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        op_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(vault_id, op_id),
        FOREIGN KEY (vault_id) REFERENCES vaults(id) ON DELETE CASCADE,
        FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS ops_vault_cursor ON ops(vault_id, id);
    `);
  }

  private withTransaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  createVault(keyFingerprint: string, vaultId?: string): VaultRecord {
    const id = vaultId ?? randomUUID();
    const createdAt = Date.now();
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO vaults (id, key_fingerprint, created_at) VALUES (?, ?, ?)"
    );
    insert.run(id, keyFingerprint, createdAt);
    const row = this.db
      .prepare("SELECT id, key_fingerprint, created_at FROM vaults WHERE id = ?")
      .get(id) as { id: string; key_fingerprint: string; created_at: number } | undefined;
    if (!row) {
      throw new Error("vault-create-failed");
    }
    if (row.key_fingerprint !== keyFingerprint) {
      throw new Error("vault-fingerprint-mismatch");
    }
    return {
      id: row.id,
      keyFingerprint: row.key_fingerprint,
      createdAt: row.created_at
    };
  }

  getVault(vaultId: string): VaultRecord | null {
    const row = this.db
      .prepare("SELECT id, key_fingerprint, created_at FROM vaults WHERE id = ?")
      .get(vaultId) as { id: string; key_fingerprint: string; created_at: number } | undefined;
    if (!row) return null;
    return {
      id: row.id,
      keyFingerprint: row.key_fingerprint,
      createdAt: row.created_at
    };
  }

  registerDevice(vaultId: string, keyFingerprint: string, deviceId?: string): DeviceRecord {
    const vault = this.getVault(vaultId);
    if (!vault) {
      throw new Error("vault-not-found");
    }
    if (vault.keyFingerprint !== keyFingerprint) {
      throw new Error("vault-fingerprint-mismatch");
    }

    const id = deviceId ?? randomUUID();
    const now = Date.now();
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO devices (id, vault_id, created_at, last_seen) VALUES (?, ?, ?, ?)"
    );
    insert.run(id, vaultId, now, now);
    const update = this.db.prepare("UPDATE devices SET last_seen = ? WHERE id = ?");
    update.run(now, id);
    const row = this.db
      .prepare("SELECT id, vault_id, created_at, last_seen FROM devices WHERE id = ?")
      .get(id) as { id: string; vault_id: string; created_at: number; last_seen: number } | undefined;
    if (!row) {
      throw new Error("device-create-failed");
    }
    return {
      id: row.id,
      vaultId: row.vault_id,
      createdAt: row.created_at,
      lastSeen: row.last_seen
    };
  }

  pushOps(vaultId: string, deviceId: string, ops: PushOp[]): PushResult {
    if (ops.length === 0) {
      return { accepted: 0, cursor: null };
    }
    const now = Date.now();
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO ops (vault_id, device_id, op_id, payload, created_at) VALUES (?, ?, ?, ?, ?)"
    );
    const updateDevice = this.db.prepare(
      "UPDATE devices SET last_seen = ? WHERE id = ? AND vault_id = ?"
    );

    return this.withTransaction(() => {
      let accepted = 0;
      for (const op of ops) {
        const result = insert.run(vaultId, deviceId, op.opId, op.payload, now) as {
          changes: number;
        };
        if (result.changes > 0) {
          accepted += 1;
        }
      }
      updateDevice.run(now, deviceId, vaultId);
      const cursorRow = this.db
        .prepare("SELECT MAX(id) as cursor FROM ops WHERE vault_id = ?")
        .get(vaultId) as { cursor: number | null } | undefined;
      return {
        accepted,
        cursor: cursorRow?.cursor ?? null
      };
    });
  }

  listOps(vaultId: string, since: number, limit: number): StoredOp[] {
    const rows = this.db
      .prepare(
        "SELECT id, op_id, payload, device_id, created_at FROM ops WHERE vault_id = ? AND id > ? ORDER BY id ASC LIMIT ?"
      )
      .all(vaultId, since, limit) as {
      id: number;
      op_id: string;
      payload: string;
      device_id: string;
      created_at: number;
    }[];
    return rows.map((row) => ({
      cursor: row.id,
      opId: row.op_id,
      payload: row.payload,
      deviceId: row.device_id,
      createdAt: row.created_at
    }));
  }
}

export const openSyncStore = (path: string) => {
  const db = new DatabaseSync(path);
  return new SyncStore(db);
};
