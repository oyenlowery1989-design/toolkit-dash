import { StrKey } from "stellar-sdk";
import type { AssetProceedsResult, ProceedsLedgerEntry } from "@/lib/proceeds-investigator/types";

export interface AdPaymentClassification {
  status: "compliant" | "underpaid" | "unpaid" | "unknown";
  paidXlm: number;
  percentage: number | null;
  requiredXlm: number;
  shortfallXlm: number;
  evidence: ProceedsLedgerEntry[];
  reason?: string;
}

const EXCLUDED_CATEGORIES = new Set(["fee", "dex_sale", "path_sale"]);
const CATEGORIES = new Set<ProceedsLedgerEntry["category"]>([
  "dex_sale", "path_sale", "payment", "create_account", "path_native_out", "account_merge", "fee",
]);

function unknown(reason: string): AdPaymentClassification {
  return { status: "unknown", paidXlm: 0, percentage: null, requiredXlm: 0, shortfallXlm: 0, evidence: [], reason };
}

function isMatchingEntry(entry: unknown, recipient: string): entry is ProceedsLedgerEntry {
  if (!entry || typeof entry !== "object") return false;
  const value = entry as Partial<ProceedsLedgerEntry>;
  return typeof value.to === "string" && value.to.trim() === recipient;
}

function isValidEntry(entry: ProceedsLedgerEntry): boolean {
  return typeof entry.id === "string" && entry.id.length > 0
    && typeof entry.account === "string"
    && typeof entry.to === "string" && entry.to.trim().length > 0
    && (entry.from === undefined || typeof entry.from === "string")
    && typeof entry.category === "string" && CATEGORIES.has(entry.category)
    && typeof entry.amountXlm === "number" && Number.isFinite(entry.amountXlm) && entry.amountXlm >= 0
    && typeof entry.txHash === "string" && typeof entry.createdAt === "string"
    && typeof entry.successful === "boolean";
}

export function classifyAdPayment(
  result: AssetProceedsResult | null | undefined,
  recipientInput: string,
): AdPaymentClassification {
  const recipient = recipientInput.trim();
  if (!recipient || !StrKey.isValidEd25519PublicKey(recipient)) {
    return unknown("Configure a valid recipient address.");
  }
  if (!result || typeof result !== "object" || !Number.isFinite(result.totalXlmProceeds) || result.totalXlmProceeds < 0) {
    return unknown("Saved analysis has invalid proceeds.");
  }
  if (!Array.isArray(result.outgoingLedger)) return unknown("Saved analysis is missing an outgoing ledger.");

  const evidence: ProceedsLedgerEntry[] = [];
  const seen = new Set<string>();
  for (const candidate of result.outgoingLedger) {
    if (!candidate || typeof candidate !== "object") return unknown("Saved analysis has an unusable outgoing ledger.");
    if (EXCLUDED_CATEGORIES.has((candidate as Partial<ProceedsLedgerEntry>).category ?? "")) continue;
    const destination = (candidate as Partial<ProceedsLedgerEntry>).to;
    if (typeof destination !== "string" || !destination.trim()) return unknown("Saved analysis has an unusable outgoing ledger.");
    if (!isMatchingEntry(candidate, recipient)) continue;
    if (!isValidEntry(candidate)) return unknown("Saved analysis has a malformed recipient payment.");
    if (!candidate.successful || candidate.amountXlm <= 0 || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    evidence.push(candidate);
  }
  const paidXlm = evidence.reduce((total, entry) => total + entry.amountXlm, 0);
  if (!Number.isFinite(paidXlm)) return unknown("Saved analysis has invalid recipient payment totals.");

  const requiredXlm = result.totalXlmProceeds * 0.25;
  if (result.totalXlmProceeds === 0) {
    return paidXlm === 0
      ? { status: "unpaid", paidXlm, percentage: 0, requiredXlm: 0, shortfallXlm: 0, evidence }
      : { status: "compliant", paidXlm, percentage: null, requiredXlm: 0, shortfallXlm: 0, evidence };
  }
  if (paidXlm === 0) return { status: "unpaid", paidXlm, percentage: 0, requiredXlm, shortfallXlm: requiredXlm, evidence };

  const tolerance = Math.min(1e-9, Math.max(1, requiredXlm) * Number.EPSILON * 8);
  const compliant = paidXlm >= requiredXlm - tolerance;
  return {
    status: compliant ? "compliant" : "underpaid",
    paidXlm,
    percentage: paidXlm / result.totalXlmProceeds * 100,
    requiredXlm,
    shortfallXlm: compliant ? 0 : requiredXlm - paidXlm,
    evidence,
  };
}
