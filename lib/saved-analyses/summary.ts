import type { SavedAnalysis, SavedAnalysisSummary } from "@/hooks/use-saved-analyses";

export function summarizeSavedAnalysis(analysis: SavedAnalysis): SavedAnalysisSummary {
  if (!analysis.result || typeof analysis.result !== "object") return analysis;
  const { proceedsLedger: _proceeds, outgoingLedger, ...result } = analysis.result;
  const amounts = new Map<string, { account: string; to: string; amountXlm: number; successful: true }>();
  const destinations = new Set((Array.isArray(result.topDestinations) ? result.topDestinations : []).map((d) => d.address));
  for (const entry of Array.isArray(outgoingLedger) ? outgoingLedger : []) {
    if (!entry || typeof entry !== "object") continue;
    const account = entry.from ?? entry.account;
    if (!entry.successful || typeof entry.to !== "string" || !destinations.has(entry.to) || !analysis.distribAddresses?.includes(account)) continue;
    const key = `${account}:${entry.to}`;
    const amount = amounts.get(key);
    if (amount) amount.amountXlm += entry.amountXlm;
    else amounts.set(key, { account, to: entry.to, amountXlm: entry.amountXlm, successful: true });
  }
  return { ...analysis, result, graphOutgoing: [...amounts.values()], hasOutgoingLedger: !!outgoingLedger?.length };
}
