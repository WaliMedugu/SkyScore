import { describe, expect, it } from "vitest";
import {
  DEFAULT_POLICY as P,
  analyzeSeasons,
  areaHa,
  assess,
  balanceOf,
  buildOffer,
  computeScore,
  expectedNdvi,
  feesCharged,
  historyGate,
  isBalanced,
  monitorField,
  nextState,
  polygonFrom,
  repayment,
  validateFarmPolygon,
  voucherCode,
  voucherRedeemed,
  accounts,
  LoanTransitionError,
} from "../src/index.ts";
import { FIELD, GOOD_FARMER, YEARS, builtProfile, bundleFrom, cropProfile, woodlandProfile } from "./fixtures.ts";

const AS_OF = "2026-10-18";

describe("geo", () => {
  it("measures a farm-sized square in hectares", () => {
    // ~131 m x ~100 m
    expect(areaHa(FIELD)).toBeGreaterThan(1.1);
    expect(areaHa(FIELD)).toBeLessThan(1.5);
  });
  it("rejects crossing boundaries, tiny plots and places outside Nigeria", () => {
    const bowtie = polygonFrom([
      [7.62, 11.05],
      [7.621, 11.051],
      [7.621, 11.05],
      [7.62, 11.051],
    ]);
    expect(validateFarmPolygon(bowtie).problems.join()).toMatch(/cross/);
    const tiny = polygonFrom([
      [7.62, 11.05],
      [7.62001, 11.05],
      [7.62001, 11.05001],
    ]);
    expect(validateFarmPolygon(tiny).ok).toBe(false);
    const london = polygonFrom([
      [-0.12, 51.5],
      [-0.11, 51.5],
      [-0.11, 51.51],
    ]);
    expect(validateFarmPolygon(london).problems.join()).toMatch(/outside Nigeria/);
    expect(validateFarmPolygon(FIELD).ok).toBe(true);
  });
});

describe("season model", () => {
  it("recognises a farmed field every season", () => {
    const s = analyzeSeasons(bundleFrom(cropProfile, { years: YEARS }), P, { asOf: AS_OF });
    const done = s.filter((x) => x.complete);
    expect(done.length).toBeGreaterThanOrEqual(6);
    expect(done.every((x) => x.label === "CULTIVATED")).toBe(true);
    expect(done[0].peak).toBeGreaterThan(0.6);
  });
  it("rejects woodland and buildings", () => {
    const wood = analyzeSeasons(bundleFrom(woodlandProfile, { years: YEARS }), P, { asOf: AS_OF });
    expect(wood.filter((x) => x.complete).every((x) => x.label === "NOT_CULTIVATED")).toBe(true);
    const town = analyzeSeasons(bundleFrom(builtProfile, { years: YEARS }), P, { asOf: AS_OF });
    expect(town.filter((x) => x.complete).every((x) => x.label === "NOT_CULTIVATED")).toBe(true);
  });
  it("uses radar when clouds hide the peak", () => {
    const b = bundleFrom(cropProfile, { years: YEARS, cloudyMonths: [7, 8, 9, 10] });
    const s = analyzeSeasons(b, P, { asOf: AS_OF }).find((x) => x.year === 2024)!;
    expect(s.peak).toBeNull();
    expect(s.radarRise).toBeGreaterThan(0.15);
    expect(s.label).not.toBe("NO_DATA");
  });
  it("flags a flood season and treats the current season as incomplete", () => {
    const s = analyzeSeasons(bundleFrom(cropProfile, { years: [...YEARS, 2026], flood: "2024-08-21" }), P, { asOf: AS_OF });
    expect(s.find((x) => x.year === 2024)!.flood).toBe(true);
    expect(s.find((x) => x.year === 2026)!.complete).toBe(false);
  });
});

