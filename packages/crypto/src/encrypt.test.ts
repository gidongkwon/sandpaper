import { describe, expect, it } from "vitest";
import {
  decryptStringWithKey,
  decryptString,
  deriveVaultKey,
  encryptString,
  encryptStringWithKey,
  type EncryptedPayload
} from "./encrypt";

describe("encryptString", () => {
  it("encrypts and decrypts with a passphrase", async () => {
    const payload = await encryptString("passphrase", "hello world", {
      salt: new Uint8Array(16).fill(1),
      iv: new Uint8Array(12).fill(2)
    });

    const decrypted = await decryptString("passphrase", payload);
    expect(decrypted).toBe("hello world");
  });

  it("returns required metadata", async () => {
    const payload = await encryptString("passphrase", "hello world", {
      salt: new Uint8Array(16).fill(3),
      iv: new Uint8Array(12).fill(4)
    });

    const expected: EncryptedPayload = {
      ciphertextB64: payload.ciphertextB64,
      ivB64: payload.ivB64,
      saltB64: payload.saltB64,
      kdf: "pbkdf2-sha256",
      iterations: payload.iterations,
      algo: "aes-256-gcm"
    };

    expect(payload).toEqual(expected);
  });

  it("derives a stable vault key for the same passphrase and salt", async () => {
    const salt = new Uint8Array(16).fill(9);
    const first = await deriveVaultKey("vault-pass", { salt, iterations: 1000 });
    const second = await deriveVaultKey("vault-pass", { salt, iterations: 1000 });

    expect(first).toEqual(second);
    expect(first.kdf).toBe("pbkdf2-sha256");
    expect(first.algo).toBe("aes-256-gcm");
  });

  it("encrypts and decrypts using a derived vault key", async () => {
    const vaultKey = await deriveVaultKey("vault-pass", {
      salt: new Uint8Array(16).fill(7),
      iterations: 1000
    });
    const payload = await encryptStringWithKey(vaultKey.keyB64, "secret", {
      iv: new Uint8Array(12).fill(1)
    });
    const decrypted = await decryptStringWithKey(vaultKey.keyB64, payload);
    expect(decrypted).toBe("secret");
  });
});
