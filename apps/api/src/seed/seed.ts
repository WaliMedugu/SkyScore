// Builds the sandbox bank on real fields: users, dealers, farmers, a repaid 2024 season, and the 2025 season
// monitored week by week from the actual satellite photos. Every score, release, hold and alert comes from
// the real data in data/snapshots. Deterministic: the same people and dates on every run.
import { addDays, polygonKey, round, type Offer } from "@skyscore/engine";
import { core, verifyBvn } from "../adapters.ts";
import { hashPin } from "../auth.ts";
import { db, json, kvSet, logEvent, one, run } from "../db.ts";
import {
  createLoan,
  decideApplication,
  getApplication,
  getLoan,
  monitorLoan,
  redeemVoucher,
  repay,
  scoreApplication,
  setUssdPin,
  sweepOverdue,
} from "../lending.ts";
import { getPolicy } from "../policy.ts";
import { snapshots, type Snapshot } from "../satellite.ts";
import { id } from "../util.ts";
import { loanMoney, type ApplicationRow, type FarmRow, type FarmerRow, type VoucherRow } from "../views.ts";
import { DEALERS, FARMERS, HUBS, REVIEW_NOTES, type SeedFarmer } from "./data.ts";
import { DEMO_FARMER_USSD_PIN, DEMO_USERS } from "./users.ts";

const TABLES = ["journal", "vouchers", "alerts", "loans", "applications", "analyses", "farms", "farmers", "users", "dealers", "accounts", "events", "sms", "ussd_sessions", "kv"];
/** The business date the demo opens on: mid-season 2025, green-up checks done, harvest ahead. */
export const DEMO_DATE = "2025-08-20";

export function wipe() {
  db.exec("BEGIN");
  for (const t of TABLES) db.exec(`DELETE FROM ${t}`);
  db.exec("COMMIT");
}

/** Small deterministic PRNG (mulberry32). */
function prng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ts = (date: string, hour = 10, min = 0) => `${date}T${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}:00.000Z`;
const maxId = (table: string) => one<{ m: number | null }>(`SELECT MAX(id) m FROM ${table}`)?.m ?? 0;

/** Run `fn` and date the events and SMS it produced at `at` (the seed replays history). */
function stampSync<T>(at: string, fn: () => T): T {
  const e = maxId("events");
  const s = maxId("sms");
  const out = fn();
  run("UPDATE events SET created_at = ? WHERE id > ?", at, e);
  run("UPDATE sms SET created_at = ? WHERE id > ?", at, s);
  return out;
}
async function stamp<T>(at: string, fn: () => T | Promise<T>): Promise<T> {
  const e = maxId("events");
  const s = maxId("sms");
  const out = await fn();
  run("UPDATE events SET created_at = ? WHERE id > ?", at, e);
  run("UPDATE sms SET created_at = ? WHERE id > ?", at, s);
  return out;
}

const PREFIXES = ["803", "806", "813", "816", "703", "706", "810", "903", "906", "814"];
const phoneFor = (i: number) => `0${PREFIXES[i % PREFIXES.length]}${String(4_100_317 + i * 73_119).slice(-7)}`;
function bvnFor(i: number) {
  let n = 31_000_123 + i * 1_234_567;
  while (String(n).endsWith("000")) n++;
  return `22${String(n).padStart(9, "0").slice(-9)}`;
}
const ninFor = (i: number) => `7${String(4_820_000_000 + i * 97_531_7).slice(-10)}`;

interface Ctx {
  rnd: () => number;
  users: Record<string, string>;
  dealers: { key: string; id: string; cluster: string; userId: string | null }[];
  reviewIdx: number;
}

function dealerFor(ctx: Ctx, cluster: string, i: number) {
  const list = ctx.dealers.filter((d) => d.cluster === cluster);
  return (list.length ? list : ctx.dealers)[i % (list.length || ctx.dealers.length)];
}

/* ── People and fields ─────────────────────────────────────────────────── */

