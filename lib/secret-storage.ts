import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "enc:v1";

export function isEncryptedStoredSecret(stored: string | null | undefined): boolean {
  return Boolean(stored?.startsWith(`${PREFIX}:`));
}

function encryptionKey(): Buffer {
  const configured = process.env.SIGNING_KEY_ENCRYPTION_KEY?.trim();
  if (!configured) {
    throw new Error("SIGNING_KEY_ENCRYPTION_KEY is required to store signing keys");
  }

  const key = /^[a-f\d]{64}$/i.test(configured)
    ? Buffer.from(configured, "hex")
    : Buffer.from(configured, "base64");
  if (key.length !== 32) {
    throw new Error("SIGNING_KEY_ENCRYPTION_KEY must decode to exactly 32 bytes");
  }
  return key;
}

/** Encrypt a signing key for database storage using AES-256-GCM. */
export function encryptStoredSecret(secret: string): string {
  if (!secret || isEncryptedStoredSecret(secret)) return secret;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

/** Validate untyped backup/API data before it enters encrypted storage. */
export function encryptImportedStoredSecret(secret: unknown): string {
  if (typeof secret !== "string") {
    throw new TypeError("Imported signing key must be a string");
  }
  return encryptStoredSecret(secret);
}

/** Decrypt a stored signing key. Plaintext is accepted for one-way legacy migration. */
export function decryptStoredSecret(stored: string | null | undefined): string {
  if (!stored) return "";
  if (!stored.startsWith(`${PREFIX}:`)) return stored;

  const parts = stored.split(":");
  if (parts.length !== 5 || parts[0] !== "enc" || parts[1] !== "v1") {
    throw new Error("Stored signing key has an invalid encrypted format");
  }
  const [, , ivEncoded, tagEncoded, ciphertextEncoded] = parts;
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivEncoded, "base64"));
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextEncoded, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function hasStoredSecret(stored: string | null | undefined): boolean {
  return Boolean(stored);
}
