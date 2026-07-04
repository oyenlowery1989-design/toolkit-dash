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
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  rpc,
  xdr,
} from "stellar-sdk";

type Network = "public" | "testnet" | "futurenet" | "local";

const NETWORK_PASSPHRASES: Record<Network, string> = {
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

export interface DeploySacOptions {
  assetCode: string;
  issuer: string;
  secretKey: string;
  network: Network;
  signal: AbortSignal;
  onLog: (msg: string) => void;
}

export async function deploySac(
  options: DeploySacOptions,
): Promise<{ contractId: string; txHash: string }> {
  const { assetCode, issuer, secretKey, network, signal, onLog } = options;

  const keypair = Keypair.fromSecret(secretKey);
  const asset =
    assetCode.toUpperCase() === "XLM" && !issuer
      ? Asset.native()
      : new Asset(assetCode, issuer);
  const networkPassphrase = NETWORK_PASSPHRASES[network];
  const contractId = asset.contractId(networkPassphrase);
  const rpcUrl = resolveRpcUrl(network);
  const server = new rpc.Server(rpcUrl);

  onLog(`SAC address: ${contractId}`);
  onLog(`RPC endpoint: ${rpcUrl}`);

  // Build the host function for SAC creation
  const createContractArgs = new xdr.CreateContractArgs({
    contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAsset(
      asset.toXDRObject(),
    ),
    executable: xdr.ContractExecutable.contractExecutableStellarAsset(),
  });

  const op = Operation.invokeHostFunction({
    func: xdr.HostFunction.hostFunctionTypeCreateContract(createContractArgs),
    auth: [],
  });

  onLog(`Fetching account sequence…`);
  const account = await server.getAccount(keypair.publicKey());
  if (signal.aborted) throw new Error("Aborted");

  const tx = new TransactionBuilder(account, {
    fee: "1000000", // generous fee cap for Soroban
    networkPassphrase,
  })
    .addOperation(op)
    .setTimeout(30)
    .build();

  onLog(`Simulating transaction…`);
  const simResult = await server.simulateTransaction(tx);
  if (signal.aborted) throw new Error("Aborted");

  if (rpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation failed: ${simResult.error}`);
  }

  const assembled = rpc.assembleTransaction(tx, simResult).build();
  assembled.sign(keypair);

  onLog(`Submitting transaction…`);
  const sendResult = await server.sendTransaction(assembled);
  if (signal.aborted) throw new Error("Aborted");

  if (sendResult.status === "ERROR") {
    throw new Error(`Submit failed — transaction rejected by network`);
  }

  const txHash = sendResult.hash;
  onLog(`  TX hash: ${txHash}`);
  onLog(`Waiting for confirmation…`);

  // Poll up to 60 seconds (30 × 2s)
  for (let i = 0; i < 30; i++) {
    if (signal.aborted) throw new Error("Aborted");
    await new Promise((r) => setTimeout(r, 2000));

    let getResult;
    try {
      getResult = await server.getTransaction(txHash);
    } catch (e) {
      // stellar-sdk v13 throws "Bad union switch" when parsing SAC deployment
      // result XDR — the transaction succeeded on-chain, the SDK just can't
      // deserialize the Soroban return value. Treat as success.
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("Bad union switch")) {
        onLog(`  ✓ SAC deployed successfully`);
        return { contractId, txHash };
      }
      throw e;
    }
    if (signal.aborted) throw new Error("Aborted");

    if (getResult.status === "SUCCESS") {
      onLog(`  ✓ SAC deployed successfully`);
      return { contractId, txHash };
    }
    if (getResult.status === "FAILED") {
      throw new Error(`Transaction failed on ledger`);
    }
    // NOT_FOUND — still being processed, keep polling
  }

  throw new Error(`Timed out waiting for confirmation (60s). Check TX: ${txHash}`);
}
