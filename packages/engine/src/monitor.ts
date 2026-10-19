import type { Policy } from "./policy.ts";
import { usableOptical } from "./seasons.ts";
import type { CropKey, CropStage, Health, MonitorAlert, MonitorResult, OpticalObs, RadarObs } from "./types.ts";
import { addDays, daysBetween, median, quantile, round } from "./util.ts";

export interface MonitorInput {
  crop: CropKey;
  /** Planting date agreed in the loan (contractual windows count from here). */
  plantingDate: string;
  asOf: string;
  optical: OpticalObs[];
  radar: RadarObs[];
  /** NDVI of the bare field before planting, if known from the season analysis. */
  preMin?: number | null;
  policy: Policy;
}

/** Expected NDVI of a healthy crop `weeks` after planting: flat, ramp to peak, plateau, ripen. */
export function expectedNdvi(crop: CropKey, weeks: number, preMin: number, policy: Policy): number {
  const c = policy.crops[crop];
  const matW = c.maturityDays / 7;
  const plateauEnd = c.peakWeek + Math.max(2, (matW - c.peakWeek) * 0.45);
  if (weeks <= 2) return preMin;
  if (weeks <= c.peakWeek) return preMin + (c.peakNdvi - preMin) * ((weeks - 2) / (c.peakWeek - 2));
  if (weeks <= plateauEnd) return c.peakNdvi;
  if (weeks <= matW) return c.peakNdvi - (c.peakNdvi - (preMin + 0.12)) * ((weeks - plateauEnd) / (matW - plateauEnd));
  return preMin + 0.08;
}

/** Radar passes from the viewing track with the most passes, so readings are comparable over time. */
export function mainTrack(radar: RadarObs[]): RadarObs[] {
  const count = new Map<string, number>();
  for (const r of radar) count.set(r.orbit ?? "", (count.get(r.orbit ?? "") ?? 0) + 1);
  const best = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return radar.filter((r) => (r.orbit ?? "") === best).sort((a, b) => a.date.localeCompare(b.date));
}

const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * Weekly in-season check for an active loan, as of a real or replayed date.
 *
 * Evidence rules (rainy-season photos are mostly cloudy):
 * - a crop is proven by a clear photo greener than the bare field, by any photo above `greenThroughCloud`
 *   (cloud and shadow only ever lower NDVI), or by radar VH rising over the bare pre-season;
 * - a missing crop is only declared from evidence of absence (clear photos of bare ground, or flat radar),
 *   never from clouds alone — then the field is marked unverified and an agent is asked to look.
 */
