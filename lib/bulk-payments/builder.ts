import {
  TransactionBuilder,
  Operation,
  Asset,
  Memo,
  Keypair,
  type Account,
  type Transaction,
} from "stellar-sdk";

/** 1 stroop — the minimum native payment amount. */
export const MIN_PAYMENT_AMOUNT = "0.0000001";

/** Max operations per transaction on Stellar. */
export const BATCH_SIZE = 100;

/** Base fee per operation in stroops. */
export const BASE_FEE = "100";

/**
 * Build and sign a single batch transaction.
 *
 * NOTE: TransactionBuilder calls `account.incrementSequenceNumber()` internally
 * during `build()`. The caller must manage the Account object lifecycle across
 * batches (reload after failures so sequence stays in sync with the network).
 */
export function buildBatchTransaction(
  account: Account,
  recipients: string[],
  memo: string,
  keypair: Keypair,
  networkPassphrase: string,
  feeMultiplier: number = 1,
  amount: string = MIN_PAYMENT_AMOUNT,
  asset: Asset = Asset.native(),
): Transaction {
  const fee = String(parseInt(BASE_FEE) * Math.max(1, Math.round(feeMultiplier)));
  const builder = new TransactionBuilder(account, {
    fee,
    networkPassphrase,
  });

  for (const destination of recipients) {
    builder.addOperation(
      Operation.payment({
        destination,
        asset,
        amount,
      }),
    );
  }

  const trimmed = memo.trim();
  if (trimmed) {
    builder.addMemo(Memo.text(trimmed));
  }

  // Always use valid timebounds so the tx reaches the ledger.
  // Ghost mode op-level failures (op_no_trust etc.) are handled by the caller.
  const tx = builder.setTimeout(30).build();
  tx.sign(keypair);
  return tx;
}

/** Estimate total XLM cost before sending. */
export function estimateCost(
  recipientCount: number,
  batchSize: number = BATCH_SIZE,
  feeMultiplier: number = 1,
  /** XLM amount per recipient (0 for non-native assets). */
  paymentXlmEach: number = parseFloat(MIN_PAYMENT_AMOUNT),
): {
  batches: number;
  feesXlm: number;
  paymentsXlm: number;
  totalXlm: number;
} {
  const batches = Math.ceil(recipientCount / batchSize);
  const feePerOp = parseInt(BASE_FEE) * Math.max(1, Math.round(feeMultiplier));
  const feesXlm = (recipientCount * feePerOp) / 1e7;
  const paymentsXlm = recipientCount * paymentXlmEach;
  return { batches, feesXlm, paymentsXlm, totalXlm: feesXlm + paymentsXlm };
}
