import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
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

/** GET /api/db/groups — all groups with members */
export async function GET() {
  const db = getDb();
  const groups = db
    .prepare("SELECT * FROM asset_groups ORDER BY updated_at DESC")
    .all() as GroupRow[];
  const allMembers = db
    .prepare("SELECT * FROM asset_group_members ORDER BY added_at ASC")
    .all() as MemberRow[];

  const membersByGroup = new Map<string, GroupMember[]>();
  for (const m of allMembers) {
    const gid = m.group_id as string;
    if (!membersByGroup.has(gid)) membersByGroup.set(gid, []);
    membersByGroup.get(gid)!.push(rowToMember(m));
  }

  return NextResponse.json(
    groups.map((g) => rowToGroup(g, membersByGroup.get(g.id as string) ?? [])),
  );
}

/** POST /api/db/groups — create group or upsert member */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const db = getDb();
  const now = Date.now();

  if (body.type === "group") {
    const { id, name, assetCode, issuer, network, notes } = body;
    const nameTrimmed = (name ?? "").trim();
    const assetCodeNorm =
      typeof assetCode === "string" ? assetCode.trim().toUpperCase() : null;
    const issuerNorm = typeof issuer === "string" ? issuer.trim() : null;
    const networkNorm = typeof network === "string" ? network : "public";

    if (assetCodeNorm && issuerNorm) {
      const existing = db
        .prepare(
          `SELECT id FROM asset_groups
           WHERE asset_code = ? AND issuer = ? AND network = ?
           LIMIT 1`,
        )
        .get(assetCodeNorm, issuerNorm, networkNorm) as
        | { id: string }
        | undefined;
      if (existing) {
        return NextResponse.json({
          ok: true,
          existingId: existing.id,
          reused: true,
        });
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
      ).run(
        id,
        nameTrimmed,
        assetCodeNorm,
        issuerNorm,
        networkNorm,
        notes ?? null,
        now,
        now,
      );
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
                  .get(assetCodeNorm, issuerNorm, networkNorm) as
                  | { id: string }
                  | undefined
              )?.id
            : undefined;

        return NextResponse.json(
          { ok: false, error: "duplicate_asset_group", existingId },
          { status: 409 },
        );
      }
      throw error;
    }
  }

  if (body.type === "member") {
    // Upsert a member into a group
    const { id, groupId, address, role, label, notes, homeDomain } = body;
    db.prepare(
      `INSERT INTO asset_group_members (id, group_id, address, role, label, notes, home_domain, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(group_id, address) DO UPDATE SET
         role        = excluded.role,
         label       = excluded.label,
         notes       = excluded.notes,
         home_domain = excluded.home_domain`,
    ).run(
      id,
      groupId,
      address,
      role,
      label ?? null,
      notes ?? null,
      homeDomain ?? null,
      now,
    );

    // bump group updated_at
    db.prepare("UPDATE asset_groups SET updated_at = ? WHERE id = ?").run(
      now,
      groupId,
    );
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown type" }, { status: 400 });
}

/** PATCH /api/db/groups — update group metadata or member field */
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const db = getDb();
  const now = Date.now();

  if (body.type === "group") {
    const { id, name, notes, assetCode, issuer, network } = body;
    db.prepare(
      `UPDATE asset_groups SET
         name       = COALESCE(?, name),
         notes      = COALESCE(?, notes),
         asset_code = COALESCE(?, asset_code),
         issuer     = COALESCE(?, issuer),
         network    = COALESCE(?, network),
         updated_at = ?
       WHERE id = ?`,
    ).run(
      name ?? null,
      notes ?? null,
      assetCode ?? null,
      issuer ?? null,
      network ?? null,
      now,
      id,
    );
    return NextResponse.json({ ok: true });
  }

  if (body.type === "member") {
    const { id, label, notes, role, homeDomain, groupId } = body;
    db.prepare(
      `UPDATE asset_group_members SET
         label       = COALESCE(?, label),
         notes       = COALESCE(?, notes),
         role        = COALESCE(?, role),
         home_domain = COALESCE(?, home_domain)
       WHERE id = ?`,
    ).run(label ?? null, notes ?? null, role ?? null, homeDomain ?? null, id);
    if (groupId) {
      db.prepare("UPDATE asset_groups SET updated_at = ? WHERE id = ?").run(
        now,
        groupId,
      );
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown type" }, { status: 400 });
}

/** DELETE /api/db/groups — delete group or member */
export async function DELETE(req: NextRequest) {
  const { key, type } = await req.json();
  const db = getDb();

  if (type === "group") {
    // CASCADE deletes members too
    db.prepare("DELETE FROM asset_groups WHERE id = ?").run(key);
  } else if (type === "member") {
    db.prepare("DELETE FROM asset_group_members WHERE id = ?").run(key);
  }

  return NextResponse.json({ ok: true });
}
