import { Asset, Operation, xdr } from "stellar-sdk";
import type { RevokableItem } from "./fetchers";

export function buildRevokeOp(item: RevokableItem): xdr.Operation {
  switch (item.kind) {
    case "account":
      return Operation.revokeAccountSponsorship({ account: item.address });
    case "trustline":
      return Operation.revokeTrustlineSponsorship({
        account: item.address,
        asset: new Asset(item.assetCode!, item.assetIssuer!),
      });
    case "signer":
      return Operation.revokeSignerSponsorship({
        account: item.address,
        signer: { ed25519PublicKey: item.signerKey! },
      });
  }
}

// Stellar caps 100 ops/tx — stay under it to leave headroom for fee/signature overhead.
const MAX_OPS_PER_TX = 90;

export function chunkItems(items: RevokableItem[]): RevokableItem[][] {
  const chunks: RevokableItem[][] = [];
  for (let i = 0; i < items.length; i += MAX_OPS_PER_TX) {
    chunks.push(items.slice(i, i + MAX_OPS_PER_TX));
  }
  return chunks;
}