export function monitorField(inp: MonitorInput): MonitorResult {
  const { policy, crop, plantingDate, asOf } = inp;
  const M = policy.monitor;
  const def = policy.crops[crop];
  const all = inp.optical.filter((o) => o.date <= asOf).sort((a, b) => a.date.localeCompare(b.date));
  const clearIds = new Set(usableOptical(all, policy).map((o) => o.sceneId));
  const clear = all.filter((o) => clearIds.has(o.sceneId));
  const track = mainTrack(inp.radar.filter((r) => r.date <= asOf));
  const matW = def.maturityDays / 7;
  const alerts: MonitorAlert[] = [];

  const before = clear.filter((o) => o.date < plantingDate && o.date >= addDays(plantingDate, -120)).map((o) => o.ndvi);
  const preMin = inp.preMin ?? quantile(before, 0.25) ?? 0.22;
  const target = preMin + M.greenupRise;
  const isGreen = (o: OpticalObs) => (clearIds.has(o.sceneId) ? o.ndvi >= target : o.ndvi >= Math.max(target + 0.1, M.greenThroughCloud));

  // Optical evidence: from a little before the agreed date (farmers plant when the rains come).
  const searchFrom = addDays(plantingDate, -45);
  const green = all.filter((o) => o.date >= searchFrom && isGreen(o));
  const greenOptical = green.length > 0;

  // Radar evidence: VH now versus the bare pre-season on the same track.
  const base = track.filter((r) => r.date >= addDays(plantingDate, -120) && r.date <= addDays(plantingDate, -30)).map((r) => r.vhDb);
  const lateR = track.filter((r) => r.date >= addDays(plantingDate, 21)).map((r) => r.vhDb);
  const radarRise = base.length >= 1 && lateR.length >= 2 ? round(median(lateR)! - median(base)!, 1) : null;
  const greenRadar = radarRise !== null && radarRise >= M.radarVhRise;
  const verified = greenOptical || greenRadar;

  // When did it actually go in? First green photo minus three weeks — only if a photo shortly before shows it wasn't green yet.
  let plantedAround: string | null = null;
  const firstGreen = green[0];
  if (firstGreen) {
    const prior = clear.filter((o) => o.date < firstGreen.date && !isGreen(o)).at(-1);
    if (prior && daysBetween(prior.date, firstGreen.date) <= 25) {
      const est = addDays(firstGreen.date, -21);
      const lo = addDays(plantingDate, -45);
      const hi = addDays(plantingDate, 30);
      plantedAround = est < lo ? lo : est > hi ? hi : est;
    }
  }
  const effPlanting = plantedAround ?? plantingDate;
  const weeksPlanned = round(daysBetween(plantingDate, asOf) / 7, 1);
  const weeks = round(daysBetween(effPlanting, asOf) / 7, 1);

  // Evidence of absence (needed before declaring "no crop").
  const lookFrom = addDays(plantingDate, 21);
  const clearLooks = clear.filter((o) => o.date >= lookFrom);
  const flatRadar = radarRise !== null && lateR.length >= 3 && radarRise < M.radarVhRise / 2;
  const absent = !verified && (clearLooks.length >= 2 || flatRadar);

  const greenUp: MonitorResult["greenUp"] = verified ? "VERIFIED" : weeksPlanned > M.greenupByWeek && absent ? "NOT_DETECTED" : "PENDING";
  const trancheAction: MonitorResult["trancheAction"] =
    verified && weeksPlanned >= M.greenupFromWeek ? "RELEASE" : greenUp === "NOT_DETECTED" ? "HOLD" : "WAIT";

  const evidence = greenOptical
    ? `NDVI ${firstGreen!.ndvi.toFixed(2)} on ${fmt(firstGreen!.date)}${clearIds.has(firstGreen!.sceneId) ? "" : " (seen through cloud)"} vs ${preMin.toFixed(2)} bare`
    : greenRadar
      ? `Radar VH up ${radarRise!.toFixed(1)} dB since the dry season`
      : absent
        ? clearLooks.length >= 2
          ? `${clearLooks.length} clear photos since ${fmt(lookFrom)} show bare ground (NDVI ≤ ${Math.max(...clearLooks.map((o) => o.ndvi)).toFixed(2)})`
          : `Radar flat (${radarRise!.toFixed(1)} dB) since planting`
        : null;

  if (greenUp === "NOT_DETECTED") {
    alerts.push({
      type: "NO_GREENUP",
      severity: "CRITICAL",
      title: "No crop detected",
      detail: `${weeksPlanned.toFixed(0)} weeks after the agreed planting date: ${evidence}. Tranche 2 is held and an agent visit is needed.`,
    });
  } else if (!verified && weeksPlanned > M.greenupByWeek) {
    alerts.push({
      type: "UNVERIFIED",
      severity: "WARN",
      title: "Crop not yet confirmed",
      detail: `Clouds have hidden the field since planting and radar is inconclusive. Tranche 2 waits; an agent should confirm the crop.`,
    });
  }

  // Stress: the last two clear readings well below a healthy crop of this age.
  const since = clear.filter((o) => o.date >= effPlanting);
  if (verified && weeks >= 6 && since.length >= 2) {
    const lastTwo = since.slice(-2);
    const below = lastTwo.every((o) => o.ndvi < expectedNdvi(crop, daysBetween(effPlanting, o.date) / 7, preMin, policy) - M.stressDrop);
    if (below && daysBetween(lastTwo[1].date, asOf) <= M.staleDays) {
      alerts.push({
        type: "STRESS",
        severity: "WARN",
        title: "Crop under stress",
        detail: `Two clear readings in a row are well below a healthy ${def.label.toLowerCase()} crop (latest NDVI ${lastTwo[1].ndvi.toFixed(2)} on ${fmt(lastTwo[1].date)}). Send extension advice.`,
      });
    }
  }

  // Flood: standing water where there should be a crop (paddy rice is grown in water, so only late, deep water counts).
  const floodObs = all.find(
    (o) => o.date >= effPlanting && (def.paddy ? o.water >= 0.6 && daysBetween(effPlanting, o.date) >= 42 : o.water >= M.floodWater && o.cloud <= 0.5),
  );
  const afterPlanting = track.filter((r) => r.date >= effPlanting);
  const floodRadar = def.paddy
    ? undefined
    : afterPlanting.find((r, i) => r.vvDb <= M.floodVvDb - 2 || (r.vvDb <= M.floodVvDb && (afterPlanting[i + 1]?.vvDb ?? 0) <= M.floodVvDb));
  if (floodObs || floodRadar) {
    alerts.push({
      type: "FLOOD",
      severity: "CRITICAL",
      title: "Flooding detected",
      detail: `Standing water seen on ${fmt(floodObs?.date ?? floodRadar!.date)}${floodObs ? "" : " by radar"}. Insurance claim opened; restructuring can be offered.`,
    });
  }

  // Stage and harvest.
  const latest = clear.at(-1) ?? null;
  const latestNdvi = latest ? round(latest.ndvi, 3) : null;
  const expected = weeks > 0 ? round(expectedNdvi(crop, weeks, preMin, policy), 3) : null;
  let stage: CropStage = weeks < 0 ? "PRE_PLANTING" : weeks < M.greenupFromWeek ? "GREEN_UP" : weeks < matW - 3 ? "GROWING" : "MATURE";
  const peakSoFar = Math.max(...since.map((o) => o.ndvi), ...green.map((o) => o.ndvi), -1);
  if (weeks >= matW - 2 && latest && latest.date >= effPlanting && peakSoFar - latest.ndvi >= M.harvestDrop) {
    stage = "HARVESTED";
    alerts.push({
      type: "HARVEST",
      severity: "INFO",
      title: "Harvest detected",
      detail: `Greenness fell from ${peakSoFar.toFixed(2)} to ${latest.ndvi.toFixed(2)} (${fmt(latest.date)}). Repayment reminder sent.`,
    });
  }

  // Stale: nothing usable for a while (cloudy weeks).
  const lastSeen = [latest?.date, track.at(-1)?.date].filter((d): d is string => !!d).sort().pop();
  const stale = !lastSeen || daysBetween(lastSeen, asOf) > M.staleDays;
  if (stale && weeksPlanned >= 0) {
    alerts.push({
      type: "NO_DATA",
      severity: "INFO",
      title: "No recent clear view",
      detail: `No usable satellite reading for ${lastSeen ? daysBetween(lastSeen, asOf) : "many"} days. The next pass will update.`,
    });
  }

  const has = (t: MonitorAlert["type"]) => alerts.some((a) => a.type === t);
  const health: Health = has("FLOOD")
    ? "FLOOD"
    : has("STRESS") || has("NO_GREENUP")
      ? "STRESS"
      : stale && weeksPlanned >= 0
        ? "NO_DATA"
        : has("UNVERIFIED") || (greenUp === "PENDING" && weeksPlanned >= M.greenupFromWeek)
          ? "WATCH"
          : "HEALTHY";

  const planted = plantedAround && plantedAround !== plantingDate ? ` Planted around ${fmt(plantedAround)}.` : "";
  const summary =
    weeksPlanned < 0 && !verified
      ? `Planting is planned for ${fmt(plantingDate)}.`
      : health === "FLOOD"
        ? "Flooding detected — insurance claim opened."
        : has("NO_GREENUP")
          ? "No crop has appeared on the field — tranche 2 held."
          : has("STRESS")
            ? "The crop is growing but under stress."
            : stage === "HARVESTED"
              ? "Harvest detected — repayment is due."
              : has("UNVERIFIED")
                ? "Clouds have hidden the crop so far — an agent should confirm it."
                : verified
                  ? `Crop confirmed from space (${evidence}).${planted}`
                  : "Waiting for the crop to green up.";

  return {
    asOf,
    stage,
    weeksSincePlanting: weeks,
    health,
    greenUp,
    trancheAction,
    latestNdvi,
    latestDate: latest?.date ?? null,
    expectedNdvi: expected,
    plantedAround,
    evidence,
    radarRise,
    alerts,
    summary,
  };
}
