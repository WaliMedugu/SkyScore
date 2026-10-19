// Build the real-satellite snapshots the demo ships with (works offline afterwards).
// Usage: npm run snapshots [-- --only=showcase,control,portfolio]
// Uncached: ~25 min. Every HTTP response is cached in data/cache/http, so re-runs are quick and resumable.
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { buildBundle, imageUrl } from "@skyscore/satellite";
import {
  DEFAULT_POLICY,
  assess,
  boxAround,
  pickFrames,
  polygonFrom,
  seasonFrames,
  round,
  type CropKey,
  type Frame,
  type LngLat,
  type Polygon,
  type SatelliteBundle,
} from "@skyscore/engine";
import { AS_OF, ROOT, SNAP_DIR, http, square, summarise } from "./lib.ts";

type Kind = "showcase" | "control" | "portfolio";
interface Snapshot {
  key: string;
  kind: Kind;
  cluster: string;
  place: string;
  state: string;
  crop: CropKey;
  polygon: Polygon;
  bundle: SatelliteBundle;
  frames: Frame[];
}

const only = (process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",") ?? ["showcase", "control", "portfolio"]) as Kind[];
/** --key=farm-kachia-03 rebuilds just the snapshots whose key contains this text. */
const keyFilter = process.argv.find((a) => a.startsWith("--key="))?.slice(6) ?? "";
const wanted = (key: string) => key.includes(keyFilter);
const cand = JSON.parse(readFileSync(join(ROOT, "data", "candidates.json"), "utf8"));
mkdirSync(SNAP_DIR, { recursive: true });
const IMG_DIR = join(SNAP_DIR, "images");

// Deterministic randomness so field shapes are reproducible.
let seed = 20261020;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

/** A field-like quadrilateral: rotated rectangle with small corner jitter (as an agent would walk it). */
function fieldShape(c: LngLat, wM: number, hM: number): Polygon {
  const ang = (rand() * 30 - 15) * (Math.PI / 180);
  const b = boxAround(c, 1);
  const mx = 2 / (b[2] - b[0]);
  const my = 2 / (b[3] - b[1]);
  const corners: LngLat[] = [
    [-wM / 2, -hM / 2],
    [wM / 2, -hM / 2],
    [wM / 2, hM / 2],
    [-wM / 2, hM / 2],
  ].map(([x, y]) => {
    const jx = x + (rand() - 0.5) * 12;
    const jy = y + (rand() - 0.5) * 12;
    const rx = jx * Math.cos(ang) - jy * Math.sin(ang);
    const ry = jx * Math.sin(ang) + jy * Math.cos(ang);
    return [round(c[0] + rx / mx, 7), round(c[1] + ry / my, 7)];
  });
  return polygonFrom(corners);
}

const CROPS: Record<string, CropKey[]> = {
  zaria: ["maize", "sorghum", "soybean", "maize", "groundnut"],
  kachia: ["maize", "soybean", "maize", "sorghum"],
  bida: ["rice", "rice", "maize"],
  kuje: ["maize", "soybean", "sorghum", "maize"],
};

const existing = (key: string): Snapshot | null => {
  const p = join(SNAP_DIR, `${key}.json`);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Snapshot) : null;
};

