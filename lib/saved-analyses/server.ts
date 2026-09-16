import { getSupabase } from "@/lib/supabase-server";

/** Read the full history for UI, export, and local sync despite the API row cap. */
export async function readSavedAnalysisRows(userId: string): Promise<{
  data: Record<string, unknown>[] | null;
  error: { message: string } | null;
}> {
  const sb = getSupabase()!;
  const rows: Record<string, unknown>[] = [];
  const pageSize = 1000;
  let total: number | null = null;
  for (;;) {
    const { data, error, count } = await sb.from("saved_analyses")
      .select("*", rows.length === 0 ? { count: "exact" } : {})
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(rows.length, rows.length + pageSize - 1);
    if (error) return { data: null, error };
    if (rows.length === 0) total = count;
    if (!data?.length) {
      return total !== null && rows.length < total
        ? { data: null, error: { message: "Saved analysis history changed during loading. Please retry." } }
        : { data: rows, error: null };
    }
    rows.push(...data);
    if (total !== null ? rows.length >= total : data.length < pageSize) {
      return { data: rows, error: null };
    }
  }
}
