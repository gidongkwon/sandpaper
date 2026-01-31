const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export type EncryptedPayload = {
  ciphertextB64: string;
  ivB64: string;
  saltB64: string;
  kdf: "pbkdf2-sha256";
  iterations: number;
  algo: "aes-256-gcm";
};

export type VaultKey = {
  keyB64: string;
  saltB64: string;
  kdf: "pbkdf2-sha256";
  iterations: number;
  algo: "aes-256-gcm";
};

export type KeyEncryptedPayload = {
  ciphertextB64: string;
  ivB64: string;
  algo: "aes-256-gcm";
};

export type EncryptOptions = {
  salt?: Uint8Array;
  iv?: Uint8Array;
  iterations?: number;
};

const getCrypto = () => {
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    throw new Error("WebCrypto is not available in this environment");
  }
  return globalThis.crypto;
};

const getBtoa = () => {
  if (typeof globalThis.btoa !== "function") {
    throw new Error("btoa is not available in this environment");
  }
  return globalThis.btoa;
};

const getAtob = () => {
  if (typeof globalThis.atob !== "function") {
    throw new Error("atob is not available in this environment");
  }
  return globalThis.atob;
};

const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return getBtoa()(binary);
};

const fromBase64 = (value: string) => {
  const binary = getAtob()(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const deriveKey = async (
  passphrase: string,
  salt: Uint8Array,
  iterations: number
) => {
  const crypto = getCrypto();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations
    },
    baseKey,
    {
      name: "AES-GCM",
      length: 256
    },
    false,
    ["encrypt", "decrypt"]
  );
};

const deriveKeyBytes = async (
  passphrase: string,
  salt: Uint8Array,
  iterations: number
) => {
  const crypto = getCrypto();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations
    },
    baseKey,
    256
  );

  return new Uint8Array(bits);
};

const importAesKey = async (keyBytes: Uint8Array) => {
  const crypto = getCrypto();
  return crypto.subtle.importKey(
    "raw",
    keyBytes,
    {
      name: "AES-GCM",
      length: 256
    },
    false,
    ["encrypt", "decrypt"]
  );
};

export const encryptString = async (
  passphrase: string,
  plaintext: string,
  options: EncryptOptions = {}
): Promise<EncryptedPayload> => {
  const crypto = getCrypto();
  const iterations = options.iterations ?? 210_000;
  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const iv = options.iv ?? crypto.getRandomValues(new Uint8Array(12));

  const key = await deriveKey(passphrase, salt, iterations);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv
    },
    key,
    textEncoder.encode(plaintext)
  );

  return {
    ciphertextB64: toBase64(new Uint8Array(ciphertext)),
    ivB64: toBase64(iv),
    saltB64: toBase64(salt),
    kdf: "pbkdf2-sha256",
    iterations,
    algo: "aes-256-gcm"
  };
};

export const deriveVaultKey = async (
  passphrase: string,
  options: EncryptOptions = {}
): Promise<VaultKey> => {
  const crypto = getCrypto();
  const iterations = options.iterations ?? 210_000;
  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const keyBytes = await deriveKeyBytes(passphrase, salt, iterations);

  return {
    keyB64: toBase64(keyBytes),
    saltB64: toBase64(salt),
    kdf: "pbkdf2-sha256",
    iterations,
    algo: "aes-256-gcm"
  };
};

export const encryptStringWithKey = async (
  keyB64: string,
  plaintext: string,
  options: EncryptOptions = {}
): Promise<KeyEncryptedPayload> => {
  const crypto = getCrypto();
  const iv = options.iv ?? crypto.getRandomValues(new Uint8Array(12));
  const keyBytes = fromBase64(keyB64);
  const key = await importAesKey(keyBytes);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv
    },
    key,
    textEncoder.encode(plaintext)
  );

  return {
    ciphertextB64: toBase64(new Uint8Array(ciphertext)),
    ivB64: toBase64(iv),
    algo: "aes-256-gcm"
  };
};

export const decryptStringWithKey = async (
  keyB64: string,
  payload: KeyEncryptedPayload
): Promise<string> => {
  const crypto = getCrypto();
  const iv = fromBase64(payload.ivB64);
  const ciphertext = fromBase64(payload.ciphertextB64);
  const keyBytes = fromBase64(keyB64);
  const key = await importAesKey(keyBytes);

  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv
    },
    key,
    ciphertext
  );

  return textDecoder.decode(plaintext);
};

export const decryptString = async (
  passphrase: string,
  payload: EncryptedPayload
): Promise<string> => {
  const crypto = getCrypto();
  const salt = fromBase64(payload.saltB64);
  const iv = fromBase64(payload.ivB64);
  const ciphertext = fromBase64(payload.ciphertextB64);

  const key = await deriveKey(passphrase, salt, payload.iterations);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv
    },
    key,
    ciphertext
  );

  return textDecoder.decode(plaintext);
};
