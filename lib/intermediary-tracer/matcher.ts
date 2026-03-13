import type { FunderCandidate } from "./types";

// ---------------------------------------------------------------------------
// Confidence scoring
//
// confidence = amountScore × 0.7 + timeScore × 0.3
//
// amountScore: 100 when diff = 0%, falls linearly to 0 at diff = 5%
// timeScore:   100 when Δt = 0s, falls linearly to 50 at Δt = windowSec
// ---------------------------------------------------------------------------

export function scoreCandidate(
  sentAmount: number,
  startingBalance: number,
  sentAtIso: string,
  createdAtIso: string,
  windowSec: number,
): Pick<FunderCandidate, "timeDeltaSec" | "amountDiffPct" | "confidence"> {
  const createTime = new Date(createdAtIso).getTime();
  const sentTime = new Date(sentAtIso).getTime();
  const timeDeltaSec = (createTime - sentTime) / 1000;

  if (timeDeltaSec < 0 || timeDeltaSec > windowSec) {
    return { timeDeltaSec, amountDiffPct: 0, confidence: 0 };
  }

  const amountDiffPct =
    startingBalance > 0
      ? (Math.abs(sentAmount - startingBalance) / startingBalance) * 100
      : 100;

  // Amount score: 100 at 0% diff, 0 at ≥5% diff
  const amountScore = Math.max(0, 100 - amountDiffPct * 20);

  // Time score: 100 at Δt=0, 50 at Δt=windowSec
  const timeScore = 100 - (timeDeltaSec / windowSec) * 50;

  const confidence = Math.round(amountScore * 0.7 + timeScore * 0.3);

  return { timeDeltaSec, amountDiffPct, confidence };
}

// ---------------------------------------------------------------------------
// Cluster detection
// ---------------------------------------------------------------------------

/**
 * Given a list of results, find addresses that appear as top funder (index 0)
 * in multiple results — indicates a single actor creating many accounts.
 */
export function detectClusters(
  results: Array<{ candidates: FunderCandidate[]; startingBalance: number }>,
): Map<string, { count: number; totalFunded: number }> {
  const map = new Map<string, { count: number; totalFunded: number }>();
  for (const r of results) {
    const top = r.candidates[0];
    if (!top) continue;
    const existing = map.get(top.address) ?? { count: 0, totalFunded: 0 };
    map.set(top.address, {
      count: existing.count + 1,
      totalFunded: existing.totalFunded + r.startingBalance,
    });
  }
  // Return only addresses that appear more than once
  for (const [addr, data] of map) {
    if (data.count < 2) map.delete(addr);
  }
  return map;
}
