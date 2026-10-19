// Row → JSON shapes shared by the web console and the Flutter app.
import { accounts, balanceOf, type CropKey, type JournalEntry, type MonitorResult, type Offer, type Polygon } from "@skyscore/engine";
import { all, json, one } from "./db.ts";
import { getPolicy } from "./policy.ts";

export interface FarmerRow {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  gender: string | null;
  birth_year: number | null;
  bvn: string | null;
  bvn_verified: number;
  nin: string | null;
  hub: string | null;
  trained: number;
  cooperative: string | null;
  language: string;
  account_no: string | null;
  consent_at: string | null;
  prior_on_time: number;
  created_at: string;
}
export interface FarmRow {
  id: string;
  farmer_id: string | null;
  name: string;
  polygon: string;
  polygon_key: string;
  area_ha: number;
  lng: number;
  lat: number;
  crop: CropKey;
  planting_month: number | null;
  tenure: string | null;
  place: string | null;
  state: string | null;
  map_method: string | null;
  snapshot_key: string | null;
  analysis_id: string | null;
  created_at: string;
}
export interface ApplicationRow {
  id: string;
  farm_id: string;
  farmer_id: string;
  analysis_id: string | null;
  status: string;
  season_year: number;
  score: number | null;
  band: string | null;
  decision: string | null;
  ghost: number | null;
  offer: string | null;
  assessment: string | null;
  officer_id: string | null;
  officer_note: string | null;
  decided_at: string | null;
  otp_hash: string | null;
  otp_expires: string | null;
  created_by: string | null;
  created_at: string;
}
export interface LoanRow {
  id: string;
  application_id: string;
  farmer_id: string;
  farm_id: string;
  state: string;
  crop: CropKey;
  principal: number;
  interest: number;
  insurance: number;
  total: number;
  tranche1: number;
  tranche2: number;
  season_year: number;
  planting_date: string;
  due_date: string;
  health: string;
  monitor: string | null;
  replay_date: string | null;
  created_at: string;
  updated_at: string;
}
export interface VoucherRow {
  code: string;
  loan_id: string;
  tranche: number;
  amount: number;
  items: string;
  status: string;
  dealer_id: string | null;
  issued_at: string | null;
  expires_at: string | null;
  redeemed_at: string | null;
  settled_at: string | null;
}

const age = (by: number | null) => (by ? new Date().getUTCFullYear() - by : null);

export function farmerDto(r: FarmerRow) {
  return {
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    name: `${r.first_name} ${r.last_name}`,
    phone: r.phone,
    gender: r.gender,
    birthYear: r.birth_year,
    age: age(r.birth_year),
    bvnMasked: r.bvn ? `•••••••${r.bvn.slice(-4)}` : null,
    bvnVerified: !!r.bvn_verified,
    hub: r.hub,
    trained: !!r.trained,
    cooperative: r.cooperative,
    language: r.language,
    accountNo: r.account_no,
    priorOnTimeLoans: r.prior_on_time,
    consentAt: r.consent_at,
    createdAt: r.created_at,
  };
}

export const farmerProfile = (r: FarmerRow) => ({
  bvnVerified: !!r.bvn_verified,
  trained: !!r.trained,
  cooperative: !!r.cooperative,
  priorOnTimeLoans: r.prior_on_time,
});

export function farmDto(r: FarmRow) {
  const policy = getPolicy();
  const farmer = r.farmer_id ? one<FarmerRow>("SELECT * FROM farmers WHERE id = ?", r.farmer_id) : undefined;
  const app = one<ApplicationRow>("SELECT * FROM applications WHERE farm_id = ? ORDER BY created_at DESC LIMIT 1", r.id);
  const loan = one<LoanRow>("SELECT * FROM loans WHERE farm_id = ? ORDER BY created_at DESC LIMIT 1", r.id);
  return {
    id: r.id,
    name: r.name,
    farmerId: r.farmer_id,
    farmerName: farmer ? `${farmer.first_name} ${farmer.last_name}` : null,
    crop: r.crop,
    cropLabel: policy.crops[r.crop]?.label ?? r.crop,
    plantingMonth: r.planting_month ?? policy.crops[r.crop]?.plantMonth ?? null,
    areaHa: r.area_ha,
    lng: r.lng,
    lat: r.lat,
    place: r.place,
    state: r.state,
    tenure: r.tenure,
    mapMethod: r.map_method,
    polygon: JSON.parse(r.polygon) as Polygon,
    snapshotKey: r.snapshot_key,
    analysisId: r.analysis_id,
    createdAt: r.created_at,
    application: app
      ? { id: app.id, status: app.status, score: app.score, band: app.band, decision: app.decision, ghost: !!app.ghost, seasonYear: app.season_year }
      : null,
    loan: loan ? { id: loan.id, state: loan.state, health: loan.health, principal: loan.principal } : null,
  };
}

