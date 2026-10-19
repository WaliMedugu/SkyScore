// Application → offer → consent → loan → vouchers → monitoring → repayment.
import { randomInt } from "node:crypto";
import {
  addDays,
  dealerPaid,
  expectedNdvi,
  feesCharged,
  insuranceClaim,
  mainTrack,
  monitorField,
  nextState,
  seasonFrames,
  usableOptical,
  repayment as repaymentEntry,
  voucherCode,
  voucherRedeemed,
  type Assessment,
  type JournalEntry,
  type LoanState,
  type MonitorResult,
  type Offer,
  type SatelliteBundle,
} from "@skyscore/engine";
import { buildBundle } from "@skyscore/satellite";
import { core, sendSms } from "./adapters.ts";
import { NO_FARMER, analysisDto, bundleOf, startAnalysis } from "./analysis.ts";
import { checkPin, hashPin } from "./auth.ts";
import { config } from "./config.ts";
import { all, businessDate, json, kvSet, logEvent, now, one, run, tx } from "./db.ts";
import { getPolicy } from "./policy.ts";
import { http } from "./satellite.ts";
import { ApiError, conflict, id, naira, notFound, today } from "./util.ts";
import { farmerProfile, loanMoney, type ApplicationRow, type FarmRow, type FarmerRow, type LoanRow, type VoucherRow } from "./views.ts";

const fmtDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function postJournal(loanId: string | null, e: JournalEntry, at = now()) {
  run("INSERT INTO journal(loan_id, kind, memo, postings, created_at) VALUES(?,?,?,?,?)", loanId, e.kind, e.memo, JSON.stringify(e.postings), at);
}

function getFarm(farmId: string) {
  const f = one<FarmRow>("SELECT * FROM farms WHERE id = ?", farmId);
  if (!f) throw notFound("Farm");
  return f;
}
function getFarmer(farmerId: string) {
  const f = one<FarmerRow>("SELECT * FROM farmers WHERE id = ?", farmerId);
  if (!f) throw notFound("Farmer");
  return f;
}
export function getApplication(appId: string) {
  const a = one<ApplicationRow>("SELECT * FROM applications WHERE id = ?", appId);
  if (!a) throw notFound("Application");
  return a;
}
export function getLoan(loanId: string) {
  const l = one<LoanRow>("SELECT * FROM loans WHERE id = ?", loanId);
  if (!l) throw notFound("Loan");
  return l;
}

/** Applications are judged as at the start of the loan season (history up to the previous harvest). */
export const decisionDate = (seasonYear: number) => `${seasonYear}-03-01`;

/* ── Applications ──────────────────────────────────────────────────────── */

export function createApplication(farmId: string, actorId: string, seasonYear = config.loanSeason) {
  const farm = getFarm(farmId);
  if (!farm.farmer_id) throw new ApiError(422, "Attach this farm to a farmer before applying.");
  const open = one<ApplicationRow>(
    "SELECT * FROM applications WHERE farm_id = ? AND season_year = ? AND status NOT IN ('DECLINED','EXPIRED') LIMIT 1",
    farmId,
    seasonYear,
  );
  if (open) throw conflict(`This farm already has a ${seasonYear} application (${open.status.toLowerCase()}).`);

  const appId = id("app");
  run(
    "INSERT INTO applications(id, farm_id, farmer_id, status, season_year, created_by, created_at) VALUES(?,?,?,?,?,?,?)",
    appId,
    farmId,
    farm.farmer_id,
    "ANALYZING",
    seasonYear,
    actorId,
    now(),
  );
  logEvent("application", appId, "CREATED", `Application created for ${farm.name}; reading satellite history.`, actorId);
  const job = startAnalysis({
    polygon: JSON.parse(farm.polygon),
    farmId,
    // Serverless requests wait for the score, so there's no audience for a paced replay.
    paced: !config.serverless,
    onDone: (analysisId) => {
      try {
        scoreApplication(appId, analysisId);
      } catch (e) {
        logEvent("application", appId, "ERROR", `Scoring failed: ${e instanceof Error ? e.message : e}`);
      }
    },
  });
  run("UPDATE applications SET analysis_id = ? WHERE id = ?", job.analysisId, appId);
  run("UPDATE farms SET analysis_id = ? WHERE id = ?", job.analysisId, farmId);
  job.listeners.add((e) => {
    if (e.type === "error") {
      run("UPDATE applications SET status = 'ERROR' WHERE id = ?", appId);
      logEvent("application", appId, "ERROR", "Satellite analysis failed; retry from the console.");
    }
  });
  return { applicationId: appId, jobId: job.id, analysisId: job.analysisId, finished: job.finished };
}

