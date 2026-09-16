import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, loadFromStorage } from "@/lib/settings";

const STORAGE_KEY = "stellar-toolkit-settings";
const store = new Map<string, string>();

Object.defineProperty(globalThis, "localStorage", { value: {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, value),
}, configurable: true });

afterEach(() => store.clear());

describe("adPaymentRecipient setting", () => {
  it("defaults to empty and sanitizes a malformed persisted value", () => {
    expect(DEFAULT_SETTINGS.adPaymentRecipient).toBe("");
    store.set(STORAGE_KEY, JSON.stringify({ adPaymentRecipient: { invalid: true } }));
    expect(loadFromStorage().adPaymentRecipient).toBe("");
  });

  it("preserves a persisted recipient", () => {
    store.set(STORAGE_KEY, JSON.stringify({ adPaymentRecipient: "GAMMBVZRMZE33O46HKLXOTOV5GOL5Y5RRC4SCMR53SSNQJXLJ6LNVCNJ" }));
    expect(loadFromStorage().adPaymentRecipient).toBe("GAMMBVZRMZE33O46HKLXOTOV5GOL5Y5RRC4SCMR53SSNQJXLJ6LNVCNJ");
  });
});
