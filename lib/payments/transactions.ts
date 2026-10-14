import { Account, Asset, Claimant, Memo, Operation, TransactionBuilder } from "stellar-sdk";
import { assetFromKey } from "./helpers";
import type { PaymentLeg, PathRecord, PathMode, ClaimantEntry } from "./types";

export interface PaymentOffer {
  id: string;
  price: string;
  selling: { asset_type: string; asset_code?: string; asset_issuer?: string };
  buying: { asset_type: string; asset_code?: string; asset_issuer?: string };
}

export interface PathPaymentInput {
  selectedPath: PathRecord;
  pathMode: PathMode;
  srcIsNative: boolean;
  srcAssetCode: string;
  srcAssetIssuer: string;
  destIsNative: boolean;
  destAssetCode: string;
  destAssetIssuer: string;
  maxSendAmount: string;
  pathDest: string;
  destAmount: string;
  exactSendAmount: string;
  minReceiveAmount: string;
}

export function addSendOperations(builder: TransactionBuilder, legs: PaymentLeg[], offers: PaymentOffer[]): number[] {
  const cancelCounts: number[] = [];
  const cancelledOffers = new Set<string>();
  for (const leg of legs) {
    let cancelCount = 0;
    // If removing trustline, cancel any open offers for this asset first —
    // both the selling side AND the buying side, since either leaves
    // liabilities that block changeTrust(limit: "0").
    if (leg.removeTrustline && leg.assetKey !== "native") {
      const [code, issuer] = leg.assetKey.split(":");
      const sellOffersToCancel = offers.filter((o: any) => {
        const selling = o.selling;
        return selling.asset_type !== "native" && selling.asset_code === code && selling.asset_issuer === issuer;
      });
      for (const o of sellOffersToCancel) {
        if (cancelledOffers.has(o.id)) continue;
        const buyingAsset = (o as any).buying.asset_type === "native"
          ? Asset.native()
          : new Asset((o as any).buying.asset_code, (o as any).buying.asset_issuer);
        builder.addOperation(
          Operation.manageSellOffer({
            selling: assetFromKey(leg.assetKey),
            buying: buyingAsset,
            amount: "0",
            price: (o as any).price,
            offerId: (o as any).id,
          }),
        );
        cancelCount++;
        cancelledOffers.add(o.id);
      }
      const buyOffersToCancel = offers.filter((o: any) => {
        const buying = o.buying;
        return buying.asset_type !== "native" && buying.asset_code === code && buying.asset_issuer === issuer;
      });
      for (const o of buyOffersToCancel) {
        if (cancelledOffers.has(o.id)) continue;
        const sellingAsset = (o as any).selling.asset_type === "native"
          ? Asset.native()
          : new Asset((o as any).selling.asset_code, (o as any).selling.asset_issuer);
        builder.addOperation(
          Operation.manageBuyOffer({
            selling: sellingAsset,
            buying: assetFromKey(leg.assetKey),
            buyAmount: "0",
            price: (o as any).price,
            offerId: (o as any).id,
          }),
        );
        cancelCount++;
        cancelledOffers.add(o.id);
      }
    }
    cancelCounts.push(cancelCount);
    builder.addOperation(
      Operation.payment({
        destination: leg.destination.trim(),
        asset: assetFromKey(leg.assetKey),
        amount: leg.amount,
      }),
    );
    if (leg.removeTrustline && leg.assetKey !== "native") {
      builder.addOperation(
        Operation.changeTrust({ asset: assetFromKey(leg.assetKey), limit: "0" }),
      );
    }
  }

  return cancelCounts;
}

export function addPathOperation(builder: TransactionBuilder, {
  selectedPath,
  pathMode,
  srcIsNative,
  srcAssetCode,
  srcAssetIssuer,
  destIsNative,
  destAssetCode,
  destAssetIssuer,
  maxSendAmount,
  pathDest,
  destAmount,
  exactSendAmount,
  minReceiveAmount,
}: PathPaymentInput): void {
  const sendAsset = srcIsNative ? Asset.native() : new Asset(srcAssetCode.trim(), srcAssetIssuer.trim());
  const receiveAsset = destIsNative ? Asset.native() : new Asset(destAssetCode.trim(), destAssetIssuer.trim());
  const intermediaryPath = selectedPath.path.map((p) =>
    p.asset_type === "native" ? Asset.native() : new Asset(p.asset_code!, p.asset_issuer!),
  );
  if (pathMode === "strict-receive") {
    builder.addOperation(
      Operation.pathPaymentStrictReceive({
        sendAsset,
        sendMax: maxSendAmount,
        destination: pathDest.trim(),
        destAsset: receiveAsset,
        destAmount,
        path: intermediaryPath,
      }),
    );
  } else {
    builder.addOperation(
      Operation.pathPaymentStrictSend({
        sendAsset,
        sendAmount: exactSendAmount,
        destination: pathDest.trim(),
        destAsset: receiveAsset,
        destMin: minReceiveAmount,
        path: intermediaryPath,
      }),
    );
  }

}

export function addClaimableBalanceOperation(builder: TransactionBuilder, claimAssetKey: string, claimAmount: string, claimants: ClaimantEntry[]): void {
  builder.addOperation(
    Operation.createClaimableBalance({
      asset: assetFromKey(claimAssetKey),
      amount: claimAmount,
      claimants: claimants.map(
        (c) => new Claimant(c.destination.trim(), Claimant.predicateUnconditional()),
      ),
    }),
  );
}

export function addPaymentMemo(builder: TransactionBuilder, memoValue: string): void {
  if (memoValue.trim()) builder.addMemo(Memo.text(memoValue.trim()));
}

export function buildCreateAccountTransaction(account: Account, fee: string, networkPassphrase: string, destination: string, startingBalance: string, memoValue: string) {
  const builder = new TransactionBuilder(account, { fee, networkPassphrase });
  builder.addOperation(Operation.createAccount({ destination: destination.trim(), startingBalance }));
  addPaymentMemo(builder, memoValue);
  return builder.setTimeout(30).build();
}

export function buildTrustlineTransaction(account: Account, fee: string, networkPassphrase: string, assetKey: string) {
  return new TransactionBuilder(account, { fee, networkPassphrase })
    .addOperation(Operation.changeTrust({ asset: assetFromKey(assetKey) }))
    .setTimeout(30)
    .build();
}
