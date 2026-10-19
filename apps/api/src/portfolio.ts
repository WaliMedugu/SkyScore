import { all, one } from "./db.ts";
import { config } from "./config.ts";
import { demoClock } from "./lending.ts";
import { getPolicy } from "./policy.ts";
import { loanMoney, type LoanRow } from "./views.ts";

export function portfolioSummary() {
  const count = (sql: string, ...p: unknown[]) => (one<{ n: number }>(sql, ...p)?.n ?? 0);
  const byStatus = Object.fromEntries(all<{ status: string; n: number }>("SELECT status, COUNT(*) n FROM applications GROUP BY status").map((r) => [r.status, r.n]));
  const byState = Object.fromEntries(all<{ state: string; n: number }>("SELECT state, COUNT(*) n FROM loans GROUP BY state").map((r) => [r.state, r.n]));
  const health = Object.fromEntries(
    all<{ health: string; n: number }>(
      "SELECT health, COUNT(*) n FROM loans WHERE state IN ('ACTIVE','T2_RELEASED','T2_HELD','RESTRUCTURED','DEFAULTED') GROUP BY health",
    ).map((r) => [r.health, r.n]),
  );
  const loans = all<LoanRow>("SELECT * FROM loans");
  let disbursed = 0;
  let outstanding = 0;
  let repaid = 0;
  let insurancePaid = 0;
  for (const l of loans) {
    const m = loanMoney(l);
    disbursed += m.disbursed;
    outstanding += Math.max(0, m.outstanding);
    repaid += m.repaid;
    insurancePaid += m.insurancePaid;
  }
  const closed = loans.filter((l) => l.state === "REPAID" || l.state === "DEFAULTED");
  const repaidLoans = loans.filter((l) => l.state === "REPAID").length;
  const ghost = one<{ n: number; ha: number }>(
    "SELECT COUNT(*) n, COALESCE(SUM(f.area_ha),0) ha FROM applications a JOIN farms f ON f.id = a.farm_id WHERE a.ghost = 1",
  );
  const avg = one<{ s: number | null }>("SELECT AVG(score) s FROM applications WHERE score IS NOT NULL")?.s ?? null;
  return {
    season: config.loanSeason,
    demoClock: demoClock(),
    farmers: count("SELECT COUNT(*) n FROM farmers"),
    farms: count("SELECT COUNT(*) n FROM farms"),
    hectares: Math.round((one<{ ha: number }>("SELECT COALESCE(SUM(area_ha),0) ha FROM farms")?.ha ?? 0) * 10) / 10,
    applications: { total: count("SELECT COUNT(*) n FROM applications"), byStatus },
    ghostFarmsBlocked: ghost?.n ?? 0,
    ghostHectaresBlocked: Math.round((ghost?.ha ?? 0) * 10) / 10,
    averageScore: avg === null ? null : Math.round(avg),
    loans: { total: loans.length, byState, active: Object.values(health).reduce((a, b) => a + b, 0) },
    health,
    money: {
      approved: loans.reduce((s, l) => s + l.principal, 0),
      disbursed,
      outstanding,
      repaid,
      insurancePaid,
    },
    repaymentRate: closed.length ? Math.round((repaidLoans / closed.length) * 1000) / 10 : null,
    alertsOpen: count("SELECT COUNT(*) n FROM alerts WHERE status = 'OPEN'"),
    dealers: count("SELECT COUNT(*) n FROM dealers"),
  };
}

export function portfolioMap() {
  const policy = getPolicy();
  const rows = all<{
    id: string;
    name: string;
    polygon: string;
    area_ha: number;
    crop: string;
    lng: number;
    lat: number;
    place: string | null;
    farmer: string | null;
    app_status: string | null;
    score: number | null;
    band: string | null;
    ghost: number | null;
    loan_id: string | null;
    loan_state: string | null;
    health: string | null;
  }>(`
    SELECT f.id, f.name, f.polygon, f.area_ha, f.crop, f.lng, f.lat, f.place,
      (fr.first_name || ' ' || fr.last_name) AS farmer,
      a.status AS app_status, a.score, a.band, a.ghost,
      l.id AS loan_id, l.state AS loan_state, l.health
    FROM farms f
    LEFT JOIN farmers fr ON fr.id = f.farmer_id
    LEFT JOIN applications a ON a.id = (SELECT id FROM applications WHERE farm_id = f.id ORDER BY created_at DESC LIMIT 1)
    LEFT JOIN loans l ON l.id = (SELECT id FROM loans WHERE farm_id = f.id ORDER BY created_at DESC LIMIT 1)
  `);
  return {
    type: "FeatureCollection" as const,
    features: rows.map((r) => ({
      type: "Feature" as const,
      geometry: JSON.parse(r.polygon),
      properties: {
        farmId: r.id,
        name: r.name,
        farmer: r.farmer,
        crop: r.crop,
        cropLabel: policy.crops[r.crop as keyof typeof policy.crops]?.label ?? r.crop,
        areaHa: r.area_ha,
        lng: r.lng,
        lat: r.lat,
        place: r.place,
        applicationStatus: r.app_status,
        score: r.score,
        band: r.band,
        ghost: !!r.ghost,
        loanId: r.loan_id,
        loanState: r.loan_state,
        health: r.health,
        // One colour key for the map: ghost > loan health > application status.
        status: r.ghost ? "GHOST" : r.loan_state === "REPAID" ? "REPAID" : r.health ?? r.app_status ?? "MAPPED",
      },
    })),
  };
}
