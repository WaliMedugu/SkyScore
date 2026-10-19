import type { Band, CropKey } from "./types.ts";

export interface PackageItemDef {
  key: string;
  name: string;
  unit: string;
  qtyPerHa: number;
  unitPrice: number;
  tranche: 1 | 2;
}

export interface CropDef {
  key: CropKey;
  label: string;
  hausa: string;
  /** Usual planting month (1-12) in the North / Middle Belt. */
  plantMonth: number;
  maturityDays: number;
  /** Typical smallholder yield, tonnes per hectare. */
  yieldT: number;
  /** Farm-gate price, naira per tonne. */
  pricePerT: number;
  /** Peak NDVI a healthy crop usually reaches. */
  peakNdvi: number;
  /** Weeks from planting to peak greenness. */
  peakWeek: number;
  /** Grown in standing water (rice paddy): flooding early in the season is normal. */
  paddy?: boolean;
  items: PackageItemDef[];
}

/** Points table: first matching threshold wins. */
export type Steps = [threshold: number, points: number][];

export interface Policy {
  version: number;
  /** Months/days that bound each window of a season year Y (MM-DD). */
  seasonWindows: { dry: [string, string]; pre: [string, string]; peak: [string, string]; post: [string, string] };
  quality: { maxCloud: number; minValidPct: number };
  evidence: {
    amplitude: Steps; // at least
    preMin: Steps; // at most
    peak: Steps; // at least
    senescence: Steps; // at least
    homogeneity: Steps; // at most
    radarRise: Steps; // at least (used when the optical peak window is clouded out)
    lateGreenup: { after: string; points: number };
    earlyGreenup: { before: string; points: number };
    /** Fields are bare before planting; land that stays green is not being prepared. */
    notBare: { preMinAbove: number; penalty: number };
    /** Harvest removes the crop; land that stays green after the season wasn't harvested. */
    noHarvest: { postMinAbove: number; penalty: number };
    woodlandDryLevel: number;
    woodlandPenalty: number;
    bareYearMax: number;
    barePenalty: number;
    maxPositive: number;
    cultivatedAt: number;
    notCultivatedBelow: number;
  };
  score: {
    historySeasons: number;
    recencyWeights: number[];
    weights: { history: number; vigour: number; consistency: number; climate: number; landcover: number; farmer: number };
    floodPenalty: number;
    droughtPenalty: number;
    droughtAnomaly: number;
    ghost: { maxCultivatedSeasons: number; maxCropShare: number; cap: number };
    /** Below this land-cover cropland share an application always goes to an officer. */
    landGate: { minCropShare: number };
    /** Automatic approval needs at least this many clearly farmed seasons, and this share of the readable ones. */
    historyGate: { minCultivated: number; minShare: number };
    bands: Record<Exclude<Band, "E">, number>;
  };
  lending: {
    multipliers: Record<"A" | "B" | "C", number>;
    /** Cap for a first loan, then after 1 and 2+ on-time loans. */
    caps: [number, number, number];
    interestFlat: number;
    insurancePremium: number;
    graceDays: number;
    voucherValidityDays: number;
  };
  monitor: {
    greenupFromWeek: number;
    greenupByWeek: number;
    greenupRise: number;
    /** NDVI that proves a crop even on a photo flagged cloudy (cloud only ever lowers NDVI). */
    greenThroughCloud: number;
    /** Radar VH rise (dB) over the bare pre-season that proves a crop through cloud. */
    radarVhRise: number;
    stressDrop: number;
    floodWater: number;
    floodVvDb: number;
    harvestDrop: number;
    staleDays: number;
  };
  crops: Record<CropKey, CropDef>;
}

