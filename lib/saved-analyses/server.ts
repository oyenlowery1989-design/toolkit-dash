import type { SavedAnalysis } from "@/hooks/use-saved-analyses";
import { summarizeSavedAnalysis } from "@/lib/saved-analyses/summary";
import { getSupabase } from "@/lib/supabase-server";

/** Read full history for export and startup sync; callers can request a bounded page. */
export async function readSavedAnalysisRows(userId: string, limit?: number): Promise<{
  data: Record<string, unknown>[] | null;
  error: { message: string } | null;
}> {
  const sb = getSupabase()!;
  const rows: Record<string, unknown>[] = [];
  const pageSize = Math.min(limit ?? 1000, 1000);
  let cursor: { timestamp: unknown; id: unknown } | undefined;
  for (;;) {
    let query = sb.from("saved_analyses")
      .select("*", { count: "exact" })
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (cursor) query = query.or(`created_at.lt.${cursor.timestamp},and(created_at.eq.${cursor.timestamp},id.lt.${JSON.stringify(cursor.id)})`);
    const { data, error, count } = await query.range(0, pageSize - 1);
    if (error) return { data: null, error };
    if (count == null) return { data: null, error: { message: "Saved analysis row count is unavailable. Please retry." } };
    if (!data?.length) {
      return count > 0
        ? { data: null, error: { message: "Saved analysis history changed during loading. Please retry." } }
        : { data: rows, error: null };
    }
    rows.push(...data);
    const last = data[data.length - 1];
    cursor = { timestamp: last.created_at, id: last.id };
    if (limit !== undefined && rows.length >= limit) {
      return { data: rows.slice(0, limit), error: null };
    }
    if (data.length >= count) {
      return { data: rows, error: null };
    }
  }
}

/** A page is bounded by both row count and encoded bytes, without discarding history. */
// Bound the database payload too: full snapshots are read before summaries are built.
export const SAVED_ANALYSES_PAGE_SIZE = 5;
export const SAVED_ANALYSES_PAGE_BYTES = 1_000_000;

export function mapSavedAnalysisRow(r: Record<string, unknown>) {
  const parse = (value: unknown) => typeof value === "string" ? JSON.parse(value) : value;
  return {
    id: r.id, name: r.name, assetCode: r.asset_code, issuer: r.issuer,
    distribAddresses: parse(r.distrib_addresses), network: r.network,
    result: parse(r.result_json), notes: r.notes ?? undefined,
    tags: r.tags ? parse(r.tags) : undefined, timestamp: r.created_at,
  };
}

export function summarizeAnalysis(row: Record<string, unknown>) {
  return summarizeSavedAnalysis(mapSavedAnalysisRow(row) as SavedAnalysis);
}

export function summaryPage(rows: Record<string, unknown>[], hasMore: boolean) {
  const page: ReturnType<typeof summarizeAnalysis>[] = [];
  let bytes = 128;
  for (const row of rows) {
    const summary = summarizeAnalysis(row);
    const size = Buffer.byteLength(JSON.stringify(summary)) + 1;
    if (page.length && bytes + size > SAVED_ANALYSES_PAGE_BYTES) break;
    page.push(summary);
    bytes += size;
  }
  if (page.length && (hasMore || page.length < rows.length)) {
    const last = page[page.length - 1];
    last.nextCursor = { timestamp: last.timestamp, id: last.id };
  }
  return page;
}