/** Score an application from its finished analysis and set its status. */
export function scoreApplication(appId: string, analysisId: string) {
  const app = getApplication(appId);
  const farm = getFarm(app.farm_id);
  const farmer = getFarmer(app.farmer_id);
  const dto = analysisDto(analysisId, {
    farmer: farmerProfile(farmer),
    asOf: decisionDate(app.season_year),
    crop: farm.crop,
    plantingMonth: farm.planting_month ?? undefined,
    seasonYear: app.season_year,
  });
  if (!dto || !dto.ready) throw new ApiError(503, "Analysis not ready.");
  const { score, offer } = dto;
  const status = score.ghost || score.decision === "DECLINE" ? "DECLINED" : score.decision === "REVIEW" ? "REVIEW" : "APPROVED";
  const assessment: Pick<Assessment, "seasons" | "score" | "offer" | "asOf" | "clearPhotos" | "photosFound"> = {
    asOf: dto.asOf,
    seasons: dto.seasons,
    score,
    offer,
    clearPhotos: dto.clearPhotos,
    photosFound: dto.photosFound,
  };
  run(
    "UPDATE applications SET status = ?, analysis_id = ?, score = ?, band = ?, decision = ?, ghost = ?, offer = ?, assessment = ? WHERE id = ?",
    status,
    analysisId,
    score.score,
    score.band,
    score.decision,
    score.ghost ? 1 : 0,
    JSON.stringify(offer),
    JSON.stringify(assessment),
    appId,
  );
  const crop = getPolicy().crops[farm.crop].label.toLowerCase();
  logEvent(
    "application",
    appId,
    status,
    score.ghost ? `Ghost farm: ${score.concerns[0]}` : `SkyScore ${score.score} (band ${score.band}) → ${status.toLowerCase()}.`,
    null,
    { score: score.score, band: score.band },
  );
  if (status === "APPROVED" && offer?.eligible) {
    sendSms(farmer.phone, `Good news ${farmer.first_name}! Ecobank SkyScore has approved ${naira(offer.principal)} of inputs for your ${crop} farm. Your agent will confirm with you.`, "APPROVED");
  } else if (status === "DECLINED") {
    sendSms(
      farmer.phone,
      score.ghost
        ? `Dear ${farmer.first_name}, we could not find farming activity on the land submitted for your SkyScore application. Please see your agent.`
        : `Dear ${farmer.first_name}, your SkyScore application can't be approved this season. Your agent can explain how to qualify next season.`,
      "DECLINED",
    );
  }
}

export function decideApplication(appId: string, action: "approve" | "decline", note: string, officerId: string) {
  const app = getApplication(appId);
  if (!["REVIEW", "APPROVED", "DECLINED"].includes(app.status)) throw conflict(`An application that is ${app.status.toLowerCase()} can't be changed.`);
  const offer = json<Offer>(app.offer);
  if (action === "approve") {
    if (app.ghost) throw conflict("A ghost-farm application can't be approved. Ask the agent to re-map the real field.");
    if (!offer?.eligible) throw conflict("There is no eligible offer for this application.");
  }
  const status = action === "approve" ? "APPROVED" : "DECLINED";
  run("UPDATE applications SET status = ?, officer_id = ?, officer_note = ?, decided_at = ? WHERE id = ?", status, officerId, note, now(), appId);
  logEvent("application", appId, `OFFICER_${status}`, `Loan officer ${action}d: ${note || "no note"}`, officerId);
  const farmer = getFarmer(app.farmer_id);
  if (status === "APPROVED") sendSms(farmer.phone, `Good news ${farmer.first_name}! Your SkyScore input loan of ${naira(offer!.principal)} has been approved by Ecobank.`, "APPROVED");
}

