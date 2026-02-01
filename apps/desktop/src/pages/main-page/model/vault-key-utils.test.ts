import { describe, expect, it } from "vitest";
import {
  readVaultKeyStatusFromStorage,
  writeVaultKeyStatusToStorage
} from "./vault-key-utils";

const createMemoryStorage = () => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    }
  } as Storage;
};

describe("vault key utils", () => {
  it("returns default status when storage is empty", () => {
    const storage = createMemoryStorage();
    const status = readVaultKeyStatusFromStorage(storage);
    expect(status.configured).toBe(false);
  });

  it("parses stored key status", () => {
    const storage = createMemoryStorage();
    storage.setItem(
      "sandpaper:vault-key",
      JSON.stringify({ kdf: "pbkdf2-sha256", iterations: 2, salt_b64: "salt" })
    );
    const status = readVaultKeyStatusFromStorage(storage);
    expect(status.configured).toBe(true);
    expect(status.kdf).toBe("pbkdf2-sha256");
  });

  it("stores key status and returns configured state", () => {
    const storage = createMemoryStorage();
    const status = writeVaultKeyStatusToStorage(storage, {
      kdf: "pbkdf2-sha256",
      iterations: 4,
      saltB64: "salt"
    });
    expect(status.configured).toBe(true);
    expect(storage.getItem("sandpaper:vault-key")).toContain("pbkdf2-sha256");
  });
});
