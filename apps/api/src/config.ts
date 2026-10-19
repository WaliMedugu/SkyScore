import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
/**
 * Serverless build (Vercel): the API is bundled into one file next to a copy of `data/`.
 * Locally the source lives in apps/api/src, three levels below the repo root.
 */
export const SERVERLESS = process.env.SKYSCORE_SERVERLESS === "1";
export const ROOT = existsSync(join(here, "data", "snapshots")) ? here : resolve(here, "..", "..", "..");
export const DATA_DIR = join(ROOT, "data");
export const SNAP_DIR = join(DATA_DIR, "snapshots");
export const WEB_DIST = join(ROOT, "apps", "web", "dist");
try {
  mkdirSync(DATA_DIR, { recursive: true });
} catch {
  /* read-only deployment: data/ ships with the bundle */
}

/** Load KEY=VALUE pairs from the repo-root .env (if any) without overriding real env vars. */
function loadDotEnv() {
  const p = join(ROOT, ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadDotEnv();

/**
 * The JWT signing key: the environment's if set; else the one generated into the serverless bundle at build
 * time (shared by every instance of a deployment); else one generated once into data/.secret.
 */
function secret(): string {
  if (process.env.SKYSCORE_JWT_SECRET) return process.env.SKYSCORE_JWT_SECRET;
  const bundled = join(DATA_DIR, ".jwt-secret");
  if (existsSync(bundled)) return readFileSync(bundled, "utf8").trim();
  const p = join(DATA_DIR, ".secret");
  if (!existsSync(p)) writeFileSync(p, randomBytes(32).toString("hex"));
  return readFileSync(p, "utf8").trim();
}

const env = process.env;
export const config = {
  port: Number(env.PORT ?? 8080),
  host: env.HOST ?? "0.0.0.0",
  /** Serverless instances keep their database in writable /tmp, starting from the seeded template. */
  dbPath: env.SKYSCORE_DB ?? (SERVERLESS ? join(tmpdir(), "skyscore.db") : join(DATA_DIR, "skyscore.db")),
  /** Pre-seeded database copied into place on a cold start (built by scripts/build-vercel.mjs). */
  templateDb: env.SKYSCORE_TEMPLATE_DB ?? (existsSync(join(DATA_DIR, "demo.db")) ? join(DATA_DIR, "demo.db") : null),
  /** Each request must finish its own work (no background jobs between requests). */
  serverless: SERVERLESS,
  jwtSecret: secret(),
  /** Answer satellite questions only from cache and snapshots (no internet at the venue). */
  offline: env.SKYSCORE_OFFLINE === "1",
  /** Sandbox: OTPs are also shown in the console's SMS outbox and returned to the agent app. */
  sandbox: env.SKYSCORE_SANDBOX !== "0",
  /** Business dates (voucher expiry, due dates, monitoring) follow a replayable season clock instead of today. */
  demoClock: env.SKYSCORE_DEMO_CLOCK !== "0",
  /** The rainy season the demo loans run in; replayed week by week with real satellite data. */
  loanSeason: Number(env.SKYSCORE_LOAN_SEASON ?? 2025),
  /** First season year read for history. */
  historyFrom: Number(env.SKYSCORE_HISTORY_FROM ?? 2018),
  ussdCode: env.SKYSCORE_USSD_CODE ?? "*326*77#",
  /** If set, USSD callbacks must carry ?key=<secret> (Africa's Talking callback URL). */
  ussdSecret: env.SKYSCORE_USSD_SECRET ?? "",
};
