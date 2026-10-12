import { Transaction } from "stellar-sdk";

/** Saved-wallet signing is restricted to the existing Asset Manager operation shapes. */
export function validateAssetManagerTransaction(tx: Transaction, publicKey: string, immutableConfirmed: unknown) {
  if (tx.source !== publicKey || tx.operations.length !== 1) throw new Error("Exactly one operation from the selected wallet is required");
  const now = Math.floor(Date.now() / 1000);
  const expiry = Number(tx.timeBounds?.maxTime);
  if (!Number.isFinite(expiry) || expiry <= now || expiry > now + 300) throw new Error("Transaction must expire within five minutes");
  const op = tx.operations[0];
  if (op.source && op.source !== publicKey) throw new Error("Operation source must match the selected wallet");
  let xlmAmount = Number(tx.fee) / 1e7;
  const destinations: string[] = [];
  switch (op.type) {
    case "setOptions": {
      if ([op.homeDomain, op.masterWeight, op.lowThreshold, op.medThreshold, op.highThreshold, op.inflationDest, op.signer].some(value => value !== undefined)) {
        throw new Error("Only issuer authorization flags may be changed");
      }
      const flag = op.setFlags ?? op.clearFlags;
      if (![1, 2, 4, 8].includes(Number(flag)) || (op.setFlags !== undefined && op.clearFlags !== undefined)) throw new Error("Only one authorization flag may be changed");
      if (flag === 4 && (op.clearFlags !== undefined || immutableConfirmed !== true)) throw new Error("Immutable flag requires explicit confirmation");
      break;
    }
    case "setTrustLineFlags":
      if (op.asset.getIssuer() !== publicKey || op.asset.isNative()) throw new Error("Only the selected issuer's trustlines may be changed");
      if (op.flags.clawbackEnabled !== undefined || typeof op.flags.authorized !== "boolean" || typeof op.flags.authorizedToMaintainLiabilities !== "boolean" || (op.flags.authorized && op.flags.authorizedToMaintainLiabilities)) {
        throw new Error("Unsupported trustline flags");
      }
      destinations.push(op.trustor);
      break;
    case "manageSellOffer":
    case "manageBuyOffer": {
      if (op.type === "manageSellOffer" ? (op.selling.isNative() || !op.buying.isNative()) : (!op.selling.isNative() || op.buying.isNative())) throw new Error("Offers must trade a custom asset against XLM");
      const amount = Number(op.type === "manageSellOffer" ? op.amount : op.buyAmount);
      const price = Number(op.price);
      if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(price) || price <= 0) throw new Error("Invalid offer amount or price");
      if ((amount === 0 && op.offerId === "0") || (amount > 0 && op.offerId !== "0")) throw new Error("Only creating and cancelling offers is supported");
      if (op.selling.isNative()) xlmAmount += op.type === "manageBuyOffer" ? amount * price : amount;
      break;
    }
    default: throw new Error("Operation is not supported by Asset Manager");
  }
  if (!Number.isFinite(xlmAmount) || xlmAmount < 0) throw new Error("Invalid XLM exposure");
  return { destinations, operationCount: 1, xlmAmount };
}