function seedUsersAndDealers(ctx: Ctx) {
  const clusterCentre = (cluster: string) => {
    const fields = snapshots.list().filter((s) => s.cluster === cluster);
    const n = fields.length || 1;
    return [fields.reduce((a, s) => a + s.bundle.centroid[0], 0) / n, fields.reduce((a, s) => a + s.bundle.centroid[1], 0) / n];
  };
  for (const d of DEALERS) {
    const did = id("dlr");
    const [lng, lat] = clusterCentre(d.cluster);
    const acc = core.openAccount("dealer", did, d.name);
    run(
      "INSERT INTO dealers(id, name, owner, phone, address, state, lng, lat, account_no, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      did,
      d.name,
      d.owner,
      phoneFor(200 + ctx.dealers.length),
      d.address,
      d.state,
      round(lng + d.offset[0], 6),
      round(lat + d.offset[1], 6),
      acc.account_no,
      ts("2024-01-15"),
    );
    ctx.dealers.push({ key: d.key, id: did, cluster: d.cluster, userId: null });
  }
  for (const u of DEMO_USERS) {
    const uid = id("usr");
    const dealer = u.dealer ? ctx.dealers.find((d) => d.key === u.dealer) : undefined;
    run(
      "INSERT INTO users(id, username, name, role, pin_hash, phone, dealer_id, created_at) VALUES(?,?,?,?,?,?,?,?)",
      uid,
      u.username,
      u.name,
      u.role,
      hashPin(u.pin),
      u.phone,
      dealer?.id ?? null,
      ts("2024-01-15"),
    );
    if (dealer) dealer.userId = uid;
    ctx.users[u.username] = uid;
  }
}

interface Seeded {
  f: SeedFarmer;
  i: number;
  snap: Snapshot;
  farmer: FarmerRow;
  farm: FarmRow;
  agent: string;
}