export function voucherDto(v: VoucherRow) {
  const dealer = v.dealer_id ? one<{ name: string }>("SELECT name FROM dealers WHERE id = ?", v.dealer_id) : undefined;
  const loan = one<LoanRow>("SELECT * FROM loans WHERE id = ?", v.loan_id);
  const farmer = loan ? one<FarmerRow>("SELECT * FROM farmers WHERE id = ?", loan.farmer_id) : undefined;
  return {
    code: v.code,
    loanId: v.loan_id,
    tranche: v.tranche,
    amount: v.amount,
    items: JSON.parse(v.items) as { name: string; unit: string; qty: number; amount: number }[],
    status: v.status,
    dealerId: v.dealer_id,
    dealerName: dealer?.name ?? null,
    issuedAt: v.issued_at,
    expiresAt: v.expires_at,
    redeemedAt: v.redeemed_at,
    settledAt: v.settled_at,
    farmerName: farmer ? `${farmer.first_name} ${farmer.last_name}` : null,
    farmerPhoneMasked: farmer ? `${farmer.phone.slice(0, 4)}•••${farmer.phone.slice(-3)}` : null,
    crop: loan?.crop ?? null,
  };
}

export function journalFor(loanId: string): (JournalEntry & { id: number; createdAt: string })[] {
  return all<{ id: number; kind: JournalEntry["kind"]; memo: string; postings: string; created_at: string }>(
    "SELECT * FROM journal WHERE loan_id = ? ORDER BY id",
    loanId,
  ).map((r) => ({ id: r.id, kind: r.kind, memo: r.memo, postings: JSON.parse(r.postings), createdAt: r.created_at }));
}

export function loanMoney(l: LoanRow) {
  const j = journalFor(l.id);
  const loanAcc = accounts.loan(l.id);
  const outstanding = balanceOf(loanAcc, j);
  const creditTo = (kinds: JournalEntry["kind"][]) =>
    j.filter((e) => kinds.includes(e.kind)).reduce((s, e) => s + e.postings.filter((p) => p.account === loanAcc).reduce((a, p) => a + p.credit, 0), 0);
  const disbursed = j
    .filter((e) => e.kind === "VOUCHER_REDEEMED")
    .reduce((s, e) => s + e.postings.filter((p) => p.account === loanAcc).reduce((a, p) => a + p.debit, 0), 0);
  return { outstanding, repaid: creditTo(["REPAYMENT"]), insurancePaid: creditTo(["INSURANCE_CLAIM"]), disbursed };
}

export function loanDto(l: LoanRow, detail = false) {
  const farm = one<FarmRow>("SELECT * FROM farms WHERE id = ?", l.farm_id);
  const farmer = one<FarmerRow>("SELECT * FROM farmers WHERE id = ?", l.farmer_id);
  const vouchers = all<VoucherRow>("SELECT * FROM vouchers WHERE loan_id = ? ORDER BY tranche", l.id).map(voucherDto);
  const money = loanMoney(l);
  const base = {
    id: l.id,
    applicationId: l.application_id,
    state: l.state,
    crop: l.crop,
    cropLabel: getPolicy().crops[l.crop]?.label ?? l.crop,
    principal: l.principal,
    interest: l.interest,
    insurance: l.insurance,
    total: l.total,
    tranche1: l.tranche1,
    tranche2: l.tranche2,
    ...money,
    seasonYear: l.season_year,
    plantingDate: l.planting_date,
    dueDate: l.due_date,
    health: l.health,
    monitor: json<MonitorResult>(l.monitor),
    replayDate: l.replay_date,
    createdAt: l.created_at,
    updatedAt: l.updated_at,
    farm: farm ? farmDto(farm) : null,
    farmer: farmer ? farmerDto(farmer) : null,
    vouchers,
  };
  if (!detail) return base;
  return {
    ...base,
    journal: journalFor(l.id),
    alerts: all("SELECT * FROM alerts WHERE loan_id = ? ORDER BY created_at DESC", l.id),
    events: all("SELECT * FROM events WHERE (entity = 'loan' AND entity_id = ?) OR (entity = 'application' AND entity_id = ?) ORDER BY id DESC LIMIT 60", l.id, l.application_id),
  };
}

export function applicationDto(a: ApplicationRow, detail = false) {
  const farm = one<FarmRow>("SELECT * FROM farms WHERE id = ?", a.farm_id);
  const farmer = one<FarmerRow>("SELECT * FROM farmers WHERE id = ?", a.farmer_id);
  const loan = one<{ id: string }>("SELECT id FROM loans WHERE application_id = ?", a.id);
  const analysis = a.analysis_id ? one<{ status: string; source: string }>("SELECT status, source FROM analyses WHERE id = ?", a.analysis_id) : undefined;
  const base = {
    id: a.id,
    status: a.status,
    seasonYear: a.season_year,
    score: a.score,
    band: a.band,
    decision: a.decision,
    ghost: !!a.ghost,
    offer: json<Offer>(a.offer),
    officerNote: a.officer_note,
    decidedAt: a.decided_at,
    otpPending: !!a.otp_hash && !!a.otp_expires && a.otp_expires > new Date().toISOString(),
    createdAt: a.created_at,
    analysisId: a.analysis_id,
    analysisStatus: analysis?.status ?? null,
    analysisSource: analysis?.source ?? null,
    loanId: loan?.id ?? null,
    farm: farm ? farmDto(farm) : null,
    farmer: farmer ? farmerDto(farmer) : null,
  };
  if (!detail) return base;
  return {
    ...base,
    assessment: json(a.assessment),
    events: all("SELECT * FROM events WHERE entity = 'application' AND entity_id = ? ORDER BY id DESC", a.id),
  };
}
