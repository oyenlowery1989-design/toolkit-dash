import { NextRequest, NextResponse } from "next/server";
import { checkSacDeployed, computeSacAddress, deploySac } from "@/lib/soroban/sac";
type Network = "public" | "testnet" | "futurenet" | "local";
import { getErrorMessage } from "@/lib/stellar-helpers";
import { requireAuth } from "@/lib/supabase-server";

const VALID_NETWORKS = new Set<Network>(["public", "testnet", "futurenet", "local"]);

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const { assetCode, issuer, secretKey, network } = await req.json();
    if (!assetCode || !secretKey || !network) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (!VALID_NETWORKS.has(network)) {
      return NextResponse.json({ error: "Invalid network" }, { status: 400 });
    }

    // Never trust the client's possibly-stale deployStatus — independently
    // verify on-chain before attempting a (redundant, possibly failing)
    // redeploy of an already-deployed contract.
    const contractId = computeSacAddress(assetCode, issuer ?? "", network as Network);
    const alreadyDeployed = await checkSacDeployed(contractId, network as Network, req.signal);
    if (alreadyDeployed) {
      return NextResponse.json(
        { error: "Contract already deployed", contractId },
        { status: 409 },
      );
    }

    const logs: string[] = [];
    const result = await deploySac({
      assetCode,
      issuer: issuer ?? "",
      secretKey,
      network: network as Network,
      signal: req.signal,
      onLog: (msg) => logs.push(msg),
    });

    return NextResponse.json({ ...result, logs });
  } catch (e) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 500 });
  }
}
