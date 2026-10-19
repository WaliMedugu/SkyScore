// Public endpoints: health, sign-in, the field explorer (analysis jobs + live stream), satellite images, USSD.
import { Hono, type Context } from "hono";
import { streamSSE, type SSEStreamingApi } from "hono/streaming";
import { getConnInfo } from "@hono/node-server/conninfo";
import { assess, round, type BBox, type CropKey, type Polygon } from "@skyscore/engine";
import { OfflineMiss } from "@skyscore/satellite";
import { TYPICAL_FARMER, analysisDto, getJob, offersByCrop, startAnalysis, type Job } from "../analysis.ts";
import { checkPin, issueToken, loginAllowed, loginFailed, loginSucceeded, type AppEnv, type AuthUser } from "../auth.ts";
import { config } from "../config.ts";
import { one } from "../db.ts";
import { demoClock } from "../lending.ts";
import { getPolicy } from "../policy.ts";
import { portfolioSummary } from "../portfolio.ts";
import { sceneImage, snapshots } from "../satellite.ts";
import { AnalysisCreateSchema, AnalysisStreamSchema, LoginSchema, UssdSchema } from "../schemas.ts";
import { ussdReply } from "../ussd.ts";
import { ApiError, badRequest, body, notFound, today } from "../util.ts";

export const VERSION = "1.0.0";
export const publicRoutes = new Hono<AppEnv>();

publicRoutes.get("/health", (c) =>
  c.json({
    ok: true,
    service: "skyscore-api",
    version: VERSION,
    offline: config.offline,
    sandbox: config.sandbox,
    snapshots: snapshots.list().length,
    time: new Date().toISOString(),
  }),
);

/** Settings the clients need: season, business date, crops and their input packages. */
publicRoutes.get("/meta", (c) => {
  const p = getPolicy();
  return c.json({
    version: VERSION,
    season: config.loanSeason,
    businessDate: demoClock(),
    demoClock: config.demoClock,
    sandbox: config.sandbox,
    offline: config.offline,
    ussdCode: config.ussdCode,
    policyVersion: p.version,
    bands: p.score.bands,
    caps: p.lending.caps,
    interestFlat: p.lending.interestFlat,
    insurancePremium: p.lending.insurancePremium,
    crops: Object.values(p.crops).map((cr) => ({
      key: cr.key,
      label: cr.label,
      hausa: cr.hausa,
      plantMonth: cr.plantMonth,
      maturityDays: cr.maturityDays,
      yieldT: cr.yieldT,
      pricePerT: cr.pricePerT,
      items: cr.items,
    })),
  });
});

/** Aggregate, non-personal numbers for the public site. */
publicRoutes.get("/stats", (c) => {
  const s = portfolioSummary();
  const fields = snapshots.list();
  return c.json({
    farmers: s.farmers,
    hectares: s.hectares,
    loans: s.loans.total,
    disbursed: s.money.disbursed,
    repaymentRate: s.repaymentRate,
    ghostFarmsBlocked: s.ghostFarmsBlocked,
    averageScore: s.averageScore,
    photosRead: fields.reduce((a, f) => a + f.bundle.optical.length, 0),
    radarPasses: fields.reduce((a, f) => a + f.bundle.radar.length, 0),
    photosOnRecord: fields.reduce((a, f) => a + f.bundle.scenesFound, 0),
    realFields: fields.length,
  }, 200, { "cache-control": "public, max-age=30, s-maxage=60" });
});

/* ── Sign-in ───────────────────────────────────────────────────────────── */

publicRoutes.post("/auth/login", async (c) => {
  const { username, pin } = await body(c, LoginSchema);
  const uname = username.trim().toLowerCase();
  if (!loginAllowed(uname)) throw new ApiError(429, "Too many wrong PINs. Wait 5 minutes and try again.");
  const u = one<{ id: string; username: string; name: string; role: AuthUser["role"]; dealer_id: string | null; pin_hash: string }>(
    "SELECT * FROM users WHERE username = ?",
    uname,
  );
  if (!u || !checkPin(pin, u.pin_hash)) {
    loginFailed(uname);
    throw new ApiError(401, "Wrong username or PIN.");
  }
  loginSucceeded(uname);
  const user: AuthUser = { id: u.id, username: u.username, name: u.name, role: u.role, dealerId: u.dealer_id };
  return c.json({ token: await issueToken(user), user, expiresInHours: 12 });
});

