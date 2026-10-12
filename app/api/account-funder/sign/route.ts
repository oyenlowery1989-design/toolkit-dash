import { NextRequest, NextResponse } from "next/server";
import { FeeBumpTransaction, Horizon, Keypair, Networks, TransactionBuilder, type Transaction } from "stellar-sdk";
import { requireAuth } from "@/lib/supabase-server";
import { loadSavedWalletSigner } from "@/lib/saved-wallet-server";
import { MainnetSigningBudgetUnavailableError, reserveMainnetSignature } from "@/lib/mainnet-signing-budget";

function hasSignature(tx: Transaction, address: string): boolean {
  const key = Keypair.fromPublicKey(address);
  return tx.signatures.some((signature) => {
    try { return key.verify(tx.hash(), signature.signature()); } catch { return false; }
  });
}

/** Accepts only funding, complete child sponsorships, or a child-signed merge fee bump. */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  try {
    const { walletId, purpose, xdr } = await req.json() ?? {};
    if (typeof walletId !== "string" || !walletId || typeof xdr !== "string" || !xdr || xdr.length > 100_000) throw new Error("Wallet and transaction are required");
    const signer = await loadSavedWalletSigner(walletId, auth.userId);
    if (!signer) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
    const publicKey = signer.publicKey();
    const tx = TransactionBuilder.fromXDR(xdr, Networks.PUBLIC);
    const feeBump = tx instanceof FeeBumpTransaction;
    const inner = feeBump ? tx.innerTransaction : tx;
    if ((feeBump ? tx.feeSource : tx.source) !== publicKey) throw new Error("Signing source does not match wallet");
    const expiresAt = Number(inner.timeBounds?.maxTime);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + 300) throw new Error("Transaction must expire within five minutes");
    const ops = inner.operations;
    const destinations: string[] = [];
    let xlmAmount = Number(tx.fee) / 1e7;
    if (purpose === "direct" && !feeBump) {
      if (!ops.length || ops.length > 50) throw new Error("Invalid funding batch");
      for (const op of ops) {
        if (op.type !== "createAccount" || (op.source && op.source !== publicKey) || Number(op.startingBalance) < 1) throw new Error("Only direct child account creation is allowed");
        destinations.push(op.destination);
        xlmAmount += Number(op.startingBalance);
      }
    } else if (purpose === "sponsored" && !feeBump) {
      if (!ops.length || ops.length > 30 || ops.length % 3 !== 0) throw new Error("Invalid sponsorship batch");
      for (let i = 0; i < ops.length; i += 3) {
        const [begin, create, end] = ops.slice(i, i + 3);
        if (begin.type !== "beginSponsoringFutureReserves" || create.type !== "createAccount" || end.type !== "endSponsoringFutureReserves" ||
          (begin.source && begin.source !== publicKey) || (create.source && create.source !== publicKey) ||
          create.destination !== begin.sponsoredId || end.source !== begin.sponsoredId ||
          create.startingBalance !== "0.0000001" || !hasSignature(inner, begin.sponsoredId)) throw new Error("Sponsorship must create and be accepted by the same signed child");
        destinations.push(create.destination);
        xlmAmount += 1 + Number(create.startingBalance); // Include the reserve locked for this child.
      }
    } else if (purpose === "close" && feeBump) {
      const op = ops[0];
      if (ops.length !== 1 || op.type !== "accountMerge" || (op.source && op.source !== inner.source) || inner.source === publicKey || !hasSignature(inner, inner.source)) throw new Error("Only a child-signed account merge can be fee-bumped");
      destinations.push(op.destination);
      // Verify the amount actually moved by the merge before applying mainnet limits.
      let account;
      try { account = await new Horizon.Server("https://horizon.stellar.org").loadAccount(inner.source); }
      catch { return NextResponse.json({ error: "Could not verify the closing account balance" }, { status: 503 }); }
      const native = account.balances.find((balance) => balance.asset_type === "native");
      if (!native) return NextResponse.json({ error: "Could not verify the closing account balance" }, { status: 503 });
      xlmAmount += Number(native.balance);
    } else throw new Error("Unsupported funding purpose");
    if (!Number.isFinite(xlmAmount) || xlmAmount < 0) throw new Error("Invalid transaction amount");
    const errors = await reserveMainnetSignature(auth.userId, tx.hash().toString("hex"), expiresAt,
      { destinations, operationCount: ops.length + (feeBump ? 1 : 0), xlmAmount });
    if (errors.length) return NextResponse.json({ error: errors.join("; ") }, { status: 403 });
    tx.sign(signer);
    return NextResponse.json({ xdr: tx.toXDR() });
  } catch (error) {
    const unavailable = error instanceof MainnetSigningBudgetUnavailableError ||
      (error instanceof Error && error.message === "Could not load signing wallet");
    return NextResponse.json({ error: unavailable ? error.message : "Could not sign funding transaction; verify the wallet and operations" }, { status: unavailable ? 503 : 400 });
  }
}
