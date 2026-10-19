// Shared domain types for SkyScore. Dates are ISO strings (YYYY-MM-DD) unless noted.

export type LngLat = [number, number];

export interface Polygon {
  type: "Polygon";
  coordinates: LngLat[][];
}

export type BBox = [minLng: number, minLat: number, maxLng: number, maxLat: number];

/** One cloud-checked Sentinel-2 reading of a field. */
export interface OpticalObs {
  date: string;
  sceneId: string;
  /** Median NDVI over the field's pixels. */
  ndvi: number;
  ndviMean: number;
  /** Spread of NDVI across the field (fields are uniform, bush is patchy). */
  ndviStd: number;
  /** Share of field pixels flagged cloud or cloud shadow by the SCL band (0..1). */
  cloud: number;
  /** Share of field pixels flagged water by the SCL band (0..1). */
  water: number;
  /** Percentage of valid pixels (0..100). */
  validPct: number;
  /** Scene-level cloud cover percentage reported by the catalogue. */
  sceneCloud?: number;
}

/** One Sentinel-1 radar reading of a field (backscatter in linear power and dB). */
export interface RadarObs {
  date: string;
  sceneId: string;
  vv: number;
  vh: number;
  vvDb: number;
  vhDb: number;
  /** Radar vegetation index, 4*VH/(VV+VH). Rises as crops grow. */
  rvi: number;
  /** Viewing track, e.g. "ascending-132". Passes from one track are directly comparable. */
  orbit?: string;
}

/** The farm's peak greenness ranked against every pixel within ~1 km. */
export interface NeighbourPeak {
  season: number;
  date: string;
  sceneId: string;
  farmNdvi: number;
  hoodMedian: number;
  /** 0..1: share of neighbourhood pixels the farm is greener than. */
  percentile: number;
}

export interface LandCover {
  /** ESA WorldCover 2021: share of the field classed as cropland (class 40). */
  worldCoverCropShare: number | null;
  /** ESA WorldCover 2021: share by class name. */
  worldCoverClasses: Record<string, number>;
  /** Impact Observatory annual land cover: share classed as crops per year. */
  ioCropShareByYear: Record<string, number>;
}

export interface RainfallMonth {
  /** YYYY-MM */
  ym: string;
  /** Total rainfall for the month in millimetres. */
  mm: number;
}

/** Everything the satellites told us about one field. */
export interface SatelliteBundle {
  polygon: Polygon;
  areaHa: number;
  centroid: LngLat;
  bbox: BBox;
  optical: OpticalObs[];
  radar: RadarObs[];
  neighbours: NeighbourPeak[];
  landCover: LandCover;
  rainfall: RainfallMonth[];
  /** Total photos the catalogue offered before cloud filtering. */
  scenesFound: number;
  fetchedAt: string;
  sources: string[];
}

export type SeasonLabel = "CULTIVATED" | "UNCERTAIN" | "NOT_CULTIVATED" | "NO_DATA";

export interface SeasonResult {
  year: number;
  /** False while the season is still running at the analysis date. */
  complete: boolean;
  label: SeasonLabel;
  /** 0..1 strength of the evidence that the field was farmed this season. */
  evidence: number;
  preMin: number | null;
  peak: number | null;
  peakDate: string | null;
  postMin: number | null;
  amplitude: number | null;
  senescence: number | null;
  homogeneity: number | null;
  /** Median NDVI in Jan–Mar: high values mean perennial vegetation (trees). */
  dryLevel: number | null;
  /** Highest NDVI anywhere in the year: low values mean buildings, rock or bare ground. */
  yearMax: number | null;
  greenupDate: string | null;
  /** Radar vegetation index rise from early season to peak window. */
  radarRise: number | null;
  flood: boolean;
  rainfallMm: number | null;
  /** (season rain - average) / average */
  rainfallAnomaly: number | null;
  neighbourPercentile: number | null;
  observations: number;
  reasons: string[];
}

export type Band = "A" | "B" | "C" | "D" | "E";
export type Decision = "APPROVE" | "REVIEW" | "DECLINE";

export interface FarmerProfile {
  bvnVerified: boolean;
  trained: boolean;
  cooperative: boolean;
  priorOnTimeLoans: number;
}

export interface ScoreFactor {
  key: "history" | "vigour" | "consistency" | "climate" | "landcover" | "farmer";
  label: string;
  points: number;
  max: number;
  detail: string;
}

export interface ScoreResult {
  score: number;
  band: Band;
  decision: Decision;
  ghost: boolean;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  factors: ScoreFactor[];
  strengths: string[];
  concerns: string[];
  seasonsConsidered: number;
  cultivatedSeasons: number;
  headline: string;
}

/** Single rainy-season crops that the season model covers (North / Middle Belt). */
export type CropKey = "maize" | "rice" | "sorghum" | "soybean" | "millet" | "groundnut" | "cowpea";

export interface OfferItem {
  key: string;
  name: string;
  unit: string;
  qty: number;
  unitPrice: number;
  amount: number;
  tranche: 1 | 2;
}

export interface Offer {
  eligible: boolean;
  reason: string;
  crop: CropKey;
  areaHa: number;
  financedHa: number;
  multiplier: number;
  cap: number;
  capApplied: boolean;
  items: OfferItem[];
  tranche1: number;
  tranche2: number;
  principal: number;
  interest: number;
  insurance: number;
  totalRepayable: number;
  plantingDate: string;
  greenupCheckFrom: string;
  greenupCheckBy: string;
  dueDate: string;
  expectedYieldT: number;
  expectedRevenue: number;
  /** Loan repayment as a share of expected harvest value. */
  repaymentToRevenue: number;
}

export type Health = "HEALTHY" | "WATCH" | "STRESS" | "FLOOD" | "NO_DATA";
export type CropStage = "PRE_PLANTING" | "GREEN_UP" | "GROWING" | "MATURE" | "HARVESTED";

export interface MonitorAlert {
  type: "NO_GREENUP" | "UNVERIFIED" | "STRESS" | "FLOOD" | "HARVEST" | "NO_DATA";
  severity: "INFO" | "WARN" | "CRITICAL";
  title: string;
  detail: string;
}

export interface MonitorResult {
  asOf: string;
  stage: CropStage;
  weeksSincePlanting: number;
  health: Health;
  greenUp: "VERIFIED" | "PENDING" | "NOT_DETECTED";
  trancheAction: "RELEASE" | "HOLD" | "WAIT";
  latestNdvi: number | null;
  latestDate: string | null;
  expectedNdvi: number | null;
  /** Planting date read from the data (first green-up), when the photos pin it down. */
  plantedAround: string | null;
  /** What proved (or disproved) the crop, in words. */
  evidence: string | null;
  /** Radar VH rise in dB since the bare pre-season, when measurable. */
  radarRise: number | null;
  alerts: MonitorAlert[];
  summary: string;
}
