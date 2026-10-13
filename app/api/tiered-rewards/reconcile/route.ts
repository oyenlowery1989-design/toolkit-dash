import { NextRequest, NextResponse } from "next/server";
import { Horizon, Networks } from "stellar-sdk";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly, requireAuth } from "@/lib/supabase-server";
import { inspectRewardRun, releaseRewardRun } from "@/lib/tiered-rewards/run-guard";

async function handle(req: NextRequest, release: boolean) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const configId = release ? (await req.json() as { configId?: string; confirmation?: string }) : null;
  const id = release ? configId?.configId : new URL(req.url).searchParams.get("configId");
  if (typeof id !== "string" || !id) return NextResponse.json({ error: "Config ID required" }, { status: 400 });
  if (release && configId?.confirmation !== "I reviewed the ledger and understand a future run can pay these recipients again") {
    return NextResponse.json({ error: "Explicit reconciliation confirmation required" }, { status: 400 });
  }

  let network: string;
  if (isSupabaseOnly()) {
    const sb = getSupabase();
    if (!sb || !auth.userId) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
    const { data, error } = await sb.from("tiered_reward_configs").select("id,network").eq("id", id).eq("user_id", auth.userId).maybeSingle();
    if (error) return NextResponse.json({ error: "Could not verify config ownership" }, { status: 503 });
    if (!data) return NextResponse.json({ error: "Config not found" }, { status: 404 });
    network = data.network ?? "public";
  } else {
    const config = getDb().prepare("SELECT network FROM tiered_reward_configs WHERE id = ?").get(id) as { network: string | null } | undefined;
    if (!config) return NextResponse.json({ error: "Config not found" }, { status: 404 });
    network = config.network ?? "public";
  }
  if (network !== "public" && network !== "testnet") return NextResponse.json({ error: "Unsupported reward network" }, { status: 400 });
  const server = new Horizon.Server(network === "public" ? "https://horizon.stellar.org" : "https://horizon-testnet.stellar.org");
  const passphrase = network === "public" ? Networks.PUBLIC : Networks.TESTNET;

  try {
    const inspected = await inspectRewardRun(id, server, passphrase);
    if (!inspected) return release
      ? NextResponse.json({ error: "No run needs reconciliation" }, { status: 404 })
      : NextResponse.json({ blocked: false, transactions: [] });
    if (!release) return NextResponse.json({ blocked: true, ready: inspected.ready, transactions: inspected.transactions });
    if (!inspected.ready) return NextResponse.json({ error: "At least one transaction has no definitive ledger result; run remains blocked", transactions: inspected.transactions }, { status: 409 });

    // Pause scheduled runs before removing the guard so a stale schedule cannot immediately repay.
    if (isSupabaseOnly()) {
      const { data, error } = await getSupabase()!.from("tiered_reward_configs")
        .update({ enabled: false, last_run_at: Date.now() }).eq("id", id).eq("user_id", auth.userId!).select("id");
      if (error || data?.length !== 1) throw new Error("Could not pause scheduled runs; guard remains active");
    } else {
      const changes = getDb().prepare("UPDATE tiered_reward_configs SET enabled = 0, last_run_at = ? WHERE id = ?").run(Date.now(), id).changes;
      if (changes !== 1) throw new Error("Could not pause scheduled runs; guard remains active");
    }
    await releaseRewardRun(id, inspected.raw);
    return NextResponse.json({ blocked: false, paused: true, transactions: inspected.transactions });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Reconciliation failed" }, { status: 409 });
  }
}

export async function GET(req: NextRequest) { return handle(req, false); }
export async function POST(req: NextRequest) { return handle(req, true); }
