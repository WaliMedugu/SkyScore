import { copyFileSync, existsSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { config } from "./config.ts";

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL,
  pin_hash TEXT NOT NULL, phone TEXT, dealer_id TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS farmers (
  id TEXT PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL, phone TEXT UNIQUE NOT NULL,
  gender TEXT, birth_year INTEGER, bvn TEXT, bvn_verified INTEGER NOT NULL DEFAULT 0, nin TEXT,
  hub TEXT, trained INTEGER NOT NULL DEFAULT 0, cooperative TEXT, language TEXT NOT NULL DEFAULT 'en',
  account_no TEXT, consent_at TEXT, prior_on_time INTEGER NOT NULL DEFAULT 0, ussd_pin_hash TEXT,
  created_by TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS farms (
  id TEXT PRIMARY KEY, farmer_id TEXT REFERENCES farmers(id), name TEXT NOT NULL, polygon TEXT NOT NULL,
  polygon_key TEXT NOT NULL, area_ha REAL NOT NULL, lng REAL NOT NULL, lat REAL NOT NULL, crop TEXT NOT NULL,
  planting_month INTEGER, tenure TEXT, place TEXT, state TEXT, map_method TEXT, mapped_by TEXT,
  snapshot_key TEXT, analysis_id TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS farms_farmer ON farms(farmer_id);
CREATE TABLE IF NOT EXISTS analyses (
  id TEXT PRIMARY KEY, farm_id TEXT, polygon_key TEXT NOT NULL, status TEXT NOT NULL, as_of TEXT NOT NULL,
  from_year INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'live', snapshot_key TEXT, bundle TEXT, error TEXT,
  created_at TEXT NOT NULL, finished_at TEXT
);
CREATE INDEX IF NOT EXISTS analyses_poly ON analyses(polygon_key, as_of);
CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY, farm_id TEXT NOT NULL REFERENCES farms(id), farmer_id TEXT NOT NULL REFERENCES farmers(id),
  analysis_id TEXT, status TEXT NOT NULL, season_year INTEGER NOT NULL, score INTEGER, band TEXT, decision TEXT,
  ghost INTEGER, offer TEXT, assessment TEXT, officer_id TEXT, officer_note TEXT, decided_at TEXT, otp_hash TEXT,
  otp_expires TEXT, created_by TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS applications_farm ON applications(farm_id);
CREATE TABLE IF NOT EXISTS loans (
  id TEXT PRIMARY KEY, application_id TEXT NOT NULL REFERENCES applications(id), farmer_id TEXT NOT NULL,
  farm_id TEXT NOT NULL, state TEXT NOT NULL, crop TEXT NOT NULL, principal INTEGER NOT NULL, interest INTEGER NOT NULL,
  insurance INTEGER NOT NULL, total INTEGER NOT NULL, tranche1 INTEGER NOT NULL, tranche2 INTEGER NOT NULL,
  season_year INTEGER NOT NULL, planting_date TEXT NOT NULL, due_date TEXT NOT NULL, health TEXT NOT NULL DEFAULT 'NO_DATA',
  monitor TEXT, replay_date TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS vouchers (
  code TEXT PRIMARY KEY, loan_id TEXT NOT NULL REFERENCES loans(id), tranche INTEGER NOT NULL, amount INTEGER NOT NULL,
  items TEXT NOT NULL, status TEXT NOT NULL, dealer_id TEXT, issued_at TEXT, expires_at TEXT, redeemed_at TEXT, settled_at TEXT
);
CREATE TABLE IF NOT EXISTS dealers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, owner TEXT, phone TEXT, address TEXT, state TEXT, lng REAL, lat REAL,
  account_no TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS accounts (
  account_no TEXT PRIMARY KEY, owner_type TEXT NOT NULL, owner_id TEXT NOT NULL, name TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS journal (
  id INTEGER PRIMARY KEY AUTOINCREMENT, loan_id TEXT, kind TEXT NOT NULL, memo TEXT NOT NULL, postings TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, entity TEXT NOT NULL, entity_id TEXT NOT NULL, type TEXT NOT NULL,
  message TEXT NOT NULL, actor TEXT, data TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_entity ON events(entity, entity_id);
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY, loan_id TEXT, farm_id TEXT, type TEXT NOT NULL, severity TEXT NOT NULL, title TEXT NOT NULL,
  detail TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN', created_at TEXT NOT NULL, ack_by TEXT, ack_at TEXT
);
CREATE TABLE IF NOT EXISTS sms (
  id INTEGER PRIMARY KEY AUTOINCREMENT, to_phone TEXT NOT NULL, body TEXT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ussd_sessions (id TEXT PRIMARY KEY, phone TEXT NOT NULL, state TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS http_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at TEXT NOT NULL);
`;

// A serverless cold start begins from the seeded template, so every instance starts with the same bank.
if (config.templateDb && !existsSync(config.dbPath) && existsSync(config.templateDb)) copyFileSync(config.templateDb, config.dbPath);
export const db = new DatabaseSync(config.dbPath);
db.exec(SCHEMA);

type Params = SQLInputValue[] | [Record<string, SQLInputValue>];
const norm = (p: unknown[]): SQLInputValue[] => p.map((v) => (typeof v === "boolean" ? (v ? 1 : 0) : v === undefined ? null : (v as SQLInputValue)));

export function one<T = Record<string, unknown>>(sql: string, ...p: unknown[]): T | undefined {
  return db.prepare(sql).get(...(norm(p) as Params as SQLInputValue[])) as T | undefined;
}
export function all<T = Record<string, unknown>>(sql: string, ...p: unknown[]): T[] {
  return db.prepare(sql).all(...(norm(p) as SQLInputValue[])) as T[];
}
export function run(sql: string, ...p: unknown[]) {
  return db.prepare(sql).run(...(norm(p) as SQLInputValue[]));
}

/** Run `fn` inside a transaction (nested calls join the outer one). */
let depth = 0;
export function tx<T>(fn: () => T): T {
  if (depth > 0) return fn();
  depth++;
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  } finally {
    depth--;
  }
}

/**
 * The business date. With the season clock on (the demo), the bank lives on a replayable date inside the
 * loan season, so records, messages and deadlines line up with what the satellites show for that date.
 */
export function businessDate(): string {
  const today = new Date().toISOString().slice(0, 10);
  if (!config.demoClock) return today;
  return kvGet<string>("demoClock") ?? `${config.loanSeason}-08-20`;
}
/** Timestamp for business records on the business date (security timers use real time directly). */
export const now = () => {
  const real = new Date().toISOString();
  return config.demoClock ? `${businessDate()}T${real.slice(11)}` : real;
};
export const json = <T>(v: string | null | undefined): T | null => (v ? (JSON.parse(v) as T) : null);

export function kvGet<T>(key: string): T | null {
  return json<T>(one<{ value: string }>("SELECT value FROM kv WHERE key = ?", key)?.value);
}
export function kvSet(key: string, value: unknown) {
  run("INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, JSON.stringify(value));
}

/** Audit / activity log. */
export function logEvent(entity: string, entityId: string, type: string, message: string, actor?: string | null, data?: unknown) {
  run(
    "INSERT INTO events(entity, entity_id, type, message, actor, data, created_at) VALUES(?,?,?,?,?,?,?)",
    entity,
    entityId,
    type,
    message,
    actor ?? null,
    data === undefined ? null : JSON.stringify(data),
    now(),
  );
}
