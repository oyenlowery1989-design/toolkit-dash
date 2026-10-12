import { Keypair } from "stellar-sdk";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly } from "@/lib/supabase-server";
import { decryptStoredSecret } from "@/lib/secret-storage";

type WalletRow = { public_key: string; secret_key: string };

/** Resolve a saved signing wallet inside a server route; never return its key to the browser. */
export async function loadSavedWalletSigner(walletId: string, userId: string | null): Promise<Keypair | null> {
  let wallet: WalletRow | null | undefined;
  if (isSupabaseOnly()) {
    const { data, error } = await getSupabase()!.from("wallets")
      .select("public_key, secret_key").eq("id", walletId).eq("user_id", userId ?? "").single();
    if (error && error.code !== "PGRST116") throw new Error("Could not load signing wallet");
    wallet = data;
  } else {
    wallet = getDb().prepare("SELECT public_key, secret_key FROM wallets WHERE id = ?").get(walletId) as WalletRow | undefined;
  }
  if (!wallet) return null;
  if (!wallet.secret_key) throw new Error("This wallet is watch-only; no signing key is saved");
  const signer = Keypair.fromSecret(decryptStoredSecret(wallet.secret_key));
  if (signer.publicKey() !== wallet.public_key) throw new Error("Saved key does not match the wallet address");
  return signer;
}