/** Send the farmer a one-time code to consent to the loan (they read it to the agent). */
export function sendOtp(appId: string, actorId: string) {
  const app = getApplication(appId);
  if (app.status !== "APPROVED") throw conflict("Only an approved application can be accepted.");
  const farmer = getFarmer(app.farmer_id);
  const offer = json<Offer>(app.offer)!;
  const otp = String(randomInt(100000, 1000000));
  run("UPDATE applications SET otp_hash = ?, otp_expires = ? WHERE id = ?", hashPin(otp), new Date(Date.now() + 10 * 60_000).toISOString(), appId);
  sendSms(
    farmer.phone,
    `Your SkyScore code is ${otp}. Give it to your agent ONLY to accept ${naira(offer.principal)} of farm inputs. Ecobank will never ask for your PIN.`,
    "OTP",
  );
  logEvent("application", appId, "OTP_SENT", `Consent code sent to ${farmer.phone.slice(0, 4)}•••${farmer.phone.slice(-3)}.`, actorId);
  return { sent: true, to: `${farmer.phone.slice(0, 4)}•••${farmer.phone.slice(-3)}`, sandboxOtp: config.sandbox ? otp : undefined };
}

/** Farmer consented: create the loan, open accounts, issue tranche 1 and hold tranche 2. */
export function acceptApplication(appId: string, otp: string, actorId: string) {
  const app = getApplication(appId);
  if (app.status !== "APPROVED") throw conflict("Only an approved application can be accepted.");
  if (!app.otp_hash || !app.otp_expires || app.otp_expires < new Date().toISOString()) throw new ApiError(422, "The code has expired. Send a new one.");
  if (!checkPin(otp, app.otp_hash)) throw new ApiError(422, "That code is wrong. Check the SMS and try again.");
  const offer = json<Offer>(app.offer)!;
  const farmer = getFarmer(app.farmer_id);
  const farm = getFarm(app.farm_id);
  return tx(() => {
    const loanId = createLoan(app, offer, farmer, farm, actorId);
    run("UPDATE applications SET status = 'ACCEPTED', otp_hash = NULL WHERE id = ?", appId);
    run("UPDATE farmers SET consent_at = COALESCE(consent_at, ?) WHERE id = ?", now(), farmer.id);
    logEvent("application", appId, "ACCEPTED", `${farmer.first_name} accepted the offer with a one-time code.`, actorId);
    return loanId;
  });
}

