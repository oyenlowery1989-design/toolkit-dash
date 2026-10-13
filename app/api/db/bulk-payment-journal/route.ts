import { NextRequest, NextResponse } from "next/server";
import { Horizon, StrKey } from "stellar-sdk";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly, requireAuth, resolveLocalSyncUserId } from "@/lib/supabase-server";
import type { BulkPaymentJournal } from "@/lib/bulk-payments/types";

const LOCAL_USER = "local";

function validJournal(value: unknown): value is BulkPaymentJournal {
  if (!value || typeof value !== "object") return false;
  const j = value as BulkPaymentJournal;
  return typeof j.runId === "string" && /^[0-9a-f-]{36}$/i.test(j.runId) &&
    Number.isSafeInteger(j.version) && j.version >= 0 &&
    ["public", "testnet", "futurenet", "local"].includes(j.network) &&
    StrKey.isValidEd25519PublicKey(j.sender) &&
    typeof j.memo === "string" && j.memo.length <= 28 &&
    typeof j.amount === "string" && j.amount.length <= 32 &&
    (j.assetCode === null && j.assetIssuer === null ||
      typeof j.assetCode === "string" && /^[A-Za-z0-9]{1,12}$/.test(j.assetCode) &&
      typeof j.assetIssuer === "string" && StrKey.isValidEd25519PublicKey(j.assetIssuer)) &&
    Number.isFinite(j.feeMultiplier) && j.feeMultiplier >= 1 && j.feeMultiplier <= 100 &&
    (j.status === "sending" || j.status === "done") &&
    Array.isArray(j.batches) && j.batches.length <= 10000 &&
    j.batches.every((batch) => Array.isArray(batch) && batch.length > 0 && batch.length <= 100 && batch.every((address) => StrKey.isValidEd25519PublicKey(address))) &&
    Array.isArray(j.results) && j.results.length === j.batches.length &&
    j.results.every((result, i) => result && result.batchIndex === i && result.count === j.batches[i].length &&
      ["pending", "sending", "success", "failed", "uncertain"].includes(result.status) &&
      (result.txHash === undefined || (typeof result.txHash === "string" && /^[0-9a-f]{64}$/i.test(result.txHash))) &&
      result.signedXdr === undefined && (result.error === undefined || (typeof result.error === "string" && result.error.length <= 500)));
}

function safePayload(j: BulkPaymentJournal): BulkPaymentJournal {
  return { runId: j.runId, version: j.version, network: j.network, sender: j.sender,
    memo: j.memo, amount: j.amount, assetCode: j.assetCode, assetIssuer: j.assetIssuer,
    feeMultiplier: j.feeMultiplier, batches: j.batches,
    results: j.results.map(({ batchIndex, count, status, txHash, error }) => ({ batchIndex, count, status, txHash, error })),
    status: j.status };
}

async function validTransition(previous: BulkPaymentJournal, next: BulkPaymentJournal): Promise<boolean> {
  if (previous.runId !== next.runId || previous.network !== next.network || previous.sender !== next.sender ||
      previous.memo !== next.memo || previous.amount !== next.amount || previous.assetCode !== next.assetCode ||
      previous.assetIssuer !== next.assetIssuer || previous.feeMultiplier !== next.feeMultiplier) return false;
  const hasUnresolved = previous.results.some((r) => r.txHash && (r.status === "uncertain" || r.status === "sending"));
  if (JSON.stringify(previous.batches) !== JSON.stringify(next.batches) && (hasUnresolved || previous.status !== "done")) return false;
  if (JSON.stringify(previous.batches) !== JSON.stringify(next.batches)) {
    return previous.results.every((result, i) => result.status !== "success" || next.results.some((candidate, j) =>
      candidate.status === "success" && candidate.txHash === result.txHash &&
      JSON.stringify(next.batches[j]) === JSON.stringify(previous.batches[i])));
  }
  for (let i = 0; i < previous.results.length; i++) {
    const before = previous.results[i];
    const after = next.results[i];
    if (after.status === "success" && !after.txHash) return false;
    if (!before.txHash && after.txHash && after.status !== "uncertain") return false;
    if (before.status === "success" && (after.status !== "success" || after.txHash !== before.txHash)) return false;
    if (before.status === "failed" && before.txHash &&
        !(after.status === "failed" && after.txHash === before.txHash) &&
        !(previous.status === "done" && after.status === "pending" && !after.txHash)) return false;
    if (!before.txHash || (before.status !== "uncertain" && before.status !== "sending")) continue;
    if (after.txHash !== before.txHash) return false;
    if (after.status === "uncertain" || after.status === "sending") continue;
    if (after.status !== "success" && after.status !== "failed") return false;
    if (previous.network !== "public" && previous.network !== "testnet") return false;
    // shortcut: a missing Horizon hash cannot prove rejection; add an operator proof path if these runs must be unblocked.
    try {
      const url = previous.network === "public" ? "https://horizon.stellar.org" : "https://horizon-testnet.stellar.org";
      const tx = await new Horizon.Server(url).transactions().transaction(before.txHash).call();
      if (tx.successful !== (after.status === "success")) return false;
    } catch { return false; }
  }
  return true;
}

