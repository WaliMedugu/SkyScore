// Satellite analysis jobs: fetch (or load a saved snapshot), stream progress, persist, and serve results.
import {
  assess,
  bbox as bboxOf,
  centroid,
  areaHa,
  pickFrames,
  polygonKey,
  usableOptical,
  type Assessment,
  type CropKey,
  type FarmerProfile,
  type Offer,
  type OpticalObs,
  type Polygon,
  type SatelliteBundle,
} from "@skyscore/engine";
import { buildBundle, type Progress } from "@skyscore/satellite";
import { config } from "./config.ts";
import { json, now, one, run } from "./db.ts";
import { getPolicy } from "./policy.ts";
import { http, snapshots } from "./satellite.ts";
import { id, today } from "./util.ts";

export type JobEventType = "progress" | "observation" | "partial" | "done" | "error";
export interface JobEvent {
  seq: number;
  type: JobEventType;
  data: unknown;
}

export class Job {
  readonly id = id("job", 12);
  private settle: () => void = () => {};
  /** Resolves once the job is done or has failed (serverless requests wait on it instead of polling). */
  readonly finished = new Promise<void>((resolve) => (this.settle = resolve));
  status: "running" | "done" | "error" = "running";
  readonly events: JobEvent[] = [];
  readonly listeners = new Set<(e: JobEvent) => void>();
  progress: Progress | null = null;
  partial: unknown = null;
  error: string | null = null;
  readonly startedAt = Date.now();
  constructor(
    readonly analysisId: string,
    readonly key: string,
  ) {}
  emit(type: JobEventType, data: unknown) {
    const e = { seq: this.events.length + 1, type, data };
    // Keep observations compact; clients that join late replay everything.
    this.events.push(e);
    for (const l of this.listeners) l(e);
    if (type === "done" || type === "error") this.settle();
  }
  summary() {
    return {
      id: this.id,
      analysisId: this.analysisId,
      status: this.status,
      progress: this.progress,
      partial: this.partial,
      error: this.error,
      elapsedMs: Date.now() - this.startedAt,
    };
  }
}

const jobs = new Map<string, Job>();
const running = new Map<string, Job>();
export const getJob = (jobId: string) => jobs.get(jobId);

/** Neutral profile used when no farmer is attached: no free points. */
export const NO_FARMER: FarmerProfile = { bvnVerified: false, trained: false, cooperative: false, priorOnTimeLoans: 0 };
/** The public explorer scores a field as if a typical applicant brought it: BVN-verified, trained, in a cooperative, first loan. */
export const TYPICAL_FARMER: FarmerProfile = { bvnVerified: true, trained: true, cooperative: true, priorOnTimeLoans: 0 };

export interface StartOptions {
  polygon: Polygon;
  farmId?: string;
  fromYear?: number;
  /** Re-fetch even if a recent analysis exists. */
  fresh?: boolean;
  /** Pace saved-data replays so people can watch the photos arrive (off when nobody is watching). */
  paced?: boolean;
  onDone?: (analysisId: string) => void;
}