export function createLoan(app: ApplicationRow, offer: Offer, farmer: FarmerRow, farm: FarmRow, actorId: string | null, at = businessNow()) {
  const loanId = id("loan");
  const acc = core.openAccount("farmer", farmer.id, `${farmer.first_name} ${farmer.last_name}`);
  run("UPDATE farmers SET account_no = ? WHERE id = ?", acc.account_no, farmer.id);
  let state: LoanState = "OFFERED";
  state = nextState(state, "ACCEPT");
  run(
    `INSERT INTO loans(id, application_id, farmer_id, farm_id, state, crop, principal, interest, insurance, total, tranche1, tranche2,
       season_year, planting_date, due_date, health, replay_date, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    loanId,
    app.id,
    farmer.id,
    farm.id,
    state,
    farm.crop,
    offer.principal,
    offer.interest,
    offer.insurance,
    offer.totalRepayable,
    offer.tranche1,
    offer.tranche2,
    app.season_year,
    offer.plantingDate,
    offer.dueDate,
    "NO_DATA",
    demoClock(),
    at,
    at,
  );
  const L = getPolicy().lending;
  const items = (t: 1 | 2) => offer.items.filter((i) => i.tranche === t).map((i) => ({ name: i.name, unit: i.unit, qty: i.qty, amount: i.amount }));
  const t1 = voucherCode();
  run(
    "INSERT INTO vouchers(code, loan_id, tranche, amount, items, status, issued_at, expires_at) VALUES(?,?,?,?,?,?,?,?)",
    t1,
    loanId,
    1,
    offer.tranche1,
    JSON.stringify(items(1)),
    "ISSUED",
    at,
    addDays(at.slice(0, 10), L.voucherValidityDays),
  );
  if (offer.tranche2 > 0) {
    run("INSERT INTO vouchers(code, loan_id, tranche, amount, items, status) VALUES(?,?,?,?,?,?)", voucherCode(), loanId, 2, offer.tranche2, JSON.stringify(items(2)), "HELD");
  }
  const list = items(1).map((i) => `${i.qty} x ${i.name}`).join(", ");
  sendSms(farmer.phone, `Your Ecobank input voucher is ${t1}: ${list}. Show it at any SkyScore agro-dealer. Valid ${L.voucherValidityDays} days.`, "VOUCHER");
  logEvent("loan", loanId, "CREATED", `Loan ${naira(offer.principal)} created; tranche 1 voucher ${t1} issued, tranche 2 held until the crop greens up.`, actorId);
  return loanId;
}

/* ── Vouchers ──────────────────────────────────────────────────────────── */

export function getVoucher(code: string) {
  const v = one<VoucherRow>("SELECT * FROM vouchers WHERE code = ?", code.trim().toUpperCase());
  if (!v) throw notFound("Voucher");
  return v;
}

/** A dealer hands over the inputs: the dealer is paid, the farmer's loan is drawn. */
export function redeemVoucher(code: string, dealerId: string, actorId: string | null, at = businessNow()) {
  const v = getVoucher(code);
  if (v.status === "HELD") throw conflict("This voucher is on hold: the satellite hasn't confirmed the crop yet.");
  if (v.status !== "ISSUED") throw conflict(`This voucher was already ${v.status.toLowerCase()}.`);
  if (v.expires_at && v.expires_at < at.slice(0, 10)) throw conflict("This voucher has expired.");
  const dealer = one<{ id: string; name: string; account_no: string }>("SELECT * FROM dealers WHERE id = ?", dealerId);
  if (!dealer) throw notFound("Dealer");
  const loan = getLoan(v.loan_id);
  const farmer = getFarmer(loan.farmer_id);
  return tx(() => {
    postJournal(loan.id, voucherRedeemed(loan.id, dealer.id, v.amount, v.code), at);
    postJournal(loan.id, dealerPaid(dealer.id, v.amount, v.code), at);
    core.credit(dealer.account_no, v.amount, `SkyScore voucher ${v.code}`);
    run("UPDATE vouchers SET status = 'REDEEMED', dealer_id = ?, redeemed_at = ?, settled_at = ? WHERE code = ?", dealer.id, at, at, v.code);
    if (v.tranche === 1) {
      postJournal(loan.id, feesCharged(loan.id, loan.interest, loan.insurance), at);
      run("UPDATE loans SET state = ?, updated_at = ? WHERE id = ?", nextState(loan.state as LoanState, "REDEEM_T1"), at, loan.id);
    }
    sendSms(farmer.phone, `${dealer.name} has given you your SkyScore inputs (voucher ${v.code}, ${naira(v.amount)}). Good farming!`, "REDEEMED");
    logEvent("loan", loan.id, "VOUCHER_REDEEMED", `${dealer.name} redeemed tranche ${v.tranche} voucher ${v.code} (${naira(v.amount)}); dealer paid into ${dealer.account_no}.`, actorId);
    return { code: v.code, amount: v.amount, dealer: dealer.name, settledTo: dealer.account_no };
  });
}

/* ── Monitoring (real "today" or a replayed date) ─────────────────────── */

/** The business date: a replayable season clock in demo mode, otherwise today. */
export const demoClock = businessDate;

/** Timestamp for business events (redemptions, repayments) on the business date. */
export const businessNow = now;

/** The bundle that covers a loan's season: the farm's latest analysis, refreshed if it ends too early. */
async function seasonBundle(loan: LoanRow, asOf: string): Promise<SatelliteBundle> {
  const farm = getFarm(loan.farm_id);
  let b = farm.analysis_id ? bundleOf(farm.analysis_id) : null;
  if (!b) throw new ApiError(503, "This farm has no satellite analysis yet.");
  const covered = b.fetchedAt.slice(0, 10);
  if (covered < asOf && !config.offline) {
    // Pull the newest photos for this season and merge them in.
    const fresh = await buildBundle(http, JSON.parse(farm.polygon), { asOf: today(), fromYear: loan.season_year });
    const seen = new Set(b.optical.map((o) => o.sceneId));
    b = { ...b, optical: [...b.optical, ...fresh.optical.filter((o) => !seen.has(o.sceneId))], radar: [...b.radar, ...fresh.radar], fetchedAt: fresh.fetchedAt };
    run("UPDATE analyses SET bundle = ? WHERE id = ?", JSON.stringify(b), farm.analysis_id);
  }
  return b;
}

/** NDVI of the bare field before this season's planting, from the application's season analysis. */
function seasonPreMin(loan: LoanRow): number | null {
  const app = getApplication(loan.application_id);
  return json<{ seasons: { year: number; preMin: number | null }[] }>(app.assessment)?.seasons.find((s) => s.year === loan.season_year)?.preMin ?? null;
}

export async function monitorLoan(loanId: string, asOfIn?: string, actorId: string | null = null): Promise<MonitorResult> {
  const loan = getLoan(loanId);
  const asOf = asOfIn ?? demoClock();
  const b = await seasonBundle(loan, asOf);
  const m = monitorField({ crop: loan.crop, plantingDate: loan.planting_date, asOf, optical: b.optical, radar: b.radar, preMin: seasonPreMin(loan), policy: getPolicy() });
  applyMonitor(loan, m, actorId);
  return m;
}

/** Act on a monitoring result: release/hold tranche 2, raise alerts, insurance, reminders. */
export function applyMonitor(loan: LoanRow, m: MonitorResult, actorId: string | null) {
  const farmer = getFarmer(loan.farmer_id);
  const at = `${m.asOf}T09:00:00.000Z`;
  tx(() => {
    run("UPDATE loans SET monitor = ?, health = ?, replay_date = ?, updated_at = ? WHERE id = ?", JSON.stringify(m), m.health, m.asOf, now(), loan.id);
    const t2 = one<VoucherRow>("SELECT * FROM vouchers WHERE loan_id = ? AND tranche = 2", loan.id);
    const state = loan.state as LoanState;
    if (m.trancheAction === "RELEASE" && t2?.status === "HELD" && (state === "ACTIVE" || state === "T2_HELD")) {
      run("UPDATE vouchers SET status = 'ISSUED', issued_at = ?, expires_at = ? WHERE code = ?", at, addDays(m.asOf, getPolicy().lending.voucherValidityDays), t2.code);
      run("UPDATE loans SET state = ? WHERE id = ?", nextState(state, "RELEASE_T2"), loan.id);
      const list = (JSON.parse(t2.items) as { qty: number; name: string }[]).map((i) => `${i.qty} x ${i.name}`).join(", ");
      sendSms(farmer.phone, `Satellites confirm your crop is up! Tranche 2 voucher ${t2.code} is ready: ${list}.`, "TRANCHE");
      logEvent("loan", loan.id, "T2_RELEASED", `Green-up verified from space on ${m.latestDate ?? m.asOf}; tranche 2 voucher ${t2.code} released.`, actorId);
    }
    if (m.trancheAction === "HOLD" && state === "ACTIVE") {
      run("UPDATE loans SET state = ? WHERE id = ?", nextState(state, "HOLD_T2"), loan.id);
      logEvent("loan", loan.id, "T2_HELD", "No green-up detected; tranche 2 held and an agent visit requested.", actorId);
    }
    // Conditions that can clear themselves (the crop came up, or recovered) close their open alerts.
    for (const type of ["NO_GREENUP", "UNVERIFIED", "STRESS"]) {
      if (m.alerts.some((a) => a.type === type)) continue;
      const cleared = run("UPDATE alerts SET status = 'RESOLVED', ack_at = ? WHERE loan_id = ? AND type = ? AND status = 'OPEN'", at, loan.id, type);
      if (cleared.changes) logEvent("loan", loan.id, `CLEARED_${type}`, `Cleared from space on ${fmtDate(m.asOf)}: ${m.summary}`, actorId);
    }
    for (const a of m.alerts) {
      if (a.type === "NO_DATA") continue;
      const exists = one("SELECT 1 FROM alerts WHERE loan_id = ? AND type = ? AND status = 'OPEN'", loan.id, a.type);
      if (exists) continue;
      run(
        "INSERT INTO alerts(id, loan_id, farm_id, type, severity, title, detail, status, created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        id("alr"),
        loan.id,
        loan.farm_id,
        a.type,
        a.severity,
        a.title,
        a.detail,
        "OPEN",
        at,
      );
      logEvent("loan", loan.id, `ALERT_${a.type}`, a.title + ": " + a.detail, actorId);
      if (a.type === "FLOOD") {
        const paid = one("SELECT 1 FROM journal WHERE loan_id = ? AND kind = 'INSURANCE_CLAIM'", loan.id);
        const { outstanding } = loanMoney(loan);
        if (!paid && outstanding > 0) {
          const payout = Math.min(outstanding, Math.round(loan.principal * 0.5));
          postJournal(loan.id, insuranceClaim(loan.id, payout, "flood detected by satellite"), at);
          sendSms(farmer.phone, `Satellites detected flooding on your farm. Your SkyScore insurance has paid ${naira(payout)} towards your loan.`, "ALERT");
        }
      } else if (a.type === "STRESS") {
        sendSms(farmer.phone, `Your ${loan.crop} looks stressed from space. Check for pests, weeds or water-logging; your agent will call you.`, "ALERT");
      } else if (a.type === "HARVEST") {
        const { outstanding } = loanMoney(loan);
        if (outstanding > 0) sendSms(farmer.phone, `Harvest time! Your SkyScore loan balance is ${naira(outstanding)}, due ${fmtDate(loan.due_date)}. Dial ${config.ussdCode} to repay.`, "REMINDER");
      } else if (a.type === "NO_GREENUP") {
        sendSms(farmer.phone, `We can't see a crop on your farm yet, so tranche 2 is on hold. Your agent will visit.`, "ALERT");
      }
    }
  });
}

