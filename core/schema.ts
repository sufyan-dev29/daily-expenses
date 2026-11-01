import type { SqlDb } from './db.ts';
import { one } from './db.ts';

/**
 * One encrypted database file per account, so there is no user_id column anywhere.
 * Money is stored as integer minor units (paisa/cents) so sums are exact.
 * Migrations are append-only; the applied count is kept in PRAGMA user_version.
 */
const MIGRATIONS: string[] = [
  // 1: initial schema
  `
  CREATE TABLE settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    mode TEXT NOT NULL DEFAULT 'offline' CHECK (mode IN ('offline', 'online')),
    theme_mode TEXT NOT NULL DEFAULT 'system' CHECK (theme_mode IN ('system', 'light', 'dark')),
    accent_hex TEXT NOT NULL DEFAULT '#006A6A',
    currency TEXT NOT NULL DEFAULT 'PKR',
    locale TEXT NOT NULL DEFAULT 'en-PK',
    date_format TEXT NOT NULL DEFAULT 'EEE, d MMM',
    week_start INTEGER NOT NULL DEFAULT 1 CHECK (week_start BETWEEN 1 AND 7),
    timezone TEXT NOT NULL DEFAULT 'Asia/Karachi',
    remember_last TEXT NOT NULL DEFAULT '{"category":true,"bank":true,"payment_mode":true,"need_want":true,"income_source":true}',
    trash_retention_days INTEGER NOT NULL DEFAULT 30 CHECK (trash_retention_days BETWEEN 1 AND 3650),
    sheet TEXT,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
--#
  INSERT INTO settings (id) VALUES (1);
--#

  CREATE TABLE options (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('bank', 'payment_mode', 'category', 'income_source')),
    name TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(name)) > 0),
    sort_order INTEGER NOT NULL DEFAULT 0,
    color TEXT,
    icon TEXT,
    archived_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (kind, name)
  );
--#
  CREATE INDEX options_kind_idx ON options (kind);
--#

  CREATE TABLE transactions (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('expense', 'income')),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    occurred_on TEXT NOT NULL CHECK (occurred_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    category_id TEXT REFERENCES options (id),
    bank_id TEXT REFERENCES options (id),
    payment_mode_id TEXT REFERENCES options (id),
    income_source_id TEXT REFERENCES options (id),
    need_want TEXT CHECK (need_want IN ('need', 'want')),
    notes TEXT,
    deleted_at TEXT,
    sheet_synced_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
--#
  CREATE INDEX tx_date_idx ON transactions (occurred_on DESC);
--#
  CREATE INDEX tx_deleted_idx ON transactions (deleted_at);
--#
  CREATE INDEX tx_kind_created_idx ON transactions (kind, created_at DESC);
--#
  CREATE INDEX tx_category_idx ON transactions (category_id);
--#

  CREATE TABLE templates (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('expense', 'income')),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    behavior TEXT NOT NULL DEFAULT 'fill' CHECK (behavior IN ('fill', 'instant')),
    payload TEXT NOT NULL DEFAULT '{}',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
--#
  CREATE INDEX templates_kind_idx ON templates (kind, sort_order);
--#

  -- One pending row per transaction: a newer change replaces the older one.
  CREATE TABLE sync_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id TEXT NOT NULL UNIQUE,
    op TEXT NOT NULL CHECK (op IN ('upsert', 'delete')),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    next_attempt_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
--#
  CREATE INDEX outbox_due_idx ON sync_outbox (next_attempt_at);
--#

  -- Queue a Google Sheet sync whenever a transaction changes, but only in online mode with a sheet configured.
  CREATE TRIGGER tx_outbox_insert AFTER INSERT ON transactions
  WHEN (SELECT mode FROM settings WHERE id = 1) = 'online'
   AND coalesce((SELECT json_extract(sheet, '$.spreadsheetId') FROM settings WHERE id = 1), '') <> ''
  BEGIN
    INSERT INTO sync_outbox (transaction_id, op) VALUES (new.id, 'upsert')
    ON CONFLICT (transaction_id) DO UPDATE SET op = 'upsert', attempts = 0, last_error = NULL,
      next_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
  END;
--#

  CREATE TRIGGER tx_outbox_update AFTER UPDATE ON transactions
  WHEN (SELECT mode FROM settings WHERE id = 1) = 'online'
   AND coalesce((SELECT json_extract(sheet, '$.spreadsheetId') FROM settings WHERE id = 1), '') <> ''
   AND (old.kind IS NOT new.kind OR old.name IS NOT new.name OR old.amount_minor IS NOT new.amount_minor
     OR old.occurred_on IS NOT new.occurred_on OR old.category_id IS NOT new.category_id
     OR old.bank_id IS NOT new.bank_id OR old.payment_mode_id IS NOT new.payment_mode_id
     OR old.income_source_id IS NOT new.income_source_id OR old.need_want IS NOT new.need_want
     OR old.notes IS NOT new.notes OR old.deleted_at IS NOT new.deleted_at)
  BEGIN
    INSERT INTO sync_outbox (transaction_id, op) VALUES (new.id, 'upsert')
    ON CONFLICT (transaction_id) DO UPDATE SET op = 'upsert', attempts = 0, last_error = NULL,
      next_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
  END;
--#

  CREATE TRIGGER tx_outbox_delete AFTER DELETE ON transactions
  WHEN (SELECT mode FROM settings WHERE id = 1) = 'online'
   AND coalesce((SELECT json_extract(sheet, '$.spreadsheetId') FROM settings WHERE id = 1), '') <> ''
  BEGIN
    INSERT INTO sync_outbox (transaction_id, op) VALUES (old.id, 'delete')
    ON CONFLICT (transaction_id) DO UPDATE SET op = 'delete', attempts = 0, last_error = NULL,
      next_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
  END;
--#
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

/** Applies any migrations not yet applied. Safe to call on every app start. */
export async function migrate(db: SqlDb): Promise<number> {
  await db.exec('PRAGMA foreign_keys = ON;');
  const row = await one<{ user_version: number }>(db, 'PRAGMA user_version');
  const current = row?.user_version ?? 0;
  if (current > SCHEMA_VERSION) {
    throw new Error('This data was created by a newer version of the app. Update the app first.');
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    // Statements run one at a time: some SQLite wrappers cannot split trigger bodies safely.
    const statements = MIGRATIONS[v].split(/^--#$/m).map((x) => x.trim()).filter(Boolean);
    await db.transaction(async () => {
      for (const stmt of statements) await db.run(stmt);
    });
    await db.exec(`PRAGMA user_version = ${v + 1};`);
  }
  return SCHEMA_VERSION;
}
