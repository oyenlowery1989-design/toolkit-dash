import { describe, it, expect } from "vitest";
import { scoreCandidate } from "../../../lib/intermediary-tracer/matcher";

/** Produce an ISO string offset by `offsetSec` seconds from `base`. */
function isoAt(base: string, offsetSec: number): string {
  const t = new Date(base).getTime() + offsetSec * 1000;
  return new Date(t).toISOString();
}

const BASE = "2024-01-01T00:00:00.000Z";
const WINDOW = 300; // 5 minutes

// ---------------------------------------------------------------------------
// Timing tests
// ---------------------------------------------------------------------------

describe("scoreCandidate — timing", () => {
  it("returns confidence=0 when createdAt is BEFORE sentAt (negative timeDelta)", () => {
    const sentAt = BASE;
    const createdAt = isoAt(BASE, -60); // 60s before sent

    const result = scoreCandidate(100, 100, sentAt, createdAt, WINDOW);

    expect(result.confidence).toBe(0);
    expect(result.timeDeltaSec).toBeLessThan(0);
  });

  it("returns confidence=0 when timeDelta exceeds window", () => {
    const sentAt = BASE;
    const createdAt = isoAt(BASE, WINDOW + 1); // 1 second past window

    const result = scoreCandidate(100, 100, sentAt, createdAt, WINDOW);

    expect(result.confidence).toBe(0);
    expect(result.timeDeltaSec).toBeGreaterThan(WINDOW);
  });

  it("returns confidence>0 when timeDelta is within window", () => {
    const sentAt = BASE;
    const createdAt = isoAt(BASE, 60); // 60s after sent, within 300s window

    const result = scoreCandidate(100, 100, sentAt, createdAt, WINDOW);

    expect(result.confidence).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Amount tests
// ---------------------------------------------------------------------------

describe("scoreCandidate — amounts", () => {
  it("returns amountDiffPct=0 and confidence>50 when amounts match exactly, timeDelta=0", () => {
    // amountScore=100, timeScore=100 → confidence=round(70+30)=100
    const result = scoreCandidate(100, 100, BASE, BASE, WINDOW);

    expect(result.amountDiffPct).toBe(0);
    expect(result.confidence).toBeGreaterThan(50);
  });

  it("returns amountDiffPct≈10 when amounts differ by 10%", () => {
    // sentAmount=100, startingBalance=110 → diff=10/110*100≈9.09%
    // Use startingBalance=100, sentAmount=110 → diff=10/100*100=10%
    const result = scoreCandidate(110, 100, BASE, BASE, WINDOW);

    expect(result.amountDiffPct).toBeCloseTo(10, 5);
  });

  it("does not crash when startingBalance=0 (handles divide-by-zero)", () => {
    // startingBalance=0 → amountDiffPct=100 (special case in impl)
    // amountScore=max(0,100-2000)=0, timeScore=100 → confidence=round(0+30)=30
    const result = scoreCandidate(100, 0, BASE, BASE, WINDOW);

    expect(result.amountDiffPct).toBe(100);
    expect(result.confidence).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// timeDeltaSec field tests
// ---------------------------------------------------------------------------

describe("scoreCandidate — timeDeltaSec field", () => {
  it("reports correct positive timeDelta when createdAt is N seconds after sentAt", () => {
    const N = 120;
    const sentAt = BASE;
    const createdAt = isoAt(BASE, N);

    const result = scoreCandidate(100, 100, sentAt, createdAt, WINDOW);

    expect(result.timeDeltaSec).toBe(N);
  });

  it("reports negative timeDelta when createdAt is before sentAt", () => {
    const N = 45;
    const sentAt = BASE;
    const createdAt = isoAt(BASE, -N);

    const result = scoreCandidate(100, 100, sentAt, createdAt, WINDOW);

    expect(result.timeDeltaSec).toBe(-N);
  });
});
