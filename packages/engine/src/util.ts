export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const round = (v: number, dp = 2) => Math.round(v * 10 ** dp) / 10 ** dp;

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Linear-interpolated quantile (q in 0..1). */
export function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function stdev(values: number[]): number | null {
  const m = mean(values);
  if (m === null || values.length < 2) return null;
  return Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / (values.length - 1));
}

const DAY = 86_400_000;
export const toTime = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);
export const toDate = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => toDate(toTime(d) + n * DAY);
export const daysBetween = (a: string, b: string) => Math.round((toTime(b) - toTime(a)) / DAY);
export const between = (d: string, from: string, to: string) => d >= from && d <= to;

/** Last day of a month as YYYY-MM-DD. */
export function endOfMonth(year: number, month1: number): string {
  return toDate(Date.UTC(year, month1, 0));
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

export const pct = (v: number) => `${Math.round(v * 100)}%`;
export const naira = (v: number) => `₦${Math.round(v).toLocaleString("en-NG")}`;

/** Stable 64-bit FNV-1a hash as hex (isomorphic: no Node crypto needed). */
export function hash(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x050c5d1f;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x01000193) ^ (h1 >>> 7);
  }
  return ((h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0"));
}
