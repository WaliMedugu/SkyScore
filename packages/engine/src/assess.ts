import { padBBox } from "./geo.ts";
import { buildOffer } from "./offer.ts";
import type { Policy } from "./policy.ts";
import { computeScore } from "./score.ts";
import { analyzeSeasons, usableOptical } from "./seasons.ts";
import type { CropKey, FarmerProfile, Offer, SatelliteBundle, ScoreResult, SeasonResult } from "./types.ts";

export interface Assessment {
  asOf: string;
  seasons: SeasonResult[];
  score: ScoreResult;
  offer: Offer | null;
  /** Readings that passed the cloud check, for charts. */
  clearPhotos: number;
  photosFound: number;
}

export interface AssessInput {
  bundle: SatelliteBundle;
  farmer: FarmerProfile;
  policy: Policy;
  asOf: string;
  crop?: CropKey;
  plantingMonth?: number;
  seasonYear?: number;
}

/** Full pipeline: satellite bundle → seasons → SkyScore → loan offer. */
export function assess(inp: AssessInput): Assessment {
  const seasons = analyzeSeasons(inp.bundle, inp.policy, { asOf: inp.asOf });
  const score = computeScore({ seasons, landCover: inp.bundle.landCover, farmer: inp.farmer, policy: inp.policy });
  const offer =
    inp.crop && inp.seasonYear
      ? buildOffer({
          score,
          areaHa: inp.bundle.areaHa,
          crop: inp.crop,
          seasonYear: inp.seasonYear,
          plantingMonth: inp.plantingMonth,
          priorOnTimeLoans: inp.farmer.priorOnTimeLoans,
          policy: inp.policy,
        })
      : null;
  return {
    asOf: inp.asOf,
    seasons,
    score,
    offer,
    clearPhotos: usableOptical(inp.bundle.optical, inp.policy).length,
    photosFound: inp.bundle.scenesFound,
  };
}

export interface Frame {
  sceneId: string;
  date: string;
  bbox: [number, number, number, number];
}

/** Time-lapse frames: per year, the clearest dry-season photo and the greenest peak-season photo. */
export function pickFrames(b: SatelliteBundle, policy: Policy): Frame[] {
  const clear = usableOptical(b.optical, policy);
  const bb = padBBox(b.bbox, 3, 450);
  const frames: Frame[] = [];
  for (const y of [...new Set(clear.map((o) => o.date.slice(0, 4)))]) {
    for (const [a, z] of [
      [`${y}-01-15`, `${y}-04-30`],
      [`${y}-08-01`, `${y}-10-31`],
    ]) {
      const best = clear.filter((o) => o.date >= a && o.date <= z).sort((p, q) => p.cloud - q.cloud || q.ndvi - p.ndvi)[0];
      if (best) frames.push({ sceneId: best.sceneId, date: best.date, bbox: bb });
    }
  }
  return frames.sort((p, q) => p.date.localeCompare(q.date));
}

/**
 * In-season photos for one season year (Apr–Dec): up to `max` clear photos evenly spread.
 * The pick doesn't depend on the replay date, so the same frames can be saved for offline use.
 */
export function seasonFrames(b: SatelliteBundle, policy: Policy, year: number, max = 10): Frame[] {
  const bb = padBBox(b.bbox, 3, 450);
  const clear = usableOptical(b.optical, policy)
    .filter((o) => o.date >= `${year}-04-01` && o.date <= `${year}-12-31`)
    .sort((p, q) => p.date.localeCompare(q.date));
  if (clear.length <= max) return clear.map((o) => ({ sceneId: o.sceneId, date: o.date, bbox: bb }));
  const step = (clear.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => clear[Math.round(i * step)]).map((o) => ({ sceneId: o.sceneId, date: o.date, bbox: bb }));
}

/** A point on the combined greenness chart. */
export interface SeriesPoint {
  date: string;
  ndvi: number | null;
  rvi: number | null;
  cloudy: boolean;
}

/** Merge optical and radar readings into one dated series for charts. */
export function chartSeries(b: SatelliteBundle, policy: Policy): SeriesPoint[] {
  const clear = new Set(usableOptical(b.optical, policy).map((o) => o.sceneId));
  const pts: SeriesPoint[] = [
    ...b.optical.map((o) => ({ date: o.date, ndvi: o.ndvi, rvi: null, cloudy: !clear.has(o.sceneId) })),
    ...b.radar.map((r) => ({ date: r.date, ndvi: null, rvi: r.rvi, cloudy: false })),
  ];
  return pts.sort((a, c) => a.date.localeCompare(c.date));
}
