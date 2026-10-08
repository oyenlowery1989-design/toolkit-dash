import { getSupabase } from "@/lib/supabase-server";

const PAGE_SIZE = 500;
const KEYS: Record<string, string> = {
  address_book: "public_key", known_creators: "address", known_intermediaries: "address",
  app_state: "key", bulk_scan_state: "scan_key",
};
type Query = ReturnType<NonNullable<ReturnType<typeof getSupabase>>["from"]>["select"];
type SelectedQuery = ReturnType<Query>;

/** Rebuild each scoped query, enforce stable ordering, and fail on incomplete reads. */
export async function readAllSupabaseRows(
  table: string,
  scope: (query: SelectedQuery) => SelectedQuery,
  columns = "*",
): Promise<{ data: Record<string, unknown>[]; error: null }> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase is not configured");
  const rows: Record<string, unknown>[] = [];
  let expected: number | null = null;
  for (;;) {
    const query = scope(sb.from(table).select(columns, { count: "exact" }));
    const { data, error, count } = await query.order(KEYS[table] ?? "id", { ascending: true })
      .range(rows.length, rows.length + PAGE_SIZE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (count === null || (expected !== null && count !== expected)) throw new Error(`${table}: source changed during export; retry`);
    expected = count;
    if (!data?.length && rows.length < expected) throw new Error(`${table}: incomplete read`);
    rows.push(...(data ?? []) as Record<string, unknown>[]);
    if (rows.length === expected) return { data: rows, error: null };
    if (rows.length > expected) throw new Error(`${table}: inconsistent row count`);
  }
}
