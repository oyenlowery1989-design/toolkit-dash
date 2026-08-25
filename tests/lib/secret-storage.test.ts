import { afterEach, describe, expect, it } from "vitest";
import {
  decryptStoredSecret,
  encryptImportedStoredSecret,
  encryptStoredSecret,
  hasStoredSecret,
} from "@/lib/secret-storage";

const originalKey = process.env.SIGNING_KEY_ENCRYPTION_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.SIGNING_KEY_ENCRYPTION_KEY;
  else process.env.SIGNING_KEY_ENCRYPTION_KEY = originalKey;
});

describe("secret storage", () => {
  it("round-trips secrets with authenticated encryption", () => {
    process.env.SIGNING_KEY_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    const encrypted = encryptStoredSecret("SABCDEFGHIJKLMNOP");

    expect(encrypted).toMatch(/^enc:v1:/);
    expect(encrypted).not.toContain("SABCDEFGHIJKLMNOP");
    expect(decryptStoredSecret(encrypted)).toBe("SABCDEFGHIJKLMNOP");
  });

  it("uses a unique nonce for each encryption", () => {
    process.env.SIGNING_KEY_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString("base64");
    expect(encryptStoredSecret("same")).not.toBe(encryptStoredSecret("same"));
  });

  it("rejects tampered ciphertext", () => {
    process.env.SIGNING_KEY_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    const encrypted = encryptStoredSecret("secret");
    expect(() => decryptStoredSecret(`${encrypted.slice(0, -2)}AA`)).toThrow();
  });

  it("requires a valid key for non-empty new secrets", () => {
    delete process.env.SIGNING_KEY_ENCRYPTION_KEY;
    expect(() => encryptStoredSecret("secret")).toThrow(/required/);
    process.env.SIGNING_KEY_ENCRYPTION_KEY = "too-short";
    expect(() => encryptStoredSecret("secret")).toThrow(/32 bytes/);
  });

  it("accepts plaintext legacy rows and empty watch-only wallets", () => {
    delete process.env.SIGNING_KEY_ENCRYPTION_KEY;
    expect(decryptStoredSecret("legacy-plaintext")).toBe("legacy-plaintext");
    expect(encryptStoredSecret("")).toBe("");
    expect(hasStoredSecret("")).toBe(false);
    expect(hasStoredSecret("legacy-plaintext")).toBe(true);
  });

  it("rejects malformed imported signing-key data", () => {
    expect(() => encryptImportedStoredSecret(null)).toThrow(/must be a string/);
    expect(() => encryptImportedStoredSecret({ secret: "hidden" })).toThrow(/must be a string/);
  });
});
