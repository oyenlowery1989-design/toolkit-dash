import { describe, it, expect, vi } from "vitest";
import { runBulkTrace, type BulkTraceRow } from "@/lib/tracer-v2/bulk-trace";
import type { TraceResult } from "@/lib/intermediary-tracer/types";

const fakeResult = (addr: string): TraceResult => ({
  targetAccount: addr, createdAt: "2020-01-01T00:00:00Z", startingBalance: 1,
  creator: "GCREATOR", isKnownIntermediary: false, candidates: [], noNativeCandidates: false,
});
const base = {
  horizonUrl: "h", windowSec: 60, tolerancePct: 5,
  knownIntermediaries: new Map<string, string>(),
  signal: new AbortController().signal,
};

describe("runBulkTrace", () => {
  it("dedups addresses and returns one row each in input order", async () => {
    const traceFn = vi.fn(async (_h, a: string) => fakeResult(a)) as any;
    const rows: BulkTraceRow[] = [];
    const out = await runBulkTrace({ ...base, addresses: ["GA", "GB", "GA"], onResult: r => rows.push(r), traceFn });
    expect(out.map(r => r.address)).toEqual(["GA", "GB"]);
    expect(out.every(r => r.status === "done")).toBe(true);
  });

  it("maps null to not-found and thrown error to error", async () => {
    const traceFn = vi.fn(async (_h, a: string) => {
      if (a === "GNULL") return null;
      if (a === "GERR") throw new Error("boom");
      return fakeResult(a);
    }) as any;
    const out = await runBulkTrace({ ...base, addresses: ["GOK", "GNULL", "GERR"], onResult: () => {}, traceFn });
    const byAddr = Object.fromEntries(out.map(r => [r.address, r]));
    expect(byAddr["GOK"].status).toBe("done");
    expect(byAddr["GNULL"].status).toBe("not-found");
    expect(byAddr["GERR"].status).toBe("error");
    expect(byAddr["GERR"].error).toContain("boom");
  });

  it("emits a pending row before the settled row for each address", async () => {
    const traceFn = vi.fn(async (_h, a: string) => fakeResult(a)) as any;
    const statuses: string[] = [];
    await runBulkTrace({ ...base, addresses: ["GA"], onResult: r => statuses.push(r.status), traceFn });
    expect(statuses[0]).toBe("pending");
    expect(statuses[statuses.length - 1]).toBe("done");
  });

  it("stops dispatching when the signal is already aborted", async () => {
    const ac = new AbortController(); ac.abort();
    const traceFn = vi.fn(async (_h, a: string) => fakeResult(a)) as any;
    const out = await runBulkTrace({ ...base, signal: ac.signal, addresses: ["GA", "GB"], onResult: () => {}, traceFn });
    // no addresses processed to "done" (pending may be emitted, but traceFn never called)
    expect(traceFn).not.toHaveBeenCalled();
    expect(out.every(r => r.status !== "done")).toBe(true);
  });

  it("respects the concurrency cap", async () => {
    let active = 0, peak = 0;
    const traceFn = vi.fn(async (_h, a: string) => {
      active++; peak = Math.max(peak, active);
      await new Promise(r => setTimeout(r, 5));
      active--; return fakeResult(a);
    }) as any;
    await runBulkTrace({ ...base, addresses: ["A","B","C","D","E","F"], concurrency: 2, onResult: () => {}, traceFn });
    expect(peak).toBeLessThanOrEqual(2);
  });
});
