import { FeeBumpTransaction, Horizon, Transaction } from "stellar-sdk";
import { getMainnetSafetyConfig } from "@/lib/mainnet-safety";
import type { MainnetRunIntent } from "@/lib/mainnet-safety";

type SignedTransaction = Transaction | FeeBumpTransaction;

export async function mainnetSubmissionIntent(tx: SignedTransaction): Promise<MainnetRunIntent> {
  const inner = tx instanceof FeeBumpTransaction ? tx.innerTransaction : tx;
  const destinations: string[] = [];
  let xlmAmount = Number(tx.fee) / 1e7;
  const mergeSources = new Set<string>();

  if (inner.operations.some((op) => op.type === "beginSponsoringFutureReserves" || op.type === "endSponsoringFutureReserves")) {
    if (inner.operations.length % 3 !== 0) throw new Error("Unsupported sponsorship transaction");
    for (let i = 0; i < inner.operations.length; i += 3) {
      const [begin, create, end] = inner.operations.slice(i, i + 3);
      if (begin.type !== "beginSponsoringFutureReserves" || create.type !== "createAccount" ||
        end.type !== "endSponsoringFutureReserves" || begin.sponsoredId !== create.destination ||
        end.source !== begin.sponsoredId || create.startingBalance !== "0.0000001") {
        throw new Error("Unsupported sponsorship transaction");
      }
    }
  }

  for (const op of inner.operations) {
    // The SDK decodes revoke sponsorship operations but omits them from its public union.
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
      case "accountMerge":
        destinations.push(op.destination);
        mergeSources.add(op.source ?? inner.source);
        break;
      case "manageSellOffer":
        if (Number(op.amount) > 0 && getMainnetSafetyConfig().allowedDestinations.size) {
          throw new Error("DEX counterparties cannot be verified against the mainnet destination allowlist");
        }
        if (op.selling.isNative()) xlmAmount += Number(op.amount);
        break;
      case "manageBuyOffer":
        if (Number(op.buyAmount) > 0 && getMainnetSafetyConfig().allowedDestinations.size) {
          throw new Error("DEX counterparties cannot be verified against the mainnet destination allowlist");
        }
        if (op.selling.isNative()) xlmAmount += Number(op.buyAmount) * Number(op.price);
        break;
      case "beginSponsoringFutureReserves":
        destinations.push(op.sponsoredId);
        xlmAmount += 1;
        break;
      case "changeTrust":
      case "claimClaimableBalance":
      case "endSponsoringFutureReserves":
      case "setOptions":
        break;
      case "setTrustLineFlags":
        destinations.push(op.trustor);
        break;
      default:
        throw new Error(`Unsupported transaction operation: ${op.type}`);
    }
  }

  if (mergeSources.size) {
    if (inner.operations.length !== 1) throw new Error("Account merge must be the only operation");
    const server = new Horizon.Server("https://horizon.stellar.org");
    for (const source of mergeSources) {
      let account;
      try { account = await server.loadAccount(source); }
      catch { throw new Error("Could not verify the account balance with Horizon"); }
      const native = account.balances.find((balance) => balance.asset_type === "native");
      if (!native) throw new Error("Could not verify the account balance with Horizon");
      xlmAmount += Number(native.balance);
    }
  }

  if (!Number.isFinite(xlmAmount) || xlmAmount < 0 || !destinations.every((address) => typeof address === "string" && address.length > 0)) {
    throw new Error("Invalid transaction amount or destination");
  }
  return { destinations, operationCount: inner.operations.length + (tx instanceof FeeBumpTransaction ? 1 : 0), xlmAmount };
}
