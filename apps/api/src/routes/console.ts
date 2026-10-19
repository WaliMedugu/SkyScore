// Bank console: who am I, dealers, portfolio, alerts, SMS outbox, activity, credit policy, season clock, sandbox.
import { Hono } from "hono";
import { core, sendSms, smsFor } from "../adapters.ts";
import { requireAuth, requireRole, type AppEnv } from "../auth.ts";
import { config } from "../config.ts";
import { all, logEvent, now, one, run } from "../db.ts";
import { demoClock, replayTo } from "../lending.ts";
import { getPolicy, resetPolicy, savePolicyPatch } from "../policy.ts";
import { portfolioMap, portfolioSummary } from "../portfolio.ts";
import { DepositSchema, PolicyPatchSchema, ReplaySchema } from "../schemas.ts";
import { ApiError, body, naira, notFound } from "../util.ts";
import { voucherDto, type VoucherRow } from "../views.ts";

interface DealerRow {
  id: string;
  name: string;
  owner: string | null;
  phone: string | null;
  address: string | null;
  state: string | null;
  lng: number | null;
  lat: number | null;
  account_no: string | null;
  created_at: string;
}

function dealerDto(d: DealerRow) {
  const stats = one<{ n: number; total: number }>("SELECT COUNT(*) n, COALESCE(SUM(amount),0) total FROM vouchers WHERE dealer_id = ? AND status = 'REDEEMED'", d.id);
  return {
    id: d.id,
    name: d.name,
    owner: d.owner,
    phone: d.phone,
    address: d.address,
    state: d.state,
    lng: d.lng,
    lat: d.lat,
    accountNo: d.account_no,
    balance: d.account_no ? (core.get(d.account_no)?.balance ?? 0) : 0,
    vouchersRedeemed: stats?.n ?? 0,
    valueRedeemed: stats?.total ?? 0,
  };
}

/* ── Me ────────────────────────────────────────────────────────────────── */

export const meRoutes = new Hono<AppEnv>();
meRoutes.use("*", requireAuth());
meRoutes.get("/", (c) => {
  const user = c.get("user");
  const dealer = user.dealerId ? one<DealerRow>("SELECT * FROM dealers WHERE id = ?", user.dealerId) : undefined;
  return c.json({ user, dealer: dealer ? dealerDto(dealer) : null, businessDate: demoClock(), season: config.loanSeason, sandbox: config.sandbox });
});

/* ── Dealers ───────────────────────────────────────────────────────────── */

export const dealerRoutes = new Hono<AppEnv>();
dealerRoutes.use("*", requireAuth("agent", "officer", "dealer"));
dealerRoutes.get("/", requireRole("agent", "officer"), (c) => c.json(all<DealerRow>("SELECT * FROM dealers ORDER BY state, name").map(dealerDto)));
dealerRoutes.get("/:id", (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (user.role === "dealer" && user.dealerId !== id) throw new ApiError(403, "You can only see your own shop.");
  const d = one<DealerRow>("SELECT * FROM dealers WHERE id = ?", id);
  if (!d) throw notFound("Dealer");
  const vouchers = all<VoucherRow>("SELECT * FROM vouchers WHERE dealer_id = ? ORDER BY redeemed_at DESC LIMIT 200", id).map(voucherDto);
  return c.json({ ...dealerDto(d), vouchers });
});

/* ── Portfolio, alerts, SMS outbox, activity ───────────────────────────── */

export const portfolioRoutes = new Hono<AppEnv>();
portfolioRoutes.use("*", requireAuth("agent", "officer"));
portfolioRoutes.get("/summary", (c) => c.json(portfolioSummary()));
portfolioRoutes.get("/map", (c) => c.json(portfolioMap()));

export const alertRoutes = new Hono<AppEnv>();
alertRoutes.use("*", requireAuth("agent", "officer"));
alertRoutes.get("/", (c) => {
  const status = c.req.query("status");
  const rows = all<Record<string, unknown>>(
    `SELECT a.*, f.name AS farm_name, f.lng, f.lat, (fr.first_name || ' ' || fr.last_name) AS farmer_name, fr.phone AS farmer_phone
     FROM alerts a LEFT JOIN farms f ON f.id = a.farm_id LEFT JOIN loans l ON l.id = a.loan_id LEFT JOIN farmers fr ON fr.id = l.farmer_id
     ${status && /^[A-Z]+$/.test(status) ? "WHERE a.status = ?" : ""} ORDER BY a.created_at DESC LIMIT 300`,
    ...(status && /^[A-Z]+$/.test(status) ? [status] : []),
  );
  return c.json(
    rows.map((r) => ({
      id: r.id,
      loanId: r.loan_id,
      farmId: r.farm_id,
      type: r.type,
      severity: r.severity,
      title: r.title,
      detail: r.detail,
      status: r.status,
      createdAt: r.created_at,
      ackBy: r.ack_by,
      ackAt: r.ack_at,
      farmName: r.farm_name,
      farmerName: r.farmer_name,
      lng: r.lng,
      lat: r.lat,
    })),
  );
});
alertRoutes.post("/:id/ack", async (c) => {
  const user = c.get("user");
  const note = (await c.req.json().catch(() => ({}))) as { note?: string };
  const r = run("UPDATE alerts SET status = 'ACKNOWLEDGED', ack_by = ?, ack_at = ? WHERE id = ? AND status = 'OPEN'", user.id, now(), c.req.param("id"));
  if (!r.changes) throw notFound("Open alert");
  const a = one<{ loan_id: string; title: string }>("SELECT loan_id, title FROM alerts WHERE id = ?", c.req.param("id"));
  if (a?.loan_id) logEvent("loan", a.loan_id, "ALERT_ACK", `${user.name} acknowledged "${a.title}"${note.note ? `: ${String(note.note).slice(0, 200)}` : ""}.`, user.id);
  return c.json({ ok: true });
});

