import { NextRequest, NextResponse } from "next/server";
import { checkSacDeployed, computeSacAddress, deploySac } from "@/lib/soroban/sac";
type Network = "public" | "testnet" | "futurenet" | "local";
import { getErrorMessage } from "@/lib/stellar-helpers";
import { requireAuth } from "@/lib/supabase-server";
import { loadSavedWalletSigner } from "@/lib/saved-wallet-server";
import { validateMainnetRun } from "@/lib/mainnet-safety";
import { MainnetSigningBudgetUnavailableError, reserveMainnetSignature } from "@/lib/mainnet-signing-budget";

const VALID_NETWORKS = new Set<Network>(["public"]);
class MainnetPolicyError extends Error {}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const { assetCode, issuer, secretKey, walletId, network } = await req.json();
    if (typeof assetCode !== "string" || !assetCode || typeof network !== "string" ||
      (typeof walletId !== "string" && typeof secretKey !== "string") ||
      (walletId !== undefined && secretKey !== undefined) ||
      (walletId !== undefined && (typeof walletId !== "string" || !walletId || walletId.length > 128)) ||
      (secretKey !== undefined && typeof secretKey !== "string")) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (!VALID_NETWORKS.has(network as Network)) {
      return NextResponse.json({ error: "Invalid network" }, { status: 400 });
    }
    const policyErrors = validateMainnetRun({ destinations: [], operationCount: 1, xlmAmount: 0 });
    if (policyErrors.length) return NextResponse.json({ error: policyErrors.join("; ") }, { status: 403 });
    const signer = walletId ? await loadSavedWalletSigner(walletId, auth.userId) : null;
    if (walletId && !signer) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
    const signingSecret = signer?.secret() ?? secretKey;
    if (!signingSecret) return NextResponse.json({ error: "Signing key required" }, { status: 400 });

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
      secretKey: signingSecret,
      network: network as Network,
      signal: req.signal,
      onLog: (msg) => logs.push(msg),
      validateFee: async (feeXlm, txHash, maxTime) => {
        const errors = await reserveMainnetSignature(auth.userId, txHash, maxTime,
          { destinations: [], operationCount: 1, xlmAmount: feeXlm });
        if (errors.length) throw new MainnetPolicyError(errors.join("; "));
      },
    });

    return NextResponse.json({ ...result, logs });
  } catch (e) {
    if (e instanceof MainnetPolicyError) return NextResponse.json({ error: e.message }, { status: 403 });
    if (e instanceof MainnetSigningBudgetUnavailableError) return NextResponse.json({ error: e.message }, { status: 503 });
    if (e instanceof Error && (e.message.startsWith("This wallet is watch-only") || e.message === "Saved key does not match the wallet address")) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    if (e instanceof Error && e.message === "Could not load signing wallet") {
      return NextResponse.json({ error: e.message }, { status: 503 });
    }
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 500 });
  }
}
