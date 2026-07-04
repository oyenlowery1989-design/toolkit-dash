import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly, syncToSupabase, requireAuth } from "@/lib/supabase-server";
import type { AssetGroup, GroupMember } from "@/lib/asset-groups/types";

type GroupRow = Record<string, unknown>;
type MemberRow = Record<string, unknown>;

function rowToMember(r: MemberRow): GroupMember {
  return {
    id: r.id as string,
    groupId: r.group_id as string,
    address: r.address as string,
    role: r.role as GroupMember["role"],
    label: (r.label as string) ?? undefined,
    notes: (r.notes as string) ?? undefined,
    homeDomain: (r.home_domain as string) ?? undefined,
    addedAt: r.added_at as number,
  };
}

function rowToGroup(r: GroupRow, members: GroupMember[]): AssetGroup {
  return {
    id: r.id as string,
    name: r.name as string,
    assetCode: (r.asset_code as string) ?? undefined,
    issuer: (r.issuer as string) ?? undefined,
    network: r.network as string,
    notes: (r.notes as string) ?? undefined,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
    members,
  };
}

function buildGroupsFromRows(groups: GroupRow[], allMembers: MemberRow[]): AssetGroup[] {
  const membersByGroup = new Map<string, GroupMember[]>();
  for (const m of allMembers) {
    const gid = m.group_id as string;
    if (!membersByGroup.has(gid)) membersByGroup.set(gid, []);
    membersByGroup.get(gid)!.push(rowToMember(m));
  }
  return groups.map((g) => rowToGroup(g, membersByGroup.get(g.id as string) ?? []));
}

/** GET /api/db/groups — all groups with members */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  if (isSupabaseOnly()) {
    const sb = getSupabase()!;
    const { data: groups } = await sb
      .from("asset_groups")
      .select("*")
      .eq("user_id", userId!)
      .order("updated_at", { ascending: false });
    const groupIds = (groups ?? []).map((g) => g.id as string);
    const { data: allMembers } = groupIds.length > 0
      ? await sb.from("asset_group_members").select("*").in("group_id", groupIds).order("added_at", { ascending: true })
      : { data: [] };
    return NextResponse.json(buildGroupsFromRows(groups ?? [], allMembers ?? []));
  }

  const db = getDb();
  const groups = db
    .prepare("SELECT * FROM asset_groups ORDER BY updated_at DESC")
    .all() as GroupRow[];
  const allMembers = db
    .prepare("SELECT * FROM asset_group_members ORDER BY added_at ASC")
    .all() as MemberRow[];
  return NextResponse.json(buildGroupsFromRows(groups, allMembers));
}

