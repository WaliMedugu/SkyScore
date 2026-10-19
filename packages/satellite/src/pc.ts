// Microsoft Planetary Computer: STAC search + titiler statistics/images for Sentinel-2, Sentinel-1 and land cover.
import type { BBox, NeighbourPeak, OpticalObs, Polygon, RadarObs } from "@skyscore/engine";
import { round } from "@skyscore/engine";
import type { Http } from "./http.ts";

export const PC = "https://planetarycomputer.microsoft.com/api";

export interface SceneRef {
  id: string;
  date: string;
  datetime: string;
  cloud: number;
  bbox: BBox | null;
  /** Sentinel-2 processing baseline, e.g. "02.12" or "05.10". */
  pb?: string;
  /** Sentinel-1 viewing track, e.g. "ascending-22": one track gives a consistent radar time series. */
  orbit?: string;
}

interface StacItem {
  id: string;
  bbox?: number[];
  properties: {
    datetime?: string;
    start_datetime?: string;
    "eo:cloud_cover"?: number;
    "s2:processing_baseline"?: string;
    "sat:orbit_state"?: string;
    "sat:relative_orbit"?: number;
  };
}

/**
 * Since processing baseline 04.00 (25 Jan 2022) ESA adds 1000 to every Sentinel-2 L2A reflectance value
 * (BOA_ADD_OFFSET = -1000) and Planetary Computer does not remove it. NDVI must subtract it, or every
 * reading from 2022 on is biased low (≈0.45 instead of ≈0.62 for a healthy crop).
 */
export function s2HasOffset(date: string, pb?: string): boolean {
  return pb ? pb >= "04.00" : date >= "2022-01-25";
}

/** NDVI expression for titiler, correcting the 2022+ offset when needed. */
export function ndviExpr(offset: boolean): string {
  return offset ? "where(B08+B04>2000,(B08-B04)/(B08+B04-2000),0)" : "(B08-B04)/(B08+B04)";
}
interface StacPage {
  features: StacItem[];
  links?: { rel: string; method?: string; body?: Record<string, unknown> }[];
}

const feature = (geometry: Polygon) => ({ type: "Feature", properties: {}, geometry });

/** Search a collection over a polygon, following pagination. */
export async function stacSearch(
  http: Http,
  collection: string,
  geometry: Polygon,
  from: string,
  to: string,
  query?: Record<string, unknown>,
): Promise<SceneRef[]> {
  const out: SceneRef[] = [];
  let body: Record<string, unknown> | undefined = {
    collections: [collection],
    intersects: geometry,
    datetime: `${from}T00:00:00Z/${to}T23:59:59Z`,
    limit: 250,
    ...(query ? { query } : {}),
    sortby: [{ field: "datetime", direction: "desc" }],
  };
  for (let page = 0; body && page < 12; page++) {
    const res: StacPage = await http.json<StacPage>("POST", `${PC}/stac/v1/search`, body);
    for (const f of res.features ?? []) {
      const dt = f.properties.datetime ?? f.properties.start_datetime ?? "";
      out.push({
        id: f.id,
        datetime: dt,
        date: dt.slice(0, 10),
        cloud: f.properties["eo:cloud_cover"] ?? 0,
        bbox: f.bbox && f.bbox.length >= 4 ? [f.bbox[0], f.bbox[1], f.bbox[2], f.bbox[3]] : null,
        pb: f.properties["s2:processing_baseline"],
        orbit: f.properties["sat:orbit_state"] ? `${f.properties["sat:orbit_state"]}-${f.properties["sat:relative_orbit"] ?? "?"}` : undefined,
      });
    }
    const next = res.links?.find((l) => l.rel === "next" && l.body);
    body = next?.body ? { ...body, ...next.body } : undefined;
  }
  return out;
}

const contains = (outer: BBox | null, inner: BBox) =>
  !!outer && outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];

/**
 * Pick photos worth reading: one per date (the tile that fully covers the field),
 * then the clearest `perDryMonth` / `perWetMonth` per calendar month.
 */