describe("SkyScore", () => {
  it("approves a proven farm and gives reasons", () => {
    const a = assess({ bundle: bundleFrom(cropProfile, { years: YEARS }), farmer: GOOD_FARMER, policy: P, asOf: AS_OF });
    expect(a.score.ghost).toBe(false);
    expect(a.score.score).toBeGreaterThanOrEqual(80);
    expect(a.score.band).toBe("A");
    expect(a.score.decision).toBe("APPROVE");
    expect(a.score.factors.reduce((s, f) => s + f.max, 0)).toBe(100);
    expect(a.score.strengths.length).toBeGreaterThan(0);
  });
  it("catches a ghost farm", () => {
    const a = assess({
      bundle: bundleFrom(woodlandProfile, { years: YEARS, landCover: { worldCoverCropShare: 0.04 } }),
      farmer: GOOD_FARMER,
      policy: P,
      asOf: AS_OF,
    });
    expect(a.score.ghost).toBe(true);
    expect(a.score.score).toBeLessThanOrEqual(P.score.ghost.cap);
    expect(a.score.decision).toBe("DECLINE");
    expect(a.score.concerns[0]).toMatch(/ghost/i);
  });
  it("sends a farm-like field to an officer when land-cover maps disagree", () => {
    const a = assess({
      bundle: bundleFrom(cropProfile, { years: YEARS, landCover: { worldCoverCropShare: 0.05, worldCoverClasses: { shrubland: 0.8, grassland: 0.15 } } }),
      farmer: GOOD_FARMER,
      policy: P,
      asOf: AS_OF,
    });
    expect(a.score.ghost).toBe(false);
    expect(a.score.decision).toBe("REVIEW");
    expect(a.score.concerns[0]).toMatch(/shrubland/);
  });
  it("sends a thin farming record to an officer instead of approving it", () => {
    const seasons = analyzeSeasons(bundleFrom(cropProfile, { years: YEARS }), P, { asOf: AS_OF }).filter((x) => x.complete);
    expect(historyGate(seasons, P)).toBeNull();
    const thin = seasons.map((x, i) => (i < seasons.length - 2 ? { ...x, label: "NOT_CULTIVATED" as const } : x));
    expect(historyGate(thin, P)).toMatch(/only 2 of/);
    const loose = { ...P, score: { ...P.score, historyGate: { minCultivated: 2, minShare: 0.25 } } };
    expect(historyGate(thin, loose)).toBeNull();
  });
  it("never auto-approves without a verified BVN", () => {
    const a = assess({ bundle: bundleFrom(cropProfile, { years: YEARS }), farmer: { ...GOOD_FARMER, bvnVerified: false }, policy: P, asOf: AS_OF });
    expect(a.score.decision).toBe("REVIEW");
    expect(a.score.concerns[0]).toMatch(/BVN/);
  });
  it("penalises floods and missing KYC", () => {
    const clean = computeScore({
      seasons: analyzeSeasons(bundleFrom(cropProfile, { years: YEARS }), P, { asOf: AS_OF }),
      landCover: { worldCoverCropShare: 0.9, worldCoverClasses: {}, ioCropShareByYear: {} },
      farmer: GOOD_FARMER,
      policy: P,
    });
    const flooded = computeScore({
      seasons: analyzeSeasons(bundleFrom(cropProfile, { years: YEARS, flood: "2023-08-21" }), P, { asOf: AS_OF }),
      landCover: { worldCoverCropShare: 0.9, worldCoverClasses: {}, ioCropShareByYear: {} },
      farmer: { ...GOOD_FARMER, bvnVerified: false },
      policy: P,
    });
    expect(flooded.score).toBeLessThan(clean.score);
    expect(flooded.concerns.join()).toMatch(/Flood/);
  });
});

describe("offer", () => {
  const score = assess({ bundle: bundleFrom(cropProfile, { years: YEARS }), farmer: GOOD_FARMER, policy: P, asOf: AS_OF }).score;
  it("sizes a maize package to the field, in whole bags, with two tranches", () => {
    const o = buildOffer({ score, areaHa: 1.2, crop: "maize", seasonYear: 2025, priorOnTimeLoans: 0, policy: P });
    expect(o.eligible).toBe(true);
    expect(o.items.every((i) => Number.isInteger(i.qty) && i.qty >= 1)).toBe(true);
    expect(o.tranche1 + o.tranche2).toBe(o.principal);
    expect(o.tranche2).toBeGreaterThan(0);
    expect(o.totalRepayable).toBe(o.principal + o.interest + o.insurance);
    expect(o.principal).toBeLessThanOrEqual(o.cap);
    expect(o.dueDate > o.plantingDate).toBe(true);
  });
  it("respects the first-loan cap on a big farm", () => {
    const o = buildOffer({ score, areaHa: 8, crop: "maize", seasonYear: 2025, priorOnTimeLoans: 0, policy: P });
    expect(o.capApplied).toBe(true);
    expect(o.principal).toBeLessThanOrEqual(P.lending.caps[0]);
  });
  it("declines a ghost farm", () => {
    const o = buildOffer({ score: { ...score, ghost: true, decision: "DECLINE" }, areaHa: 1, crop: "maize", seasonYear: 2025, priorOnTimeLoans: 0, policy: P });
    expect(o.eligible).toBe(false);
    expect(o.principal).toBe(0);
  });
});

