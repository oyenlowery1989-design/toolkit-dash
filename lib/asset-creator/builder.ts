// lib/asset-creator/builder.ts
import {
  Keypair,
  TransactionBuilder,
  Operation,
  Asset,
  Memo,
  BASE_FEE,
} from "stellar-sdk";
import { signCreationTransaction } from "./signing";
import type { Horizon } from "stellar-sdk";
import type { AssetCreatorForm, SignedTx, CreationStrategy } from "./types";

const ISSUER_FUND_XLM = "2.1";
const DISTRIB_FUND_XLM = "2.0";
const TX_TIMEOUT = 180;

/** Check if an account already exists on Horizon. */
export async function accountExists(server: Horizon.Server, publicKey: string): Promise<boolean> {
  try {
    await server.loadAccount(publicKey);
    return true;
  } catch {
    return false;
  }
}

/** Check if an account already holds at least `minAmount` of the given asset. */
async function hasSufficientBalance(
  server: Horizon.Server,
  publicKey: string,
  asset: Asset,
  minAmount: number,
): Promise<boolean> {
  try {
    const account = await server.loadAccount(publicKey);
    const match = account.balances.find(
      (b: { asset_type: string; asset_code?: string; asset_issuer?: string; balance: string }) =>
        asset.isNative()
          ? b.asset_type === "native"
          : b.asset_code === asset.getCode() && b.asset_issuer === asset.getIssuer(),
    );
    if (!match) return false;
    return parseFloat(match.balance) >= minAmount;
  } catch {
    return false;
  }
}

export const StandardStrategy: CreationStrategy = {
  id: "standard",
  label: "Standard",

  async buildTransactions(
    form: AssetCreatorForm,
    steps: Array<SignedTx["stepId"]>,
    server: Horizon.Server,
    networkPassphrase: string,
    signal: AbortSignal,
  ): Promise<SignedTx[]> {
    const results: SignedTx[] = [];

    for (const stepId of steps) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");

      if (stepId === "fund-accounts") {
        // Check which accounts already exist — only create missing ones
        const [issuerExists, distribExists] = await Promise.all([
          accountExists(server, form.issuerPublicKey),
          accountExists(server, form.distributorPublicKey),
        ]);
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");

        // If both already exist, nothing to do
        if (issuerExists && distribExists) continue;

        const fundingPublicKey = form.fundingWalletId ? form.fundingPublicKey! : Keypair.fromSecret(form.resolvedFundingSecretKey).publicKey();
        const fundingAccount = await server.loadAccount(fundingPublicKey);
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");

        const builder = new TransactionBuilder(fundingAccount, { fee: BASE_FEE, networkPassphrase });

        if (!issuerExists) {
          builder.addOperation(Operation.createAccount({
            destination: form.issuerPublicKey,
            startingBalance: ISSUER_FUND_XLM,
          }));
        }
        if (!distribExists) {
          builder.addOperation(Operation.createAccount({
            destination: form.distributorPublicKey,
            startingBalance: DISTRIB_FUND_XLM,
          }));
        }

        const tx = builder.setTimeout(TX_TIMEOUT).build();
        const xdr = await signCreationTransaction(tx, form.fundingWalletId, form.resolvedFundingSecretKey, stepId, signal, networkPassphrase);
        results.push({
          stepId: "fund-accounts",
          label: "Fund issuer + distributor accounts",
          xdr,
          sourceAccount: fundingPublicKey,
        });
      }

      if (stepId === "set-home-domain") {
        if (!form.homeDomain) continue;
        const issuerPublicKey = form.issuerPublicKey;
        const issuerAccount = await server.loadAccount(issuerPublicKey);
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");

        const tx = new TransactionBuilder(issuerAccount, { fee: BASE_FEE, networkPassphrase })
          .addOperation(Operation.setOptions({ homeDomain: form.homeDomain }))
          .setTimeout(TX_TIMEOUT)
          .build();

        const xdr = await signCreationTransaction(tx, form.issuerWalletId, form.issuerSecretKey, stepId, signal, networkPassphrase);
        results.push({
          stepId: "set-home-domain",
          label: "Set home domain on issuer",
          xdr,
          sourceAccount: issuerPublicKey,
        });
      }

      if (stepId === "trustline") {
        const distributorPublicKey = form.distributorPublicKey;
        const distribAccount = await server.loadAccount(distributorPublicKey);
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");

        const asset = new Asset(form.assetCode, form.issuerPublicKey);
        const tx = new TransactionBuilder(distribAccount, { fee: BASE_FEE, networkPassphrase })
          .addOperation(Operation.changeTrust({ asset }))
          .setTimeout(TX_TIMEOUT)
          .build();

        const xdr = await signCreationTransaction(tx, form.distributorWalletId, form.distributorSecretKey, stepId, signal, networkPassphrase);
        results.push({
          stepId: "trustline",
          label: "Distributor establishes trustline",
          xdr,
          sourceAccount: distributorPublicKey,
        });
      }

      if (stepId === "issuance") {
        const asset = new Asset(form.assetCode, form.issuerPublicKey);

        // Idempotency guard: if the distributor already holds the full supply,
        // a prior submission likely committed even though the client saw a
        // timeout/error — skip re-minting to avoid permanently double-issuing.
        const alreadyIssued = await hasSufficientBalance(
          server,
          form.distributorPublicKey,
          asset,
          form.supply,
        );
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        if (alreadyIssued) continue;

        const issuerPublicKey = form.issuerPublicKey;
        const issuerAccount = await server.loadAccount(issuerPublicKey);
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");

        const builder = new TransactionBuilder(issuerAccount, { fee: BASE_FEE, networkPassphrase })
          .addOperation(Operation.payment({
            destination: form.distributorPublicKey,
            asset,
            amount: form.supply.toFixed(7), // prevent scientific notation for large numbers
          }));

        if (form.memo) builder.addMemo(Memo.text(form.memo));

        const tx = builder.setTimeout(TX_TIMEOUT).build();
        const xdr = await signCreationTransaction(tx, form.issuerWalletId, form.issuerSecretKey, stepId, signal, networkPassphrase);
        results.push({
          stepId: "issuance",
          label: "Issuer mints supply to distributor",
          xdr,
          sourceAccount: issuerPublicKey,
        });
      }
    }

    return results;
  },
};
