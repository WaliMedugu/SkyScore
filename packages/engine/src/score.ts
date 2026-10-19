import type { Policy } from "./policy.ts";
import type { Band, Decision, FarmerProfile, LandCover, ScoreFactor, ScoreResult, SeasonResult } from "./types.ts";
import { clamp, mean, pct, round, stdev } from "./util.ts";

export interface ScoreInput {
  seasons: SeasonResult[];
  landCover: LandCover;
  farmer: FarmerProfile;
  policy: Policy;
}

export function bandFor(score: number, policy: Policy): Band {
  const b = policy.score.bands;
  if (score >= b.A) return "A";
  if (score >= b.B) return "B";
  if (score >= b.C) return "C";
  if (score >= b.D) return "D";
  return "E";
}

const decisionFor = (band: Band): Decision => (band === "A" || band === "B" ? "APPROVE" : band === "C" ? "REVIEW" : "DECLINE");

function topClass(classes: Record<string, number>): string {
  const top = Object.entries(classes).sort((a, b) => b[1] - a[1])[0];
  return top ? `${top[0]} (${Math.round(top[1] * 100)}%)` : "non-cropland";
}

/** Compute the SkyScore: six explainable factors, a band, and a recommendation. */
/**
 * History gate: does this field's record of farmed seasons support an automatic approval?
 * `evaluable` holds the readable completed seasons, newest first. Returns why an officer should look, or null.
 */
export function historyGate(evaluable: SeasonResult[], policy: Policy): string | null {
  const h = policy.score.historyGate;
  const farmed = evaluable.filter((s) => s.label === "CULTIVATED").length;
  if (!evaluable.length) return null;
  // TODO(human): decide when a farming record is too thin or too broken to approve without an officer.
  // Working default: at least `minCultivated` clearly farmed seasons AND at least `minShare` of the readable ones.
  // `evaluable` is newest first (evaluable[0] = last season); each season has `label`, `evidence` (0–1) and `year`.
  if (farmed >= h.minCultivated && farmed / evaluable.length >= h.minShare) return null;
  return `Clearly farmed in only ${farmed} of ${evaluable.length} readable seasons: an officer should confirm the field is farmed now.`;
}