async function read(userId: string): Promise<BulkPaymentJournal | null> {
  let row: { payload_json: string; version: number } | null = null;
  if (isSupabaseOnly()) {
    const { data, error } = await getSupabase()!.from("bulk_payment_journal")
      .select("payload_json,version").eq("user_id", userId).maybeSingle();
    if (error) throw error;
    row = data;
  } else {
    row = getDb().prepare("SELECT payload_json,version FROM bulk_payment_journal WHERE user_id = ?")
      .get(LOCAL_USER) as typeof row;
  }
  if (!row) return null;
  const journal = JSON.parse(row.payload_json) as BulkPaymentJournal;
  if (!validJournal(journal)) throw new Error("Invalid stored bulk payment journal");
  return { ...journal, version: row.version };
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  try { return NextResponse.json(await read(auth.userId ?? LOCAL_USER)); }
  catch (error) { console.error("[bulk-payment-journal] GET failed:", error); return NextResponse.json({ error: "Journal unavailable" }, { status: 500 }); }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const userId = auth.userId ?? LOCAL_USER;
  let body: { journal?: unknown; expectedVersion?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!validJournal(body.journal) || !(body.expectedVersion === null || Number.isSafeInteger(body.expectedVersion))) {
    return NextResponse.json({ error: "Invalid journal" }, { status: 400 });
  }
  const journal = safePayload(body.journal);
  const expected = body.expectedVersion;
  if (expected === null && journal.version !== 0 || typeof expected === "number" && journal.version !== expected + 1) {
    return NextResponse.json({ error: "Invalid journal version" }, { status: 400 });
  }
  if (expected === null && (journal.status !== "sending" || journal.results.some((r) => r.status !== "pending" || r.txHash))) {
    return NextResponse.json({ error: "New journal must begin before any submission" }, { status: 400 });
  }
  const json = JSON.stringify(journal);
  if (json.length > 4_000_000) return NextResponse.json({ error: "Bulk journal is too large" }, { status: 413 });
  const now = Date.now();
  try {
    if (typeof expected === "number") {
      const previous = await read(userId);
      if (!previous || previous.version !== expected || !await validTransition(previous, journal)) {
        return NextResponse.json({ error: "Journal changed or a transaction still needs ledger confirmation" }, { status: 409 });
      }
    }
    if (isSupabaseOnly()) {
      const sb = getSupabase()!;
      if (expected === null) {
        const { error } = await sb.from("bulk_payment_journal").insert({ user_id: userId, run_id: journal.runId, version: 0, payload_json: json, updated_at: now });
        if (error) return NextResponse.json({ error: "Existing journal or storage failure" }, { status: error.code === "23505" ? 409 : 500 });
      } else {
        const { data, error } = await sb.from("bulk_payment_journal")
          .update({ version: journal.version, payload_json: json, updated_at: now })
          .eq("user_id", userId).eq("run_id", journal.runId).eq("version", expected)
          .select("version").maybeSingle();
        if (error) throw error;
        if (!data) return NextResponse.json({ error: "Journal changed in another tab" }, { status: 409 });
      }
    } else {
      const db = getDb();
      const changed = expected === null
        ? db.prepare("INSERT OR IGNORE INTO bulk_payment_journal (user_id,run_id,version,payload_json,updated_at) VALUES (?,?,?,?,?)")
          .run(LOCAL_USER, journal.runId, 0, json, now).changes
        : db.prepare("UPDATE bulk_payment_journal SET version=?,payload_json=?,updated_at=? WHERE user_id=? AND run_id=? AND version=?")
          .run(journal.version, json, now, LOCAL_USER, journal.runId, expected).changes;
      if (!changed) return NextResponse.json({ error: "Journal changed in another tab" }, { status: 409 });
      const sb = getSupabase();
      const mirrorUserId = auth.userId ?? resolveLocalSyncUserId();
      if (sb && mirrorUserId) {
        const { error } = await sb.from("bulk_payment_journal").upsert({ user_id: mirrorUserId, run_id: journal.runId, version: journal.version, payload_json: json, updated_at: now });
        if (error) throw error;
      }
    }
    return NextResponse.json({ journal });
  } catch (error) {
    console.error("[bulk-payment-journal] POST failed:", error);
    return NextResponse.json({ error: "Journal write failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const userId = auth.userId ?? LOCAL_USER;
  try {
    const current = await read(userId);
    if (!current) return NextResponse.json({ ok: true });
    if (current.results.some((r) => r.txHash && (r.status === "sending" || r.status === "uncertain"))) {
      return NextResponse.json({ error: "Resolve transaction hashes before clearing the journal" }, { status: 409 });
    }
    if (isSupabaseOnly()) {
      const { data, error } = await getSupabase()!.from("bulk_payment_journal")
        .delete().eq("user_id", userId).eq("run_id", current.runId).eq("version", current.version)
        .select("run_id").maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: "Journal changed in another tab" }, { status: 409 });
    } else {
      const changed = getDb().prepare("DELETE FROM bulk_payment_journal WHERE user_id=? AND run_id=? AND version=?")
        .run(LOCAL_USER, current.runId, current.version).changes;
      if (!changed) return NextResponse.json({ error: "Journal changed in another tab" }, { status: 409 });
      const sb = getSupabase();
      const mirrorUserId = auth.userId ?? resolveLocalSyncUserId();
      if (sb && mirrorUserId) {
        const { error } = await sb.from("bulk_payment_journal").delete().eq("user_id", mirrorUserId);
        if (error) throw error;
      }
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[bulk-payment-journal] DELETE failed:", error);
    return NextResponse.json({ error: "Journal clear failed" }, { status: 500 });
  }
}
