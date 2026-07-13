import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { LTM_SCHEMA_VERSION } from "@proxy-cli/proto";
import { SEED_HABITS } from "./seed.js";

export type LtmDb = Database.Database;

export function openLtmDb(sqlitePath: string): LtmDb {
  mkdirSync(dirname(sqlitePath), { recursive: true });
  const db = new Database(sqlitePath);
  db.pragma("journal_mode = WAL");
  migrate(db);
  seedHabits(db);
  return db;
}

function migrate(db: LtmDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      identity_json TEXT,
      updated_at TEXT NOT NULL,
      schema_version INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stacks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      value TEXT NOT NULL UNIQUE,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS style_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      value TEXT NOT NULL UNIQUE,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      stack_json TEXT,
      notes TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS facts (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      topic TEXT NOT NULL,
      source_session TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS habits (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      inject_text TEXT NOT NULL,
      seed INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      status TEXT NOT NULL,
      client TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const row = db.prepare("SELECT id FROM profile WHERE id = 1").get();
  if (!row) {
    db.prepare(
      "INSERT INTO profile (id, identity_json, updated_at, schema_version) VALUES (1, NULL, ?, ?)",
    ).run(new Date().toISOString(), LTM_SCHEMA_VERSION);
  }
}

function seedHabits(db: LtmDb): void {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO habits (id, label, enabled, inject_text, seed, updated_at)
    VALUES (@id, @label, @enabled, @inject_text, @seed, @updated_at)
  `);
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const h of SEED_HABITS) {
      insert.run({
        id: h.id,
        label: h.label,
        enabled: h.enabled ? 1 : 0,
        inject_text: h.inject_text,
        seed: h.seed ? 1 : 0,
        updated_at: now,
      });
    }
  });
  tx();
}
