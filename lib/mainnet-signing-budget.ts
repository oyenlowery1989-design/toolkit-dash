import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly } from "@/lib/supabase-server";
import { getMainnetSafetyConfig, validateMainnetRun, type MainnetRunIntent } from "@/lib/mainnet-safety";

const BUCKET = "global";
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RETRIES = 8;

type Entry = { hash: string; stroops: number; countedUntil: number };
type SigningIntent = Omit<MainnetRunIntent, "xlmSentLast24Hours">;

export class MainnetSigningBudgetUnavailableError extends Error {
  constructor(message = "Could not verify the daily mainnet signing budget") {
    super(message);
    this.name = "MainnetSigningBudgetUnavailableError";
  }
}

function readEntries(raw: string | undefined): Entry[] {
  if (!raw) return [];
  const entries: unknown = JSON.parse(raw);
  if (!Array.isArray(entries) || !entries.every((entry) =>
    entry && typeof entry === "object" &&
    typeof entry.hash === "string" && /^[0-9a-f]{64}$/.test(entry.hash) &&
    Number.isSafeInteger(entry.stroops) && entry.stroops >= 0 &&
    Number.isSafeInteger(entry.countedUntil),
  )) throw new MainnetSigningBudgetUnavailableError("Mainnet signing budget data is invalid");
  return entries as Entry[];
}

/** Read the same conservative rolling balance used by reservations, for previews. */
export async function getReservedMainnetXlm(now = Date.now()): Promise<number> {
  try {
    let raw: string | undefined;
    if (isSupabaseOnly()) {
      const sb = getSupabase();
      if (!sb) throw new MainnetSigningBudgetUnavailableError();
      const { data, error } = await sb.from("mainnet_signing_budget")
        .select("entries_json").eq("bucket_key", BUCKET).maybeSingle();
      if (error) throw error;
      raw = data?.entries_json as string | undefined;
    } else {
      const row = getDb().prepare("SELECT entries_json FROM mainnet_signing_budget WHERE bucket_key = ?")
        .get(BUCKET) as { entries_json: string } | undefined;
      raw = row?.entries_json;
    }
    const stroops = readEntries(raw).filter((entry) => entry.countedUntil > now)
      .reduce((sum, entry) => sum + entry.stroops, 0);
    if (!Number.isSafeInteger(stroops)) throw new MainnetSigningBudgetUnavailableError();
    return stroops / 1e7;
  } catch (error) {
    if (error instanceof MainnetSigningBudgetUnavailableError) throw error;
    throw new MainnetSigningBudgetUnavailableError();
  }
}

function planReservation(raw: string | undefined, hash: string, stroops: number, countedUntil: number, intent: SigningIntent, now: number) {
  const entries = readEntries(raw).filter((entry) => entry.countedUntil > now);
  const existing = entries.find((entry) => entry.hash === hash);
  if (existing && existing.countedUntil !== countedUntil) {
    throw new MainnetSigningBudgetUnavailableError("Transaction hash conflicts with an existing signing reservation");
  }
  const effectiveStroops = Math.max(existing?.stroops ?? 0, stroops);
  const reserved = entries.reduce((sum, entry) => sum + entry.stroops, 0) - (existing?.stroops ?? 0);
  if (!Number.isSafeInteger(reserved)) throw new MainnetSigningBudgetUnavailableError("Mainnet signing budget is too large");
  const errors = validateMainnetRun({ ...intent, xlmAmount: effectiveStroops / 1e7, xlmSentLast24Hours: reserved / 1e7 });
  const dailyLimit = getMainnetSafetyConfig().maxXlmPerDay;
  if (reserved + effectiveStroops > Math.floor(dailyLimit * 1e7 + 1e-8) &&
    !errors.some((error) => error.startsWith("Daily XLM limit"))) {
    errors.push(`Daily XLM limit of ${dailyLimit} would be exceeded`);
  }
  return {
    errors,
    duplicate: !!existing && existing.stroops >= stroops,
    value: JSON.stringify([...entries.filter((entry) => entry.hash !== hash), { hash, stroops: effectiveStroops, countedUntil }]),
  };
}

/** Reserve the possible XLM spend before server-controlled signing/submission.
 *  Unsubmitted signatures conservatively count until 24h after their expiry. */
export async function reserveMainnetSignature(
  _userId: string | null,
  txHash: string,
  maxTimeSeconds: number,
  intent: SigningIntent,
  now = Date.now(),
): Promise<string[]> {
  if (!/^[0-9a-f]{64}$/.test(txHash) || !Number.isSafeInteger(maxTimeSeconds) ||
    maxTimeSeconds * 1000 <= now || maxTimeSeconds * 1000 > now + 5 * 60_000 ||
    !Number.isFinite(intent.xlmAmount) || intent.xlmAmount < 0) {
    throw new MainnetSigningBudgetUnavailableError("Invalid mainnet signing reservation");
  }
  const stroops = Math.ceil(intent.xlmAmount * 1e7 - 1e-8);
  const countedUntil = maxTimeSeconds * 1000 + DAY_MS;
  if (!Number.isSafeInteger(stroops) || !Number.isSafeInteger(countedUntil)) {
    throw new MainnetSigningBudgetUnavailableError("Invalid mainnet signing amount");
  }

  if (!isSupabaseOnly()) {
    try {
      const db = getDb();
      return db.transaction(() => {
        const row = db.prepare("SELECT entries_json FROM mainnet_signing_budget WHERE bucket_key = ?")
          .get(BUCKET) as { entries_json: string } | undefined;
        const planned = planReservation(row?.entries_json, txHash, stroops, countedUntil, intent, now);
        if (planned.errors.length || planned.duplicate) return planned.errors;
        db.prepare(`INSERT INTO mainnet_signing_budget (bucket_key, entries_json) VALUES (?, ?)
          ON CONFLICT(bucket_key) DO UPDATE SET entries_json = excluded.entries_json`).run(BUCKET, planned.value);
        return [];
      })();
    } catch (error) {
      if (error instanceof MainnetSigningBudgetUnavailableError) throw error;
      throw new MainnetSigningBudgetUnavailableError();
    }
  }

  const sb = getSupabase();
  if (!sb) throw new MainnetSigningBudgetUnavailableError();
  try {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const { data: row, error: readError } = await sb.from("mainnet_signing_budget")
        .select("entries_json").eq("bucket_key", BUCKET).maybeSingle();
      if (readError) throw readError;
      const raw = row?.entries_json as string | undefined;
      const planned = planReservation(raw, txHash, stroops, countedUntil, intent, now);
      if (planned.errors.length || planned.duplicate) return planned.errors;
      if (raw === undefined) {
        const { error } = await sb.from("mainnet_signing_budget")
          .insert({ bucket_key: BUCKET, entries_json: planned.value });
        if (!error) return [];
        if (error.code === "23505") continue;
        throw error;
      }
      const { data, error } = await sb.from("mainnet_signing_budget")
        .update({ entries_json: planned.value })
        .eq("bucket_key", BUCKET).eq("entries_json", raw).select("bucket_key");
      if (error) throw error;
      if (data?.length === 1) return [];
    }
  } catch (error) {
    if (error instanceof MainnetSigningBudgetUnavailableError) throw error;
    throw new MainnetSigningBudgetUnavailableError();
  }
  throw new MainnetSigningBudgetUnavailableError("Mainnet signing budget is busy; retry the preview");
}
