import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly, requireAuth } from "@/lib/supabase-server";
import { Keypair, Horizon } from "stellar-sdk";
const { Server } = Horizon;

const HORIZON_URLS: Record<string, string> = {
  public: "https://horizon.stellar.org",
  testnet: "https://horizon-testnet.stellar.org",
  futurenet: "https://horizon-futurenet.stellar.org",
};

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  const groupId = req.nextUrl.searchParams.get("groupId");
  if (!groupId) return NextResponse.json({ error: "groupId required" }, { status: 400 });

  let secretKey: string | undefined;
  let network: string | undefined;

  if (isSupabaseOnly()) {
    const sb = getSupabase()!;
    const { data: g, error } = await sb
      .from("auto_send_groups")
      .select("secret_key, network")
      .eq("id", groupId)
      .eq("user_id", auth.userId!)
      .single();
    if (error || !g) return NextResponse.json({ error: "group not found" }, { status: 404 });
    secretKey = g.secret_key;
    network = g.network;
  } else {
    const db = getDb();
    const g = db.prepare(`SELECT secret_key, network FROM auto_send_groups WHERE id = ?`).get(groupId) as
      | { secret_key: string; network: string }
      | undefined;
    if (!g) return NextResponse.json({ error: "group not found" }, { status: 404 });
    secretKey = g.secret_key;
    network = g.network;
  }

  if (!secretKey) return NextResponse.json({ error: "No secret key configured for this group" }, { status: 400 });

  let keypair: Keypair;
  try {
    keypair = Keypair.fromSecret(secretKey);
  } catch {
    return NextResponse.json({ error: "Invalid secret key stored in group" }, { status: 400 });
  }

  const address = keypair.publicKey();
  const horizonUrl = HORIZON_URLS[network ?? "public"] ?? HORIZON_URLS.public;
  const server = new Server(horizonUrl);

  try {
    const account = await server.loadAccount(address);
    const native = account.balances.find(
      (b: { asset_type: string; balance: string }) => b.asset_type === "native"
    );
    const balance = parseFloat(native?.balance ?? "0");
    return NextResponse.json({ balance, address });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg.slice(0, 200) }, { status: 500 });
  }
}
