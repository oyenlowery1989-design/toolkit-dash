import type { SupabaseClient } from "@supabase/supabase-js";

export type SupabaseRows = {
  data: Record<string, unknown>[] | null;
  error: { message: string } | null;
};

const PAGE_SIZE = 1000;
const ID_BATCH_SIZE = 100;

const ORDER_COLUMNS: Record<string, string> = {
  address_book: "public_key",
  known_intermediaries: "address",
  known_creators: "address",
  app_state: "key",
  bulk_scan_state: "scan_key",
};

export async function readPages(
  page: (from: number, to: number) => PromiseLike<SupabaseRows & { count?: number | null }>,
): Promise<SupabaseRows> {
  const rows: Record<string, unknown>[] = [];
  let total: number | undefined;
  for (;;) {
    const result = await page(rows.length, rows.length + PAGE_SIZE - 1);
    if (result.error) return { data: null, error: result.error };
    if (result.count == null) {
      return { data: null, error: { message: "Supabase row count is unavailable. Please retry." } };
    }
    if (total !== undefined && result.count !== total) {
      return { data: null, error: { message: "Rows changed during paged read. Please retry." } };
    }
    total ??= result.count;
    const batch = result.data ?? [];
    if (batch.length === 0) {
      return rows.length < total
        ? { data: null, error: { message: "Paged read ended before all rows were loaded." } }
        : { data: rows, error: null };
    }
    rows.push(...batch);
    if (rows.length >= total) {
      return { data: rows, error: null };
    }
  }
}

export function readAllUserRows(sb: SupabaseClient, table: string, userId: string): Promise<SupabaseRows> {
  return readPages((from, to) => sb.from(table).select("*", { count: "exact" })
    .eq("user_id", userId).order(ORDER_COLUMNS[table] ?? "id").range(from, to));
}

export async function readAllChildRows(
  sb: SupabaseClient,
  table: string,
  parentColumn: string,
  parentIds: string[],
): Promise<SupabaseRows> {
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < parentIds.length; i += ID_BATCH_SIZE) {
    const ids = parentIds.slice(i, i + ID_BATCH_SIZE);
    const result = await readPages((from, to) => sb.from(table).select("*", { count: "exact" })
      .in(parentColumn, ids).order("id").range(from, to));
    if (result.error) return result;
    rows.push(...result.data!);
  }
  return { data: rows, error: null };
}