/* ── Field explorer: analyse any field ─────────────────────────────────── */

function clientIp(c: Context): string {
  const fwd = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  if (fwd) return fwd;
  try {
    return getConnInfo(c).remote.address ?? "local";
  } catch {
    return "local";
  }
}

// Live satellite reads are heavy, so each address gets 20 an hour (saved demo fields are free).
const hits = new Map<string, number[]>();
function allowLive(ip: string, max = 20, windowMs = 3_600_000): boolean {
  const t = Date.now();
  const recent = (hits.get(ip) ?? []).filter((x) => t - x < windowMs);
  if (recent.length >= max) return false;
  recent.push(t);
  hits.set(ip, recent);
  return true;
}

publicRoutes.post("/analyses", async (c) => {
  const b = await body(c, AnalysisCreateSchema);
  const polygon = b.polygon as Polygon;
  if (!snapshots.forPolygon(polygon) && !allowLive(clientIp(c))) throw new ApiError(429, "Too many live analyses from this address. Try again within the hour.");
  const job = startAnalysis({ polygon, fromYear: b.fromYear, fresh: b.fresh });
  return c.json({ jobId: job.id, analysisId: job.analysisId, status: job.status }, 202);
});

const DATE = /^\d{4}-\d{2}-\d{2}$/;

publicRoutes.get("/analyses/:id", (c) => {
  const q = c.req.query();
  const crops = getPolicy().crops;
  const dto = analysisDto(c.req.param("id"), {
    farmer: TYPICAL_FARMER,
    asOf: q.asOf && DATE.test(q.asOf) ? q.asOf : undefined,
    crop: q.crop && q.crop in crops ? (q.crop as CropKey) : undefined,
    plantingMonth: q.plantingMonth && /^(1[0-2]|[1-9])$/.test(q.plantingMonth) ? Number(q.plantingMonth) : undefined,
    seasonYear: q.seasonYear && /^20\d\d$/.test(q.seasonYear) ? Number(q.seasonYear) : undefined,
  });
  if (!dto) throw notFound("Analysis");
  return c.json({ ...dto, profile: "TYPICAL_APPLICANT" });
});

publicRoutes.get("/jobs/:id", (c) => {
  const job = getJob(c.req.param("id"));
  if (!job) throw notFound("Job");
  return c.json(job.summary());
});

/** Pump a job's events into a server-sent-events stream until it finishes (with a heartbeat while it works). */
async function pipeJob(stream: SSEStreamingApi, job: Job, from = 0) {
  let sent = Math.max(0, Math.min(from, job.events.length));
  let wake = () => {};
  let aborted = false;
  const listener = () => wake();
  job.listeners.add(listener);
  stream.onAbort(() => {
    aborted = true;
    wake();
  });
  try {
    while (!aborted) {
      while (sent < job.events.length && !aborted) {
        const e = job.events[sent];
        await stream.writeSSE({ id: String(e.seq), event: e.type, data: JSON.stringify(e.data) });
        sent = e.seq;
      }
      if (job.status !== "running") break;
      const woke = await new Promise<boolean>((resolve) => {
        const t = setTimeout(() => resolve(false), 15_000);
        wake = () => {
          clearTimeout(t);
          resolve(true);
        };
      });
      if (!woke && !aborted) await stream.writeSSE({ event: "ping", data: "{}" });
    }
  } finally {
    job.listeners.delete(listener);
  }
  return !aborted;
}

/** Server-sent events: every photo as it is read, partial scores, then done/error. Resumable with Last-Event-ID. */
publicRoutes.get("/jobs/:id/events", (c) => {
  const job = getJob(c.req.param("id"));
  if (!job) throw notFound("Job");
  const from = Number(c.req.header("last-event-id") ?? c.req.query("after") ?? 0) || 0;
  return streamSSE(c, async (stream) => {
    await pipeJob(stream, job, from);
  });
});

/**
 * Analyse a field in one request: the same live events, then a final `result` event carrying the scored analysis
 * and an offer for every crop. Nothing depends on a later request reaching the same server (serverless-safe).
 */