export function selectScenes(scenes: SceneRef[], fieldBBox: BBox, perDryMonth = 1, perWetMonth = 2, denseFromYear = 9999): SceneRef[] {
  const byDate = new Map<string, SceneRef>();
  for (const s of scenes) {
    const cur = byDate.get(s.date);
    const better = !cur || (contains(s.bbox, fieldBBox) && !contains(cur.bbox, fieldBBox)) || (contains(s.bbox, fieldBBox) === contains(cur.bbox, fieldBBox) && s.cloud < cur.cloud);
    if (better) byDate.set(s.date, s);
  }
  const byMonth = new Map<string, SceneRef[]>();
  for (const s of byDate.values()) {
    const k = s.date.slice(0, 7);
    byMonth.set(k, [...(byMonth.get(k) ?? []), s]);
  }
  const picked: SceneRef[] = [];
  for (const [ym, list] of byMonth) {
    const m = Number(ym.slice(5, 7));
    // Monitoring seasons: every photo from April to November (clouds hide most of them).
    if (Number(ym.slice(0, 4)) >= denseFromYear && m >= 4 && m <= 11) {
      picked.push(...list);
      continue;
    }
    const n = m >= 5 && m <= 10 ? perWetMonth : perDryMonth;
    // Clearest first, but spread across the month when taking two.
    const sorted = [...list].sort((a, b) => a.cloud - b.cloud);
    const chosen: SceneRef[] = [];
    for (const s of sorted) {
      if (chosen.length >= n) break;
      if (chosen.some((c) => Math.abs(Date.parse(c.date) - Date.parse(s.date)) < 8 * 86_400_000)) continue;
      chosen.push(s);
    }
    for (const s of sorted) if (chosen.length < n && !chosen.includes(s)) chosen.push(s);
    picked.push(...chosen);
  }
  return picked.sort((a, b) => b.date.localeCompare(a.date));
}

interface BandStats {
  mean: number;
  median: number;
  std: number;
  count: number;
  valid_percent: number;
  histogram: [number[], number[]];
  percentile_2?: number;
  percentile_98?: number;
}
interface StatsFeature {
  properties: { statistics: Record<string, BandStats> };
}

const CLOUD_WATER = "((SCL==3)|(SCL==8)|(SCL==9)|(SCL==10))*1.0;(SCL==6)*1.0";

/** One Sentinel-2 photo → field NDVI, cloud and water fractions. */
export async function s2Reading(http: Http, scene: SceneRef, field: Polygon): Promise<OpticalObs | null> {
  const offset = s2HasOffset(scene.date, scene.pb);
  const expr = `${ndviExpr(offset)};${CLOUD_WATER}`;
  const url = `${PC}/data/v1/item/statistics?collection=sentinel-2-l2a&item=${encodeURIComponent(scene.id)}&expression=${encodeURIComponent(expr)}&asset_as_band=True`;
  const res = await http.json<StatsFeature>("POST", url, feature(field));
  const bands = Object.values(res.properties?.statistics ?? {});
  if (bands.length < 3) return null;
  const [ndvi, cloud, water] = bands;
  if (!Number.isFinite(ndvi.median) || ndvi.count === 0) return null;
  return {
    date: scene.date,
    sceneId: scene.id,
    ndvi: round(ndvi.median, 4),
    ndviMean: round(ndvi.mean, 4),
    ndviStd: round(ndvi.std, 4),
    cloud: round(cloud.mean, 4),
    water: round(water.mean, 4),
    validPct: round(ndvi.valid_percent, 1),
    sceneCloud: round(scene.cloud, 1),
  };
}

const toDb = (v: number) => 10 * Math.log10(Math.max(v, 1e-6));

/** One Sentinel-1 radar pass → field backscatter and radar vegetation index. */
export async function s1Reading(http: Http, scene: SceneRef, field: Polygon): Promise<RadarObs | null> {
  const url = `${PC}/data/v1/item/statistics?collection=sentinel-1-rtc&item=${encodeURIComponent(scene.id)}&assets=vv&assets=vh`;
  const res = await http.json<StatsFeature>("POST", url, feature(field));
  const st = res.properties?.statistics ?? {};
  const vv = st["vv_b1"]?.mean;
  const vh = st["vh_b1"]?.mean;
  if (!Number.isFinite(vv) || !Number.isFinite(vh) || vv <= 0 || vh <= 0) return null;
  return {
    date: scene.date,
    sceneId: scene.id,
    vv: round(vv, 5),
    vh: round(vh, 5),
    vvDb: round(toDb(vv), 2),
    vhDb: round(toDb(vh), 2),
    rvi: round((4 * vh) / (vv + vh), 4),
    ...(scene.orbit ? { orbit: scene.orbit } : {}),
  };
}