async function analyse(key: string, poly: Polygon, fromYear: number): Promise<SatelliteBundle> {
  const t0 = Date.now();
  // 2024–2026 are read in full so the loan seasons can be replayed week by week.
  const b = await buildBundle(http, poly, { asOf: AS_OF, fromYear, denseFromYear: 2024 });
  process.stdout.write(`  ${key}: ${b.optical.length} photos, ${b.radar.length} radar, ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
  return b;
}

async function saveFrames(key: string, frames: Frame[]) {
  const dir = join(IMG_DIR, key);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let n = 0;
  await Promise.all(
    frames.flatMap((f) =>
      (["rgb", "ndvi"] as const).map(async (kind) => {
        try {
          const img = await http.bytes(imageUrl(f.sceneId, f.bbox, kind, 256));
          writeFileSync(join(dir, `${f.sceneId}_${kind}.png`), img.data);
          n++;
        } catch {
          /* frame skipped */
        }
      }),
    ),
  );
  return n;
}

/** Time-lapse frames plus in-season photos for the loan seasons, so loan pages work offline too. */
const SEASONS = [2024, 2025, 2026];
function withSeasons(b: SatelliteBundle, frames: Frame[]): Frame[] {
  const all = [...frames, ...SEASONS.flatMap((y) => seasonFrames(b, DEFAULT_POLICY, y))];
  return [...new Map(all.map((f) => [f.sceneId, f])).values()];
}

const save = (s: Snapshot) => writeFileSync(join(SNAP_DIR, `${s.key}.json`), JSON.stringify(s));

// 1. Showcase: one proven field per cluster with full history and time-lapse images.
if (only.includes("showcase")) {
  console.log("■ Showcase");
  for (const c of cand.clusters as { key: string; name: string; state: string }[]) {
    const key = `showcase-${c.key}`;
    if (!wanted(key)) continue;
    let poly = existing(key)?.polygon;
    if (!poly) {
      // Screen the purest cropland squares on recent seasons; keep the clearest crop cycle.
      const pool = (cand.results[c.key] as { centre: LngLat; crop: number }[]).filter((x) => x.crop >= 0.8).slice(0, 4);
      let best: { centre: LngLat; ev: number } | null = null;
      for (const p of pool) {
        const b = await analyse(`${c.key} screen`, square(p.centre, 110), 2022);
        const a = assess({ bundle: b, farmer: { bvnVerified: true, trained: true, cooperative: true, priorOnTimeLoans: 0 }, policy: DEFAULT_POLICY, asOf: AS_OF });
        const ev = a.seasons.filter((s) => s.complete).reduce((s, x) => s + x.evidence + (x.peak ?? 0) * 0.5, 0);
        if (!best || ev > best.ev) best = { centre: p.centre, ev };
      }
      if (!best) continue;
      poly = fieldShape(best.centre, 120 + rand() * 30, 95 + rand() * 25);
    }
    const b = await analyse(key, poly, 2018);
    const frames = pickFrames(b, DEFAULT_POLICY);
    const imgs = await saveFrames(key, withSeasons(b, frames));
    save({ key, kind: "showcase", cluster: c.key, place: c.name, state: c.state, crop: CROPS[c.key][0], polygon: poly, bundle: b, frames });
    summarise(`${key} (${imgs} images)`, b);
  }
}

// 2. Non-farm controls for the ghost-farm demo.
if (only.includes("control")) {
  console.log("\n■ Controls");
  for (const k of cand.controls as { key: string; name: string; best: { centre: LngLat } }[]) {
    const key = `control-${k.key}`;
    if (!wanted(key)) continue;
    const poly = existing(key)?.polygon ?? fieldShape(k.best.centre, 115, 100);
    const b = await analyse(key, poly, 2018);
    const frames = pickFrames(b, DEFAULT_POLICY);
    await saveFrames(key, withSeasons(b, frames));
    save({ key, kind: "control", cluster: k.key, place: k.name, state: k.name.split(", ").pop() ?? "", crop: "maize", polygon: poly, bundle: b, frames });
    summarise(key, b);
  }
}

// 3. Portfolio: a spread of real fields per cluster for the loan book.
if (only.includes("portfolio")) {
  console.log("\n■ Portfolio");
  const used = new Set(
    ["zaria", "kachia", "bida", "kuje"].map((c) => {
      const s = existing(`showcase-${c}`);
      return s ? JSON.stringify(s.polygon.coordinates[0][0]) : "";
    }),
  );
  const PER_CLUSTER: Record<string, number> = { zaria: 10, kachia: 8, bida: 5, kuje: 7 };
  for (const c of cand.clusters as { key: string; name: string; state: string }[]) {
    const pool = (cand.results[c.key] as { centre: LngLat; crop: number }[]).filter((x) => x.crop >= 0.45 && !used.has(x.centre.join()));
    // Skip the purest square (likely the showcase field) to avoid duplicates.
    const picks = pool.slice(1, 1 + (PER_CLUSTER[c.key] ?? 6));
    let i = 0;
    for (const p of picks) {
      i++;
      const key = `farm-${c.key}-${String(i).padStart(2, "0")}`;
      if (!wanted(key)) continue;
      const poly = existing(key)?.polygon ?? fieldShape(p.centre, 70 + rand() * 90, 60 + rand() * 80);
      const b = await analyse(key, poly, 2020);
      const crops = CROPS[c.key];
      const frames = pickFrames(b, DEFAULT_POLICY);
      const imgs = await saveFrames(key, withSeasons(b, frames));
      process.stdout.write(`    ${imgs} images saved
`);
      save({ key, kind: "portfolio", cluster: c.key, place: c.name, state: c.state, crop: crops[i % crops.length], polygon: poly, bundle: b, frames });
    }
  }
}

// Index of everything on disk.
import { readdirSync } from "node:fs";
const index = readdirSync(SNAP_DIR)
  .filter((f) => f.endsWith(".json") && f !== "index.json")
  .map((f) => JSON.parse(readFileSync(join(SNAP_DIR, f), "utf8")) as Snapshot)
  .map((s) => ({ key: s.key, kind: s.kind, cluster: s.cluster, place: s.place, state: s.state, crop: s.crop, areaHa: s.bundle.areaHa, photos: s.bundle.optical.length }));
writeFileSync(join(SNAP_DIR, "index.json"), JSON.stringify(index, null, 2));
console.log(`\nDone: ${index.length} snapshots on disk.`, http.stats);
