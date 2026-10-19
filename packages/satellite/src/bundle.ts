// Build a SatelliteBundle for one field: every source, newest season first, with live progress.
import type { NeighbourPeak, OpticalObs, Polygon, RadarObs, SatelliteBundle } from "@skyscore/engine";
import { DEFAULT_POLICY, areaHa, bbox, boxAround, bboxPolygon, centroid, round, usableOptical } from "@skyscore/engine";
import type { Http } from "./http.ts";
import { ioCrops, neighbourPeak, s1Reading, s2Reading, selectScenes, stacSearch, worldCover, type SceneRef } from "./pc.ts";
import { rainfall } from "./power.ts";

export type Stage = "search" | "optical" | "radar" | "neighbours" | "landcover" | "rainfall" | "done";

export interface Progress {
  stage: Stage;
  done: number;
  total: number;
  message: string;
  optical?: OpticalObs;
  radar?: RadarObs;
}

export interface BundleOptions {
  /** First season year to read (Sentinel-2 L2A is reliable over Nigeria from 2018). */
  fromYear?: number;
  /** Analysis date (YYYY-MM-DD); later data is ignored. */
  asOf: string;
  onProgress?: (p: Progress) => void;
  /** Half-size of the neighbourhood box in metres. */
  hoodHalfM?: number;
  /**
   * Seasons from this year on are read in full — every photo and radar pass from spring to harvest — so a
   * crop can be followed week by week. Older seasons are sampled. Default: the year before `asOf`.
   */
  denseFromYear?: number;
  signal?: AbortSignal;
}

const SOURCES = [
  "Copernicus Sentinel-2 L2A (ESA), via Microsoft Planetary Computer",
  "Copernicus Sentinel-1 RTC (ESA), via Microsoft Planetary Computer",
  "ESA WorldCover 2021",
  "Impact Observatory / Esri annual land use land cover 2017-2023",
  "NASA POWER (precipitation)",
];

