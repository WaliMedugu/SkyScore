// Shapes the SkyScore API returns (see /openapi.json).
import type { LandCover, MonitorResult, NeighbourPeak, Offer, Policy, Polygon, RainfallMonth, ScoreResult, SeasonResult } from "@skyscore/engine";

export type { MonitorResult, Offer, Policy, Polygon, ScoreResult, SeasonResult };

export interface Frame {
  sceneId: string;
  date: string;
  bbox: [number, number, number, number];
}

export interface OpticalPoint {
  date: string;
  ndvi: number;
  cloud?: number;
  water?: number;
  clear: boolean;
  sceneId: string;
}
export interface RadarPoint {
  date: string;
  rvi: number;
  vvDb: number;
  vhDb?: number;
}

export interface Analysis {
  id: string;
  status: string;
  source: "live" | "snapshot";
  snapshotKey: string | null;
  ready: boolean;
  error?: string | null;
  asOf: string;
  polygon: Polygon;
  areaHa: number;
  centroid: [number, number];
  bbox: [number, number, number, number];
  photosFound: number;
  clearPhotos: number;
  radarPasses: number;
  seasons: SeasonResult[];
  score: ScoreResult;
  offer: Offer | null;
  landCover: LandCover;
  neighbours: NeighbourPeak[];
  series: { optical: OpticalPoint[]; radar: RadarPoint[] };
  rainfall: RainfallMonth[];
  frames: Frame[];
  sources: string[];
}

export interface Farmer {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  phone: string;
  gender: string | null;
  birthYear: number | null;
  age: number | null;
  bvnMasked: string | null;
  bvnVerified: boolean;
  hub: string | null;
  trained: boolean;
  cooperative: string | null;
  language: string;
  accountNo: string | null;
  priorOnTimeLoans: number;
  consentAt: string | null;
  createdAt: string;
}

export interface Farm {
  id: string;
  name: string;
  farmerId: string | null;
  farmerName: string | null;
  crop: string;
  cropLabel: string;
  plantingMonth: number | null;
  areaHa: number;
  lng: number;
  lat: number;
  place: string | null;
  state: string | null;
  tenure: string | null;
  mapMethod: string | null;
  polygon: Polygon;
  snapshotKey: string | null;
  analysisId: string | null;
  createdAt: string;
  application: { id: string; status: string; score: number | null; band: string | null; decision: string | null; ghost: boolean; seasonYear: number } | null;
  loan: { id: string; state: string; health: string; principal: number } | null;
}

export interface Application {
  id: string;
  status: string;
  seasonYear: number;
  score: number | null;
  band: string | null;
  decision: string | null;
  ghost: boolean;
  offer: Offer | null;
  officerNote: string | null;
  decidedAt: string | null;
  otpPending: boolean;
  createdAt: string;
  analysisId: string | null;
  analysisStatus: string | null;
  analysisSource: string | null;
  loanId: string | null;
  farm: Farm | null;
  farmer: Farmer | null;
  assessment?: { asOf: string; seasons: SeasonResult[]; score: ScoreResult; offer: Offer | null; clearPhotos: number; photosFound: number } | null;
  events?: EventRow[];
}

export interface Voucher {
  code: string;
  loanId: string;
  tranche: number;
  amount: number;
  items: { name: string; unit: string; qty: number; amount: number }[];
  status: string;
  dealerId: string | null;
  dealerName: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  redeemedAt: string | null;
  settledAt: string | null;
  farmerName: string | null;
  farmerPhoneMasked: string | null;
  crop: string | null;
}

export interface JournalEntry {
  id: number;
  kind: string;
  memo: string;
  postings: { account: string; debit: number; credit: number }[];
  createdAt: string;
}

export interface SeasonChart {
  plantingDate: string;
  plantedAround: string | null;
  from: string;
  to: string;
  upTo: string;
  greenupWindow: [string, string];
  observed: OpticalPoint[];
  radar: RadarPoint[];
  expected: { date: string; ndvi: number }[];
  frames: Frame[];
  snapshotKey: string | null;
}