publicRoutes.post("/analyses/stream", async (c) => {
  const b = await body(c, AnalysisStreamSchema);
  const polygon = b.polygon as Polygon;
  if (!snapshots.forPolygon(polygon) && !allowLive(clientIp(c))) throw new ApiError(429, "Too many live analyses from this address. Try again within the hour.");
  const job = startAnalysis({ polygon, fromYear: b.fromYear, fresh: b.fresh });
  const crop = b.crop && b.crop in getPolicy().crops ? (b.crop as CropKey) : undefined;
  return streamSSE(c, async (stream) => {
    const open = await pipeJob(stream, job);
    if (!open || job.status !== "done") return;
    const analysis = analysisDto(job.analysisId, { farmer: TYPICAL_FARMER, crop });
    await stream.writeSSE({
      event: "result",
      data: JSON.stringify({ ...analysis, profile: "TYPICAL_APPLICANT", offers: offersByCrop(job.analysisId, TYPICAL_FARMER) }),
    });
  });
});

/** One time-lapse frame (true colour or greenness) for a field. Cached; works offline for saved fields. */
publicRoutes.get("/scenes/:sceneId/image", async (c) => {
  const q = c.req.query();
  const bbox = (q.bbox ?? "").split(",").map(Number) as BBox;
  if (bbox.length !== 4 || bbox.some((v) => !Number.isFinite(v))) throw badRequest("bbox=minLng,minLat,maxLng,maxLat is required.");
  const kind = q.kind === "ndvi" ? "ndvi" : "rgb";
  try {
    const img = await sceneImage(c.req.param("sceneId"), bbox, kind, q.snap, Number(q.size ?? 256) || 256);
    return c.body(new Uint8Array(img.data), 200, { "content-type": img.type, "cache-control": "public, max-age=604800, s-maxage=31536000, immutable" });
  } catch (e) {
    if (e instanceof OfflineMiss) throw new ApiError(503, "This photo isn't saved and the server is offline.");
    if (e instanceof Error && /^Bad /.test(e.message)) throw badRequest(e.message);
    throw new ApiError(502, "The satellite archive didn't return this photo. Try again.");
  }
});

/** Real fields the demo ships with: proven farms and non-farm land (ghost-farm tests). */
publicRoutes.get("/showcase", (c) => {
  const p = getPolicy();
  const asOf = today();
  const items = snapshots
    .list()
    .filter((s) => s.kind !== "portfolio")
    .map((s) => {
      const a = assess({ bundle: s.bundle, farmer: TYPICAL_FARMER, policy: p, asOf, crop: s.crop });
      const peak = s.frames.filter((f) => f.date.slice(5, 7) >= "08").at(-1) ?? s.frames.at(-1) ?? null;
      return {
        key: s.key,
        kind: s.kind,
        cluster: s.cluster,
        place: s.place,
        state: s.state,
        crop: s.crop,
        cropLabel: p.crops[s.crop]?.label ?? s.crop,
        polygon: s.polygon,
        areaHa: round(s.bundle.areaHa, 2),
        centroid: s.bundle.centroid,
        photosFound: s.bundle.scenesFound,
        clearPhotos: a.clearPhotos,
        score: a.score.score,
        band: a.score.band,
        decision: a.score.decision,
        ghost: a.score.ghost,
        cultivatedSeasons: a.score.cultivatedSeasons,
        seasonsConsidered: a.score.seasonsConsidered,
        headline: a.score.headline,
        thumbnail: peak,
        frames: s.frames,
      };
    })
    .sort((x, y) => (x.kind === y.kind ? x.key.localeCompare(y.key) : x.kind === "showcase" ? -1 : 1));
  // Same for every visitor: let a CDN keep it for a few minutes.
  c.header("cache-control", "public, max-age=60, s-maxage=600");
  return c.json(items);
});

/* ── USSD (Africa's Talking callback; also used by the console simulator) ── */

publicRoutes.post("/ussd", async (c) => {
  if (config.ussdSecret && c.req.query("key") !== config.ussdSecret) return c.text("END Not allowed.", 403);
  const ct = c.req.header("content-type") ?? "";
  const raw = ct.includes("application/json") ? await c.req.json().catch(() => ({})) : await c.req.parseBody();
  const r = UssdSchema.safeParse(raw);
  if (!r.success) return c.text("END Invalid request.", 400);
  return c.text(ussdReply(r.data.phoneNumber, r.data.text));
});
