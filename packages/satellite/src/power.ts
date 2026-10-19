// NASA POWER: free, keyless daily/monthly rainfall for any point since 1981.
import type { LngLat, RainfallMonth } from "@skyscore/engine";
import { daysInMonth, round } from "@skyscore/engine";
import type { Http } from "./http.ts";

const POWER = "https://power.larc.nasa.gov/api/temporal";

interface PowerResponse {
  properties: { parameter: { PRECTOTCORR: Record<string, number> } };
}

/** Monthly rainfall totals (mm) from `fromYear` up to `asOf`. */
export async function rainfall(http: Http, [lng, lat]: LngLat, fromYear: number, asOf: string): Promise<RainfallMonth[]> {
  const asOfYear = Number(asOf.slice(0, 4));
  const lastFull = asOfYear - 1;
  const out: RainfallMonth[] = [];
  const pt = `longitude=${lng.toFixed(4)}&latitude=${lat.toFixed(4)}`;

  if (lastFull >= fromYear) {
    // Monthly values are mm/day averages; key 13 is the annual average.
    const m = await http.json<PowerResponse>("GET", `${POWER}/monthly/point?parameters=PRECTOTCORR&community=AG&${pt}&start=${fromYear}&end=${lastFull}&format=JSON`);
    for (const [k, v] of Object.entries(m.properties.parameter.PRECTOTCORR)) {
      const y = Number(k.slice(0, 4));
      const mo = Number(k.slice(4, 6));
      if (mo < 1 || mo > 12 || v < 0) continue;
      out.push({ ym: `${y}-${String(mo).padStart(2, "0")}`, mm: round(v * daysInMonth(y, mo), 1) });
    }
  }

  // Current year: daily values up to a few days ago (POWER lags slightly).
  const end = new Date(Date.parse(`${asOf}T00:00:00Z`) - 4 * 86_400_000).toISOString().slice(0, 10).replace(/-/g, "");
  if (asOfYear >= fromYear && end > `${asOfYear}0101`) {
    const d = await http.json<PowerResponse>(
      "GET",
      `${POWER}/daily/point?parameters=PRECTOTCORR&community=AG&${pt}&start=${asOfYear}0101&end=${end}&format=JSON`,
      undefined,
      { cache: true },
    );
    const months = new Map<string, number>();
    for (const [k, v] of Object.entries(d.properties.parameter.PRECTOTCORR)) {
      if (v < 0) continue;
      const ym = `${k.slice(0, 4)}-${k.slice(4, 6)}`;
      months.set(ym, (months.get(ym) ?? 0) + v);
    }
    for (const [ym, mm] of months) out.push({ ym, mm: round(mm, 1) });
  }
  return out.sort((a, b) => a.ym.localeCompare(b.ym));
}
