import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllChildRows, readAllUserRows, readPages } from "@/lib/supabase-read-all";

describe("Supabase paged reads", () => {
  it("orders journal and lease reads by columns present in their tables", async () => {
    const ordered: string[] = [];
    const sb = {
      from(table: string) {
        const query = {
          select: () => query,
          eq: () => query,
          in: () => query,
          order(column: string) {
            ordered.push(`${table}.${column}`);
            return query;
          },
          range: async () => ({ data: [], error: null, count: 0 }),
        };
        return query;
      },
    } as unknown as SupabaseClient;
    await readAllUserRows(sb, "bulk_payment_journal", "user");
    await readAllChildRows(sb, "tiered_reward_run_leases", "resource_id", ["reward-guard:config"]);
    expect(ordered).toEqual(["bulk_payment_journal.user_id", "tiered_reward_run_leases.resource_id"]);
  });

  it("reads every page before summing payment history", async () => {
    const rows = Array.from({ length: 1501 }, (_, i) => ({ id: String(i), amount_sent: 1 }));
    const page = vi.fn(async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null, count: rows.length }));
    const result = await readPages(page);
    expect(page).toHaveBeenCalledTimes(2);
    expect(result.error).toBeNull();
    expect(result.data?.reduce((sum, row) => sum + Number(row.amount_sent), 0)).toBe(1501);
  });

  it("fails closed if rows change during the read", async () => {
    const page = vi.fn(async (from: number) => ({
      data: Array.from({ length: from === 0 ? 1000 : 1 }, () => ({})), error: null,
      count: from === 0 ? 1001 : 1002,
    }));
    expect((await readPages(page)).error?.message).toContain("changed");
  });
});
