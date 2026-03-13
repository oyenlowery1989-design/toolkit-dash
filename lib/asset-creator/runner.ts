// lib/asset-creator/runner.ts
import { TransactionBuilder } from "stellar-sdk";
import type { Horizon } from "stellar-sdk";
import type {
  AssetCreatorForm,
  SignedTx,
  StepResult,
  CreationStrategy,
} from "./types";

const FRIENDBOT_URL = "https://friendbot.stellar.org";

export interface RunAssetCreationOptions {
  strategy: CreationStrategy;
  server: Horizon.Server;
  networkPassphrase: string;
  signal: AbortSignal;
  onLog: (msg: string) => void;
  onStep: (result: StepResult) => void;
}

/**
 * Orchestrates all steps: friendbot (testnet) or fund-accounts tx (mainnet),
 * then set-home-domain, trustline, issuance.
 *
 * Calls onStep after each transaction with its result.
 * On failure, stops and returns current results — caller handles retry.
 */
export async function runAssetCreation(
  form: AssetCreatorForm,
  completedStepIds: Set<SignedTx["stepId"]>,
  options: RunAssetCreationOptions,
): Promise<StepResult[]> {
  const { strategy, server, networkPassphrase, signal, onLog, onStep } = options;
  const results: StepResult[] = [];

  const allSteps: Array<SignedTx["stepId"]> = [
    "fund-accounts",
    "set-home-domain",
    "trustline",
    "issuance",
  ];

  const remainingSteps = allSteps.filter((s) => !completedStepIds.has(s));

  for (const stepId of remainingSteps) {
    if (signal.aborted) break;

    // Skip set-home-domain if no home domain provided
    if (stepId === "set-home-domain" && !form.homeDomain) {
      const skipped: StepResult = { stepId, status: "skipped" };
      results.push(skipped);
      onStep(skipped);
      continue;
    }

    // Handle fund-accounts step
    if (stepId === "fund-accounts") {
      if (form.network === "testnet") {
        // Testnet: use friendbot for each account
        for (const addr of [form.issuerPublicKey, form.distributorPublicKey]) {
          const url = `${FRIENDBOT_URL}?addr=${addr}`;
          onLog(`  GET ${url}`);
          try {
            const res = await fetch(url, { signal });
            const body = await res.json().catch(() => ({}));
            const alreadyExists =
              !res.ok &&
              JSON.stringify(body).includes("createAccountAlreadyExist");
            if (!res.ok && !alreadyExists) {
              const err: StepResult = {
                stepId: "friendbot",
                status: "failed",
                error: `Friendbot failed for ${addr.slice(0, 4)}…${addr.slice(-4)}: ${JSON.stringify(body)}`,
              };
              results.push(err);
              onStep(err);
              return results;
            }
          } catch (e) {
            if (signal.aborted) break;
            const err: StepResult = {
              stepId: "friendbot",
              status: "failed",
              error: `Friendbot request failed: ${String(e)}`,
            };
            results.push(err);
            onStep(err);
            return results;
          }
        }
        const ok: StepResult = { stepId: "fund-accounts", status: "success" };
        results.push(ok);
        onStep(ok);
        continue;
      }
      // else fall through to standard tx submission below
    }

    // Build and submit transaction
    const running: StepResult = { stepId, status: "running" };
    onStep(running);

    try {
      const txns = await strategy.buildTransactions(
        form,
        [stepId],
        server,
        networkPassphrase,
        signal,
      );

      if (txns.length === 0) {
        // strategy returned nothing (e.g. set-home-domain with empty domain — shouldn't happen here)
        const skipped: StepResult = { stepId, status: "skipped" };
        results.push(skipped);
        onStep(skipped);
        continue;
      }

      for (const signedTx of txns) {
        onLog(`  Submitting tx: ${signedTx.label}`);
        const tx = TransactionBuilder.fromXDR(signedTx.xdr, networkPassphrase);
        const submitted = await server.submitTransaction(tx);
        const hash = (submitted as { hash?: string }).hash ?? "";
        onLog(`  ✓ ${signedTx.label}: ${hash}`);

        const ok: StepResult = { stepId, status: "success", txHash: hash };
        results.push(ok);
        onStep(ok);
      }
    } catch (e: unknown) {
      if (signal.aborted) break;

      // Check for op_already_exists (skippable on fund-accounts)
      const errStr = JSON.stringify(e);
      if (stepId === "fund-accounts" && errStr.includes("op_already_exists")) {
        const ok: StepResult = { stepId, status: "success" };
        results.push(ok);
        onStep(ok);
        continue;
      }

      const failed: StepResult = {
        stepId,
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
      };
      results.push(failed);
      onStep(failed);
      return results; // stop on failure
    }
  }

  return results;
}
