import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly, requireAuth } from "@/lib/supabase-server";
import type { AutoSendGroup, AutoSendDestination } from "@/lib/auto-send/types";

type Row = Record<string, unknown>;

function rowToDestination(r: Row): AutoSendDestination {
  return {
    id: r.id as string,
    groupId: (r.group_id as string),
    destination: r.destination as string,
    percentage: (r.percentage as number) ?? 0,
    isRemainder: Number(r.is_remainder) === 1,
    paused: Number(r.is_paused) === 1,
    label: (r.label as string) ?? undefined,
    memo: (r.memo as string) ?? undefined,
    minThreshold: (r.min_threshold as number) ?? 0,
    maxCap: (r.max_cap as number) ?? 0,
    position: (r.position as number) ?? 0,
  };
}

function buildGroups(groups: Row[], allDests: Row[]): AutoSendGroup[] {
  const destsByGroup = new Map<string, AutoSendDestination[]>();
  for (const d of allDests) {
    const gid = d.group_id as string;
    if (!destsByGroup.has(gid)) destsByGroup.set(gid, []);
    destsByGroup.get(gid)!.push(rowToDestination(d));
  }
  return groups.map((g) => ({
    id: g.id as string,
    name: g.name as string,
    network: (g.network as string) ?? "public",
    secretKey: "",
    hasKey: !!((g.secret_key as string) ?? ""),
    intervalMinutes: (g.interval_minutes as number) ?? null,
    enabled: Number(g.enabled) === 1,
    batchSend: Number(g.batch_send) === 1,
    batchMemo: (g.batch_memo as string) ?? undefined,
    minReserve: (g.min_reserve as number) ?? 10.0,
    minSenderThreshold: (g.min_sender_threshold as number) ?? 0,
    previewOnly: Number(g.preview_only) === 1,
    lastFailureAt: (g.last_failure_at as number) ?? undefined,
    createdAt: g.created_at as number,
    destinations: (destsByGroup.get(g.id as string) ?? []).sort((a, b) => a.position - b.position),
  }));
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  if (isSupabaseOnly()) {
    const sb = getSupabase()!;
    const { data: groups, error: ge } = await sb.from("auto_send_groups").select("*").eq("user_id", auth.userId!).order("created_at", { ascending: false });
    if (ge) return NextResponse.json({ error: ge.message }, { status: 500 });
    const { data: dests, error: de } = await sb.from("auto_send_destinations").select("*").in("group_id", (groups ?? []).map((g) => g.id));
    if (de) return NextResponse.json({ error: de.message }, { status: 500 });
    return NextResponse.json(buildGroups(groups ?? [], dests ?? []));
  }

  const db = getDb();
  const groups = db.prepare(`SELECT * FROM auto_send_groups ORDER BY created_at DESC`).all() as Row[];
  const allDests = db.prepare(`SELECT * FROM auto_send_destinations ORDER BY position ASC`).all() as Row[];
  return NextResponse.json(buildGroups(groups, allDests));
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;

    let body: Row;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

    const now = Date.now();

    if (body.type === "group") {
      const { id, name, network, secretKey, intervalMinutes } = body as Record<string, unknown>;
      if (!id || !name) return NextResponse.json({ error: "id and name required" }, { status: 400 });

      if (isSupabaseOnly()) {
        const sb = getSupabase()!;
        // Reject if this id already belongs to a different user (prevents hijack via client-supplied id)
        const { data: existingGroup } = await sb.from("auto_send_groups").select("user_id").eq("id", id).single();
        if (existingGroup && existingGroup.user_id !== auth.userId) {
          return NextResponse.json({ error: "Not authorized" }, { status: 403 });
        }
        const { error } = await sb.from("auto_send_groups").upsert({
          id, user_id: auth.userId!, name: (name as string).trim(),
          network: network ?? "public", secret_key: secretKey ?? "",
          interval_minutes: intervalMinutes ?? null, enabled: 1, created_at: now,
        });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      } else {
        const db = getDb();
        db.prepare(`INSERT INTO auto_send_groups (id, name, network, secret_key, interval_minutes, enabled, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)`)
          .run(id, (name as string).trim(), network ?? "public", secretKey ?? "", intervalMinutes ?? null, now);
      }
      return NextResponse.json({ ok: true });
    }

    if (body.type === "destination") {
      const { id, groupId, destination, percentage, isRemainder, paused, label, memo, minThreshold, maxCap, position } = body as Record<string, unknown>;
      if (!id || !groupId || !destination) return NextResponse.json({ error: "id, groupId, destination required" }, { status: 400 });

      if (isSupabaseOnly()) {
        const sb = getSupabase()!;
        // Verify the target group belongs to the authenticated user before writing a destination to it
        const { data: ownerGroup } = await sb.from("auto_send_groups").select("id").eq("id", groupId).eq("user_id", auth.userId!).single();
        if (!ownerGroup) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

        // Upsert by (group_id, destination) — find existing id first to avoid PK conflicts
        const { data: existing } = await sb.from("auto_send_destinations").select("id").eq("group_id", groupId).eq("destination", destination).single();
        const rowId = existing?.id ?? id;
        const { error } = await sb.from("auto_send_destinations").upsert({
          id: rowId, user_id: auth.userId!, group_id: groupId, destination,
          percentage: percentage ?? 0, is_remainder: isRemainder ? 1 : 0,
          is_paused: paused ? 1 : 0, label: label ?? null, memo: memo ?? null,
          min_threshold: minThreshold ?? 0, max_cap: maxCap ?? 0, position: position ?? 0,
        });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true, id: rowId });
      } else {
        const db = getDb();
        const existing = db.prepare(`SELECT id FROM auto_send_destinations WHERE group_id = ? AND destination = ?`).get(groupId, destination) as { id: string } | undefined;
        const rowId = existing?.id ?? id;
        db.prepare(`INSERT OR REPLACE INTO auto_send_destinations (id, group_id, destination, percentage, is_remainder, is_paused, label, memo, min_threshold, max_cap, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(rowId, groupId, destination, percentage, (isRemainder as boolean) ? 1 : 0, (paused as boolean) ? 1 : 0, label ?? null, memo ?? null, minThreshold ?? 0, maxCap ?? 0, position ?? 0);
        return NextResponse.json({ ok: true, id: rowId });
      }
    }

    return NextResponse.json({ error: "unknown type — expected 'group' or 'destination'" }, { status: 400 });
  } catch (e) {
    console.error("[auto-send-groups] POST unhandled:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;

    let body: Row;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

    if (body.type === "group") {
      const { id, name, network, secretKey, intervalMinutes, enabled, batchSend, batchMemo, minReserve, minSenderThreshold, previewOnly, lastFailureAt } = body;
      if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

      if (isSupabaseOnly()) {
        const updates: Row = {};
        if (name !== undefined) updates.name = (name as string).trim();
        if (network !== undefined) updates.network = network;
        // Only update key when caller supplies a non-empty value (empty = keep existing)
        if (secretKey !== undefined && secretKey !== "") updates.secret_key = secretKey;
        if (intervalMinutes !== undefined) updates.interval_minutes = intervalMinutes ?? null;
        if (enabled !== undefined) updates.enabled = enabled ? 1 : 0;
        if (batchSend !== undefined) updates.batch_send = batchSend ? 1 : 0;
        if (batchMemo !== undefined) updates.batch_memo = batchMemo || null;
        if (minReserve !== undefined) updates.min_reserve = minReserve;
        if (minSenderThreshold !== undefined) updates.min_sender_threshold = minSenderThreshold;
        if (previewOnly !== undefined) updates.preview_only = previewOnly ? 1 : 0;
        if (lastFailureAt !== undefined) updates.last_failure_at = lastFailureAt ?? null;
        if (Object.keys(updates).length === 0) return NextResponse.json({ ok: true });
        const { error } = await getSupabase()!.from("auto_send_groups").update(updates).eq("id", id).eq("user_id", auth.userId!);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      } else {
        const db = getDb();
        const fields: string[] = [];
        const values: unknown[] = [];
        if (name !== undefined) { fields.push("name = ?"); values.push((name as string).trim()); }
        if (network !== undefined) { fields.push("network = ?"); values.push(network); }
        // Only update key when caller supplies a non-empty value (empty = keep existing)
        if (secretKey !== undefined && secretKey !== "") { fields.push("secret_key = ?"); values.push(secretKey); }
        if (intervalMinutes !== undefined) { fields.push("interval_minutes = ?"); values.push(intervalMinutes ?? null); }
        if (enabled !== undefined) { fields.push("enabled = ?"); values.push(enabled ? 1 : 0); }
        if (batchSend !== undefined) { fields.push("batch_send = ?"); values.push(batchSend ? 1 : 0); }
        if (batchMemo !== undefined) { fields.push("batch_memo = ?"); values.push(batchMemo || null); }
        if (minReserve !== undefined) { fields.push("min_reserve = ?"); values.push(minReserve); }
        if (minSenderThreshold !== undefined) { fields.push("min_sender_threshold = ?"); values.push(minSenderThreshold); }
        if (previewOnly !== undefined) { fields.push("preview_only = ?"); values.push(previewOnly ? 1 : 0); }
        if (lastFailureAt !== undefined) { fields.push("last_failure_at = ?"); values.push(lastFailureAt ?? null); }
        if (fields.length === 0) return NextResponse.json({ ok: true });
        values.push(id);
        db.prepare(`UPDATE auto_send_groups SET ${fields.join(", ")} WHERE id = ?`).run(...values);
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "unknown type — expected 'group'" }, { status: 400 });
  } catch (e) {
    console.error("[auto-send-groups] PATCH unhandled:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;

    let body: Row;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

    if (body.type === "group") {
      if (isSupabaseOnly()) {
        const { error } = await getSupabase()!.from("auto_send_groups").delete().eq("id", body.key).eq("user_id", auth.userId!);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      } else {
        getDb().prepare(`DELETE FROM auto_send_groups WHERE id = ?`).run(body.key);
      }
      return NextResponse.json({ ok: true });
    }

    if (body.type === "destination") {
      if (isSupabaseOnly()) {
        const sb = getSupabase()!;
        // Verify ownership through parent group before deleting
        const { data: dest } = await sb.from("auto_send_destinations").select("group_id").eq("id", body.key).single();
        if (dest) {
          const { data: ownerGroup } = await sb.from("auto_send_groups").select("id").eq("id", dest.group_id).eq("user_id", auth.userId!).single();
          if (!ownerGroup) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
        }
        const { error } = await sb.from("auto_send_destinations").delete().eq("id", body.key);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      } else {
        getDb().prepare(`DELETE FROM auto_send_destinations WHERE id = ?`).run(body.key);
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "unknown type — expected 'group' or 'destination'" }, { status: 400 });
  } catch (e) {
    console.error("[auto-send-groups] DELETE unhandled:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
