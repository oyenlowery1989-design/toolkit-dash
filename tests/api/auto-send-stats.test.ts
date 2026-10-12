import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ db: null as Database.Database | null }));
vi.mock("@/lib/db", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/supabase-server", () => ({ requireAuth: async () => ({ ok: true }), isSupabaseOnly: () => false, getSupabase: () => null }));

import { GET } from "@/app/api/auto-send/stats/route";

afterEach(() => { mocks.db?.close(); mocks.db = null; });

describe("Auto-Send statistics", () => {
  it("counts only actual sends as XLM and excludes the guard from runs", async () => {
    mocks.db = new Database(":memory:");
    mocks.db.exec(`CREATE TABLE auto_send_run_log (ran_at INTEGER, group_id TEXT, status TEXT, amount_sent REAL);
      CREATE TABLE auto_send_groups (enabled INTEGER, interval_minutes INTEGER);`);
    const insert = mocks.db.prepare("INSERT INTO auto_send_run_log VALUES (?, ?, ?, ?)");
    insert.run(1, "group", "guard", null);
    insert.run(2, "group", "preview", 100);
    insert.run(3, "group", "sent", 5);
    const response = await GET(new NextRequest("http://localhost/api/auto-send/stats"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ totalRuns: 2, totalSent: 1, totalXlm: 5, lastRunAt: 3 });
  });
});
