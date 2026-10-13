import { NextRequest, NextResponse } from "next/server";
import { FeeBumpTransaction, Keypair, Networks, TransactionBuilder } from "stellar-sdk";
import { requireAuth } from "@/lib/supabase-server";
import { loadSavedWalletSigner } from "@/lib/saved-wallet-server";
import { reserveMainnetSignature, MainnetSigningBudgetUnavailableError } from "@/lib/mainnet-signing-budget";
import { claimAssetIssuance, readAssetIssuanceClaim, IssuanceAlreadyClaimedError, IssuanceProtectionUnavailableError } from "@/lib/asset-creator/issuance-guard";
import { issuanceProofMessage } from "@/lib/asset-creator/issuance-proof";

async function recoverIssuance(signedXdr: string, network: "public" | "testnet", signer: Keypair, assetCode: string, userId: string | null, now: number) {
  let original;
  try {
    original = TransactionBuilder.fromXDR(signedXdr, network === "public" ? Networks.PUBLIC : Networks.TESTNET);
  } catch {
    throw new IssuanceProtectionUnavailableError();
  }
  if (original instanceof FeeBumpTransaction) throw new IssuanceProtectionUnavailableError();
  const op = original.operations[0];
  if (original.source !== signer.publicKey() || original.operations.length !== 1 ||
    op?.type !== "payment" || (op.source && op.source !== signer.publicKey()) || op.asset.isNative() || op.asset.getIssuer() !== signer.publicKey() || op.asset.getCode() !== assetCode ||
    original.signatures.length !== 1 || !signer.verify(original.hash(), original.signatures[0].signature())) {
    throw new IssuanceProtectionUnavailableError();
  }
  const expiresAt = Number(original.timeBounds?.maxTime);
  if (!Number.isFinite(expiresAt)) throw new IssuanceProtectionUnavailableError();
  if (expiresAt <= now) throw new IssuanceAlreadyClaimedError();
  if (network === "public") {
    const errors = await reserveMainnetSignature(userId, original.hash().toString("hex"), expiresAt, {
      destinations: [op.destination], operationCount: 1, xlmAmount: Number(original.fee) / 1e7,
    });
    if (errors.length) return NextResponse.json({ error: errors.join("; ") }, { status: 403 });
  }
  return NextResponse.json({ xdr: signedXdr });
}

async function protectManualIssuance(body: Record<string, unknown>, userId: string | null) {
  const { unsignedXdr, signedXdr, issuerProof } = body;
  const network = body.network;
  if (body.stepId !== "issuance" || (network !== "public" && network !== "testnet") ||
    typeof unsignedXdr !== "string" || !unsignedXdr || unsignedXdr.length > 100_000 ||
    typeof signedXdr !== "string" || !signedXdr || signedXdr.length > 100_000 ||
    typeof issuerProof !== "string" || issuerProof.length > 200 || !issuerProof) {
    return NextResponse.json({ error: "Valid signed issuance and issuer proof are required" }, { status: 400 });
  }
  const tx = TransactionBuilder.fromXDR(signedXdr, network === "public" ? Networks.PUBLIC : Networks.TESTNET);
  const unsignedTx = TransactionBuilder.fromXDR(unsignedXdr, network === "public" ? Networks.PUBLIC : Networks.TESTNET);
  if (tx instanceof FeeBumpTransaction || unsignedTx instanceof FeeBumpTransaction || tx.operations.length !== 1 || tx.signatures.length !== 1 ||
    unsignedTx.signatures.length || unsignedTx.hash().toString("hex") !== tx.hash().toString("hex")) throw new Error("Invalid manual issuance transaction");
  const op = tx.operations[0];
  const signer = Keypair.fromPublicKey(tx.source);
  const expiresAt = Number(tx.timeBounds?.maxTime);
  const now = Math.floor(Date.now() / 1000);
  if (op.type !== "payment" || (op.source && op.source !== tx.source) || op.asset.isNative() ||
    op.asset.getIssuer() !== tx.source || !Number.isFinite(Number(op.amount)) || Number(op.amount) <= 0 ||
    !Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + 300 ||
    !signer.verify(tx.hash(), tx.signatures[0].signature()) ||
    !signer.verify(issuanceProofMessage(tx.hash()), Buffer.from(issuerProof, "base64"))) {
    throw new Error("Invalid manual issuance or issuer proof");
  }
  const assetCode = op.asset.getCode();
  const existing = await readAssetIssuanceClaim(network, tx.source, assetCode);
  if (existing) return recoverIssuance(existing, network, signer, assetCode, userId, now);
  if (network === "public") {
    const errors = await reserveMainnetSignature(userId, tx.hash().toString("hex"), expiresAt, {
      destinations: [op.destination], operationCount: 1, xlmAmount: Number(tx.fee) / 1e7,
    });
    if (errors.length) return NextResponse.json({ error: errors.join("; ") }, { status: 403 });
  }
  const claimedXdr = await claimAssetIssuance({
    network, issuer: tx.source, asset_code: assetCode,
    unsigned_xdr: unsignedXdr, unsigned_hash: tx.hash().toString("hex"),
    signed_xdr: signedXdr, created_at: Date.now(),
  });
  if (claimedXdr !== signedXdr) return recoverIssuance(claimedXdr, network, signer, assetCode, userId, now);
  return NextResponse.json({ xdr: claimedXdr });
}