/** Set the demo clock and re-run monitoring for every open loan (the season replay). */
export async function replayTo(date: string, actorId: string | null) {
  if (!config.demoClock) throw conflict("The season clock is off on this server (SKYSCORE_DEMO_CLOCK=0).");
  kvSet("demoClock", date);
  const loans = all<LoanRow>(
    "SELECT * FROM loans WHERE state IN ('ACTIVE','T2_RELEASED','T2_HELD','RESTRUCTURED','DEFAULTED') AND season_year <= ? ORDER BY created_at",
    Number(date.slice(0, 4)),
  );
  const results: { loanId: string; health: string; stage: string }[] = [];
  for (const l of loans) {
    try {
      const m = await monitorLoan(l.id, date, actorId);
      results.push({ loanId: l.id, health: m.health, stage: m.stage });
    } catch {
      /* skip loans without data */
    }
  }
  const defaulted = sweepOverdue(date, actorId);
  logEvent("system", "demo", "REPLAY", `Season replayed to ${fmtDate(date)}: ${results.length} loans checked from space.`, actorId);
  return { date, checked: results.length, defaulted, results };
}

/** Loans still owing after their due date (which already includes the grace period) move to DEFAULTED. */
export function sweepOverdue(date: string, actorId: string | null) {
  const late = all<LoanRow>("SELECT * FROM loans WHERE state IN ('ACTIVE','T2_RELEASED','T2_HELD','RESTRUCTURED') AND due_date < ?", date);
  let n = 0;
  for (const l of late) {
    const { outstanding } = loanMoney(l);
    if (outstanding <= 0) continue;
    const farmer = getFarmer(l.farmer_id);
    tx(() => {
      run("UPDATE loans SET state = ?, updated_at = ? WHERE id = ?", nextState(l.state as LoanState, "DEFAULT"), now(), l.id);
      run(
        "INSERT INTO alerts(id, loan_id, farm_id, type, severity, title, detail, status, created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        id("alr"),
        l.id,
        l.farm_id,
        "OVERDUE",
        "CRITICAL",
        "Repayment overdue",
        `${naira(outstanding)} still owed after the ${fmtDate(l.due_date)} due date.`,
        "OPEN",
        `${date}T09:00:00.000Z`,
      );
      sendSms(farmer.phone, `Your SkyScore loan of ${naira(outstanding)} is overdue. Dial ${config.ussdCode} to repay or talk to your agent about a plan.`, "REMINDER");
      logEvent("loan", l.id, "DEFAULTED", `Overdue: ${naira(outstanding)} owed after ${fmtDate(l.due_date)}.`, actorId);
    });
    n++;
  }
  return n;
}

