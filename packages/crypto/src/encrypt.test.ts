import { describe, expect, it } from "vitest";
import {
  decryptString,
  encryptString,
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
});