export function computeScore({ seasons, landCover, farmer, policy }: ScoreInput): ScoreResult {
  const W = policy.score.weights;
  const strengths: string[] = [];
  const concerns: string[] = [];

  // Last N completed seasons, newest first.
  const history = seasons
    .filter((s) => s.complete)
    .sort((a, b) => b.year - a.year)
    .slice(0, policy.score.historySeasons);
  const evaluable = history.filter((s) => s.label !== "NO_DATA");
  const cultivated = evaluable.filter((s) => s.label === "CULTIVATED");

  // 1. Farming history
  let wSum = 0;
  let wHit = 0;
  history.forEach((s, i) => {
    if (s.label === "NO_DATA") return;
    const w = policy.score.recencyWeights[i] ?? 0.5;
    wSum += w;
    wHit += w * (s.label === "CULTIVATED" ? 1 : s.label === "UNCERTAIN" ? 0.4 : 0);
  });
  const historyShare = wSum ? wHit / wSum : 0;
  const coverage = clamp(evaluable.length / 3, 0, 1); // fewer than 3 readable seasons -> less certainty
  const historyPts = W.history * historyShare * (0.6 + 0.4 * coverage);
  const yearsList = cultivated.map((s) => s.year).sort().join(", ");
  const historyDetail = evaluable.length
    ? `Farmed in ${cultivated.length} of the last ${evaluable.length} readable seasons${yearsList ? ` (${yearsList})` : ""}.`
    : "No readable seasons yet.";
  if (cultivated.length >= 4) strengths.push(`Satellites show this field farmed in ${cultivated.length} of the last ${evaluable.length} seasons.`);
  if (evaluable.length && cultivated.length <= 1) concerns.push(`Satellites find farming in only ${cultivated.length} of the last ${evaluable.length} seasons.`);

  // 2. Crop vigour vs neighbours
  const pcts = cultivated.map((s) => s.neighbourPercentile).filter((v): v is number => v !== null);
  let vigourPts: number;
  let vigourDetail: string;
  const meanPct = mean(pcts);
  if (meanPct !== null) {
    vigourPts = W.vigour * clamp((meanPct - 0.2) / 0.7, 0, 1);
    vigourDetail = `At peak season the crop was greener than ${pct(meanPct)} of land within ~1 km (average of ${pcts.length} season${pcts.length > 1 ? "s" : ""}).`;
    if (meanPct >= 0.7) strengths.push(`Healthier crops than ${pct(meanPct)} of the surrounding land.`);
    if (meanPct < 0.35) concerns.push(`Crops are weaker than most of the surrounding land (${pct(meanPct)} percentile).`);
  } else {
    const peaks = cultivated.map((s) => s.peak).filter((v): v is number => v !== null);
    const mp = mean(peaks);
    vigourPts = mp === null ? 0 : W.vigour * 0.8 * clamp((mp - 0.4) / 0.35, 0, 1);
    vigourDetail = mp === null ? "No peak-season readings to compare." : `Average peak greenness NDVI ${mp.toFixed(2)} (no neighbour comparison available).`;
  }

  // 3. Consistency of peaks
  const peaks = cultivated.map((s) => s.peak).filter((v): v is number => v !== null);
  let consistencyPts: number;
  let consistencyDetail: string;
  if (peaks.length >= 2) {
    const cv = (stdev(peaks) ?? 0) / (mean(peaks) || 1);
    consistencyPts = W.consistency * clamp(1 - (cv - 0.08) / 0.22, 0.2, 1);
    consistencyDetail = `Peak greenness varies ${pct(cv)} season to season.`;
    if (cv <= 0.1) strengths.push("Very steady harvests from season to season.");
  } else {
    consistencyPts = W.consistency * 0.4;
    consistencyDetail = "Not enough farmed seasons to judge consistency.";
  }

  // 4. Climate resilience
  const floods = history.filter((s) => s.flood);
  const droughts = history.filter((s) => s.rainfallAnomaly !== null && s.rainfallAnomaly <= policy.score.droughtAnomaly);
  let climatePts = W.climate - floods.length * policy.score.floodPenalty;
  const climateNotes: string[] = [];
  for (const d of droughts) {
    const heldUp = d.label === "CULTIVATED" && (d.neighbourPercentile ?? 0) >= 0.5;
    if (heldUp) {
      climateNotes.push(`${d.year} rain was ${pct(-(d.rainfallAnomaly ?? 0))} below normal, yet the crop beat its neighbours`);
      strengths.push(`Held up in the ${d.year} dry spell (${pct(-(d.rainfallAnomaly ?? 0))} less rain than normal).`);
    } else {
      climatePts -= policy.score.droughtPenalty;
      climateNotes.push(`${d.year} rain was ${pct(-(d.rainfallAnomaly ?? 0))} below normal`);
    }
  }
  climatePts = clamp(climatePts, 0, W.climate);
  if (floods.length) concerns.push(`Flooding detected in ${floods.map((f) => f.year).join(", ")}: insurance recommended.`);
  else if (history.length) strengths.push(`No floods detected in ${history.length} seasons.`);
  const climateDetail = [floods.length ? `Flood seasons: ${floods.map((f) => f.year).join(", ")}` : "No floods detected", ...climateNotes].join(". ") + ".";

  // 5. Land-cover agreement
  const wc = landCover.worldCoverCropShare;
  const ioVals = Object.values(landCover.ioCropShareByYear);
  const io = mean(ioVals);
  let landPts = wc === null ? W.landcover * 0.4 : W.landcover * clamp((wc - 0.1) / 0.6, 0, 1);
  if (io !== null) landPts = Math.min(W.landcover, landPts + 2 * clamp(io, 0, 1));
  const landDetail =
    wc === null
      ? "No land-cover map available."
      : `ESA WorldCover maps ${pct(wc)} of the field as cropland${io !== null ? `; Impact Observatory averages ${pct(io)} crops across ${ioVals.length} years` : ""}.`;
  if (wc !== null && wc >= 0.6) strengths.push(`ESA WorldCover independently maps ${pct(wc)} of this field as cropland.`);
  if (wc !== null && wc < 0.25) concerns.push(`Land-cover maps show mostly non-farmland here (${pct(wc)} cropland).`);

  // 6. Farmer profile
  const coopOrHistory = farmer.cooperative || farmer.priorOnTimeLoans > 0;
  const farmerPts = (farmer.bvnVerified ? 5 : 0) + (farmer.trained ? 5 : 0) + (coopOrHistory ? 5 : 0);
  const farmerScaled = (farmerPts / 15) * W.farmer;
  const farmerBits = [
    farmer.bvnVerified ? "BVN verified" : "BVN not verified",
    farmer.trained ? "completed agribusiness training" : "no training record",
    farmer.priorOnTimeLoans > 0 ? `${farmer.priorOnTimeLoans} loan(s) repaid on time` : farmer.cooperative ? "cooperative member" : "no cooperative or loan history",
  ];
  if (!farmer.bvnVerified) concerns.push("Farmer's BVN is not verified yet.");

  const factors: ScoreFactor[] = [
    { key: "history", label: "Farming history", points: round(historyPts, 1), max: W.history, detail: historyDetail },
    { key: "vigour", label: "Crop vigour", points: round(vigourPts, 1), max: W.vigour, detail: vigourDetail },
    { key: "consistency", label: "Consistency", points: round(consistencyPts, 1), max: W.consistency, detail: consistencyDetail },
    { key: "climate", label: "Climate resilience", points: round(climatePts, 1), max: W.climate, detail: climateDetail },
    { key: "landcover", label: "Land-cover check", points: round(landPts, 1), max: W.landcover, detail: landDetail },
    { key: "farmer", label: "Farmer profile", points: round(farmerScaled, 1), max: W.farmer, detail: `${farmerBits.join(", ")}.` },
  ];

  let score = Math.round(factors.reduce((a, f) => a + f.points, 0));
  const g = policy.score.ghost;
  const ghost = evaluable.length >= 3 && cultivated.length <= g.maxCultivatedSeasons && (wc === null || wc < g.maxCropShare);
  if (ghost) {
    score = Math.min(score, g.cap);
    concerns.unshift("No farming history found on this land: possible ghost farm.");
  }
  const band = bandFor(score, policy);
  let decision: Decision = ghost ? "DECLINE" : decisionFor(band);
  // Land-cover maps that disagree with the satellite story send the case to a person.
  const gated = !ghost && wc !== null && wc < policy.score.landGate.minCropShare && decision === "APPROVE";
  if (gated) {
    decision = "REVIEW";
    concerns.unshift(`Land-cover maps classify this land as ${topClass(landCover.worldCoverClasses)}, not cropland: an agent should confirm the field before approval.`);
  }
  // A thin or broken farming record isn't auto-approved, however well the other factors score.
  const thin = !ghost && decision === "APPROVE" ? historyGate(evaluable, policy) : null;
  if (thin) {
    decision = "REVIEW";
    concerns.unshift(thin);
  }
  // KYC is a hard requirement for disbursing, so an unverified BVN always goes to an officer.
  if (decision === "APPROVE" && !farmer.bvnVerified) {
    decision = "REVIEW";
    concerns.unshift("BVN not verified yet: complete KYC before this loan can be approved.");
  }
  const confidence = evaluable.length >= 5 ? "HIGH" : evaluable.length >= 3 ? "MEDIUM" : "LOW";
  if (confidence === "LOW") concerns.push("Few clear seasons available: an agent visit should confirm the field.");

  const headline = ghost
    ? "No farming history detected — this looks like a ghost farm."
    : decision === "APPROVE"
      ? `A proven field: farmed ${cultivated.length} of the last ${evaluable.length} seasons.`
      : decision === "REVIEW"
        ? "Some farming history, but a loan officer should take a look."
        : "Not enough evidence of steady farming to lend yet.";

  return {
    score,
    band,
    decision,
    ghost,
    confidence,
    factors,
    strengths: [...new Set(strengths)].slice(0, 6),
    concerns: [...new Set(concerns)].slice(0, 6),
    seasonsConsidered: evaluable.length,
    cultivatedSeasons: cultivated.length,
    headline,
  };
}