function seedFarmer(ctx: Ctx, f: SeedFarmer, i: number): Seeded | null {
  const snap = snapshots.get(f.snap);
  if (!snap) {
    console.warn(`  (skipped ${f.first} ${f.last}: snapshot ${f.snap} not found — run npm run snapshots)`);
    return null;
  }
  const home = HUBS[snap.cluster];
  const agent = ["zaria", "kachia"].includes(snap.cluster) ? ctx.users.ibrahim : ctx.users.grace;
  const reg = f.history ? addDays("2024-02-05", i) : addDays("2025-01-13", i * 2);
  const at = ts(reg, 9, 30);
  const fid = id("frm");
  const bvn = f.bvn === false ? null : bvnFor(i);
  const verified = bvn ? verifyBvn(bvn, f.first, f.last).verified : false;
  const trained = f.trained !== false && !!home;
  run(
    `INSERT INTO farmers(id, first_name, last_name, phone, gender, birth_year, bvn, bvn_verified, nin, hub, trained, cooperative, language, consent_at, created_by, created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    fid,
    f.first,
    f.last,
    phoneFor(i),
    f.gender,
    f.born,
    bvn,
    verified,
    ninFor(i),
    home?.hub ?? null,
    trained,
    f.coop && home ? home.coop : null,
    f.lang ?? home?.lang ?? "en",
    at,
    agent,
    at,
  );
  setUssdPin(fid, DEMO_FARMER_USSD_PIN);

  const crops = getPolicy().crops;
  const farmId = id("farm");
  const anaId = id("ana", 12);
  const years = snap.bundle.optical.map((o) => Number(o.date.slice(0, 4)));
  run(
    "INSERT INTO analyses(id, farm_id, polygon_key, status, as_of, from_year, source, snapshot_key, bundle, created_at, finished_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    anaId,
    farmId,
    polygonKey(snap.polygon),
    "done",
    snap.bundle.fetchedAt.slice(0, 10),
    Math.min(...years),
    "snapshot",
    snap.key,
    null, // read from the snapshot store (keeps the database small)
    at,
    at,
  );
  const [lng, lat] = snap.bundle.centroid;
  const name = `${f.first}'s ${crops[snap.crop].label.toLowerCase()} field`;
  run(
    `INSERT INTO farms(id, farmer_id, name, polygon, polygon_key, area_ha, lng, lat, crop, tenure, place, state, map_method, mapped_by, snapshot_key, analysis_id, created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    farmId,
    fid,
    name,
    JSON.stringify(snap.polygon),
    polygonKey(snap.polygon),
    round(snap.bundle.areaHa, 3),
    round(lng, 6),
    round(lat, 6),
    snap.crop,
    f.tenure ?? null,
    snap.place,
    snap.state,
    "gps",
    agent,
    snap.key,
    anaId,
    at,
  );
  stampSync(at, () => {
    logEvent("farmer", fid, "REGISTERED", `${f.first} ${f.last} registered${home ? ` at ${home.hub}` : ""}; consent recorded.`, agent, { bvn: verified });
    logEvent("farm", farmId, "MAPPED", `${name} mapped by GPS walk (${round(snap.bundle.areaHa, 2)} ha).`, agent);
  });
  return {
    f,
    i,
    snap,
    agent,
    farmer: one<FarmerRow>("SELECT * FROM farmers WHERE id = ?", fid)!,
    farm: one<FarmRow>("SELECT * FROM farms WHERE id = ?", farmId)!,
  };
}

/* ── Lending history ───────────────────────────────────────────────────── */

const refreshFarmer = (s: Seeded) => (s.farmer = one<FarmerRow>("SELECT * FROM farmers WHERE id = ?", s.farmer.id)!);

async function applyFor(ctx: Ctx, s: Seeded, season: number, date: string, reviewApproveAll: boolean): Promise<ApplicationRow> {
  const appId = id("app");
  run(
    "INSERT INTO applications(id, farm_id, farmer_id, analysis_id, status, season_year, created_by, created_at) VALUES(?,?,?,?,?,?,?,?)",
    appId,
    s.farm.id,
    s.farmer.id,
    s.farm.analysis_id,
    "ANALYZING",
    season,
    s.agent,
    ts(date, 11),
  );
  await stamp(ts(date, 11, 5), () => {
    logEvent("application", appId, "CREATED", `Application created for ${s.farm.name}; reading satellite history.`, s.agent);
    scoreApplication(appId, s.farm.analysis_id!);
  });
  let app = getApplication(appId);
  if (app.status === "REVIEW") {
    const choice = s.f.review?.action ?? (reviewApproveAll || ctx.reviewIdx++ % 2 === 1 ? "approve" : "leave");
    if (choice !== "leave") {
      const note = s.f.review?.note ?? REVIEW_NOTES[ctx.reviewIdx % REVIEW_NOTES.length];
      await stamp(ts(addDays(date, 2), 14), () => decideApplication(appId, choice, note, ctx.users.amina));
      app = getApplication(appId);
    }
  }
  return app;
}

async function acceptOffer(s: Seeded, app: ApplicationRow, date: string): Promise<string> {
  const offer = json<Offer>(app.offer)!;
  return stamp(ts(date, 12), () => {
    const loanId = createLoan(app, offer, s.farmer, s.farm, s.agent, ts(date, 12));
    run("UPDATE applications SET status = 'ACCEPTED' WHERE id = ?", app.id);
    logEvent("application", app.id, "ACCEPTED", `${s.farmer.first_name} accepted the offer with a one-time code.`, s.agent);
    return loanId;
  });
}

const voucher = (loanId: string, tranche: 1 | 2) => one<VoucherRow>("SELECT * FROM vouchers WHERE loan_id = ? AND tranche = ?", loanId, tranche);

async function redeem(ctx: Ctx, s: Seeded, loanId: string, tranche: 1 | 2, date: string) {
  const v = voucher(loanId, tranche);
  if (!v || v.status !== "ISSUED") return false;
  const d = dealerFor(ctx, s.snap.cluster, s.i);
  await stamp(ts(date, 15), () => redeemVoucher(v.code, d.id, d.userId, ts(date, 15)));
  return true;
}

/** Weekly checks from three weeks after planting to `until`; tranche 2 is collected a few days after release. */
async function monitorSeason(ctx: Ctx, s: Seeded, loanId: string, until: string, collectT2: boolean) {
  const loan = getLoan(loanId);
  const dates: string[] = [];
  for (let d = addDays(loan.planting_date, 21); d <= until; d = addDays(d, 7)) dates.push(d);
  if (dates.at(-1) !== until && until > loan.planting_date) dates.push(until);
  for (const d of dates) {
    const before = voucher(loanId, 2)?.status;
    await stamp(ts(d, 7), () => monitorLoan(loanId, d, null));
    const after = voucher(loanId, 2)?.status;
    if (collectT2 && before === "HELD" && after === "ISSUED") {
      const pick = addDays(d, 2 + Math.floor(ctx.rnd() * 4));
      if (pick <= until) await redeem(ctx, s, loanId, 2, pick);
    }
  }
}

async function deposit(s: Seeded, amount: number, memo: string, date: string) {
  const acc = core.openAccount("farmer", s.farmer.id, `${s.farmer.first_name} ${s.farmer.last_name}`);
  run("UPDATE farmers SET account_no = ? WHERE id = ?", acc.account_no, s.farmer.id);
  await stamp(ts(date, 16), () => core.credit(acc.account_no, amount, memo));
}

const roundTo = (v: number, step: number) => Math.round(v / step) * step;

/* ── Entry point ───────────────────────────────────────────────────────── */

export async function seedAll(o: { reset?: boolean } = {}) {
  if (!snapshots.list().length) snapshots.load();
  if (o.reset) wipe();
  if (one("SELECT 1 FROM users LIMIT 1")) throw new Error("The database already has data. Run `npm run seed` to reset it.");
  const ctx: Ctx = { rnd: prng(20261020), users: {}, dealers: [], reviewIdx: 0 };
  seedUsersAndDealers(ctx);
  const people = FARMERS.map((f, i) => seedFarmer(ctx, f, i)).filter((x): x is Seeded => !!x);

  // 2024: a first season for the graduates — scored as at 1 March 2024, monitored, harvested, repaid.
  const loans2024: { s: Seeded; loanId: string }[] = [];
  for (const s of people.filter((p) => p.f.history)) {
    const app = await applyFor(ctx, s, 2024, addDays("2024-03-04", s.i % 10), true);
    if (app.status !== "APPROVED") continue;
    const loanId = await acceptOffer(s, app, addDays("2024-04-08", s.i % 10));
    await redeem(ctx, s, loanId, 1, addDays("2024-04-08", (s.i % 10) + 5 + (s.i % 6)));
    const loan = getLoan(loanId);
    const crop = getPolicy().crops[loan.crop];
    await monitorSeason(ctx, s, loanId, addDays(loan.planting_date, crop.maturityDays + 14), true);
    loans2024.push({ s, loanId });
  }
  for (const { s, loanId } of loans2024.filter((x) => x.s.f.history === "ontime")) {
    const loan = getLoan(loanId);
    const owed = loanMoney(loan).outstanding;
    await deposit(s, roundTo(owed + 40_000 + ctx.rnd() * 160_000, 500), `${getPolicy().crops[loan.crop].label} sale at harvest`, addDays(loan.due_date, -14));
    await stamp(ts(addDays(loan.due_date, -6), 13), () => repay(loanId, owed, ctx.rnd() < 0.6 ? "USSD" : "AGENT", null, ts(addDays(loan.due_date, -6), 13)));
  }
  for (const { s, loanId } of loans2024.filter((x) => x.s.f.history === "late")) {
    const loan = getLoan(loanId);
    await stamp(ts(addDays(loan.due_date, 5), 8), () => sweepOverdue(addDays(loan.due_date, 5), null));
    const owed = loanMoney(getLoan(loanId)).outstanding;
    await deposit(s, roundTo(owed + 20_000, 500), "Sorghum sale, Samaru market", addDays(loan.due_date, 35));
    await stamp(ts(addDays(loan.due_date, 38), 13), () => repay(loanId, owed, "AGENT", ctx.users.ibrahim, ts(addDays(loan.due_date, 38), 13)));
  }
  people.forEach(refreshFarmer);

  // 2025: everyone applies; scored as at 1 March 2025 with what the satellites saw in 2018–2024.
  let loans = loans2024.length;
  let partials = 0;
  for (const s of people) {
    const app = await applyFor(ctx, s, 2025, addDays("2025-03-03", s.i % 12), false);
    if (app.status !== "APPROVED" || s.f.plan === "pending") continue;
    const accepted = addDays("2025-04-07", s.i % 14);
    const loanId = await acceptOffer(s, app, accepted);
    loans++;
    await deposit(s, roundTo(15_000 + ctx.rnd() * 105_000, 500), "Savings deposit", accepted);
    await redeem(ctx, s, loanId, 1, addDays(accepted, 4 + (s.i % 9)));
    await monitorSeason(ctx, s, loanId, DEMO_DATE, ctx.rnd() < 0.65);
    // A couple of farmers pay something early from off-farm income.
    if (partials < 2 && s.i % 5 === 1) {
      const owed = loanMoney(getLoan(loanId)).outstanding;
      const acc = core.forOwner("farmer", s.farmer.id);
      if (owed > 20_000 && acc && acc.balance >= 15_000) {
        await stamp(ts("2025-07-15", 18), () => repay(loanId, 15_000, "USSD", null, ts("2025-07-15", 18)));
        partials++;
      }
    }
  }

  kvSet("demoClock", DEMO_DATE);
  kvSet("seededAt", new Date().toISOString());
  return { farmers: people.length, farms: people.length, loans };
}
