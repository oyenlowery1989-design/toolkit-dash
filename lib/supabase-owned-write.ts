import { getSupabase } from "@/lib/supabase-server";

/** Insert first, then update only an owned row on conflict. Never transfer ownership. */
export async function writeOwnedRow(table: string, row: Record<string, unknown> & { id: string; user_id: string }) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase is not configured");
  const inserted = await sb.from(table).insert(row);
  if (!inserted.error) return { error: null, status: 200 };
  if (inserted.error.code !== "23505") return { error: inserted.error, status: 500 };
  const { id, user_id: userId, ...updates } = row;
  const updated = await sb.from(table).update(updates).eq("id", id).eq("user_id", userId).select("id").maybeSingle();
  if (updated.error) return { error: updated.error, status: 500 };
  if (!updated.data) return { error: { message: "Not authorized" }, status: 403 };
  return { error: null, status: 200 };
}
