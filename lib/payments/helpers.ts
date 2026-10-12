import { Asset, StrKey } from "stellar-sdk";
import { calcAvailableXlm } from "@/lib/stellar-reserve";
import type { PaymentLeg, AccountBalance, ClaimantEntry } from "@/lib/payments/types";

export function makeLeg(): PaymentLeg {
  return { id: crypto.randomUUID(), assetKey: "native", amount: "", destination: "" };
}

export function makeClaimant(): ClaimantEntry {
  return { id: crypto.randomUUID(), destination: "" };
}

export function assetFromKey(key: string): Asset {
  if (key === "native") return Asset.native();
  const colonIdx = key.indexOf(":");
  return new Asset(key.slice(0, colonIdx), key.slice(colonIdx + 1));
}

export function assetLabel(keyOrType: string, code?: string): string {
  if (keyOrType === "native") return "XLM";
  if (code !== undefined) return code || "unknown"; // called with Horizon asset_type + asset_code
  return keyOrType.split(":")[0]; // called with "CODE:ISSUER" key
}

export function isValidAssetCode(code: string): boolean {
  return /^[a-zA-Z0-9]{1,12}$/.test(code);
}

export function isLegValid(leg: PaymentLeg): boolean {
  return (
    StrKey.isValidEd25519PublicKey(leg.destination.trim()) &&
    Number(leg.amount) > 0
  );
}

export function nativeMaxSpendable(bal: AccountBalance, feeStroops: number, estOps: number, extraReserveXlm = 0): string {
  const { available } = calcAvailableXlm({
    subentry_count: bal.subentryCount,
    num_sponsoring: bal.numSponsoring,
    num_sponsored: bal.numSponsored,
    balances: [{ asset_type: "native", balance: bal.balance, selling_liabilities: bal.sellingLiabilities }],
  });
  const feeCost = (feeStroops * estOps) / 1e7;
  // ponytail: cancel ops for removeTrustline legs not counted in estOps; worst case leaves account short by fee×cancelCount stroops
  return Math.max(0, available - feeCost - extraReserveXlm).toFixed(7);
}
