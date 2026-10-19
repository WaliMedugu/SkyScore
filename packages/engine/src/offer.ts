import type { Policy } from "./policy.ts";
import type { CropKey, Offer, OfferItem, ScoreResult } from "./types.ts";
import { addDays, round } from "./util.ts";

export interface OfferInput {
  score: ScoreResult;
  areaHa: number;
  crop: CropKey;
  seasonYear: number;
  /** 1-12; defaults to the crop's usual planting month. */
  plantingMonth?: number;
  priorOnTimeLoans: number;
  policy: Policy;
}

/** Size an input loan from the field, the crop package and the score band. */
export function buildOffer(inp: OfferInput): Offer {
  const { score, crop, policy } = inp;
  const def = policy.crops[crop];
  const L = policy.lending;
  const plantMonth = inp.plantingMonth ?? def.plantMonth;
  const plantingDate = `${inp.seasonYear}-${String(plantMonth).padStart(2, "0")}-15`;
  const greenupCheckFrom = addDays(plantingDate, policy.monitor.greenupFromWeek * 7);
  const greenupCheckBy = addDays(plantingDate, policy.monitor.greenupByWeek * 7);
  const dueDate = addDays(plantingDate, def.maturityDays + 30 + L.graceDays);
  const cap = L.caps[Math.min(inp.priorOnTimeLoans, L.caps.length - 1)];

  const base: Offer = {
    eligible: false,
    reason: "",
    crop,
    areaHa: round(inp.areaHa, 2),
    financedHa: 0,
    multiplier: 0,
    cap,
    capApplied: false,
    items: [],
    tranche1: 0,
    tranche2: 0,
    principal: 0,
    interest: 0,
    insurance: 0,
    totalRepayable: 0,
    plantingDate,
    greenupCheckFrom,
    greenupCheckBy,
    dueDate,
    expectedYieldT: round(def.yieldT * inp.areaHa, 2),
    expectedRevenue: Math.round(def.yieldT * inp.areaHa * def.pricePerT),
    repaymentToRevenue: 0,
  };

  if (score.ghost) return { ...base, reason: "No farming history detected on this land." };
  if (score.decision === "DECLINE") return { ...base, reason: `Score ${score.score} (band ${score.band}) is below the lending threshold.` };

  const multiplier = L.multipliers[score.band as "A" | "B" | "C"] ?? 0;
  const perHa = def.items.reduce((a, i) => a + i.qtyPerHa * i.unitPrice, 0);
  let financedHa = inp.areaHa * multiplier;
  let capApplied = false;
  if (financedHa * perHa > cap) {
    financedHa = cap / perHa;
    capApplied = true;
  }

  // Whole bags/units only; round down any item that would push the loan over the cap.
  const items: OfferItem[] = def.items.map((i) => {
    const qty = Math.max(1, Math.round(i.qtyPerHa * financedHa));
    return { key: i.key, name: i.name, unit: i.unit, qty, unitPrice: i.unitPrice, amount: qty * i.unitPrice, tranche: i.tranche };
  });
  let principal = items.reduce((a, i) => a + i.amount, 0);
  for (let guard = 0; principal > cap && guard < 50; guard++) {
    const biggest = [...items].filter((i) => i.qty > 1).sort((a, b) => b.unitPrice - a.unitPrice)[0];
    if (!biggest) break;
    biggest.qty -= 1;
    biggest.amount = biggest.qty * biggest.unitPrice;
    principal = items.reduce((a, i) => a + i.amount, 0);
    capApplied = true;
  }

  const tranche1 = items.filter((i) => i.tranche === 1).reduce((a, i) => a + i.amount, 0);
  const tranche2 = principal - tranche1;
  const interest = Math.round(principal * L.interestFlat);
  const insurance = Math.round(principal * L.insurancePremium);
  const totalRepayable = principal + interest + insurance;

  return {
    ...base,
    eligible: true,
    reason: score.decision === "REVIEW" ? "Eligible for a smaller loan after officer review." : "Eligible.",
    financedHa: round(financedHa, 2),
    multiplier,
    capApplied,
    items,
    tranche1,
    tranche2,
    principal,
    interest,
    insurance,
    totalRepayable,
    repaymentToRevenue: base.expectedRevenue ? round(totalRepayable / base.expectedRevenue, 3) : 0,
  };
}