/** Start (or reuse) an analysis for a polygon. Data is always fetched up to today. */
export function startAnalysis(o: StartOptions): Job {
  const fromYear = o.fromYear ?? config.historyFrom;
  const pkey = polygonKey(o.polygon);
  const key = `${pkey}|${fromYear}`;

  const live = running.get(key);
  if (live) {
    if (o.onDone) live.listeners.add((e) => e.type === "done" && o.onDone?.(live.analysisId));
    return live;
  }

  // Reuse a finished analysis of the same field from the last 7 days (or any snapshot-backed one).
  if (!o.fresh) {
    const prev = one<{ id: string; source: string }>(
      "SELECT id, source FROM analyses WHERE polygon_key = ? AND status = 'done' AND (source = 'snapshot' OR as_of >= date('now','-7 day')) ORDER BY created_at DESC LIMIT 1",
      pkey,
    );
    if (prev) {
      // Same field read recently: replay the stored photos so every viewer sees the same story, then finish.
      const j = new Job(prev.id, key);
      jobs.set(j.id, j);
      running.set(key, j);
      if (o.onDone) j.listeners.add((e) => e.type === "done" && o.onDone?.(prev.id));
      if (o.farmId) run("UPDATE analyses SET farm_id = COALESCE(farm_id, ?) WHERE id = ?", o.farmId, prev.id);
      void (async () => {
        const stored = bundleOf(prev.id);
        if (stored) await replaySnapshot(j, stored, o.paced ?? true);
        j.status = "done";
        j.emit("done", { analysisId: prev.id, reused: true });
        running.delete(key);
        setTimeout(() => jobs.delete(j.id), 30 * 60_000).unref();
      })();
      return j;
    }
  }

  const analysisId = id("ana", 12);
  const snap = snapshots.forPolygon(o.polygon);
  run(
    "INSERT INTO analyses(id, farm_id, polygon_key, status, as_of, from_year, source, snapshot_key, created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    analysisId,
    o.farmId ?? null,
    pkey,
    "running",
    today(),
    fromYear,
    snap ? "snapshot" : "live",
    snap?.key ?? null,
    now(),
  );
  const job = new Job(analysisId, key);
  jobs.set(job.id, job);
  running.set(key, job);
  if (o.onDone) job.listeners.add((e) => e.type === "done" && o.onDone?.(analysisId));

  void (async () => {
    try {
      let bundle: SatelliteBundle;
      if (snap) {
        bundle = await replaySnapshot(job, snap.bundle, o.paced ?? true);
      } else {
        const seen: OpticalObs[] = [];
        bundle = await buildBundle(http, o.polygon, {
          asOf: today(),
          fromYear,
          onProgress: (p) => {
            job.progress = p;
            if (p.optical) {
              seen.push(p.optical);
              job.emit("observation", { kind: "optical", obs: p.optical });
              if (seen.length % 15 === 0) emitPartial(job, o.polygon, seen);
            } else {
              job.emit("progress", p);
            }
          },
        });
      }
      // Saved fields are read from the snapshot store, so only live analyses store their bundle.
      run("UPDATE analyses SET status = 'done', bundle = ?, finished_at = ? WHERE id = ?", snap ? null : JSON.stringify(bundle), now(), analysisId);
      job.status = "done";
      job.emit("done", { analysisId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      run("UPDATE analyses SET status = 'error', error = ?, finished_at = ? WHERE id = ?", msg, now(), analysisId);
      job.status = "error";
      job.error = msg;
      job.emit("error", { message: msg });
    } finally {
      running.delete(key);
      // Forget old jobs after 30 minutes.
      setTimeout(() => jobs.delete(job.id), 30 * 60_000).unref();
    }
  })();
  return job;
}

/** Stream a saved snapshot through the same events a live fetch emits, paced so people can watch (~3.5 s). */
async function replaySnapshot(job: Job, b: SatelliteBundle, paced = true): Promise<SatelliteBundle> {
  const obs = [...b.optical].sort((x, y) => y.date.localeCompare(x.date));
  job.emit("progress", { stage: "search", done: 1, total: 1, message: `${b.scenesFound} photos of this field on record; reading the ${b.optical.length} that cover it (saved data).` });
  const seen: OpticalObs[] = [];
  const perTick = Math.max(3, Math.ceil(obs.length / 48));
  for (let i = 0; i < obs.length; i++) {
    seen.push(obs[i]);
    job.emit("observation", { kind: "optical", obs: obs[i] });
    if ((i + 1) % perTick === 0) {
      job.progress = { stage: "optical", done: i + 1, total: obs.length, message: `Read ${obs[i].date}` };
      if ((i + 1) % (perTick * 4) === 0) emitPartial(job, b.polygon, seen);
      if (paced) await new Promise((r) => setTimeout(r, 70));
    }
  }
  emitPartial(job, b.polygon, seen);
  job.emit("progress", { stage: "radar", done: b.radar.length, total: b.radar.length, message: `${b.radar.length} radar passes` });
  job.emit("progress", { stage: "landcover", done: 2, total: 2, message: "Land-cover maps read" });
  job.emit("progress", { stage: "done", done: 1, total: 1, message: `Loaded ${b.optical.length} photos and ${b.radar.length} radar passes.` });
  return b;
}

function emitPartial(job: Job, polygon: Polygon, seen: OpticalObs[]) {
  try {
    const partial: SatelliteBundle = {
      polygon,
      areaHa: areaHa(polygon),
      centroid: centroid(polygon),
      bbox: bboxOf(polygon),
      optical: seen,
      radar: [],
      neighbours: [],
      landCover: { worldCoverCropShare: null, worldCoverClasses: {}, ioCropShareByYear: {} },
      rainfall: [],
      scenesFound: seen.length,
      fetchedAt: new Date().toISOString(),
      sources: [],
    };
    const a = assess({ bundle: partial, farmer: NO_FARMER, policy: getPolicy(), asOf: today() });
    job.partial = {
      seasons: a.seasons.map((s) => ({ year: s.year, label: s.label, peak: s.peak, complete: s.complete })),
      photos: seen.length,
    };
    job.emit("partial", job.partial);
  } catch {
    /* partial results are best-effort */
  }
}

/* ── Reading results ───────────────────────────────────────────────────── */

interface AnalysisRow {
  id: string;
  farm_id: string | null;
  polygon_key: string;
  status: string;
  as_of: string;
  from_year: number;
  source: string;
  snapshot_key: string | null;
  bundle: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export function analysisRow(analysisId: string) {
  return one<AnalysisRow>("SELECT * FROM analyses WHERE id = ?", analysisId);
}

/** A finished analysis's satellite data: stored with the row for live reads, from the snapshot store for saved fields. */
export function bundleOf(analysisId: string): SatelliteBundle | null {
  const row = analysisRow(analysisId);
  if (!row) return null;
  if (row.bundle) return json<SatelliteBundle>(row.bundle);
  if (row.snapshot_key && row.status === "done") return snapshots.get(row.snapshot_key)?.bundle ?? null;
  return null;
}

/** The next season a crop can be planted in: this year if its planting month is still ahead. */
export function nextSeasonYear(asOf: string, plantMonth: number) {
  return Number(asOf.slice(0, 4)) + (Number(asOf.slice(5, 7)) >= plantMonth ? 1 : 0);
}

/** The input offer for every crop, so a client can switch crops without another request. */
export function offersByCrop(analysisId: string, farmer: FarmerProfile): Record<string, Offer | null> {
  const b = bundleOf(analysisId);
  if (!b) return {};
  const policy = getPolicy();
  const asOf = today();
  const out: Record<string, Offer | null> = {};
  for (const crop of Object.keys(policy.crops) as CropKey[]) {
    out[crop] = assess({ bundle: b, farmer, policy, asOf, crop, seasonYear: nextSeasonYear(asOf, policy.crops[crop].plantMonth) }).offer;
  }
  return out;
}

export interface AssessOpts {
  farmer?: FarmerProfile;
  asOf?: string;
  crop?: CropKey;
  plantingMonth?: number;
  seasonYear?: number;
}

/** Everything a client needs to draw a field's satellite story and score. */
export function analysisDto(analysisId: string, o: AssessOpts = {}) {
  const row = analysisRow(analysisId);
  if (!row) return null;
  const base = {
    id: row.id,
    status: row.status,
    source: row.source,
    snapshotKey: row.snapshot_key,
    fetchedAsOf: row.as_of,
    fromYear: row.from_year,
    error: row.error,
    createdAt: row.created_at,
  };
  const b = bundleOf(analysisId);
  if (!b) return { ...base, ready: false as const };
  const policy = getPolicy();
  const asOf = o.asOf ?? today();
  // Without a season, quote for the next planting of that crop (this year if its planting month is still ahead).
  const plantMonth = o.plantingMonth ?? (o.crop ? policy.crops[o.crop]?.plantMonth : undefined);
  const seasonYear = o.seasonYear ?? (plantMonth ? nextSeasonYear(asOf, plantMonth) : undefined);
  const a: Assessment = assess({
    bundle: b,
    farmer: o.farmer ?? NO_FARMER,
    policy,
    asOf,
    crop: o.crop,
    plantingMonth: o.plantingMonth,
    seasonYear,
  });
  const clear = new Set(usableOptical(b.optical, policy).map((x) => x.sceneId));
  return {
    ...base,
    ready: true as const,
    asOf,
    polygon: b.polygon,
    areaHa: b.areaHa,
    centroid: b.centroid,
    bbox: b.bbox,
    photosFound: b.scenesFound,
    clearPhotos: a.clearPhotos,
    radarPasses: b.radar.length,
    seasons: a.seasons,
    score: a.score,
    offer: a.offer,
    landCover: b.landCover,
    neighbours: b.neighbours,
    series: {
      optical: b.optical.map((x) => ({ date: x.date, ndvi: x.ndvi, cloud: x.cloud, water: x.water, clear: clear.has(x.sceneId), sceneId: x.sceneId })),
      radar: b.radar.map((r) => ({ date: r.date, rvi: r.rvi, vvDb: r.vvDb, vhDb: r.vhDb })),
    },
    rainfall: b.rainfall,
    frames: (row.snapshot_key ? snapshots.get(row.snapshot_key)?.frames : null) ?? pickFrames(b, policy),
    sources: b.sources,
    bundleFetchedAt: b.fetchedAt,
  };
}
