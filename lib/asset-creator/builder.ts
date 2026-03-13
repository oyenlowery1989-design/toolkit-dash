// lib/asset-creator/builder.ts
import {
  Keypair,
  TransactionBuilder,
  Operation,
  Asset,
  Memo,
  BASE_FEE,
} from "stellar-sdk";
import type { Horizon } from "stellar-sdk";
import type { AssetCreatorForm, SignedTx, CreationStrategy } from "./types";

const ISSUER_FUND_XLM = "2.1";
const DISTRIB_FUND_XLM = "2.0";
const TX_TIMEOUT = 180;

/** Check if an account already exists on Horizon. */
async function accountExists(server: Horizon.Server, publicKey: string): Promise<boolean> {
  try {
    await server.loadAccount(publicKey);
    return true;
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
        const fundingKp = Keypair.fromSecret(form.resolvedFundingSecretKey);
        const [issuerExists, distribExists] = await Promise.all([
          accountExists(server, form.issuerPublicKey),
          accountExists(server, form.distributorPublicKey),
        ]);
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");

        // If both already exist, nothing to do
        if (issuerExists && distribExists) continue;

        const fundingAccount = await server.loadAccount(fundingKp.publicKey());
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
        tx.sign(fundingKp);
        results.push({
          stepId: "fund-accounts",
          label: "Fund issuer + distributor accounts",
          xdr: tx.toEnvelope().toXDR("base64"),
          sourceAccount: fundingKp.publicKey(),
        });
      }

      if (stepId === "set-home-domain") {
        if (!form.homeDomain) continue;
        const issuerKp = Keypair.fromSecret(form.issuerSecretKey);
        const issuerAccount = await server.loadAccount(issuerKp.publicKey());
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");

        const tx = new TransactionBuilder(issuerAccount, { fee: BASE_FEE, networkPassphrase })
          .addOperation(Operation.setOptions({ homeDomain: form.homeDomain }))
          .setTimeout(TX_TIMEOUT)
          .build();

        tx.sign(issuerKp);
        results.push({
          stepId: "set-home-domain",
          label: "Set home domain on issuer",
          xdr: tx.toEnvelope().toXDR("base64"),
          sourceAccount: issuerKp.publicKey(),
        });
      }

      if (stepId === "trustline") {
        const distribKp = Keypair.fromSecret(form.distributorSecretKey);
        const distribAccount = await server.loadAccount(distribKp.publicKey());
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");

        const asset = new Asset(form.assetCode, form.issuerPublicKey);
        const tx = new TransactionBuilder(distribAccount, { fee: BASE_FEE, networkPassphrase })
          .addOperation(Operation.changeTrust({ asset }))
          .setTimeout(TX_TIMEOUT)
          .build();

        tx.sign(distribKp);
        results.push({
          stepId: "trustline",
          label: "Distributor establishes trustline",
          xdr: tx.toEnvelope().toXDR("base64"),
          sourceAccount: distribKp.publicKey(),
        });
      }

      if (stepId === "issuance") {
        const issuerKp = Keypair.fromSecret(form.issuerSecretKey);
        const issuerAccount = await server.loadAccount(issuerKp.publicKey());
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");

        const asset = new Asset(form.assetCode, form.issuerPublicKey);
        const builder = new TransactionBuilder(issuerAccount, { fee: BASE_FEE, networkPassphrase })
          .addOperation(Operation.payment({
            destination: form.distributorPublicKey,
            asset,
            amount: form.supply.toFixed(7), // prevent scientific notation for large numbers
          }));

        if (form.memo) builder.addMemo(Memo.text(form.memo));

        const tx = builder.setTimeout(TX_TIMEOUT).build();
        tx.sign(issuerKp);
        results.push({
          stepId: "issuance",
          label: "Issuer mints supply to distributor",
          xdr: tx.toEnvelope().toXDR("base64"),
          sourceAccount: issuerKp.publicKey(),
        });
      }
    }

    return results;
  },
};
