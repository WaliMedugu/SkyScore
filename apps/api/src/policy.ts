import { DEFAULT_POLICY, mergePolicy, type Policy } from "@skyscore/engine";
import { kvGet, kvSet } from "./db.ts";
import { ApiError } from "./util.ts";

let cached: Policy | null = null;

/** The live credit policy: engine defaults plus any changes an officer saved. */
export function getPolicy(): Policy {
  if (!cached) cached = mergePolicy(DEFAULT_POLICY, kvGet("policy") ?? {});
  return cached;
}

/** Sanity rules a saved policy must keep, so a typo can't break scoring or lending. */
export function validatePolicy(p: Policy): string[] {
  const problems: string[] = [];
  const walk = (v: unknown, path: string) => {
    if (typeof v === "number" && !Number.isFinite(v)) problems.push(`${path} must be a number.`);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
  };
  walk(p, "");
  const w = p.score.weights;
  const sum = Object.values(w).reduce((a, b) => a + b, 0);
  if (Object.values(w).some((x) => typeof x !== "number" || x < 0)) problems.push("Score weights can't be negative.");
  if (Math.round(sum) !== 100) problems.push(`Score weights must add up to 100 (now ${sum}).`);
  const b = p.score.bands;
  if (!(b.A <= 100 && b.A > b.B && b.B > b.C && b.C > b.D && b.D > 0)) problems.push("Bands must step down: 100 ≥ A > B > C > D > 0.");
  for (const [band, m] of Object.entries(p.lending.multipliers)) if (!(m > 0 && m <= 1.5)) problems.push(`Band ${band} multiplier must be between 0 and 1.5.`);
  const caps = p.lending.caps;
  if (!Array.isArray(caps) || !caps.length || caps.some((c, i) => !(c > 0) || (i > 0 && c < caps[i - 1]))) problems.push("Loan caps must be positive and rise with each repaid loan.");
  if (!(p.lending.interestFlat >= 0 && p.lending.interestFlat <= 0.5)) problems.push("Flat interest must be between 0 and 50%.");
  if (!(p.lending.insurancePremium >= 0 && p.lending.insurancePremium <= 0.2)) problems.push("Insurance premium must be between 0 and 20%.");
  if (!(p.lending.voucherValidityDays >= 1 && p.lending.voucherValidityDays <= 365)) problems.push("Voucher validity must be 1–365 days.");
  if (!(p.lending.graceDays >= 0 && p.lending.graceDays <= 120)) problems.push("Grace period must be 0–120 days.");
  if (!(p.score.ghost.cap >= 0 && p.score.ghost.cap < b.D)) problems.push("The ghost-farm score cap must sit below band D.");
  if (!(p.score.landGate.minCropShare >= 0 && p.score.landGate.minCropShare <= 1)) problems.push("Land-cover gate must be a share between 0 and 1.");
  if (!(p.score.historyGate.minCultivated >= 0 && p.score.historyGate.minShare >= 0 && p.score.historyGate.minShare <= 1)) problems.push("History gate needs a season count ≥ 0 and a share between 0 and 1.");
  if (!(p.monitor.greenupFromWeek < p.monitor.greenupByWeek)) problems.push("The green-up check must open before it closes.");
  for (const c of Object.values(p.crops)) {
    if (!(c.maturityDays >= 60 && c.maturityDays <= 200)) problems.push(`${c.label}: maturity must be 60–200 days.`);
    if (!(c.plantMonth >= 1 && c.plantMonth <= 12)) problems.push(`${c.label}: planting month must be 1–12.`);
    if (!(c.peakNdvi > 0.3 && c.peakNdvi < 0.95)) problems.push(`${c.label}: peak NDVI must be between 0.3 and 0.95.`);
    for (const i of c.items) if (!(i.qtyPerHa >= 0 && i.unitPrice > 0)) problems.push(`${c.label}: ${i.name} needs a quantity ≥ 0 and a price above 0.`);
  }
  return problems;
}

export function savePolicyPatch(patch: unknown): Policy {
  const merged = mergePolicy(getPolicy(), patch);
  let problems: string[];
  try {
    problems = validatePolicy(merged);
  } catch {
    problems = ["The policy no longer has the expected structure."];
  }
  if (problems.length) throw new ApiError(422, "The policy change was not saved.", problems.map((message) => ({ field: "policy", message })));
  merged.version = (getPolicy().version ?? 1) + 1;
  kvSet("policy", merged);
  cached = merged;
  return merged;
}

export function resetPolicy(): Policy {
  kvSet("policy", {});
  cached = DEFAULT_POLICY;
  return cached;
}
