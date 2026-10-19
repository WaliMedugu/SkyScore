import type { Policy, Steps } from "./policy.ts";
import type { OpticalObs, RadarObs, SatelliteBundle, SeasonLabel, SeasonResult } from "./types.ts";
import { between, clamp, daysInMonth, mean, median, quantile, round } from "./util.ts";

/** At-least steps: points for the first threshold the value reaches. */
function atLeast(v: number | null, steps: Steps): number {
  if (v === null) return 0;
  for (const [t, p] of steps) if (v >= t) return p;
  return 0;
}
/** At-most steps: points for the first threshold the value stays under. */
function atMost(v: number | null, steps: Steps): number {
  if (v === null) return 0;
  for (const [t, p] of steps) if (v <= t) return p;
  return 0;
}

/** Keep only readings clean enough to trust. */
export function usableOptical(obs: OpticalObs[], policy: Policy): OpticalObs[] {
  return obs
    .filter((o) => o.cloud <= policy.quality.maxCloud && o.validPct >= policy.quality.minValidPct && Number.isFinite(o.ndvi))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The history model judges every year on the same photo budget — the clearest two per rainy-season month,
 * one per dry month, at least 8 days apart — because peak and quantile statistics drift upward when a year
 * simply has more photos. (Monitoring uses every photo; this is only for comparing seasons fairly.)
 */
export function historySample(clear: OpticalObs[]): OpticalObs[] {
  const byMonth = new Map<string, OpticalObs[]>();
  for (const o of clear) byMonth.set(o.date.slice(0, 7), [...(byMonth.get(o.date.slice(0, 7)) ?? []), o]);
  const out: OpticalObs[] = [];
  for (const [ym, list] of byMonth) {
    const m = Number(ym.slice(5, 7));
    const n = m >= 5 && m <= 10 ? 2 : 1;
    if (list.length <= n) {
      out.push(...list);
      continue;
    }
    const ranked = [...list].sort((a, b) => a.cloud - b.cloud || b.validPct - a.validPct || a.date.localeCompare(b.date));
    const chosen: OpticalObs[] = [];
    for (const o of ranked) {
      if (chosen.length >= n) break;
      if (chosen.some((c) => Math.abs(Date.parse(c.date) - Date.parse(o.date)) < 8 * 86_400_000)) continue;
      chosen.push(o);
    }
    for (const o of ranked) if (chosen.length < n && !chosen.includes(o)) chosen.push(o);
    out.push(...chosen);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

const win = (year: number, [from, to]: [string, string]): [string, string] => {
  const toYear = to < from ? year + 1 : year; // windows such as Nov–Jan cross the year boundary
  return [`${year}-${from}`, `${toYear}-${to}`];
};

/** Season-total rainfall (May–Oct) per year, in mm. */
export function seasonRainfall(b: SatelliteBundle): Map<number, number> {
  const byYear = new Map<number, { mm: number; months: number }>();
  for (const r of b.rainfall) {
    const [y, m] = r.ym.split("-").map(Number);
    if (m < 5 || m > 10) continue;
    const e = byYear.get(y) ?? { mm: 0, months: 0 };
    e.mm += r.mm;
    e.months += 1;
    byYear.set(y, e);
  }
  const out = new Map<number, number>();
  for (const [y, e] of byYear) if (e.months === 6) out.set(y, round(e.mm, 1));
  return out;
}

export interface SeasonOptions {
  /** Ignore data after this date and mark seasons not yet finished as incomplete. */
  asOf: string;
  fromYear?: number;
  toYear?: number;
}

/** Turn a farm's satellite history into one verdict per rainy season. */
export function analyzeSeasons(b: SatelliteBundle, policy: Policy, opts: SeasonOptions): SeasonResult[] {
  const optical = historySample(usableOptical(b.optical, policy).filter((o) => o.date <= opts.asOf));
  const radar = [...b.radar].filter((r) => r.date <= opts.asOf).sort((a, c) => a.date.localeCompare(c.date));
  const years = optical.map((o) => Number(o.date.slice(0, 4)));
  if (!years.length && !radar.length) return [];
  const asOfYear = Number(opts.asOf.slice(0, 4));
  const fromYear = opts.fromYear ?? Math.min(...years, asOfYear);
  const toYear = opts.toYear ?? asOfYear;

  const rain = seasonRainfall(b);
  const rainMean = mean([...rain.values()]);

  const out: SeasonResult[] = [];
  for (let y = fromYear; y <= toYear; y++) out.push(analyzeOneSeason(y, optical, radar, b, policy, opts.asOf, rain, rainMean));
  return out;
}

function analyzeOneSeason(
  year: number,
  optical: OpticalObs[],
  radar: RadarObs[],
  b: SatelliteBundle,
  policy: Policy,
  asOf: string,
  rain: Map<number, number>,
  rainMean: number | null,
): SeasonResult {
  const W = policy.seasonWindows;
  const E = policy.evidence;
  const [dryA, dryB] = win(year, W.dry);
  const [preA, preB] = win(year, W.pre);
  const [peakA, peakB] = win(year, W.peak);
  const [postA, postB] = win(year, W.post);
  const complete = asOf >= postB;

  const inWin = (a: string, z: string) => optical.filter((o) => between(o.date, a, z));
  const dry = inWin(dryA, dryB);
  const pre = inWin(preA, preB);
  const peakObs = inWin(peakA, peakB);
  const post = inWin(postA, postB);
  const yearObs = inWin(`${year}-01-01`, `${year}-12-31`);

  const vals = (o: OpticalObs[]) => o.map((x) => x.ndvi);
  const dryLevel = median(vals(dry));
  const preMin = quantile(vals(pre), 0.25) ?? quantile(vals(dry), 0.25);
  let peak: number | null = null;
  let peakDate: string | null = null;
  let homogeneity: number | null = null;
  for (const o of peakObs) {
    if (peak === null || o.ndvi > peak) {
      peak = o.ndvi;
      peakDate = o.date;
      homogeneity = o.ndviStd;
    }
  }
  const postMin = quantile(vals(post), 0.25);
  const yearMax = yearObs.length ? Math.max(...vals(yearObs)) : null;
  const amplitude = peak !== null && preMin !== null ? peak - preMin : null;
  const senescence = peak !== null && postMin !== null ? peak - postMin : null;

  let greenupDate: string | null = null;
  if (preMin !== null && amplitude !== null && amplitude > 0) {
    const target = preMin + amplitude / 2;
    greenupDate = optical.find((o) => between(o.date, `${year}-05-01`, `${year}-09-30`) && o.ndvi >= target)?.date ?? null;
  }

  // Radar per calendar month (median of the passes), so dense recent years compare fairly with sparse old ones.
  const months = monthlyRadar(radar);
  const early = months.filter((r) => between(r.date, `${year}-03-01`, `${year}-06-30`)).map((r) => r.rvi);
  const late = months.filter((r) => between(r.date, peakA, peakB)).map((r) => r.rvi);
  const radarRise = early.length && late.length ? Math.max(...late) - Math.min(...early) : null;

  const flood =
    peakObs.some((o) => o.water >= policy.monitor.floodWater) ||
    months.some((r) => between(r.date, peakA, peakB) && r.vvDb <= policy.monitor.floodVvDb);

  const rainfallMm = rain.get(year) ?? null;
  const rainfallAnomaly = rainfallMm !== null && rainMean ? round((rainfallMm - rainMean) / rainMean, 3) : null;
  const neighbour = b.neighbours.find((n) => n.season === year) ?? null;

  const observations = pre.length + peakObs.length + post.length;
  const reasons: string[] = [];
  let label: SeasonLabel;
  let evidence = 0;

  const enoughOptical = observations >= 3 && (pre.length > 0 || dry.length > 0) && (peakObs.length > 0 || post.length > 0);
  const radarOnlyPeak = peakObs.length === 0 && radarRise !== null;
  if (!enoughOptical && !radarOnlyPeak) {
    label = "NO_DATA";
    reasons.push(observations ? `Only ${observations} clear photo(s) this season — too few to judge.` : "No clear photos this season (cloud).");
  } else {
    let pts = 0;
    const a = atLeast(amplitude, E.amplitude);
    const p0 = atMost(preMin, E.preMin);
    const pk = peakObs.length ? atLeast(peak, E.peak) : atLeast(radarRise, E.radarRise);
    const s = atLeast(senescence, E.senescence);
    const h = atMost(homogeneity, E.homogeneity);
    pts += a + p0 + pk + s + h;
    if (a > 0 && amplitude !== null) reasons.push(`Greened up by ${amplitude.toFixed(2)} NDVI from the dry season to the peak.`);
    if (p0 > 0 && preMin !== null) reasons.push(`Bare ground before planting (NDVI ${preMin.toFixed(2)}).`);
    if (pk > 0 && peak !== null) reasons.push(`Crop peaked at NDVI ${peak.toFixed(2)}${peakDate ? ` on ${peakDate}` : ""}.`);
    if (pk > 0 && peak === null && radarRise !== null) reasons.push(`Radar shows growth through the cloudy months (RVI +${radarRise.toFixed(2)}).`);
    if (s > 0 && senescence !== null) reasons.push(`Sharp drop after the peak, consistent with a harvest.`);
    if (h > 0 && homogeneity !== null) reasons.push(`Even growth across the field, as a planted crop is.`);
    if (greenupDate) {
      const md = greenupDate.slice(5);
      if (md >= E.lateGreenup.after) pts += E.lateGreenup.points;
      if (md < E.earlyGreenup.before) {
        pts += E.earlyGreenup.points;
        reasons.push("Greened very early in the rains, which wild vegetation often does.");
      }
    }
    if (dryLevel !== null && dryLevel >= E.woodlandDryLevel) {
      pts -= E.woodlandPenalty;
      reasons.push(`Stays green in the dry season (NDVI ${dryLevel.toFixed(2)}): looks like trees or bush, not a field.`);
    }
    if (preMin !== null && preMin > E.notBare.preMinAbove) {
      pts -= E.notBare.penalty;
      reasons.push(`Never bare before planting (NDVI ${preMin.toFixed(2)}): the land wasn't prepared.`);
    }
    if (postMin !== null && postMin > E.noHarvest.postMinAbove) {
      pts -= E.noHarvest.penalty;
      reasons.push(`No harvest drop after the peak (NDVI stays ${postMin.toFixed(2)}).`);
    }
    if (yearMax !== null && yearMax < E.bareYearMax) {
      pts -= E.barePenalty;
      reasons.push(`Never turns green (max NDVI ${yearMax.toFixed(2)}): looks like buildings, rock or bare ground.`);
    }
    evidence = round(clamp(pts / E.maxPositive, 0, 1), 3);
    label = evidence >= E.cultivatedAt ? "CULTIVATED" : evidence < E.notCultivatedBelow ? "NOT_CULTIVATED" : "UNCERTAIN";
  }
  if (flood) reasons.push("Standing water detected in the growing season (flood).");

  const r2 = (v: number | null) => (v === null ? null : round(v, 3));
  return {
    year,
    complete,
    label,
    evidence,
    preMin: r2(preMin),
    peak: r2(peak),
    peakDate,
    postMin: r2(postMin),
    amplitude: r2(amplitude),
    senescence: r2(senescence),
    homogeneity: r2(homogeneity),
    dryLevel: r2(dryLevel),
    yearMax: r2(yearMax),
    greenupDate,
    radarRise: r2(radarRise),
    flood,
    rainfallMm,
    rainfallAnomaly,
    neighbourPercentile: neighbour ? round(neighbour.percentile, 3) : null,
    observations,
    reasons,
  };
}

/** Monthly rainfall helper used by the UI (mm/day * days -> mm). */
export function monthlyMm(year: number, month: number, mmPerDay: number): number {
  return round(mmPerDay * daysInMonth(year, month), 1);
}

/** One radar value per calendar month: the median RVI and VV of that month's passes (dated mid-month). */
export function monthlyRadar(radar: RadarObs[]): { date: string; rvi: number; vvDb: number }[] {
  const byMonth = new Map<string, RadarObs[]>();
  for (const r of radar) byMonth.set(r.date.slice(0, 7), [...(byMonth.get(r.date.slice(0, 7)) ?? []), r]);
  return [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ym, list]) => ({ date: `${ym}-15`, rvi: median(list.map((r) => r.rvi))!, vvDb: median(list.map((r) => r.vvDb))! }));
}
