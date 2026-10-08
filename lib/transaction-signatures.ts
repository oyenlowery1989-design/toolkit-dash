import { createHash } from "node:crypto";
import { FeeBumpTransaction, Keypair, MuxedAccount, StrKey, type Transaction } from "stellar-sdk";
import type { SignedTransaction } from "@/lib/transaction-policy";

interface SigningAccount {
  signers: Array<{ key: string; weight: number }>;
  thresholds: { low_threshold: number; med_threshold: number; high_threshold: number };
}
export function baseAddress(address: string): string {
  return address.startsWith("M") ? MuxedAccount.fromAddress(address, "0").baseAccount().accountId() : address;
}
function signedBy(tx: SignedTransaction, key: string): boolean {
  try {
    if (key.startsWith("T")) return Buffer.from(StrKey.decodePreAuthTx(key)).equals(tx.hash());
    if (key.startsWith("X")) return tx.signatures.some((s) => createHash("sha256").update(s.signature()).digest().equals(Buffer.from(StrKey.decodeSha256Hash(key))));
    if (!StrKey.isValidEd25519PublicKey(key)) return false;
    return tx.signatures.some((s) => Keypair.fromPublicKey(key).verify(tx.hash(), s.signature()));
  } catch { return false; }
}

/** Reject unauthenticated envelopes before they can lock somebody else's account/budget. */
export async function verifyEnvelopeSignatures(tx: SignedTransaction, load: (address: string) => Promise<SigningAccount>) {
  const inner: Transaction = tx instanceof FeeBumpTransaction ? tx.innerTransaction : tx;
  const created = new Set(inner.operations.filter((o) => o.type === "createAccount").map((o) => baseAddress(o.destination)));
  const required = new Map<string, "low_threshold" | "med_threshold" | "high_threshold">([[baseAddress(inner.source), "low_threshold"]]);
  for (const op of inner.operations) {
    const address = baseAddress(op.source ?? inner.source);
    const threshold = op.type === "setOptions" || op.type === "accountMerge" ? "high_threshold" : "med_threshold";
    if (required.get(address) !== "high_threshold") required.set(address, threshold);
  }
  for (const [address, threshold] of required) {
    let account: SigningAccount;
    try { account = await load(address); }
    catch (error) {
      if (!(error as { response?: { status?: number } }).response || (error as { response: { status: number } }).response.status !== 404 || !created.has(address)) throw error;
      account = { signers: [{ key: address, weight: 1 }], thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 } };
    }
    const weight = account.signers.reduce((sum, signer) => sum + (signedBy(inner, signer.key) ? signer.weight : 0), 0);
    if (weight < Math.max(1, account.thresholds[threshold])) throw new Error("Transaction signatures do not authorize every source account");
  }
  for (const key of inner.extraSigners ?? []) if (!signedBy(inner, key)) throw new Error("Extra transaction signer is missing");
  if (tx instanceof FeeBumpTransaction) {
    const payer = await load(baseAddress(tx.feeSource));
    const weight = payer.signers.reduce((sum, signer) => sum + (signedBy(tx, signer.key) ? signer.weight : 0), 0);
    if (weight < Math.max(1, payer.thresholds.low_threshold)) throw new Error("Fee payer signature is missing");
  }
}
