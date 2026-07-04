import { NextRequest, NextResponse } from "next/server";
import { checkSacDeployed } from "@/lib/soroban/sac";
type Network = "public" | "testnet" | "futurenet" | "local";
import { getErrorMessage } from "@/lib/stellar-helpers";

const VALID_NETWORKS = new Set<Network>(["public", "testnet", "futurenet", "local"]);

export async function POST(req: NextRequest) {
  try {
    const { contractId, network } = await req.json();
    if (!contractId || !network) {
      return NextResponse.json({ error: "Missing contractId or network" }, { status: 400 });
    }
    if (!VALID_NETWORKS.has(network)) {
      return NextResponse.json({ error: "Invalid network" }, { status: 400 });
    }
    const deployed = await checkSacDeployed(contractId, network as Network);
    return NextResponse.json({ deployed });
  } catch (e) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 500 });
  }
}
