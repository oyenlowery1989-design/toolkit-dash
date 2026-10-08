import { createHash } from "node:crypto";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly } from "@/lib/supabase-server";

/** Consume only after verifying the signed token. Unique insert defeats concurrent replay. */
export async function consumePreviewApproval(token: string): Promise<boolean> {
  const hash = createHash("sha256").update(token).digest("hex");
  if (isSupabaseOnly()) {
    const { error } = await getSupabase()!.from("used_preview_approvals").insert({ hash, consumed_at: Date.now() });
    if (error?.code === "23505") return false;
    if (error) throw new Error("Preview approval could not be recorded");
    return true;
  }
  return getDb().prepare("INSERT OR IGNORE INTO used_preview_approvals(hash, consumed_at) VALUES (?, ?)").run(hash, Date.now()).changes === 1;
}
