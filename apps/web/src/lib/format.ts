// Formatting for money, dates and statuses.

export const naira = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `₦${Math.round(v).toLocaleString("en-NG")}`);

export function nairaShort(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const a = Math.abs(v);
  if (a >= 1e9) return `₦${(v / 1e9).toFixed(1)}bn`;
  if (a >= 1e6) return `₦${(v / 1e6).toFixed(a >= 1e7 ? 1 : 2)}m`;
  if (a >= 1e3) return `₦${Math.round(v / 1e3)}k`;
  return `₦${Math.round(v)}`;
}

const D = (d: string) => new Date(d.length === 10 ? `${d}T00:00:00Z` : d);
export const date = (d: string | null | undefined) =>
  d ? D(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";
export const dateShort = (d: string | null | undefined) => (d ? D(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "—");
export const monthYear = (d: string) => D(d).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
export const time = (d: string) => D(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

export function ago(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = (Date.now() - D(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return date(iso);
}

export const pct = (v: number | null | undefined, dp = 0) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(dp)}%`);
export const ha = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v.toFixed(v < 10 ? 2 : 1)} ha`);
export const words = (s: string | null | undefined) => (s ? s.replace(/_/g, " ").toLowerCase() : "—");
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Colour tone for any status the API returns. */
export function tone(status: string | null | undefined): string {
  switch (status) {
    case "HEALTHY":
    case "APPROVED":
    case "APPROVE":
    case "ACCEPTED":
    case "ACTIVE":
    case "T2_RELEASED":
    case "ISSUED":
    case "VERIFIED":
    case "CULTIVATED":
    case "RELEASE":
      return "tone-healthy";
    case "WATCH":
    case "REVIEW":
    case "PENDING":
    case "UNCERTAIN":
    case "UNVERIFIED":
    case "ANALYZING":
    case "WAIT":
    case "HELD":
      return "tone-watch";
    case "STRESS":
    case "GHOST_DECLINED":
    case "DECLINED":
    case "DECLINE":
    case "DEFAULTED":
    case "T2_HELD":
    case "NO_GREENUP":
    case "NOT_DETECTED":
    case "OVERDUE":
    case "ERROR":
    case "HOLD":
    case "CRITICAL":
      return "tone-stress";
    case "FLOOD":
      return "tone-flood";
    case "GHOST":
    case "NO_DATA":
    case "NOT_CULTIVATED":
    case "EXPIRED":
      return "tone-ghost";
    case "REPAID":
    case "REDEEMED":
    case "HARVEST":
      return "tone-repaid";
    default:
      return "tone-neutral";
  }
}

/** Map colours (fills) per status. */
export const STATUS_FILL: Record<string, string> = {
  HEALTHY: "#BED600",
  WATCH: "#F5B400",
  STRESS: "#E4572E",
  FLOOD: "#0082BB",
  GHOST: "#9AA5AB",
  REPAID: "#005B82",
  NO_DATA: "#C8D3D8",
  APPROVED: "#E9F2A6",
  REVIEW: "#F5B400",
  DECLINED: "#E4572E",
  ANALYZING: "#FFFFFF",
  MAPPED: "#FFFFFF",
};

export const BAND_COLOR: Record<string, string> = { A: "#BED600", B: "#8FC31F", C: "#F5B400", D: "#E98A2E", E: "#E4572E" };
