import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly } from "@/lib/supabase-server";
import { encryptStoredSecret, isEncryptedStoredSecret } from "@/lib/secret-storage";

type SecretTable = "wallets" | "auto_send_groups" | "tiered_reward_configs";
const TABLES: SecretTable[] = ["wallets", "auto_send_groups", "tiered_reward_configs"];

export interface SecretMigrationReport {
  scanned: number;
  migrated: number;
  alreadyEncrypted: number;
  empty: number;
}

function freshReport(): SecretMigrationReport {
  return { scanned: 0, migrated: 0, alreadyEncrypted: 0, empty: 0 };
}

export async function inspectAndMigrateLegacySecrets(
  userId: string | null,
  migrate: boolean,
): Promise<Record<SecretTable, SecretMigrationReport>> {
  const reports = Object.fromEntries(TABLES.map((table) => [table, freshReport()])) as Record<SecretTable, SecretMigrationReport>;

  if (isSupabaseOnly()) {
    if (!userId) throw new Error("Authenticated user id required for Supabase secret migration");
    const sb = getSupabase()!;
    for (const table of TABLES) {
      const { data, error } = await sb.from(table).select("id, secret_key").eq("user_id", userId);
      if (error) throw new Error(`${table}: ${error.message}`);
      for (const row of data ?? []) {
        const report = reports[table];
        report.scanned += 1;
        const stored = (row.secret_key as string | null) ?? "";
        if (!stored) { report.empty += 1; continue; }
        if (isEncryptedStoredSecret(stored)) { report.alreadyEncrypted += 1; continue; }
        if (!migrate) continue;
        const { error: updateError } = await sb.from(table)
          .update({ secret_key: encryptStoredSecret(stored) })
          .eq("id", row.id)
          .eq("user_id", userId);
        if (updateError) throw new Error(`${table}/${row.id}: ${updateError.message}`);
        report.migrated += 1;
      }
    }
    return reports;
  }

  const db = getDb();
  const migrateLocal = db.transaction(() => {
    for (const table of TABLES) {
      const rows = db.prepare(`SELECT id, secret_key FROM ${table}`).all() as Array<{ id: string; secret_key: string }>;
      for (const row of rows) {
        const report = reports[table];
        report.scanned += 1;
        if (!row.secret_key) { report.empty += 1; continue; }
        if (isEncryptedStoredSecret(row.secret_key)) { report.alreadyEncrypted += 1; continue; }
        if (!migrate) continue;
        db.prepare(`UPDATE ${table} SET secret_key = ? WHERE id = ?`)
          .run(encryptStoredSecret(row.secret_key), row.id);
        report.migrated += 1;
      }
    }
  });
  migrateLocal();
  return reports;
}