/** Rank the farm's NDVI against every pixel in a box around it on the same photo. */
export async function neighbourPeak(http: Http, scene: SceneRef, farmNdvi: number, hood: Polygon, season: number): Promise<NeighbourPeak | null> {
  const expr = ndviExpr(s2HasOffset(scene.date, scene.pb));
  const url = `${PC}/data/v1/item/statistics?collection=sentinel-2-l2a&item=${encodeURIComponent(scene.id)}&expression=${encodeURIComponent(expr)}&asset_as_band=True&histogram_bins=60&histogram_range=-0.2,1`;
  const res = await http.json<StatsFeature>("POST", url, feature(hood));
  const st = Object.values(res.properties?.statistics ?? {})[0];
  if (!st?.histogram) return null;
  const [counts, edges] = st.histogram;
  const total = counts.reduce((a, c) => a + c, 0);
  if (!total) return null;
  let below = 0;
  for (let i = 0; i < counts.length; i++) {
    const lo = edges[i];
    const hi = edges[i + 1] ?? lo;
    if (hi <= farmNdvi) below += counts[i];
    else if (lo < farmNdvi) below += counts[i] * ((farmNdvi - lo) / (hi - lo || 1));
  }
  return {
    season,
    date: scene.date,
    sceneId: scene.id,
    farmNdvi: round(farmNdvi, 4),
    hoodMedian: round(st.median, 4),
    percentile: round(below / total, 4),
  };
}

const WORLDCOVER: Record<number, string> = {
  10: "trees",
  20: "shrubland",
  30: "grassland",
  40: "cropland",
  50: "built-up",
  60: "bare",
  70: "snow",
  80: "water",
  90: "wetland",
  95: "mangroves",
  100: "moss",
};

async function categorical(http: Http, collection: string, item: string, asset: string, field: Polygon): Promise<Map<number, number>> {
  const url = `${PC}/data/v1/item/statistics?collection=${collection}&item=${encodeURIComponent(item)}&assets=${asset}&categorical=true`;
  const res = await http.json<StatsFeature>("POST", url, feature(field));
  const st = Object.values(res.properties?.statistics ?? {})[0];
  const shares = new Map<number, number>();
  if (!st?.histogram) return shares;
  const [counts, values] = st.histogram;
  const total = counts.reduce((a, c) => a + c, 0) || 1;
  values.forEach((v, i) => shares.set(Math.round(v), counts[i] / total));
  return shares;
}

export async function worldCover(http: Http, field: Polygon) {
  const items = await stacSearch(http, "esa-worldcover", field, "2021-01-01", "2021-12-31");
  if (!items.length) return { share: null as number | null, classes: {} as Record<string, number> };
  const shares = await categorical(http, "esa-worldcover", items[0].id, "map", field);
  const classes: Record<string, number> = {};
  for (const [k, v] of shares) classes[WORLDCOVER[k] ?? String(k)] = round(v, 3);
  return { share: round(shares.get(40) ?? 0, 3), classes };
}

/** Impact Observatory annual land cover: share classed as crops (class 5) per year. */
export async function ioCrops(http: Http, field: Polygon): Promise<Record<string, number>> {
  const items = await stacSearch(http, "io-lulc-annual-v02", field, "2017-01-01", "2024-12-31");
  const out: Record<string, number> = {};
  await Promise.all(
    items.map(async (it) => {
      const year = it.date.slice(0, 4);
      if (out[year] !== undefined) return;
      const shares = await categorical(http, "io-lulc-annual-v02", it.id, "data", field);
      out[year] = round(shares.get(5) ?? 0, 3);
    }),
  );
  return out;
}

/** Acquisition date encoded in a Sentinel-2 item id (…_MSIL2A_20241028T095121_…). */
export function sceneDate(sceneId: string): string {
  const m = sceneId.match(/_(\d{4})(\d{2})(\d{2})T\d{6}_/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

/** Image URL for a field crop of one photo (true colour or coloured NDVI). */
export function imageUrl(sceneId: string, bbox: BBox, kind: "rgb" | "ndvi", size = 256): string {
  const [a, b, c, d] = bbox.map((v) => round(v, 6));
  const base = `${PC}/data/v1/item/bbox/${a},${b},${c},${d}/${size}x${size}.png?collection=sentinel-2-l2a&item=${encodeURIComponent(sceneId)}`;
  return kind === "rgb"
    ? `${base}&assets=visual&asset_bidx=visual%7C1%2C2%2C3&nodata=0`
    : `${base}&expression=${encodeURIComponent(ndviExpr(s2HasOffset(sceneDate(sceneId))))}&asset_as_band=True&rescale=-0.1%2C0.9&colormap_name=rdylgn`;
}
