import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly, requireAuth } from "@/lib/supabase-server";
import { readPages } from "@/lib/supabase-read-all";
import { parseAssetPair } from "@/lib/asset-pair";

/** Only the current user's distributors for this exact ledger asset. */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const assetCode = req.nextUrl.searchParams.get("assetCode") ?? "";
  const issuer = req.nextUrl.searchParams.get("issuer") ?? "";
  const network = req.nextUrl.searchParams.get("network") ?? "";
  const pair = parseAssetPair(`${assetCode}:${issuer}`);
  if (!pair || pair.assetCode !== assetCode || pair.issuer !== issuer ||
      !["public", "testnet", "futurenet", "local"].includes(network)) {
    return NextResponse.json({ error: "Invalid asset or network" }, { status: 400 });
  }
  try {
    const accounts: string[] = [];
    if (isSupabaseOnly()) {
      const sb = getSupabase()!;
      const groups = await readPages((from, to) => sb.from("asset_groups").select("id", { count: "exact" })
        .eq("user_id", auth.userId!).eq("asset_code", assetCode).eq("issuer", issuer).eq("network", network)
        .order("id").range(from, to));
      if (groups.error) throw new Error(groups.error.message);
      const ids = groups.data!.map(group => group.id as string);
      for (let i = 0; i < ids.length; i += 100) {
        const members = await readPages((from, to) => sb.from("asset_group_members").select("address", { count: "exact" })
          .in("group_id", ids.slice(i, i + 100)).eq("role", "distributor").order("id").range(from, to));
        if (members.error) throw new Error(members.error.message);
        accounts.push(...members.data!.map(member => member.address as string));
      }
    } else {
      const rows = getDb().prepare(`SELECT DISTINCT m.address FROM asset_group_members m
        JOIN asset_groups g ON g.id = m.group_id
        WHERE g.asset_code = ? AND g.issuer = ? AND g.network = ? AND m.role = 'distributor'
        ORDER BY m.address`).all(assetCode, issuer, network) as { address: string }[];
      accounts.push(...rows.map(row => row.address));
    }
    return NextResponse.json({ accounts: [...new Set(accounts)] }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Saved distributors could not be loaded. Retry the analysis or enter seller accounts manually." }, { status: 502 });
  }
}