/** The season so far for one loan: observed greenness, the healthy-crop curve and photos, up to the business date. */
export function seasonChart(loan: LoanRow) {
  const farm = getFarm(loan.farm_id);
  const b = farm.analysis_id ? bundleOf(farm.analysis_id) : null;
  if (!b) return null;
  const policy = getPolicy();
  const upTo = loan.replay_date ?? demoClock();
  const from = addDays(loan.planting_date, -60);
  const to = loan.due_date;
  const clear = new Set(usableOptical(b.optical, policy).map((o) => o.sceneId));
  const inWindow = (d: string) => d >= from && d <= to && d <= upTo;
  const pre = seasonPreMin(loan) ?? 0.2;
  const weeks = Math.ceil((policy.crops[loan.crop].maturityDays + 30) / 7);
  // The healthy-crop curve starts when the photos say the crop went in (or the agreed date).
  const planted = json<MonitorResult>(loan.monitor)?.plantedAround ?? loan.planting_date;
  const observed = b.optical.filter((o) => inWindow(o.date)).map((o) => ({ date: o.date, ndvi: o.ndvi, clear: clear.has(o.sceneId), sceneId: o.sceneId }));
  return {
    plantingDate: loan.planting_date,
    plantedAround: planted === loan.planting_date ? null : planted,
    from,
    to,
    upTo,
    greenupWindow: [addDays(loan.planting_date, policy.monitor.greenupFromWeek * 7), addDays(loan.planting_date, policy.monitor.greenupByWeek * 7)],
    observed,
    radar: mainTrack(b.radar)
      .filter((r) => inWindow(r.date))
      .map((r) => ({ date: r.date, rvi: r.rvi, vhDb: r.vhDb, vvDb: r.vvDb })),
    expected: Array.from({ length: weeks + 1 }, (_, w) => ({ date: addDays(planted, w * 7), ndvi: Math.round(expectedNdvi(loan.crop, w, pre, policy) * 1000) / 1000 })),
    // Season time-lapse: the same evenly spread photos the snapshot builder saves, up to the business date.
    frames: seasonFrames(b, policy, loan.season_year).filter((f) => f.date <= upTo),
    snapshotKey: farm.snapshot_key,
  };
}

