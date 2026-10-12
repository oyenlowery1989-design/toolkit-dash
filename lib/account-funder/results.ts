export type RunOutcome = "pending" | "success" | "failed";

export function summarizeFunderRun(label: string, outcomes: RunOutcome[], stopped: boolean) {
  const succeeded = outcomes.filter((status) => status === "success").length;
  const failed = outcomes.filter((status) => status === "failed").length;
  const pending = outcomes.length - succeeded - failed;
  const tone = failed ? (succeeded ? "warning" : "error") : stopped || pending ? "info" : "success";
  return {
    tone,
    message: `${label} ${stopped ? "stopped" : "complete"}: ${succeeded} succeeded, ${failed} failed${pending ? `, ${pending} not processed` : ""}.`,
  } as const;
}

/** Failed Stellar batches are atomic: op_success is not proof of creation. */
export async function resolveFundingFailure(
  addresses: string[], codes: string[], verify: (address: string) => Promise<unknown>,
): Promise<{ status: "funded" | "failed"; error?: string }[]> {
  const results: { status: "funded" | "failed"; error?: string }[] = [];
  for (let i = 0; i < addresses.length; i++) {
    const code = codes[i] ?? "unknown";
    if (code === "op_already_exists") {
      results.push({ status: "funded" });
    } else if (code === "op_success") {
      try {
        await verify(addresses[i]);
        results.push({ status: "funded" });
      } catch {
        results.push({ status: "failed", error: "unconfirmed on ledger" });
      }
    } else results.push({ status: "failed", error: code });
  }
  return results;
}
