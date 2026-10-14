import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const script = pathToFileURL(resolve("scripts/backup-drill.mjs")).href;

function runDrill(source: "local" | "supabase", afterLabel: string) {
  const code = `
    const tables = ${JSON.stringify([
      "address_book", "known_intermediaries", "known_creators", "saved_analyses", "bulk_recipients",
      "proceeds_presets", "saved_searches", "bulk_run_history", "asset_groups", "asset_group_members",
      "wallet_folders", "wallets", "app_state", "auto_send_groups", "auto_send_destinations",
      "auto_send_run_log", "persons", "person_addresses", "person_relationships", "creator_children",
      "bulk_scan_state", "bulk_payment_journal", "tiered_reward_configs", "tiered_reward_tiers",
      "tiered_reward_assets", "tiered_reward_run_log", "tiered_reward_run_leases", "tracer_watchlist",
      "tracer_watch_events", "key_scan_state", "key_scan_hits",
    ])};
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (calls === 2) return Response.json({ ok: true, counts: Object.fromEntries(tables.map(name => [name, 0])) });
      const payload = Object.fromEntries(tables.map(name => [name, []]));
      payload.address_book = [{ id: "same", label: calls === 1 ? "before" : ${JSON.stringify(afterLabel)} }];
      return Response.json({ source: "sqlite", ...payload });
    };
    await import(${JSON.stringify(script)});
  `;
  return spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    encoding: "utf8",
    env: {
      ...process.env,
      DRILL_BASE_URL: "http://localhost",
      DRILL_BEARER_TOKEN: "test",
      DRILL_CONFIRM_DISPOSABLE: "DISPOSABLE",
      DRILL_RESTORE_SOURCE: source,
    },
  });
}

it("rejects a same-source restore when row values change but counts do not", () => {
  const result = runDrill("local", "after");
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Post-restore content changed");
});

it("does not claim the destination content was verified", () => {
  const result = runDrill("local", "before");
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('"stage":"source-unchanged-target-unverified"');
  expect(result.stdout).toContain('"targetContentVerified":false');
});

it("labels cross-source verification as count-only", () => {
  const result = runDrill("supabase", "after");
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('"stage":"restore-counts-checked"');
  expect(result.stdout).toContain('"targetContentVerified":false');
});