describe("monitoring", () => {
  const b = bundleFrom(cropProfile, { years: [2025] });
  it("verifies green-up and releases tranche 2", () => {
    const m = monitorField({ crop: "maize", plantingDate: "2025-06-15", asOf: "2025-08-05", optical: b.optical, radar: b.radar, policy: P });
    expect(m.greenUp).toBe("VERIFIED");
    expect(m.trancheAction).toBe("RELEASE");
    expect(m.health).toBe("HEALTHY");
  });
  it("holds tranche 2 when nothing grows", () => {
    const bare = bundleFrom(builtProfile, { years: [2025] });
    const m = monitorField({ crop: "maize", plantingDate: "2025-06-15", asOf: "2025-08-20", optical: bare.optical, radar: bare.radar, policy: P });
    expect(m.greenUp).toBe("NOT_DETECTED");
    expect(m.trancheAction).toBe("HOLD");
    expect(m.alerts.some((a) => a.type === "NO_GREENUP")).toBe(true);
  });
  it("proves a crop through cloud with radar", () => {
    const cloudy = bundleFrom(cropProfile, { years: [2025], cloudyMonths: [6, 7, 8, 9] });
    const m = monitorField({ crop: "maize", plantingDate: "2025-06-15", asOf: "2025-08-20", optical: cloudy.optical, radar: cloudy.radar, policy: P });
    expect(m.greenUp).toBe("VERIFIED");
    expect(m.radarRise).toBeGreaterThan(P.monitor.radarVhRise);
    expect(m.evidence).toMatch(/Radar VH up/);
    expect(m.trancheAction).toBe("RELEASE");
  });
  it("never declares a missing crop from clouds alone", () => {
    const cloudy = bundleFrom(cropProfile, { years: [2025], cloudyMonths: [6, 7, 8, 9] });
    const m = monitorField({ crop: "maize", plantingDate: "2025-06-15", asOf: "2025-08-20", optical: cloudy.optical, radar: [], policy: P });
    expect(m.greenUp).toBe("PENDING");
    expect(m.trancheAction).toBe("WAIT");
    expect(m.alerts.map((a) => a.type)).toContain("UNVERIFIED");
    expect(m.alerts.map((a) => a.type)).not.toContain("NO_GREENUP");
    // Nothing usable for over a month: the honest status is "no recent view", not "stressed".
    expect(m.health).toBe("NO_DATA");
  });
  it("reads the real planting date from the photos", () => {
    const m = monitorField({ crop: "maize", plantingDate: "2025-06-15", asOf: "2025-08-05", optical: b.optical, radar: b.radar, policy: P });
    expect(m.plantedAround).not.toBeNull();
    expect(m.plantedAround! < "2025-06-15").toBe(true);
  });
  it("treats water in a rice paddy as normal but flags a flooded maize field", () => {
    const paddy = bundleFrom(cropProfile, { years: [2025], flood: "2025-07-21" });
    const rice = monitorField({ crop: "rice", plantingDate: "2025-07-15", asOf: "2025-08-10", optical: paddy.optical, radar: paddy.radar, policy: P });
    expect(rice.alerts.some((a) => a.type === "FLOOD")).toBe(false);
    const flooded = bundleFrom(cropProfile, { years: [2025], flood: "2025-08-06" });
    const maize = monitorField({ crop: "maize", plantingDate: "2025-06-15", asOf: "2025-08-10", optical: flooded.optical, radar: flooded.radar, policy: P });
    expect(maize.health).toBe("FLOOD");
  });
  it("detects harvest after maturity", () => {
    const m = monitorField({ crop: "maize", plantingDate: "2025-06-15", asOf: "2025-11-25", optical: b.optical, radar: b.radar, policy: P });
    expect(m.stage).toBe("HARVESTED");
  });
  it("draws a sensible healthy-crop curve", () => {
    expect(expectedNdvi("maize", 1, 0.2, P)).toBeCloseTo(0.2);
    expect(expectedNdvi("maize", 9, 0.2, P)).toBeCloseTo(P.crops.maize.peakNdvi);
  });
});

describe("loan lifecycle and ledger", () => {
  it("follows the allowed path and refuses illegal moves", () => {
    let s = nextState("OFFERED", "ACCEPT");
    s = nextState(s, "REDEEM_T1");
    s = nextState(s, "HOLD_T2");
    s = nextState(s, "RELEASE_T2");
    s = nextState(s, "REPAY_FULL");
    expect(s).toBe("REPAID");
    expect(() => nextState("REPAID", "REDEEM_T1")).toThrow(LoanTransitionError);
  });
  it("keeps every entry balanced and tracks what the farmer owes", () => {
    const e1 = voucherRedeemed("L1", "D1", 250_000, "SKY-AAAA-BBBB");
    const e2 = feesCharged("L1", 15_000, 10_000);
    const e3 = repayment("L1", "F1", 100_000, "USSD");
    for (const e of [e1, e2, e3]) expect(isBalanced(e)).toBe(true);
    expect(balanceOf(accounts.loan("L1"), [e1, e2, e3])).toBe(175_000);
  });
  it("makes readable voucher codes", () => {
    expect(voucherCode()).toMatch(/^SKY-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
  });
});
