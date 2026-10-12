import { Keypair } from "stellar-sdk";
import { decryptStoredSecret, encryptStoredSecret } from "@/lib/secret-storage";
import { loadSavedWalletSigner } from "@/lib/saved-wallet-server";
import type { TieredRewardConfig } from "./types";

// Wallet IDs share the existing signing-storage column; legacy encrypted keys remain valid.
const WALLET_PREFIX = "saved-wallet:v1:";
export function rewardSigningFields(stored: unknown, includeSecret = false) {
  const value = typeof stored === "string" ? decryptStoredSecret(stored) : "";
  const walletId = value.startsWith(WALLET_PREFIX) ? value.slice(WALLET_PREFIX.length) : undefined;
  return { walletId, secretKey: includeSecret && !walletId ? value || null : null, hasKey: !!value };
}

/** Undefined leaves a saved signer unchanged; null explicitly clears it. */
export async function rewardSigningUpdate(data: Record<string, unknown>, userId: string | null): Promise<string | undefined> {
  if (data.walletId !== undefined && data.walletId !== null) {
    if (typeof data.walletId !== "string" || !data.walletId || data.walletId.length > 200) throw new Error("Invalid saved wallet");
    if (typeof data.secretKey === "string" && data.secretKey.trim()) throw new Error("Choose either a saved wallet or a manual key");
    const signer = await loadSavedWalletSigner(data.walletId, userId);
    if (!signer) throw new Error("Saved wallet not found");
    return encryptStoredSecret(WALLET_PREFIX + data.walletId);
  }
  if (typeof data.secretKey === "string" && data.secretKey.trim()) {
    Keypair.fromSecret(data.secretKey.trim());
    return encryptStoredSecret(data.secretKey.trim());
  }
  if (data.secretKey === null || data.walletId === null) return "";
  if (data.secretKey !== undefined && typeof data.secretKey !== "string") throw new Error("Invalid signing key");
  return undefined;
}

export async function resolveRewardSigningConfig(config: TieredRewardConfig, userId?: string): Promise<TieredRewardConfig> {
  if (!config.walletId) return config;
  const signer = await loadSavedWalletSigner(config.walletId, userId ?? null);
  if (!signer) throw new Error("Saved wallet not found; choose another sender wallet");
  return { ...config, secretKey: signer.secret() };
}
