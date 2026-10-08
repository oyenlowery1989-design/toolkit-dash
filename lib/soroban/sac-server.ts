import { Asset, Keypair, Operation, TransactionBuilder, rpc, xdr } from "stellar-sdk";
import { executeMainnetTransaction } from "@/lib/mainnet-execution";
import { checkSacDeployed, resolveRpcUrl, NETWORK_PASSPHRASES } from "@/lib/soroban/sac";
type Network = "public" | "testnet" | "futurenet" | "local";

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
  return executeMainnetTransaction(assembled, async () => {
  const sendResult = await server.sendTransaction(assembled);
  if (signal.aborted) throw new Error("Aborted");

  if (sendResult.status === "ERROR") {
    throw Object.assign(new Error("Submit failed — transaction rejected by network"), {
      response: { status: 400, data: { extras: { result_codes: { transaction: "tx_soroban_rejected" } } } },
    });
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
      // stellar-sdk v13 can throw "Bad union switch" when parsing the SAC
      // deployment result XDR for BOTH a successful deploy AND a failed/still
      // pending transaction — the exception message alone is not reliable
      // proof of success. Independently confirm the contract actually exists
      // on-ledger before reporting success.
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("Bad union switch")) {
        onLog(`  SDK could not parse the result XDR — verifying on-ledger…`);
        const deployed = await checkSacDeployed(contractId, network, signal).catch(() => false);
        if (signal.aborted) throw new Error("Aborted");
        if (deployed) {
          onLog(`  ✓ SAC deployed successfully (confirmed on-ledger)`);
          return { contractId, txHash };
        }
        throw new Error(
          `Could not confirm SAC deployment (SDK parse error, on-ledger check found no contract yet). Check TX: ${txHash}`,
        );
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
  });
}