export async function buildBundle(http: Http, polygon: Polygon, o: BundleOptions): Promise<SatelliteBundle> {
  const fromYear = o.fromYear ?? 2018;
  const emit = (p: Progress) => o.onProgress?.(p);
  const check = () => {
    if (o.signal?.aborted) throw new Error("Analysis cancelled");
  };
  const field = polygon;
  const bb = bbox(field);
  const c = centroid(field);

  const dense = Math.max(fromYear, o.denseFromYear ?? Number(o.asOf.slice(0, 4)) - 1);
  emit({ stage: "search", done: 0, total: 1, message: "Searching the satellite archive…" });
  const sampled = await stacSearch(http, "sentinel-2-l2a", field, `${fromYear}-01-01`, o.asOf, { "eo:cloud_cover": { lt: 80 } });
  // In monitoring seasons keep even very cloudy photos: a green reading through cloud still proves a crop.
  const cloudy = await stacSearch(http, "sentinel-2-l2a", field, `${dense}-04-01`, o.asOf, { "eo:cloud_cover": { lt: 99 } });
  const s2All = [...new Map([...sampled, ...cloudy].map((x) => [x.id, x])).values()];
  const s2 = selectScenes(s2All, bb, 1, 2, dense);
  emit({ stage: "search", done: 1, total: 1, message: `${s2All.length} photos of this field since ${fromYear}; reading the ${s2.length} clearest.` });
  check();

  // Optical readings, newest first, streamed as they arrive.
  const optical: OpticalObs[] = [];
  let done = 0;
  await Promise.all(
    s2.map(async (scene) => {
      try {
        const obs = await s2Reading(http, scene, field);
        if (obs) optical.push(obs);
        done++;
        emit({ stage: "optical", done, total: s2.length, message: `Read ${scene.date}`, optical: obs ?? undefined });
      } catch {
        done++;
        emit({ stage: "optical", done, total: s2.length, message: `Skipped ${scene.date} (service error)` });
      }
    }),
  );
  check();

  // Radar sees through cloud. Each year uses one viewing track (the one with most passes) so readings compare;
  // monitoring seasons take every pass February–November, older seasons one pass a month March–October.
  const radar: RadarObs[] = [];
  try {
    const s1All = await stacSearch(http, "sentinel-1-rtc", field, `${fromYear}-02-01`, o.asOf);
    const picks: SceneRef[] = [];
    for (const year of [...new Set(s1All.map((s) => s.date.slice(0, 4)))]) {
      const inYear = s1All.filter((s) => s.date.startsWith(year));
      const tally = new Map<string, number>();
      for (const s of inYear) tally.set(s.orbit ?? "", (tally.get(s.orbit ?? "") ?? 0) + 1);
      const track = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const mine = inYear.filter((s) => (s.orbit ?? "") === track).sort((a, b) => a.date.localeCompare(b.date));
      if (Number(year) >= dense) {
        picks.push(...mine.filter((s) => Number(s.date.slice(5, 7)) >= 2 && Number(s.date.slice(5, 7)) <= 11));
      } else {
        const byMonth = new Map<string, SceneRef>();
        for (const s of mine) {
          const m = Number(s.date.slice(5, 7));
          if (m >= 3 && m <= 10 && !byMonth.has(s.date.slice(0, 7))) byMonth.set(s.date.slice(0, 7), s);
        }
        picks.push(...byMonth.values());
      }
    }
    let rdone = 0;
    await Promise.all(
      picks.map(async (scene) => {
        try {
          const r = await s1Reading(http, scene, field);
          if (r) radar.push(r);
        } catch {
          /* keep going */
        }
        rdone++;
        emit({ stage: "radar", done: rdone, total: picks.length, message: `Radar ${scene.date}` });
      }),
    );
  } catch {
    emit({ stage: "radar", done: 0, total: 0, message: "Radar unavailable; continuing with optical only." });
  }
  check();

  // Neighbourhood comparison at each season's clearest peak photo.
  const neighbours: NeighbourPeak[] = [];
  const clean = usableOptical(optical, DEFAULT_POLICY);
  const seasons = [...new Set(clean.map((x) => Number(x.date.slice(0, 4))))];
  const hood = bboxPolygon(boxAround(c, o.hoodHalfM ?? 600));
  let ndone = 0;
  await Promise.all(
    seasons.map(async (y) => {
      const peakObs = clean.filter((x) => x.date >= `${y}-07-01` && x.date <= `${y}-10-31`).sort((a, b) => b.ndvi - a.ndvi)[0];
      if (peakObs) {
        try {
          const ref = s2.find((s) => s.id === peakObs.sceneId);
          const n = await neighbourPeak(http, { id: peakObs.sceneId, date: peakObs.date, datetime: peakObs.date, cloud: 0, bbox: null, pb: ref?.pb }, peakObs.ndvi, hood, y);
          if (n) neighbours.push(n);
        } catch {
          /* optional */
        }
      }
      ndone++;
      emit({ stage: "neighbours", done: ndone, total: seasons.length, message: `Compared ${y} with neighbouring fields` });
    }),
  );

  emit({ stage: "landcover", done: 0, total: 2, message: "Checking land-cover maps…" });
  const [wc, io] = await Promise.all([
    worldCover(http, field).catch(() => ({ share: null as number | null, classes: {} as Record<string, number> })),
    ioCrops(http, field).catch(() => ({}) as Record<string, number>),
  ]);
  emit({ stage: "landcover", done: 2, total: 2, message: "Land-cover maps read" });

  emit({ stage: "rainfall", done: 0, total: 1, message: "Reading rainfall records…" });
  const rain = await rainfall(http, c, fromYear, o.asOf).catch(() => []);
  emit({ stage: "rainfall", done: 1, total: 1, message: `${rain.length} months of rainfall` });

  const bundle: SatelliteBundle = {
    polygon: field,
    areaHa: round(areaHa(field), 3),
    centroid: c,
    bbox: bb,
    optical: optical.sort((a, b) => a.date.localeCompare(b.date)),
    radar: radar.sort((a, b) => a.date.localeCompare(b.date)),
    neighbours: neighbours.sort((a, b) => a.season - b.season),
    landCover: { worldCoverCropShare: wc.share, worldCoverClasses: wc.classes, ioCropShareByYear: io },
    rainfall: rain,
    scenesFound: s2All.length,
    fetchedAt: new Date().toISOString(),
    sources: SOURCES,
  };
  emit({ stage: "done", done: 1, total: 1, message: `Read ${optical.length} photos and ${radar.length} radar passes.` });
  return bundle;
}
