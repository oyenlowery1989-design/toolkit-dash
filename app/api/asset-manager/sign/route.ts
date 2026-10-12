import { NextRequest, NextResponse } from "next/server";
import { Networks, Transaction, TransactionBuilder } from "stellar-sdk";
import { requireAuth } from "@/lib/supabase-server";
import { loadSavedWalletSigner } from "@/lib/saved-wallet-server";
import { getMainnetSafetyConfig } from "@/lib/mainnet-safety";
import { MainnetSigningBudgetUnavailableError, reserveMainnetSignature } from "@/lib/mainnet-signing-budget";
import { validateAssetManagerTransaction } from "@/lib/asset-manager/signing-policy";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body || typeof body.walletId !== "string" || !body.walletId || typeof body.xdr !== "string" || !body.xdr || body.xdr.length > 100_000 || body.networkPassphrase !== Networks.PUBLIC) {
    return NextResponse.json({ error: "A saved wallet and public-network transaction are required" }, { status: 400 });
  }
  try {
    const signer = await loadSavedWalletSigner(body.walletId, auth.userId);
    if (!signer) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
    const tx = TransactionBuilder.fromXDR(body.xdr, Networks.PUBLIC);
    if (!(tx instanceof Transaction)) throw new Error("Fee bump transactions are not supported here");
    const intent = validateAssetManagerTransaction(tx, signer.publicKey(), body.immutableConfirmed);
    const op = tx.operations[0];
    if ((op.type === "manageSellOffer" || op.type === "manageBuyOffer") && op.offerId === "0" && getMainnetSafetyConfig().allowedDestinations.size > 0) {
      return NextResponse.json({ error: "DEX counterparties cannot be verified against the mainnet destination allowlist" }, { status: 403 });
    }
    const errors = await reserveMainnetSignature(auth.userId, tx.hash().toString("hex"),
      Number(tx.timeBounds?.maxTime), intent);
    if (errors.length) return NextResponse.json({ error: errors.join("; ") }, { status: 403 });
    tx.sign(signer);
    return NextResponse.json({ xdr: tx.toXDR() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not sign transaction" },
      { status: error instanceof MainnetSigningBudgetUnavailableError ? 503 : 400 });
  }
}