/** Sample 2026 input prices for the demo. Ecobank and its dealers set real prices. */
export const DEFAULT_POLICY: Policy = {
  version: 1,
  seasonWindows: {
    dry: ["01-01", "03-31"],
    pre: ["03-01", "06-20"],
    peak: ["07-01", "10-31"],
    post: ["11-01", "01-31"],
  },
  quality: { maxCloud: 0.15, minValidPct: 60 },
  // Calibrated on real fields (18 Oct 2026): 4 farms (Zaria, Kachia, Bida, Kuje) vs woodland,
  // shrubland and town controls, with Sentinel-2's 2022+ reflectance offset corrected.
  evidence: {
    amplitude: [
      [0.35, 0.3],
      [0.25, 0.18],
      [0.15, 0.06],
    ],
    preMin: [
      [0.22, 0.15],
      [0.27, 0.07],
    ],
    peak: [
      [0.6, 0.2],
      [0.5, 0.12],
      [0.4, 0.04],
    ],
    senescence: [
      [0.3, 0.15],
      [0.2, 0.08],
    ],
    homogeneity: [
      [0.12, 0.1],
      [0.16, 0.05],
    ],
    radarRise: [
      [0.15, 0.18],
      [0.08, 0.1],
    ],
    lateGreenup: { after: "06-20", points: 0.05 },
    earlyGreenup: { before: "06-01", points: -0.1 },
    notBare: { preMinAbove: 0.3, penalty: 0.2 },
    noHarvest: { postMinAbove: 0.4, penalty: 0.15 },
    woodlandDryLevel: 0.3,
    woodlandPenalty: 0.35,
    bareYearMax: 0.3,
    barePenalty: 0.4,
    maxPositive: 0.95,
    cultivatedAt: 0.65,
    notCultivatedBelow: 0.35,
  },
  score: {
    historySeasons: 6,
    recencyWeights: [1, 0.9, 0.8, 0.7, 0.6, 0.5],
    weights: { history: 30, vigour: 20, consistency: 10, climate: 15, landcover: 10, farmer: 15 },
    floodPenalty: 5,
    droughtPenalty: 3,
    droughtAnomaly: -0.25,
    ghost: { maxCultivatedSeasons: 1, maxCropShare: 0.25, cap: 15 },
    landGate: { minCropShare: 0.2 },
    historyGate: { minCultivated: 3, minShare: 0.5 },
    bands: { A: 80, B: 65, C: 50, D: 35 },
  },
  lending: {
    multipliers: { A: 1, B: 0.85, C: 0.6 },
    caps: [500_000, 900_000, 1_500_000],
    interestFlat: 0.06,
    insurancePremium: 0.04,
    graceDays: 15,
    voucherValidityDays: 45,
  },
  monitor: {
    greenupFromWeek: 4,
    greenupByWeek: 7,
    greenupRise: 0.15,
    greenThroughCloud: 0.45,
    radarVhRise: 3,
    stressDrop: 0.15,
    floodWater: 0.2,
    floodVvDb: -18,
    harvestDrop: 0.2,
    staleDays: 30,
  },
  crops: {
    maize: {
      key: "maize",
      label: "Maize",
      hausa: "Masara",
      plantMonth: 6,
      maturityDays: 110,
      yieldT: 2.2,
      pricePerT: 480_000,
      peakNdvi: 0.65,
      peakWeek: 9,
      items: [
        { key: "seed", name: "Hybrid maize seed", unit: "25 kg bag", qtyPerHa: 1, unitPrice: 45_000, tranche: 1 },
        { key: "npk", name: "NPK 15-15-15 fertiliser", unit: "50 kg bag", qtyPerHa: 4, unitPrice: 40_000, tranche: 1 },
        { key: "herbicide", name: "Pre-emergence herbicide", unit: "1 L", qtyPerHa: 4, unitPrice: 6_000, tranche: 1 },
        { key: "urea", name: "Urea top-dressing", unit: "50 kg bag", qtyPerHa: 2, unitPrice: 45_000, tranche: 2 },
      ],
    },
    rice: {
      key: "rice",
      label: "Rice",
      hausa: "Shinkafa",
      paddy: true,
      plantMonth: 7,
      maturityDays: 120,
      yieldT: 2.5,
      pricePerT: 600_000,
      peakNdvi: 0.7,
      peakWeek: 10,
      items: [
        { key: "seed", name: "Certified rice seed (FARO 44)", unit: "50 kg bag", qtyPerHa: 1, unitPrice: 60_000, tranche: 1 },
        { key: "npk", name: "NPK 15-15-15 fertiliser", unit: "50 kg bag", qtyPerHa: 4, unitPrice: 40_000, tranche: 1 },
        { key: "herbicide", name: "Rice herbicide", unit: "1 L", qtyPerHa: 4, unitPrice: 6_000, tranche: 1 },
        { key: "urea", name: "Urea top-dressing", unit: "50 kg bag", qtyPerHa: 2, unitPrice: 45_000, tranche: 2 },
      ],
    },
    sorghum: {
      key: "sorghum",
      label: "Sorghum",
      hausa: "Dawa",
      plantMonth: 6,
      maturityDays: 120,
      yieldT: 1.5,
      pricePerT: 450_000,
      peakNdvi: 0.6,
      peakWeek: 10,
      items: [
        { key: "seed", name: "Improved sorghum seed", unit: "10 kg bag", qtyPerHa: 1, unitPrice: 15_000, tranche: 1 },
        { key: "npk", name: "NPK 15-15-15 fertiliser", unit: "50 kg bag", qtyPerHa: 3, unitPrice: 40_000, tranche: 1 },
        { key: "herbicide", name: "Pre-emergence herbicide", unit: "1 L", qtyPerHa: 3, unitPrice: 6_000, tranche: 1 },
        { key: "urea", name: "Urea top-dressing", unit: "50 kg bag", qtyPerHa: 1, unitPrice: 45_000, tranche: 2 },
      ],
    },
    soybean: {
      key: "soybean",
      label: "Soybean",
      hausa: "Waken suya",
      plantMonth: 6,
      maturityDays: 110,
      yieldT: 1.4,
      pricePerT: 700_000,
      peakNdvi: 0.65,
      peakWeek: 9,
      items: [
        { key: "seed", name: "Soybean seed (TGX)", unit: "20 kg bag", qtyPerHa: 3, unitPrice: 25_000, tranche: 1 },
        { key: "ssp", name: "Single super phosphate", unit: "50 kg bag", qtyPerHa: 2, unitPrice: 25_000, tranche: 1 },
        { key: "inoculant", name: "Rhizobium inoculant", unit: "sachet", qtyPerHa: 1, unitPrice: 5_000, tranche: 1 },
        { key: "insecticide", name: "Insecticide spray", unit: "1 L", qtyPerHa: 2, unitPrice: 8_000, tranche: 2 },
      ],
    },
    millet: {
      key: "millet",
      label: "Millet",
      hausa: "Gero",
      plantMonth: 6,
      maturityDays: 90,
      yieldT: 1.2,
      pricePerT: 450_000,
      peakNdvi: 0.55,
      peakWeek: 8,
      items: [
        { key: "seed", name: "Improved millet seed", unit: "5 kg bag", qtyPerHa: 1, unitPrice: 8_000, tranche: 1 },
        { key: "npk", name: "NPK 15-15-15 fertiliser", unit: "50 kg bag", qtyPerHa: 2, unitPrice: 40_000, tranche: 1 },
        { key: "urea", name: "Urea top-dressing", unit: "50 kg bag", qtyPerHa: 1, unitPrice: 45_000, tranche: 2 },
      ],
    },
    groundnut: {
      key: "groundnut",
      label: "Groundnut",
      hausa: "Gyada",
      plantMonth: 6,
      maturityDays: 100,
      yieldT: 1.3,
      pricePerT: 800_000,
      peakNdvi: 0.6,
      peakWeek: 9,
      items: [
        { key: "seed", name: "Groundnut seed (SAMNUT)", unit: "20 kg bag", qtyPerHa: 3, unitPrice: 30_000, tranche: 1 },
        { key: "ssp", name: "Single super phosphate", unit: "50 kg bag", qtyPerHa: 2, unitPrice: 25_000, tranche: 1 },
        { key: "herbicide", name: "Pre-emergence herbicide", unit: "1 L", qtyPerHa: 2, unitPrice: 6_000, tranche: 1 },
        { key: "fungicide", name: "Leaf-spot fungicide", unit: "1 kg", qtyPerHa: 1, unitPrice: 15_000, tranche: 2 },
      ],
    },
    cowpea: {
      key: "cowpea",
      label: "Cowpea (beans)",
      hausa: "Wake",
      plantMonth: 7,
      maturityDays: 75,
      yieldT: 1.0,
      pricePerT: 900_000,
      peakNdvi: 0.55,
      peakWeek: 7,
      items: [
        { key: "seed", name: "Improved cowpea seed", unit: "25 kg bag", qtyPerHa: 1, unitPrice: 30_000, tranche: 1 },
        { key: "ssp", name: "Single super phosphate", unit: "50 kg bag", qtyPerHa: 2, unitPrice: 25_000, tranche: 1 },
        { key: "insecticide", name: "Insecticide spray", unit: "1 L", qtyPerHa: 3, unitPrice: 9_000, tranche: 2 },
      ],
    },
  },
};

export const CROP_KEYS = Object.keys(DEFAULT_POLICY.crops) as CropKey[];

/** Deep-merge a partial policy (as stored by an officer) over the defaults. */
export function mergePolicy(base: Policy, patch: unknown): Policy {
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  const merge = (a: unknown, b: unknown): unknown => {
    if (!isObj(a) || !isObj(b)) return b === undefined ? a : b;
    const out: Record<string, unknown> = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = merge(a[k], v);
    return out;
  };
  return merge(base, patch) as Policy;
}
