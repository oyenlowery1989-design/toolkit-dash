import type { AssetProceedsResult } from "@/lib/proceeds-investigator/types";
import { classifyAdPayment, type AdPaymentClassification } from "@/lib/saved-analyses/ad-payments";

export interface PaymentReviewAnalysis {
  id: string;
  assetCode: string;
  issuer: string;
  network: string;
  timestamp: number;
  result: AssetProceedsResult;
}

export interface PaymentReviewItem extends PaymentReviewAnalysis {
  classification: AdPaymentClassification;
  sharedEvidence: boolean;
}

export function summarizeAdPayments(analyses: PaymentReviewAnalysis[], recipient: string): {
  items: PaymentReviewItem[];
  uniquePaidXlm: number;
} {
  const latest = new Map<string, PaymentReviewAnalysis>();
  for (const analysis of analyses) {
    const key = `${analysis.assetCode}:${analysis.issuer}:${analysis.network}`;
    if ((latest.get(key)?.timestamp ?? -Infinity) < analysis.timestamp) latest.set(key, analysis);
  }
  const counts = new Map<string, number>();
  const classified = [...latest.values()].map((analysis) => {
    const classification = classifyAdPayment(analysis.result, recipient);
    for (const entry of classification.evidence) counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1);
    return { ...analysis, classification };
  });
  const paid = new Set<string>();
  let uniquePaidXlm = 0;
  const items = classified.map((item) => {
    for (const entry of item.classification.evidence) {
      if (!paid.has(entry.id)) {
        paid.add(entry.id);
        uniquePaidXlm += entry.amountXlm;
      }
    }
    return { ...item, sharedEvidence: item.classification.evidence.some((entry) => (counts.get(entry.id) ?? 0) > 1) };
  });
  return { items, uniquePaidXlm };
}