export const smsRoutes = new Hono<AppEnv>();
smsRoutes.use("*", requireAuth("agent", "officer"));
smsRoutes.get("/", (c) => {
  const phone = c.req.query("phone")?.replace(/[^\d]/g, "");
  const limit = Math.min(Number(c.req.query("limit")) || 100, 500);
  return c.json(smsFor(phone || undefined, limit));
});

export const eventRoutes = new Hono<AppEnv>();
eventRoutes.use("*", requireAuth("agent", "officer"));
eventRoutes.get("/", (c) => {
  const q = c.req.query();
  const limit = Math.min(Number(q.limit) || 80, 500);
  const where: string[] = ["entity <> 'account'"];
  const params: unknown[] = [];
  if (q.entity && /^[a-z]+$/.test(q.entity)) {
    where.push("entity = ?");
    params.push(q.entity);
  }
  if (q.entityId) {
    where.push("entity_id = ?");
    params.push(q.entityId);
  }
  const rows = all<{ id: number; entity: string; entity_id: string; type: string; message: string; actor_name: string | null; data: string | null; created_at: string }>(
    `SELECT e.*, u.name AS actor_name FROM events e LEFT JOIN users u ON u.id = e.actor WHERE ${where.join(" AND ")} ORDER BY e.id DESC LIMIT ?`,
    ...params,
    limit,
  );
  return c.json(
    rows.map((r) => ({
      id: r.id,
      entity: r.entity,
      entityId: r.entity_id,
      type: r.type,
      message: r.message,
      actor: r.actor_name ?? "SkyScore",
      data: r.data ? JSON.parse(r.data) : null,
      createdAt: r.created_at,
    })),
  );
});

/* ── Credit policy ─────────────────────────────────────────────────────── */

export const policyRoutes = new Hono<AppEnv>();
policyRoutes.use("*", requireAuth());
policyRoutes.get("/", (c) => c.json(getPolicy()));
policyRoutes.patch("/", requireRole("officer"), async (c) => {
  const patch = await body(c, PolicyPatchSchema);
  const p = savePolicyPatch(patch);
  logEvent("system", "policy", "POLICY_CHANGED", `Credit policy v${p.version} saved: ${Object.keys(patch).join(", ")} changed.`, c.get("user").id, patch);
  return c.json(p);
});
policyRoutes.post("/reset", requireRole("officer"), (c) => {
  const p = resetPolicy();
  logEvent("system", "policy", "POLICY_RESET", "Credit policy reset to the calibrated defaults.", c.get("user").id);
  return c.json(p);
});

/* ── Season clock (replay the season with real satellite data) ─────────── */

export const demoRoutes = new Hono<AppEnv>();
demoRoutes.use("*", requireAuth());
demoRoutes.get("/clock", (c) => c.json({ date: demoClock(), season: config.loanSeason, enabled: config.demoClock }));
demoRoutes.post("/replay", requireRole("officer"), async (c) => {
  const { date } = await body(c, ReplaySchema);
  return c.json(await replayTo(date, c.get("user").id));
});

/* ── Sandbox helpers (only while SKYSCORE_SANDBOX is on) ───────────────── */

export const sandboxRoutes = new Hono<AppEnv>();
sandboxRoutes.use("*", requireAuth("agent", "officer"));
sandboxRoutes.post("/deposit", async (c) => {
  if (!config.sandbox) throw new ApiError(403, "Sandbox tools are off on this server.");
  const b = await body(c, DepositSchema);
  const farmer = one<{ id: string; first_name: string; last_name: string; phone: string }>("SELECT * FROM farmers WHERE id = ?", b.farmerId);
  if (!farmer) throw notFound("Farmer");
  const acc = core.openAccount("farmer", farmer.id, `${farmer.first_name} ${farmer.last_name}`);
  run("UPDATE farmers SET account_no = ? WHERE id = ?", acc.account_no, farmer.id);
  core.credit(acc.account_no, b.amount, b.memo ?? "Harvest sale (sandbox)");
  sendSms(farmer.phone, `Ecobank: ${naira(b.amount)} received in account ${acc.account_no}. ${b.memo ?? ""}`.trim(), "INFO");
  return c.json(core.get(acc.account_no));
});