export interface Loan {
  id: string;
  applicationId: string;
  state: string;
  crop: string;
  cropLabel: string;
  principal: number;
  interest: number;
  insurance: number;
  total: number;
  tranche1: number;
  tranche2: number;
  outstanding: number;
  repaid: number;
  insurancePaid: number;
  disbursed: number;
  seasonYear: number;
  plantingDate: string;
  dueDate: string;
  health: string;
  monitor: MonitorResult | null;
  replayDate: string | null;
  createdAt: string;
  updatedAt: string;
  farm: Farm | null;
  farmer: Farmer | null;
  vouchers: Voucher[];
  journal?: JournalEntry[];
  alerts?: AlertRaw[];
  events?: EventRow[];
  season?: SeasonChart | null;
}

export interface AlertRaw {
  id: string;
  loan_id: string;
  type: string;
  severity: string;
  title: string;
  detail: string;
  status: string;
  created_at: string;
}
export interface Alert {
  id: string;
  loanId: string | null;
  farmId: string | null;
  type: string;
  severity: string;
  title: string;
  detail: string;
  status: string;
  createdAt: string;
  ackBy: string | null;
  ackAt: string | null;
  farmName: string | null;
  farmerName: string | null;
  lng: number | null;
  lat: number | null;
}

export interface EventRow {
  id: number;
  entity: string;
  entityId?: string;
  entity_id?: string;
  type: string;
  message: string;
  actor?: string | null;
  createdAt?: string;
  created_at?: string;
}

export interface Summary {
  season: number;
  demoClock: string;
  farmers: number;
  farms: number;
  hectares: number;
  applications: { total: number; byStatus: Record<string, number> };
  ghostFarmsBlocked: number;
  ghostHectaresBlocked: number;
  averageScore: number | null;
  loans: { total: number; byState: Record<string, number>; active: number };
  health: Record<string, number>;
  money: { approved: number; disbursed: number; outstanding: number; repaid: number; insurancePaid: number };
  repaymentRate: number | null;
  alertsOpen: number;
  dealers: number;
}

export interface MapFeature {
  type: "Feature";
  geometry: Polygon;
  properties: {
    farmId: string;
    name: string;
    farmer: string | null;
    crop: string;
    cropLabel: string;
    areaHa: number;
    lng: number;
    lat: number;
    place: string | null;
    applicationStatus: string | null;
    score: number | null;
    band: string | null;
    ghost: boolean;
    loanId: string | null;
    loanState: string | null;
    health: string | null;
    status: string;
  };
}

export interface Dealer {
  id: string;
  name: string;
  owner: string | null;
  phone: string | null;
  address: string | null;
  state: string | null;
  lng: number | null;
  lat: number | null;
  accountNo: string | null;
  balance: number;
  vouchersRedeemed: number;
  valueRedeemed: number;
  vouchers?: Voucher[];
}

export interface Sms {
  id: number;
  to_phone: string;
  body: string;
  kind: string;
  created_at: string;
}

export interface ShowcaseField {
  key: string;
  kind: "showcase" | "control";
  cluster: string;
  place: string;
  state: string;
  crop: string;
  cropLabel: string;
  polygon: Polygon;
  areaHa: number;
  centroid: [number, number];
  photosFound: number;
  clearPhotos: number;
  score: number;
  band: string;
  decision: string;
  ghost: boolean;
  cultivatedSeasons: number;
  seasonsConsidered: number;
  headline: string;
  thumbnail: Frame | null;
  frames: Frame[];
}

export interface Meta {
  version: string;
  season: number;
  businessDate: string;
  demoClock: boolean;
  sandbox: boolean;
  offline: boolean;
  ussdCode: string;
  crops: { key: string; label: string; hausa: string; plantMonth: number; maturityDays: number; items: { key: string; name: string; unit: string; qtyPerHa: number; unitPrice: number; tranche: 1 | 2 }[] }[];
}
