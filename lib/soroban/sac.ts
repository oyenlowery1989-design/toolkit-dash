// lib/soroban/sac.ts
//
// Stellar Asset Contract (SAC) utilities.
// A SAC is a Soroban contract auto-generated for any classic Stellar asset.
// Its address is deterministic (computed from asset code + issuer + network passphrase).
// Deploying it is a one-time on-chain operation that costs ~0.1 XLM in fees.
// The underlying classic asset is unchanged — same DEX, same holders, same Lobstr.

import {
  Asset,
  Contract,
  Networks,
  rpc,
  xdr,
} from "stellar-sdk";

type Network = "public" | "testnet" | "futurenet" | "local";

export const NETWORK_PASSPHRASES: Record<Network, string> = {
  public: Networks.PUBLIC,
  testnet: Networks.TESTNET,
  futurenet: Networks.FUTURENET,
  local: Networks.TESTNET,
};

// ---------------------------------------------------------------------------
// RPC endpoints (Soroban RPC — different from Horizon)
// ---------------------------------------------------------------------------

export const SOROBAN_RPC_URLS: Record<Exclude<Network, "local">, string> = {
  public: "https://mainnet.sorobanrpc.com",
  testnet: "https://soroban-testnet.stellar.org",
  futurenet: "https://rpc-futurenet.stellar.org",
};

// NOTE: `localRpcUrl` is currently never supplied by any caller (checkSacDeployed,
// deploySac, the API routes, or SorobanPanel) — there is no settings field for a
// per-user local Soroban RPC endpoint (unlike `localHorizonUrl` in lib/settings.ts
// for Horizon). Selecting network "local" always hits the hardcoded default below
// regardless of a user's actual local RPC endpoint. A full fix would need a new
// settings field + UI control; out of scope for this pass.
export function resolveRpcUrl(network: Network, localRpcUrl?: string): string {
  if (network === "local") return localRpcUrl ?? "http://localhost:8000/soroban/rpc";
  return SOROBAN_RPC_URLS[network];
}

// ---------------------------------------------------------------------------
// computeSacAddress
// Returns the deterministic SAC contract ID (C... StrKey) for any classic asset.
// Free — no transaction needed.
// ---------------------------------------------------------------------------

export function computeSacAddress(
  assetCode: string,
  issuer: string,
  network: Network,
): string {
  const asset =
    assetCode.toUpperCase() === "XLM" && !issuer
      ? Asset.native()
      : new Asset(assetCode, issuer);
  return asset.contractId(NETWORK_PASSPHRASES[network]);
}

// ---------------------------------------------------------------------------
// checkSacDeployed
// Queries the Soroban RPC to check whether the SAC has been deployed on-chain.
// ---------------------------------------------------------------------------

export async function checkSacDeployed(
  contractId: string,
  network: Network,
  signal?: AbortSignal,
): Promise<boolean> {
  const rpcUrl = resolveRpcUrl(network);
  const server = new rpc.Server(rpcUrl);

  const contract = new Contract(contractId);
  const ledgerKey = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: contract.address().toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );

  const result = await server.getLedgerEntries(ledgerKey);
  if (signal?.aborted) throw new Error("Aborted");
  return result.entries.length > 0;
}

// ---------------------------------------------------------------------------
// deploySac
// Builds, simulates, signs, and submits the SAC deployment transaction.
// Returns { contractId, txHash } on success.
// ---------------------------------------------------------------------------