/** POST /api/db/groups — create group or upsert member */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  const body = await req.json();
  const now = Date.now();

  if (body.type === "group") {
    const { id, name, assetCode, issuer, network, notes } = body;
    const nameTrimmed = (name ?? "").trim();
    const assetCodeNorm = typeof assetCode === "string" ? assetCode.trim() : null;
    const issuerNorm = typeof issuer === "string" ? issuer.trim() : null;
    const networkNorm = typeof network === "string" ? network : "public";

    if (!isSupabaseOnly()) {
      const db = getDb();

      // Check for existing group with same asset identity
      if (assetCodeNorm && issuerNorm) {
        const existing = db
          .prepare(
            `SELECT id FROM asset_groups
             WHERE asset_code = ? AND issuer = ? AND network = ?
             LIMIT 1`,
          )
          .get(assetCodeNorm, issuerNorm, networkNorm) as { id: string } | undefined;
        if (existing) {
          return NextResponse.json({ ok: true, existingId: existing.id, reused: true });
        }
      }

      try {
        db.prepare(
          `INSERT INTO asset_groups (id, name, asset_code, issuer, network, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name       = excluded.name,
             asset_code = excluded.asset_code,
             issuer     = excluded.issuer,
             network    = excluded.network,
             notes      = excluded.notes,
             updated_at = excluded.updated_at`,
        ).run(id, nameTrimmed, assetCodeNorm, issuerNorm, networkNorm, notes ?? null, now, now);

        syncToSupabase(async () => {
          await getSupabase()!.from("asset_groups").upsert({
            id,
            user_id: userId,
            name: nameTrimmed,
            asset_code: assetCodeNorm,
            issuer: issuerNorm,
            network: networkNorm,
            notes: notes ?? null,
            created_at: now,
            updated_at: now,
          });
        });

        return NextResponse.json({ ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.toLowerCase().includes("unique constraint")) {
          const existingId =
            assetCodeNorm && issuerNorm
              ? (
                  db
                    .prepare(
                      `SELECT id FROM asset_groups
                       WHERE asset_code = ? AND issuer = ? AND network = ?
                       LIMIT 1`,
                    )
                    .get(assetCodeNorm, issuerNorm, networkNorm) as { id: string } | undefined
                )?.id
              : undefined;
          return NextResponse.json(
            { ok: false, error: "duplicate_asset_group", existingId },
            { status: 409 },
          );
        }
        throw error;
      }
    } else {
      // Supabase-only mode
      const sb = getSupabase()!;
      if (assetCodeNorm && issuerNorm) {
        const { data: existing } = await sb
          .from("asset_groups")
          .select("id")
          .eq("user_id", userId!)
          .eq("asset_code", assetCodeNorm)
          .eq("issuer", issuerNorm)
          .eq("network", networkNorm)
          .limit(1)
          .single();
        if (existing) {
          return NextResponse.json({ ok: true, existingId: existing.id, reused: true });
        }
      }
      const { error } = await sb.from("asset_groups").upsert({
        id,
        user_id: userId,
        name: nameTrimmed,
        asset_code: assetCodeNorm,
        issuer: issuerNorm,
        network: networkNorm,
        notes: notes ?? null,
        created_at: now,
        updated_at: now,
      });
      if (error?.code === "23505") {
        const { data: existing } = await sb
          .from("asset_groups")
          .select("id")
          .eq("user_id", userId!)
          .eq("asset_code", assetCodeNorm)
          .eq("issuer", issuerNorm)
          .eq("network", networkNorm)
          .limit(1)
          .single();
        return NextResponse.json(
          { ok: false, error: "duplicate_asset_group", existingId: existing?.id },
          { status: 409 },
        );
      }
      return NextResponse.json({ ok: true });
    }
  }

  if (body.type === "member") {
    const { id, groupId, address, role, label, notes, homeDomain } = body;

    if (!isSupabaseOnly()) {
      const db = getDb();
      db.prepare(
        `INSERT INTO asset_group_members (id, group_id, address, role, label, notes, home_domain, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(group_id, address) DO UPDATE SET
           role        = excluded.role,
           label       = excluded.label,
           notes       = excluded.notes,
           home_domain = excluded.home_domain`,
      ).run(id, groupId, address, role, label ?? null, notes ?? null, homeDomain ?? null, now);
      db.prepare("UPDATE asset_groups SET updated_at = ? WHERE id = ?").run(now, groupId);
    }

    syncToSupabase(async () => {
      const sb = getSupabase()!;
      await sb.from("asset_group_members").upsert(
        {
          id,
          group_id: groupId,
          address,
          role,
          label: label ?? null,
          notes: notes ?? null,
          home_domain: homeDomain ?? null,
          added_at: now,
        },
        { onConflict: "group_id,address" },
      );
      await sb.from("asset_groups").update({ updated_at: now }).eq("id", groupId).eq("user_id", userId!);
    });

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown type" }, { status: 400 });
}

/** PATCH /api/db/groups — update group metadata or member field */
export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  const body = await req.json();
  const now = Date.now();

  if (body.type === "group") {
    const { id, name, notes, assetCode, issuer, network } = body;

    if (!isSupabaseOnly()) {
      getDb()
        .prepare(
          `UPDATE asset_groups SET
             name       = COALESCE(?, name),
             notes      = COALESCE(?, notes),
             asset_code = COALESCE(?, asset_code),
             issuer     = COALESCE(?, issuer),
             network    = COALESCE(?, network),
             updated_at = ?
           WHERE id = ?`,
        )
        .run(name ?? null, notes ?? null, assetCode ?? null, issuer ?? null, network ?? null, now, id);
    }

    syncToSupabase(async () => {
      const patch: Record<string, unknown> = { updated_at: now };
      if (name !== undefined) patch.name = name;
      if (notes !== undefined) patch.notes = notes;
      if (assetCode !== undefined) patch.asset_code = assetCode;
      if (issuer !== undefined) patch.issuer = issuer;
      if (network !== undefined) patch.network = network;
      await getSupabase()!.from("asset_groups").update(patch).eq("id", id).eq("user_id", userId!);
    });

    return NextResponse.json({ ok: true });
  }

  if (body.type === "member") {
    const { id, label, notes, role, homeDomain, groupId } = body;

    if (!isSupabaseOnly()) {
      const db = getDb();
      db.prepare(
        `UPDATE asset_group_members SET
           label       = COALESCE(?, label),
           notes       = COALESCE(?, notes),
           role        = COALESCE(?, role),
           home_domain = COALESCE(?, home_domain)
         WHERE id = ?`,
      ).run(label ?? null, notes ?? null, role ?? null, homeDomain ?? null, id);
      if (groupId) {
        db.prepare("UPDATE asset_groups SET updated_at = ? WHERE id = ?").run(now, groupId);
      }
    }

    syncToSupabase(async () => {
      const patch: Record<string, unknown> = {};
      if (label !== undefined) patch.label = label;
      if (notes !== undefined) patch.notes = notes;
      if (role !== undefined) patch.role = role;
      if (homeDomain !== undefined) patch.home_domain = homeDomain;
      if (Object.keys(patch).length > 0) {
        await getSupabase()!.from("asset_group_members").update(patch).eq("id", id);
      }
      if (groupId) {
        await getSupabase()!.from("asset_groups").update({ updated_at: now }).eq("id", groupId).eq("user_id", userId!);
      }
    });

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown type" }, { status: 400 });
}

/** DELETE /api/db/groups — delete group or member */
export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  const { key, type } = await req.json();

  if (!isSupabaseOnly()) {
    const db = getDb();
    if (type === "group") {
      db.prepare("DELETE FROM asset_groups WHERE id = ?").run(key);
    } else if (type === "member") {
      db.prepare("DELETE FROM asset_group_members WHERE id = ?").run(key);
    }
  }

  syncToSupabase(async () => {
    const sb = getSupabase()!;
    if (type === "group") {
      return sb.from("asset_groups").delete().eq("id", key).eq("user_id", userId!);
    } else {
      // asset_group_members has no user_id — scope via parent group ownership
      const { data: member } = await sb.from("asset_group_members").select("group_id").eq("id", key).single();
      if (!member) return;
      const { data: parentGroup } = await sb.from("asset_groups").select("id").eq("id", member.group_id).eq("user_id", userId!).single();
      if (!parentGroup) return; // caller doesn't own the parent group — abort
      return sb.from("asset_group_members").delete().eq("id", key);
    }
  });

  return NextResponse.json({ ok: true });
}
