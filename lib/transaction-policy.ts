import { FeeBumpTransaction, Transaction, type Operation } from "stellar-sdk";

export type SignedTransaction = Transaction | FeeBumpTransaction;
const STROOPS = 10_000_000n;
/** Parse ledger precision without floating point rounding or negative/NaN bypasses. */
export function toStroops(value: string): bigint {
  if (!/^\d+(?:\.\d{1,7})?$/.test(value)) throw new Error("Invalid XLM amount");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * STROOPS + BigInt(fraction.padEnd(7, "0"));
}
export function fromStroops(value: bigint): number { return Number(value) / Number(STROOPS); }

export async function transactionIntent(tx: SignedTransaction, nativeBalance: (address: string) => Promise<string>) {
  const inner = tx instanceof FeeBumpTransaction ? tx.innerTransaction : tx;
  if (inner.networkPassphrase !== "Public Global Stellar Network ; September 2015") throw new Error("Only mainnet is supported");
  if (!inner.timeBounds || inner.timeBounds.maxTime === "0") throw new Error("A finite transaction timeout is required");
  let amount = BigInt(tx.fee); // Include fee bump and Soroban resource fees.
  const destinations = new Set<string>();
  let unboundedDestinations = false;
  for (const [index, op] of inner.operations.entries()) {
    switch (op.type) {
      case "payment":
        destinations.add(op.destination);
        if (op.asset.isNative()) amount += toStroops(op.amount);
        break;
      case "createAccount":
        destinations.add(op.destination); amount += toStroops(op.startingBalance); break;
      case "pathPaymentStrictSend":
        destinations.add(op.destination);
        if (op.sendAsset.isNative()) amount += toStroops(op.sendAmount);
        break;
      case "pathPaymentStrictReceive":
        destinations.add(op.destination);
        if (op.sendAsset.isNative()) amount += toStroops(op.sendMax);
        break;
      case "createClaimableBalance":
        op.claimants.forEach((c) => destinations.add(c.destination));
        if (op.asset.isNative()) amount += toStroops(op.amount);
        break;
      case "accountMerge":
        // Mixed operations can increase the balance after inspection (claims/trades).
        if (inner.operations.length !== 1) throw new Error("Account merge must be submitted alone for safe accounting");
        destinations.add(op.destination);
        amount += toStroops(await nativeBalance(op.source ?? inner.source));
        break;
      case "manageSellOffer": case "createPassiveSellOffer":
        if (toStroops(op.amount) > 0n) unboundedDestinations = true;
        if (op.selling.isNative()) amount += toStroops(op.amount);
        break;
      case "manageBuyOffer":
        if (toStroops(op.buyAmount) > 0n) unboundedDestinations = true;
        if (op.selling.isNative()) {
          // SDK's decoded price is rational text; round the maximum liability upward.
          const envelope = inner.toEnvelope();
          const operations = envelope.switch().name === "envelopeTypeTxV0"
            ? envelope.v0().tx().operations() : envelope.v1().tx().operations();
          const price = operations[index].body().manageBuyOfferOp().price();
          const buy = toStroops(op.buyAmount), numerator = BigInt(price.n()), denominator = BigInt(price.d());
          if (numerator < 0n || denominator <= 0n) throw new Error("Invalid offer price");
          amount += (buy * numerator + denominator - 1n) / denominator;
        }
        break;
      case "beginSponsoringFutureReserves": destinations.add(op.sponsoredId); break;
      case "allowTrust": case "setTrustLineFlags": destinations.add(op.trustor); break;
      case "clawback": destinations.add(op.from); break;
      case "setOptions":
        break;
      case "invokeHostFunction":
        // Arbitrary contracts can move XLM without classic payment operations.
        if (op.func.switch().name !== "hostFunctionTypeCreateContract"
          || op.func.createContract().contractIdPreimage().switch().name !== "contractIdPreimageFromAsset") {
          throw new Error("Only Stellar Asset Contract creation is supported by this submission policy");
        }
        break;
      case "changeTrust": case "manageData": case "bumpSequence": case "claimClaimableBalance":
      case "clawbackClaimableBalance": case "endSponsoringFutureReserves": case "revokeSponsorship":
        break;
      default:
        throw new Error(`Operation ${(op as Operation).type} requires an explicit spending policy`);
    }
  }
  if (amount < 0n || amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Transaction exceeds supported accounting range");
  return { unboundedDestinations, destinations: [...destinations], operationCount: inner.operations.length, xlmAmount: fromStroops(amount), stroops: amount, source: inner.source };
}