/** Signs only the Asset Creator's four operations; saved secrets stay server-side. */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  try {
    const body = await req.json();
    const { walletId, xdr, stepId } = body ?? {};
    if (body?.signedXdr !== undefined) return await protectManualIssuance(body, auth.userId);
    const network: unknown = body?.network ?? "public";
    if (typeof walletId !== "string" || !walletId || typeof xdr !== "string" || !xdr || xdr.length > 100_000 || (network !== "public" && network !== "testnet")) {
      return NextResponse.json({ error: "Wallet and transaction are required" }, { status: 400 });
    }
    const signer = await loadSavedWalletSigner(walletId, auth.userId);
    if (!signer) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
    const tx = TransactionBuilder.fromXDR(xdr, network === "public" ? Networks.PUBLIC : Networks.TESTNET);
    if (tx instanceof FeeBumpTransaction || tx.source !== signer.publicKey() || tx.signatures.length) throw new Error("Transaction source does not match the selected wallet or transaction is already signed");
    const expiresAt = Number(tx.timeBounds?.maxTime);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + 300) throw new Error("Transaction must expire within five minutes");
    const destinations: string[] = [];
    let xlmAmount = Number(tx.fee) / 1e7;
    if (!tx.operations.length || tx.operations.length > (stepId === "fund-accounts" ? 2 : 1)) throw new Error("Invalid creation operation count");
    for (const op of tx.operations) {
      if (op.source && op.source !== signer.publicKey()) throw new Error("Operation source does not match the selected wallet");
      if (stepId === "fund-accounts" && op.type === "createAccount" && ["2.0000000", "2.1000000"].includes(op.startingBalance)) {
        destinations.push(op.destination);
        xlmAmount += Number(op.startingBalance);
      } else if (stepId === "set-home-domain" && op.type === "setOptions" && typeof op.homeDomain === "string" && op.homeDomain.length <= 32 &&
        ![op.clearFlags, op.setFlags, op.masterWeight, op.lowThreshold, op.medThreshold, op.highThreshold, op.inflationDest, op.signer].some((v) => v !== undefined)) {
        // Only the home domain can change; account authority stays intact.
      } else if (stepId === "trustline" && op.type === "changeTrust" && op.line.getAssetType() !== "liquidity_pool_shares" && Number(op.limit) > 0) {
        // The distributor establishes a classic-asset trustline.
      } else if (stepId === "issuance" && op.type === "payment" && !op.asset.isNative() && op.asset.getIssuer() === signer.publicKey() && Number(op.amount) > 0) {
        destinations.push(op.destination);
      } else throw new Error("Operation is not supported by Asset Creator");
    }
    if (!Number.isFinite(xlmAmount) || xlmAmount < 0) throw new Error("Invalid transaction amount");
    const assetCode = stepId === "issuance" && tx.operations[0].type === "payment" ? tx.operations[0].asset.getCode() : null;
    if (assetCode) {
      const existing = await readAssetIssuanceClaim(network, signer.publicKey(), assetCode);
      if (existing) return await recoverIssuance(existing, network, signer, assetCode, auth.userId, now);
    }
    if (network === "public") {
      const errors = await reserveMainnetSignature(auth.userId, tx.hash().toString("hex"), expiresAt, {
        destinations, operationCount: tx.operations.length, xlmAmount,
      });
      if (errors.length) return NextResponse.json({ error: errors.join("; ") }, { status: 403 });
    }
    tx.sign(signer);
    const signedXdr = tx.toXDR();
    if (assetCode) {
      const claimedXdr = await claimAssetIssuance({
        network, issuer: signer.publicKey(), asset_code: assetCode,
        unsigned_xdr: xdr, unsigned_hash: tx.hash().toString("hex"),
        signed_xdr: signedXdr, created_at: Date.now(),
      });
      if (claimedXdr !== signedXdr) return await recoverIssuance(claimedXdr, network, signer, assetCode, auth.userId, now);
      return NextResponse.json({ xdr: claimedXdr });
    }
    return NextResponse.json({ xdr: signedXdr });
  } catch (error) {
    if (error instanceof IssuanceAlreadyClaimedError) return NextResponse.json({ error: error.message }, { status: 409 });
    const unavailable = error instanceof Error && error.message === "Could not load signing wallet";
    if (error instanceof IssuanceProtectionUnavailableError || error instanceof MainnetSigningBudgetUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    return NextResponse.json({ error: unavailable ? error.message : "Could not sign asset creation transaction; verify the wallet and operations" }, { status: unavailable ? 503 : 400 });
  }
}
