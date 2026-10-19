// Applications, loans and vouchers.
import { Hono } from "hono";
import { requireAuth, requireRole, type AppEnv } from "../auth.ts";
import { config } from "../config.ts";
import { all } from "../db.ts";
import {
  acceptApplication,
  createApplication,
  decideApplication,
  getApplication,
  getLoan,
  getVoucher,
  monitorLoan,
  redeemVoucher,
  repay,
  rescoreApplication,
  seasonChart,
  sendOtp,
} from "../lending.ts";
import { AcceptSchema, ApplicationCreateSchema, DecisionSchema, MonitorSchema, RedeemSchema, RepaySchema } from "../schemas.ts";
import { ApiError, body } from "../util.ts";
import { applicationDto, loanDto, voucherDto, type ApplicationRow, type LoanRow, type VoucherRow } from "../views.ts";

const STATUS = /^[A-Z_]{3,20}$/;

/* ── Applications ──────────────────────────────────────────────────────── */

export const applicationRoutes = new Hono<AppEnv>();
applicationRoutes.use("*", requireAuth("agent", "officer"));

applicationRoutes.get("/", (c) => {
  const status = c.req.query("status");
  const season = Number(c.req.query("season")) || null;
  const where: string[] = [];
  const params: unknown[] = [];
  if (status && STATUS.test(status)) {
    where.push("status = ?");
    params.push(status);
  }
  if (season) {
    where.push("season_year = ?");
    params.push(season);
  }
  const rows = all<ApplicationRow>(`SELECT * FROM applications ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT 500`, ...params);
  return c.json(rows.map((a) => applicationDto(a)));
});

applicationRoutes.post("/", async (c) => {
  const b = await body(c, ApplicationCreateSchema);
  const { finished, ...r } = createApplication(b.farmId, c.get("user").id, b.seasonYear);
  // Serverless instances can't keep working after the response, so the request waits for the score.
  if (config.serverless) await finished;
  return c.json({ ...r, application: applicationDto(getApplication(r.applicationId)) }, config.serverless ? 201 : 202);
});

applicationRoutes.get("/:id", (c) => c.json(applicationDto(getApplication(c.req.param("id")), true)));

applicationRoutes.post("/:id/decision", requireRole("officer"), async (c) => {
  const b = await body(c, DecisionSchema);
  decideApplication(c.req.param("id"), b.action, b.note ?? "", c.get("user").id);
  return c.json(applicationDto(getApplication(c.req.param("id")), true));
});

applicationRoutes.post("/:id/otp", (c) => c.json(sendOtp(c.req.param("id"), c.get("user").id)));

applicationRoutes.post("/:id/accept", async (c) => {
  const { otp } = await body(c, AcceptSchema);
  const loanId = acceptApplication(c.req.param("id"), otp, c.get("user").id);
  return c.json(loanDto(getLoan(loanId), true), 201);
});

applicationRoutes.post("/:id/rescore", requireRole("officer"), async (c) => {
  const { finished, ...r } = rescoreApplication(c.req.param("id"), c.get("user").id);
  if (config.serverless) await finished;
  return c.json({ ...r, application: applicationDto(getApplication(c.req.param("id")), true) }, r.jobId && !config.serverless ? 202 : 200);
});

/* ── Loans ─────────────────────────────────────────────────────────────── */

export const loanRoutes = new Hono<AppEnv>();
loanRoutes.use("*", requireAuth("agent", "officer"));

loanRoutes.get("/", (c) => {
  const q = c.req.query();
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.state && STATUS.test(q.state)) {
    where.push("state = ?");
    params.push(q.state);
  }
  if (q.health && STATUS.test(q.health)) {
    where.push("health = ?");
    params.push(q.health);
  }
  if (q.season && Number(q.season)) {
    where.push("season_year = ?");
    params.push(Number(q.season));
  }
  if (q.farmerId) {
    where.push("farmer_id = ?");
    params.push(q.farmerId);
  }
  const rows = all<LoanRow>(`SELECT * FROM loans ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT 500`, ...params);
  return c.json(rows.map((l) => loanDto(l)));
});

loanRoutes.get("/:id", (c) => {
  const loan = getLoan(c.req.param("id"));
  return c.json({ ...loanDto(loan, true), season: seasonChart(loan) });
});

loanRoutes.post("/:id/monitor", async (c) => {
  const b = await body(c, MonitorSchema);
  await monitorLoan(c.req.param("id"), b.asOf, c.get("user").id);
  const loan = getLoan(c.req.param("id"));
  return c.json({ ...loanDto(loan, true), season: seasonChart(loan) });
});

loanRoutes.post("/:id/repayments", async (c) => {
  const b = await body(c, RepaySchema);
  const r = repay(c.req.param("id"), b.amount, b.channel ?? "AGENT", c.get("user").id);
  return c.json({ ...r, loan: loanDto(getLoan(c.req.param("id")), true) }, 201);
});

/* ── Vouchers (dealers redeem, agents and officers look up) ────────────── */

export const voucherRoutes = new Hono<AppEnv>();
voucherRoutes.use("*", requireAuth("dealer", "agent", "officer"));

voucherRoutes.get("/", (c) => {
  const user = c.get("user");
  const status = c.req.query("status");
  const where: string[] = [];
  const params: unknown[] = [];
  if (user.role === "dealer") {
    where.push("dealer_id = ?");
    params.push(user.dealerId);
  } else if (c.req.query("dealerId")) {
    where.push("dealer_id = ?");
    params.push(c.req.query("dealerId"));
  }
  if (status && STATUS.test(status)) {
    where.push("status = ?");
    params.push(status);
  }
  const rows = all<VoucherRow>(
    `SELECT * FROM vouchers ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY COALESCE(redeemed_at, issued_at) DESC LIMIT 300`,
    ...params,
  );
  return c.json(rows.map(voucherDto));
});

voucherRoutes.get("/:code", (c) => c.json(voucherDto(getVoucher(c.req.param("code")))));

voucherRoutes.post("/:code/redeem", requireRole("dealer", "officer"), async (c) => {
  const user = c.get("user");
  const b = await body(c, RedeemSchema);
  const dealerId = user.role === "dealer" ? user.dealerId : b.dealerId;
  if (!dealerId) throw new ApiError(422, "Choose the agro-dealer handing over the inputs.");
  const r = redeemVoucher(c.req.param("code"), dealerId, user.id);
  return c.json({ ...r, voucher: voucherDto(getVoucher(r.code)) });
});
