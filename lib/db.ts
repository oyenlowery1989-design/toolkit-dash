/**
 * SQLite database singleton for Stellar Toolkit.
 * The DB file lives at <project-root>/stellar-toolkit.db.
 * Uses better-sqlite3 (synchronous, no connection pooling needed).
 * Pattern: global singleton so Next.js HMR doesn't open multiple connections.
 */

import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "stellar-toolkit.db");

declare global {
  // eslint-disable-next-line no-var
  var _stellarDb: Database.Database | undefined;
}

function initDb(): Database.Database {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL"); // better concurrent read performance
  db.pragma("foreign_keys = ON");

  db.exec(`
    -- ── User data (critical — never lose this) ─────────────────────────────

    CREATE TABLE IF NOT EXISTS address_book (
      public_key  TEXT    PRIMARY KEY,
      label       TEXT    NOT NULL,
      notes       TEXT,
      color       TEXT,
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS known_intermediaries (
      address   TEXT    PRIMARY KEY,
      name      TEXT    NOT NULL,
      notes     TEXT,
      added_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS known_creators (
      address   TEXT    PRIMARY KEY,
      name      TEXT    NOT NULL,
      notes     TEXT,
      added_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS saved_analyses (
      id                TEXT    PRIMARY KEY,
      name              TEXT    NOT NULL,
      asset_code        TEXT    NOT NULL,
      issuer            TEXT    NOT NULL,
      distrib_addresses TEXT    NOT NULL,  -- JSON array of strings
      network           TEXT    NOT NULL,
      result_json       TEXT    NOT NULL,  -- full AssetProceedsResult JSON
      notes             TEXT,
      tags              TEXT,              -- JSON array of strings
      created_at        INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bulk_recipients (
      id          TEXT    PRIMARY KEY,
      name        TEXT    NOT NULL,
      network     TEXT    NOT NULL,
      addresses   TEXT    NOT NULL,  -- JSON array of strings
      assets_text TEXT,
      saved_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS proceeds_presets (
      id                   TEXT    PRIMARY KEY,
      asset_code           TEXT    NOT NULL,
      issuer               TEXT    NOT NULL,
      distribution_address TEXT    NOT NULL,
      network              TEXT    NOT NULL,
      accounts_text        TEXT    NOT NULL,
      created_at           INTEGER NOT NULL
    );

    -- ── Search history (important UX — sidebar, dashboard) ──────────────────

    CREATE TABLE IF NOT EXISTS saved_searches (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      type                TEXT    NOT NULL,
      value               TEXT    NOT NULL,
      label               TEXT,
      network             TEXT,
      distrib_address     TEXT,
      total_xlm_proceeds  REAL,
      total_asset_sold    REAL,
      intermediary_name   TEXT,
      accounts_found      INTEGER,
      created_at          INTEGER NOT NULL,
      UNIQUE(type, value)
    );

    CREATE TABLE IF NOT EXISTS bulk_run_history (
      id               TEXT    PRIMARY KEY,
      network          TEXT    NOT NULL,
      memo             TEXT    NOT NULL,
      recipient_count  INTEGER NOT NULL,
      success_count    INTEGER NOT NULL,
      failed_count     INTEGER NOT NULL,
      ran_at           INTEGER NOT NULL
    );

    -- ── Asset Groups (case files — cluster related addresses around an asset) ─

    CREATE TABLE IF NOT EXISTS asset_groups (
      id          TEXT    PRIMARY KEY,
      name        TEXT    NOT NULL,
      asset_code  TEXT,
      issuer      TEXT,
      network     TEXT    NOT NULL DEFAULT 'public',
      notes       TEXT,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_groups_identity
    ON asset_groups(asset_code, issuer, network)
    WHERE asset_code IS NOT NULL AND issuer IS NOT NULL;

    CREATE TABLE IF NOT EXISTS asset_group_members (
      id          TEXT    PRIMARY KEY,
      group_id    TEXT    NOT NULL REFERENCES asset_groups(id) ON DELETE CASCADE,
      address     TEXT    NOT NULL,
      role        TEXT    NOT NULL,   -- issuer|distributor|creator|intermediary|bank|withdrawal|destination|service|other
      label       TEXT,
      notes       TEXT,
      home_domain TEXT,
      added_at    INTEGER NOT NULL,
      UNIQUE(group_id, address)
    );

    CREATE INDEX IF NOT EXISTS idx_group_members_group ON asset_group_members(group_id);
    CREATE INDEX IF NOT EXISTS idx_group_members_address ON asset_group_members(address);

    -- ── Wallet Manager ────────────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS wallet_folders (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      position    INTEGER NOT NULL DEFAULT 0
    );

    -- Note: wallets table may pre-exist without folder_id (old schema).
    -- Migration below handles adding missing columns after this exec block.
    CREATE TABLE IF NOT EXISTS wallets (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      public_key  TEXT NOT NULL,
      secret_key  TEXT NOT NULL,
      position    INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS app_state (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL
    );
  `);

  // ── Wallet migration: ensure id + folder_id columns exist ─────────────────
  // The wallets table schema evolved over time. Recreate if id column is missing
  // (SQLite doesn't support ALTER TABLE ADD COLUMN for PRIMARY KEY columns).
  const walletCols = (db.pragma("table_info(wallets)") as { name: string }[]).map((c) => c.name);

  if (!walletCols.includes("id")) {
    // Ensure default folder exists before migration
    const defaultFolderId = "default-folder";
    db.prepare(
      "INSERT OR IGNORE INTO wallet_folders (id, name, position) VALUES (?, ?, ?)"
    ).run(defaultFolderId, "Default", 0);

    // Recreate wallets table with correct schema via rename→create→copy→drop
    db.exec(`ALTER TABLE wallets RENAME TO wallets_old`);
    db.exec(`
      CREATE TABLE wallets (
        id          TEXT PRIMARY KEY,
        folder_id   TEXT,
        name        TEXT NOT NULL,
        public_key  TEXT NOT NULL,
        secret_key  TEXT NOT NULL,
        position    INTEGER NOT NULL DEFAULT 0
      )
    `);

    // Copy existing rows, generating a unique id for each
    const oldRows = db.prepare("SELECT * FROM wallets_old").all() as Record<string, unknown>[];
    const insert = db.prepare(
      "INSERT INTO wallets (id, folder_id, name, public_key, secret_key, position) VALUES (?, ?, ?, ?, ?, ?)"
    );
    for (const row of oldRows) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const folderId = (row.folder_id as string | null) ?? defaultFolderId;
      insert.run(id, folderId, row.name, row.public_key, row.secret_key, row.position ?? 0);
    }

    db.exec(`DROP TABLE wallets_old`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_wallets_folder ON wallets(folder_id)`);
  } else if (!walletCols.includes("folder_id")) {
    // id exists but folder_id is missing — add it
    const defaultFolderId = "default-folder";
    db.prepare(
      "INSERT OR IGNORE INTO wallet_folders (id, name, position) VALUES (?, ?, ?)"
    ).run(defaultFolderId, "Default", 0);

    db.exec(`ALTER TABLE wallets ADD COLUMN folder_id TEXT`);
    db.prepare("UPDATE wallets SET folder_id = ? WHERE folder_id IS NULL").run(defaultFolderId);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_wallets_folder ON wallets(folder_id)`);
  }

  return db;
}

export function getDb(): Database.Database {
  if (!global._stellarDb) {
    global._stellarDb = initDb();
  }
  return global._stellarDb;
}