/** Re-score an application (after a policy change), or restart its satellite analysis if that failed. */
export function rescoreApplication(appId: string, actorId: string) {
  const app = getApplication(appId);
  if (app.status === "ACCEPTED") throw conflict("This application has already become a loan.");
  if (app.status === "ANALYZING") throw conflict("Still reading the satellite history for this field.");
  const done = app.analysis_id ? one<{ status: string }>("SELECT status FROM analyses WHERE id = ?", app.analysis_id)?.status === "done" : false;
  if (done) {
    scoreApplication(app.id, app.analysis_id!);
    logEvent("application", app.id, "RESCORED", "Re-scored with the current credit policy.", actorId);
    return { jobId: null, finished: Promise.resolve() };
  }
  const farm = getFarm(app.farm_id);
  run("UPDATE applications SET status = 'ANALYZING' WHERE id = ?", app.id);
  const job = startAnalysis({ polygon: JSON.parse(farm.polygon), farmId: farm.id, fresh: true, paced: !config.serverless, onDone: (aid) => scoreApplication(app.id, aid) });
  run("UPDATE applications SET analysis_id = ? WHERE id = ?", job.analysisId, app.id);
  run("UPDATE farms SET analysis_id = ? WHERE id = ?", job.analysisId, farm.id);
  job.listeners.add((e) => {
    if (e.type === "error") run("UPDATE applications SET status = 'ERROR' WHERE id = ?", app.id);
  });
  logEvent("application", app.id, "RETRY", "Satellite analysis restarted.", actorId);
  return { jobId: job.id, finished: job.finished };
}

