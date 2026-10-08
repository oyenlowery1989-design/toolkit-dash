import { assertExecutionLease } from "@/lib/execution-context";
import { verifyEnvelopeSignatures, baseAddress } from "@/lib/transaction-signatures";
import { Horizon, Networks, TransactionBuilder } from "stellar-sdk";
import { getMainnetSafetyConfig, validateMainnetRun } from "@/lib/mainnet-safety";
import { transactionIntent, toStroops, type SignedTransaction } from "@/lib/transaction-policy";
import { reserveExecution, readExecution, finishExecution } from "@/lib/transaction-budget";

/** The only place the application may submit classic transactions to Horizon. */
export async function executeMainnetTransaction(transaction: SignedTransaction, sorobanSubmit?: (tx: SignedTransaction) => Promise<unknown>) {
  // Decode again: never trust a caller-supplied intent or network object.
  const tx = TransactionBuilder.fromXDR(transaction.toXDR(), Networks.PUBLIC);
  const safety = getMainnetSafetyConfig();
  const gateErrors = validateMainnetRun({ destinations: [], operationCount: 0, xlmAmount: 0 });
  if (gateErrors.length) throw new Error(gateErrors.join("; "));
  const server = new Horizon.Server("https://horizon.stellar.org");
  const intent = await transactionIntent(tx, async (address) => {
    const account = await server.loadAccount(address);
    return account.balances.find((b) => b.asset_type === "native")?.balance ?? "0";
  });
  const errors = validateMainnetRun(intent);
  if (errors.length) throw new Error(errors.join("; "));
  await assertExecutionLease();
  await verifyEnvelopeSignatures(tx, (address) => server.loadAccount(address));
  const hash = tx.hash().toString("hex");
  const reserved = await reserveExecution(hash, baseAddress(intent.source), intent.stroops, toStroops(safety.maxXlmPerDay.toFixed(7)));
  if (!reserved) {
    const existing = await readExecution(hash);
    if (existing?.status === "submitted" && existing.result_json) return JSON.parse(existing.result_json);
    throw new Error(`Transaction ${hash} is already recorded; reconcile its outcome before retrying`);
  }
  // A durable reservation survives crashes and uncertain network responses.
  let result;
  let submissionStarted = false;
  try {
    await assertExecutionLease();
    // Recheck incident controls immediately before submission.
    const lateErrors = validateMainnetRun(intent);
    if (lateErrors.length) {
      throw new Error(lateErrors.join("; "));
    }
    submissionStarted = true;
    result = sorobanSubmit ? await sorobanSubmit(tx) : await server.submitTransaction(tx);
  } catch (error) {
    // Only an explicit ledger rejection permits another transaction. Timeouts/5xx
    // retain a budget hold and block this source pending reconciliation.
    const codes = (error as { response?: { status?: number; data?: { extras?: { result_codes?: { transaction?: string } } } } })?.response;
    const rejected = !submissionStarted || (codes?.status === 400 && Boolean(codes.data?.extras?.result_codes));
    const record = await readExecution(hash);
    if (record?.status === "reserved") await finishExecution(hash, rejected ? "rejected" : "unknown", undefined, rejected ? (codes?.data?.extras?.result_codes?.transaction === "tx_failed" ? BigInt(tx.fee) : 0n) : undefined);
    throw error;
  }
  try { await finishExecution(hash, "submitted", result); }
  catch {
    // Do not report a submitted transaction as safely retryable.
    throw new Error(`Transaction ${hash} was submitted but accounting failed. Reconcile before retrying.`);
  }
  return result;
}
