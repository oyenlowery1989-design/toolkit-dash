// ---------------------------------------------------------------------------
// Tracer v2 — Bulk Trace runner
// ---------------------------------------------------------------------------
// Traces the origin of N accounts concurrently via a worker pool, reusing
// the existing (signed-off) `traceAccountOrigin` from intermediary-tracer.
// Injectable `traceFn` for tests — defaults to the real tracer.

import { traceAccountOrigin } from "@/lib/intermediary-tracer/fetchers";
import type { TraceResult } from "@/lib/intermediary-tracer/types";

export interface BulkTraceRow {
  address: string;
  status: "pending" | "done" | "error" | "not-found";
  result?: TraceResult;
  error?: string;
}

export interface BulkTraceOptions {
  addresses: string[];
  horizonUrl: string;
  windowSec: number;
  tolerancePct: number;
  knownIntermediaries: Map<string, string>;
  signal: AbortSignal;
  concurrency?: number; // default 4
  onLog?: (msg: string) => void;
  onResult: (row: BulkTraceRow) => void; // called on pending AND on settle (merge by address)
  // injectable for tests — defaults to the real tracer:
  traceFn?: typeof traceAccountOrigin;
}

export async function runBulkTrace(
  opts: BulkTraceOptions,
): Promise<BulkTraceRow[]> {
  const {
    addresses,
    horizonUrl,
    windowSec,
    tolerancePct,
    knownIntermediaries,
    signal,
    concurrency = 4,
    onLog,
    onResult,
    traceFn = traceAccountOrigin,
  } = opts;

  // Dedup addresses, preserve order.
  const deduped = Array.from(new Set(addresses));

  const rowsByAddress = new Map<string, BulkTraceRow>();
  for (const address of deduped) {
    const row: BulkTraceRow = { address, status: "pending" };
    rowsByAddress.set(address, row);
    onResult(row);
  }

  const queue = [...deduped];

  async function worker() {
    while (queue.length && !signal.aborted) {
      const addr = queue.shift();
      if (addr === undefined) break;

      let row: BulkTraceRow;
      try {
        const result = await traceFn(
          horizonUrl,
          addr,
          windowSec,
          tolerancePct,
          knownIntermediaries,
          signal,
          onLog,
        );
        row =
          result === null
            ? { address: addr, status: "not-found" }
            : { address: addr, status: "done", result };
      } catch (err) {
        if (signal.aborted) {
          // Abort mid-flight — do not mark as error, leave as-is.
          continue;
        }
        row = {
          address: addr,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        };
      }

      rowsByAddress.set(addr, row);
      onResult(row);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, deduped.length) }, worker),
  );

  return deduped.map((addr) => rowsByAddress.get(addr)!);
}
