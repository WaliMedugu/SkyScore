import type { LandCover, OpticalObs, RadarObs, SatelliteBundle } from "../src/types.ts";
import { areaHa, bbox, centroid, polygonFrom } from "../src/geo.ts";
import { round } from "../src/util.ts";

/** ~1.2 ha square near Zaria, Kaduna State. */
export const FIELD = polygonFrom([
  [7.6194, 11.0494],
  [7.6206, 11.0494],
  [7.6206, 11.0503],
  [7.6194, 11.0503],
]);

/** NDVI profile for a month (1-12) of a given land type. */
type Profile = (month: number, day: number) => number;

/** Bare after harvest, prepared in May–June, green Jul–Sep, harvested Oct–Nov. */
export const cropProfile: Profile = (m, d) => {
  const t = m + d / 31;
  if (t < 5.6) return 0.17;
  if (t < 7) return 0.17 + (t - 5.6) * 0.18;
  if (t < 9.5) return 0.68;
  if (t < 11) return 0.68 - (t - 9.5) * 0.3;
  return 0.2;
};
/** Woodland: green all year, a bit greener in the rains. */
export const woodlandProfile: Profile = (m) => (m >= 6 && m <= 10 ? 0.74 : 0.52);
/** Town / rock: never green. */
export const builtProfile: Profile = () => 0.11;

export function bundleFrom(profile: Profile, opts: { years: number[]; cloudyMonths?: number[]; flood?: string; noise?: number; landCover?: Partial<LandCover>; std?: number } ): SatelliteBundle {
  const optical: OpticalObs[] = [];
  const radar: RadarObs[] = [];
  let seed = 7;
  const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280) - 0.5;
  for (const y of opts.years) {
    for (let m = 1; m <= 12; m++) {
      for (const d of [6, 21]) {
        const date = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const cloudy = (opts.cloudyMonths ?? []).includes(m);
        // Clouds hide the field: a cloudy photo reads low whatever is underneath.
        const v = cloudy ? 0.05 + 0.02 * rand() : profile(m, d) + (opts.noise ?? 0.02) * rand();
        optical.push({
          date,
          sceneId: `S2_${date}`,
          ndvi: v,
          ndviMean: v,
          ndviStd: opts.std ?? 0.06,
          cloud: cloudy ? 0.8 : 0.01,
          water: opts.flood === date ? 0.4 : 0,
          validPct: 100,
        });
        // Radar sees through cloud: VH backscatter and RVI rise with the crop (one track, twice a month).
        const grow = Math.max(0, profile(m, d) - 0.17);
        const rvi = 0.25 + Math.max(0, profile(m, d) - 0.2) * 0.6;
        radar.push({ date, sceneId: `S1_${date}`, vv: 0.08, vh: 0.02, vvDb: -11, vhDb: round(-18 + grow * 10, 2), rvi, orbit: "ascending-132" });
      }
    }
  }
  const rainfall = opts.years.flatMap((y) =>
    Array.from({ length: 12 }, (_, i) => ({ ym: `${y}-${String(i + 1).padStart(2, "0")}`, mm: i >= 4 && i <= 9 ? 180 : 5 })),
  );
  return {
    polygon: FIELD,
    areaHa: areaHa(FIELD),
    centroid: centroid(FIELD),
    bbox: bbox(FIELD),
    optical,
    radar,
    neighbours: opts.years.map((y) => ({ season: y, date: `${y}-08-21`, sceneId: `S2_${y}`, farmNdvi: 0.68, hoodMedian: 0.5, percentile: 0.78 })),
    landCover: { worldCoverCropShare: 0.92, worldCoverClasses: { cropland: 0.92 }, ioCropShareByYear: {}, ...opts.landCover },
    rainfall,
    scenesFound: optical.length,
    fetchedAt: "2026-10-18T00:00:00Z",
    sources: ["test"],
  };
}

export const YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025];
export const GOOD_FARMER = { bvnVerified: true, trained: true, cooperative: true, priorOnTimeLoans: 0 };