/* ── Repayment ─────────────────────────────────────────────────────────── */

export function repay(loanId: string, amount: number, channel: string, actorId: string | null, at = businessNow()) {
  const loan = getLoan(loanId);
  if (!["ACTIVE", "T2_RELEASED", "T2_HELD", "RESTRUCTURED", "DEFAULTED"].includes(loan.state)) throw conflict(`A loan that is ${loan.state.toLowerCase()} can't take repayments.`);
  const { outstanding } = loanMoney(loan);
  if (amount <= 0) throw new ApiError(422, "Enter an amount above zero.");
  if (amount > outstanding) throw new ApiError(422, `That's more than the ${naira(outstanding)} owed.`);
  const farmer = getFarmer(loan.farmer_id);
  if (!farmer.account_no) throw new ApiError(422, "Farmer has no Ecobank account.");
  return tx(() => {
    core.debit(farmer.account_no!, amount, `SkyScore loan repayment (${channel})`);
    postJournal(loan.id, repaymentEntry(loan.id, farmer.id, amount, channel), at);
    const left = outstanding - amount;
    if (left <= 0) {
      run("UPDATE loans SET state = ?, updated_at = ? WHERE id = ?", nextState(loan.state as LoanState, "REPAY_FULL"), at, loan.id);
      if (at.slice(0, 10) <= loan.due_date) run("UPDATE farmers SET prior_on_time = prior_on_time + 1 WHERE id = ?", farmer.id);
      run("UPDATE alerts SET status = 'RESOLVED' WHERE loan_id = ? AND status = 'OPEN'", loan.id);
      sendSms(farmer.phone, `Loan fully repaid. Thank you ${farmer.first_name}! Your next SkyScore limit has gone up.`, "RECEIPT");
      logEvent("loan", loan.id, "REPAID", `Fully repaid via ${channel}.`, actorId);
    } else {
      sendSms(farmer.phone, `Received ${naira(amount)} for your SkyScore loan. Balance ${naira(left)}.`, "RECEIPT");
      logEvent("loan", loan.id, "REPAYMENT", `${naira(amount)} repaid via ${channel}; ${naira(left)} left.`, actorId);
    }
    return { paid: amount, outstanding: Math.max(0, left), state: left <= 0 ? "REPAID" : loan.state };
  });
}

/* ── Farmers ───────────────────────────────────────────────────────────── */

export function setUssdPin(farmerId: string, pin: string) {
  if (!/^\d{4}$/.test(pin)) throw new ApiError(422, "A USSD PIN has 4 digits.");
  run("UPDATE farmers SET ussd_pin_hash = ? WHERE id = ?", hashPin(pin), farmerId);
}

export { NO_FARMER };
