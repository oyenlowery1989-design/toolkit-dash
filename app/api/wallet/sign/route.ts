import { NextRequest, NextResponse } from "next/server";
import { FeeBumpTransaction, Horizon, Networks, TransactionBuilder } from "stellar-sdk";
import { requireAuth } from "@/lib/supabase-server";
import { loadSavedWalletSigner } from "@/lib/saved-wallet-server";
import { MainnetSigningBudgetUnavailableError, reserveMainnetSignature } from "@/lib/mainnet-signing-budget";

/** The stored key never leaves this authenticated signing boundary. */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { walletId, xdr } = (body ?? {}) as { walletId?: unknown; xdr?: unknown };
  if (typeof walletId !== "string" || !walletId || typeof xdr !== "string" || !xdr || xdr.length > 100_000) {
    return NextResponse.json({ error: "Wallet and transaction are required" }, { status: 400 });
  }

  try {
    const keypair = await loadSavedWalletSigner(walletId, auth.userId);
    if (!keypair) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
    const publicKey = keypair.publicKey();
    const tx = TransactionBuilder.fromXDR(xdr, Networks.PUBLIC);
    const feeBump = tx instanceof FeeBumpTransaction;
    const inner = feeBump ? tx.innerTransaction : tx;
    if ((feeBump ? tx.feeSource : inner.source) !== publicKey) {
      return NextResponse.json({ error: "Transaction source does not match the selected wallet" }, { status: 400 });
    }
    const expiresAt = Number(inner.timeBounds?.maxTime);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + 300) {
      return NextResponse.json({ error: "Transaction must expire within five minutes; rebuild it and retry" }, { status: 400 });
    }

    let xlmAmount = Number(tx.fee) / 1e7;
    const destinations: string[] = [];
    if (!feeBump) {
      for (const op of inner.operations) {
        if (op.source && op.source !== publicKey) {
          return NextResponse.json({ error: "Operation source does not match the selected wallet" }, { status: 400 });
        }
        // Stellar SDK decodes these operations at runtime but omits them from its Operation union.
        if (["revokeAccountSponsorship", "revokeTrustlineSponsorship", "revokeSignerSponsorship"].includes(op.type)) continue;
        switch (op.type) {
          case "payment":
            destinations.push(op.destination);
            if (op.asset.isNative()) xlmAmount += Number(op.amount);
            break;
          case "createAccount":
            destinations.push(op.destination);
            xlmAmount += Number(op.startingBalance);
            break;
          case "pathPaymentStrictReceive":
            destinations.push(op.destination);
            if (op.sendAsset.isNative()) xlmAmount += Number(op.sendMax);
            break;
          case "pathPaymentStrictSend":
            destinations.push(op.destination);
            if (op.sendAsset.isNative()) xlmAmount += Number(op.sendAmount);
            break;
          case "createClaimableBalance":
            destinations.push(...op.claimants.map((claimant) => claimant.destination));
            if (op.asset.isNative()) xlmAmount += Number(op.amount);
            break;
          case "accountMerge": {
            if (inner.operations.length !== 1) return NextResponse.json({ error: "Account merge must be the only operation" }, { status: 400 });
            destinations.push(op.destination);
            let account;
            try {
              account = await new Horizon.Server("https://horizon.stellar.org").loadAccount(publicKey);
            } catch {
              return NextResponse.json({ error: "Could not verify the account balance with Horizon" }, { status: 503 });
            }
            const native = account.balances.find((balance) => balance.asset_type === "native");
            if (!native) return NextResponse.json({ error: "Could not verify the account balance" }, { status: 503 });
            xlmAmount += Number(native.balance);
            break;
          }
          case "changeTrust": break;
          case "claimClaimableBalance": break;
          case "setOptions":
            if (typeof op.homeDomain === "string" && op.homeDomain.length <= 32 &&
              ![op.clearFlags, op.setFlags, op.masterWeight, op.lowThreshold, op.medThreshold, op.highThreshold, op.inflationDest, op.signer].some((value) => value !== undefined)) break;
            return NextResponse.json({ error: "Only changing the home domain is supported here" }, { status: 400 });
          case "manageSellOffer":
            if (Number(op.amount) === 0 && op.offerId !== "0") break;
            return NextResponse.json({ error: "Only offer cancellation is supported here" }, { status: 400 });
          case "manageBuyOffer":
            if (Number(op.buyAmount) === 0 && op.offerId !== "0") break;
            return NextResponse.json({ error: "Only offer cancellation is supported here" }, { status: 400 });
          default:
            return NextResponse.json({ error: "This operation is not supported by saved-wallet signing" }, { status: 400 });
        }
      }
    }
    if (!Number.isFinite(xlmAmount) || xlmAmount < 0) {
      return NextResponse.json({ error: "Invalid transaction amount" }, { status: 400 });
    }
    const errors = await reserveMainnetSignature(auth.userId, tx.hash().toString("hex"), expiresAt,
      { destinations, operationCount: inner.operations.length + (feeBump ? 1 : 0), xlmAmount });
    if (errors.length) return NextResponse.json({ error: errors.join("; ") }, { status: 403 });
    tx.sign(keypair);
    return NextResponse.json({ xdr: tx.toXDR() });
  } catch (error) {
    if (error instanceof MainnetSigningBudgetUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof Error && error.message === "Could not load signing wallet") {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof Error && (error.message.startsWith("This wallet is watch-only") || error.message === "Saved key does not match the wallet address")) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Could not sign transaction; verify the saved key and transaction" }, { status: 400 });
  }
}
