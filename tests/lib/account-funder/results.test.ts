import { expect, it, vi } from "vitest";
import { resolveFundingFailure, summarizeFunderRun } from "@/lib/account-funder/results";

it("reports actual success, failure and unprocessed counts with appropriate severity", () => {
  expect(summarizeFunderRun("Funding", ["success", "success"], false)).toEqual({ tone: "success", message: "Funding complete: 2 succeeded, 0 failed." });
  expect(summarizeFunderRun("Funding", ["success", "failed"], false)).toEqual({ tone: "warning", message: "Funding complete: 1 succeeded, 1 failed." });
  expect(summarizeFunderRun("Closing", ["failed"], false).tone).toBe("error");
  expect(summarizeFunderRun("Funding", ["success", "pending", "pending"], true)).toEqual({ tone: "info", message: "Funding stopped: 1 succeeded, 0 failed, 2 not processed." });
});
it("counts an atomic failed batch only after verifying ambiguous op_success accounts", async () => {
  const verify = vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("404"));
  const results = await resolveFundingFailure(["existing", "confirmed", "missing", "failed"], ["op_already_exists", "op_success", "op_success", "op_underfunded"], verify);
  expect(results).toEqual([{ status: "funded" }, { status: "funded" }, { status: "failed", error: "unconfirmed on ledger" }, { status: "failed", error: "op_underfunded" }]);
  expect(verify.mock.calls).toEqual([["confirmed"], ["missing"]]);
  expect(summarizeFunderRun("Funding", results.map((r) => r.status === "funded" ? "success" : "failed"), false).message).toBe("Funding complete: 2 succeeded, 2 failed.");
});
it("does not count signing or generic submission errors as successes", async () => {
  const verify = vi.fn();
  expect(await resolveFundingFailure(["child"], ["Server policy disabled"], verify)).toEqual([{ status: "failed", error: "Server policy disabled" }]);
  expect(verify).not.toHaveBeenCalled();
});
