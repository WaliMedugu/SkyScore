// Farmers and their farms (field agents and loan officers).
import { Hono } from "hono";
import { areaHa, bbox, centroid, pointInPolygon, polygonKey, round, type CropKey, type Polygon } from "@skyscore/engine";
import { core, sendSms, smsFor, verifyBvn } from "../adapters.ts";
import { analysisDto, startAnalysis } from "../analysis.ts";
import { requireAuth, type AppEnv } from "../auth.ts";
import { config } from "../config.ts";
import { all, logEvent, now, one, run } from "../db.ts";
import { decisionDate, setUssdPin } from "../lending.ts";
import { getPolicy } from "../policy.ts";
import { snapshots } from "../satellite.ts";
import { BvnSchema, FarmCreateSchema, FarmerCreateSchema, UssdPinSchema } from "../schemas.ts";
import { ApiError, body, conflict, id, notFound } from "../util.ts";
import { applicationDto, farmDto, farmerDto, farmerProfile, loanDto, type ApplicationRow, type FarmRow, type FarmerRow, type LoanRow } from "../views.ts";

const intParam = (v: string | undefined, lo: number, hi: number, dflt: number) => {
  const n = Number(v);
  return Number.isInteger(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

const getFarmer = (farmerId: string) => {
  const f = one<FarmerRow>("SELECT * FROM farmers WHERE id = ?", farmerId);
  if (!f) throw notFound("Farmer");
  return f;
};
const getFarm = (farmId: string) => {
  const f = one<FarmRow>("SELECT * FROM farms WHERE id = ?", farmId);
  if (!f) throw notFound("Farm");
  return f;
};

/* ── Farmers ───────────────────────────────────────────────────────────── */

export const farmerRoutes = new Hono<AppEnv>();
farmerRoutes.use("*", requireAuth("agent", "officer"));

farmerRoutes.get("/", (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const limit = intParam(c.req.query("limit"), 1, 200, 50);
  const offset = intParam(c.req.query("offset"), 0, 1_000_000, 0);
  const digits = q.replace(/\D/g, "");
  const where = q ? "WHERE (first_name || ' ' || last_name) LIKE ? OR phone LIKE ? OR id = ? OR hub LIKE ?" : "";
  const params = q ? [`%${q}%`, digits ? `%${digits}%` : "-", q, `%${q}%`] : [];
  const rows = all<FarmerRow>(`SELECT * FROM farmers ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
  const total = one<{ n: number }>(`SELECT COUNT(*) n FROM farmers ${where}`, ...params)?.n ?? 0;
  return c.json({
    total,
    items: rows.map((r) => {
      const farms = one<{ n: number; ha: number }>("SELECT COUNT(*) n, COALESCE(SUM(area_ha),0) ha FROM farms WHERE farmer_id = ?", r.id);
      const loan = one<{ id: string; state: string; health: string }>("SELECT id, state, health FROM loans WHERE farmer_id = ? ORDER BY created_at DESC LIMIT 1", r.id);
      return { ...farmerDto(r), farms: farms?.n ?? 0, hectares: round(farms?.ha ?? 0, 2), latestLoan: loan ?? null };
    }),
  });
});

farmerRoutes.post("/", async (c) => {
  const b = await body(c, FarmerCreateSchema);
  const user = c.get("user");
  if (one("SELECT 1 FROM farmers WHERE phone = ?", b.phone)) throw conflict("A farmer with this phone number is already registered.");
  if (b.bvn && one("SELECT 1 FROM farmers WHERE bvn = ?", b.bvn)) throw conflict("This BVN is already registered to another farmer.");
  const bvn = b.bvn ? verifyBvn(b.bvn, b.firstName, b.lastName) : null;
  const fid = id("frm");
  const at = now();
  run(
    `INSERT INTO farmers(id, first_name, last_name, phone, gender, birth_year, bvn, bvn_verified, nin, hub, trained, cooperative, language, consent_at, created_by, created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    fid,
    b.firstName,
    b.lastName,
    b.phone,
    b.gender ?? null,
    b.birthYear ?? null,
    b.bvn ?? null,
    bvn?.verified ?? false,
    b.nin ?? null,
    b.hub ?? null,
    b.trained ?? false,
    b.cooperative ?? null,
    b.language ?? "en",
    at,
    user.id,
    at,
  );
  logEvent("farmer", fid, "REGISTERED", `${b.firstName} ${b.lastName} registered${b.hub ? ` at ${b.hub}` : ""}; consent recorded.`, user.id, { bvn: bvn?.verified ?? null });
  sendSms(b.phone, `Welcome to SkyScore by Ecobank, ${b.firstName}! Your agent ${user.name} registered you. We never ask for your PIN.`, "INFO");
  return c.json({ farmer: farmerDto(getFarmer(fid)), bvn }, 201);
});

farmerRoutes.get("/:id", (c) => {
  const f = getFarmer(c.req.param("id"));
  return c.json({
    ...farmerDto(f),
    account: core.forOwner("farmer", f.id) ?? null,
    farms: all<FarmRow>("SELECT * FROM farms WHERE farmer_id = ? ORDER BY created_at", f.id).map(farmDto),
    applications: all<ApplicationRow>("SELECT * FROM applications WHERE farmer_id = ? ORDER BY created_at DESC", f.id).map((a) => applicationDto(a)),
    loans: all<LoanRow>("SELECT * FROM loans WHERE farmer_id = ? ORDER BY created_at DESC", f.id).map((l) => loanDto(l)),
    sms: smsFor(f.phone, 30),
    ussdPinSet: !!one("SELECT 1 FROM farmers WHERE id = ? AND ussd_pin_hash IS NOT NULL", f.id),
  });
});

farmerRoutes.post("/:id/verify-bvn", async (c) => {
  const f = getFarmer(c.req.param("id"));
  const { bvn = f.bvn ?? undefined } = await body(c, BvnSchema);
  if (!bvn) throw new ApiError(422, "Enter the farmer's 11-digit BVN.");
  if (one("SELECT 1 FROM farmers WHERE bvn = ? AND id <> ?", bvn, f.id)) throw conflict("This BVN is already registered to another farmer.");
  const r = verifyBvn(bvn, f.first_name, f.last_name);
  run("UPDATE farmers SET bvn = ?, bvn_verified = ? WHERE id = ?", bvn, r.verified, f.id);
  logEvent("farmer", f.id, r.verified ? "BVN_VERIFIED" : "BVN_FAILED", r.message, c.get("user").id);
  return c.json({ ...r, farmer: farmerDto(getFarmer(f.id)) });
});

farmerRoutes.post("/:id/ussd-pin", async (c) => {
  const f = getFarmer(c.req.param("id"));
  const { pin } = await body(c, UssdPinSchema);
  setUssdPin(f.id, pin);
  logEvent("farmer", f.id, "USSD_PIN_SET", "USSD PIN set by the farmer at the agent's phone.", c.get("user").id);
  return c.json({ ok: true });
});

/* ── Farms ─────────────────────────────────────────────────────────────── */

export const farmRoutes = new Hono<AppEnv>();
farmRoutes.use("*", requireAuth("agent", "officer"));

farmRoutes.get("/", (c) => {
  const farmerId = c.req.query("farmerId");
  const rows = farmerId
    ? all<FarmRow>("SELECT * FROM farms WHERE farmer_id = ? ORDER BY created_at DESC", farmerId)
    : all<FarmRow>("SELECT * FROM farms ORDER BY created_at DESC LIMIT ?", intParam(c.req.query("limit"), 1, 500, 200));
  return c.json(rows.map(farmDto));
});

/** A field already registered under this boundary or overlapping it can't back a second loan. */
function overlapping(polygon: Polygon) {
  const [x0, y0, x1, y1] = bbox(polygon);
  const c0 = centroid(polygon);
  const near = all<FarmRow>("SELECT * FROM farms WHERE lng BETWEEN ? AND ? AND lat BETWEEN ? AND ?", x0 - 0.01, x1 + 0.01, y0 - 0.01, y1 + 0.01);
  return near.find((f) => {
    const p = JSON.parse(f.polygon) as Polygon;
    return f.polygon_key === polygonKey(polygon) || pointInPolygon(c0, p) || pointInPolygon([f.lng, f.lat], polygon);
  });
}

farmRoutes.post("/", async (c) => {
  const b = await body(c, FarmCreateSchema);
  const user = c.get("user");
  const farmer = getFarmer(b.farmerId);
  const polygon = b.polygon as Polygon;
  const clash = overlapping(polygon);
  if (clash) {
    const owner = clash.farmer_id ? one<FarmerRow>("SELECT * FROM farmers WHERE id = ?", clash.farmer_id) : undefined;
    const who = owner?.id === farmer.id ? "this farmer" : "another farmer";
    throw conflict(`This boundary overlaps "${clash.name}", already registered to ${who}. One field can back only one loan.`);
  }
  const crop = b.crop as CropKey;
  const [lng, lat] = centroid(polygon);
  const fid = id("farm");
  const snap = snapshots.forPolygon(polygon);
  const name = b.name || `${farmer.first_name}'s ${getPolicy().crops[crop].label.toLowerCase()} field`;
  run(
    `INSERT INTO farms(id, farmer_id, name, polygon, polygon_key, area_ha, lng, lat, crop, planting_month, tenure, place, state, map_method, mapped_by, snapshot_key, created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    fid,
    farmer.id,
    name,
    JSON.stringify(polygon),
    polygonKey(polygon),
    round(areaHa(polygon), 3),
    round(lng, 6),
    round(lat, 6),
    crop,
    b.plantingMonth ?? null,
    b.tenure ?? null,
    b.place ?? snap?.place ?? null,
    b.state ?? snap?.state ?? null,
    b.mapMethod ?? null,
    user.id,
    snap?.key ?? null,
    now(),
  );
  // Start reading the satellite history straight away so the score is ready when the farmer applies.
  // (Serverless instances can't work after responding: the application request does the reading instead.)
  const job = config.serverless ? null : startAnalysis({ polygon, farmId: fid });
  if (job) run("UPDATE farms SET analysis_id = ? WHERE id = ?", job.analysisId, fid);
  logEvent("farm", fid, "MAPPED", `${name} mapped (${round(areaHa(polygon), 2)} ha, ${b.mapMethod ?? "map"}).`, user.id);
  return c.json({ farm: farmDto(getFarm(fid)), jobId: job?.id ?? null, analysisId: job?.analysisId ?? null }, 201);
});

farmRoutes.get("/:id", (c) => c.json(farmDto(getFarm(c.req.param("id")))));

/** The field's satellite story, scored for its own farmer (as at the season's decision date by default). */
farmRoutes.get("/:id/analysis", (c) => {
  const farm = getFarm(c.req.param("id"));
  if (!farm.analysis_id) throw new ApiError(404, "This farm hasn't been analysed yet.");
  const farmer = farm.farmer_id ? one<FarmerRow>("SELECT * FROM farmers WHERE id = ?", farm.farmer_id) : undefined;
  const app = one<ApplicationRow>("SELECT * FROM applications WHERE farm_id = ? ORDER BY created_at DESC LIMIT 1", farm.id);
  const asOfQ = c.req.query("asOf");
  const dto = analysisDto(farm.analysis_id, {
    farmer: farmer ? farmerProfile(farmer) : undefined,
    asOf: asOfQ && /^\d{4}-\d{2}-\d{2}$/.test(asOfQ) ? asOfQ : app ? decisionDate(app.season_year) : undefined,
    crop: farm.crop,
    plantingMonth: farm.planting_month ?? undefined,
    seasonYear: app?.season_year,
  });
  if (!dto) throw notFound("Analysis");
  return c.json(dto);
});

farmRoutes.post("/:id/analyse", async (c) => {
  const farm = getFarm(c.req.param("id"));
  const fresh = c.req.query("fresh") === "1";
  const job = startAnalysis({ polygon: JSON.parse(farm.polygon), farmId: farm.id, fresh, paced: !config.serverless });
  run("UPDATE farms SET analysis_id = ? WHERE id = ?", job.analysisId, farm.id);
  if (config.serverless) await job.finished;
  return c.json({ jobId: job.id, analysisId: job.analysisId, status: job.status }, config.serverless ? 200 : 202);
});
