import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { FileCache, Http } from "@skyscore/satellite";
import { DEFAULT_POLICY, assess, bboxPolygon, boxAround, type LngLat, type Polygon, type SatelliteBundle } from "@skyscore/engine";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const CACHE_DIR = join(ROOT, "data", "cache", "http");
export const SNAP_DIR = join(ROOT, "data", "snapshots");
export const AS_OF = new Date().toISOString().slice(0, 10);

export const http = new Http({ cache: new FileCache(CACHE_DIR), concurrency: 10, retries: 6 });

/** Square field of `sideM` metres centred on a point. */
export const square = (c: LngLat, sideM: number): Polygon => bboxPolygon(boxAround(c, sideM / 2));

export function summarise(name: string, b: SatelliteBundle) {
  const a = assess({ bundle: b, farmer: { bvnVerified: true, trained: true, cooperative: true, priorOnTimeLoans: 0 }, policy: DEFAULT_POLICY, asOf: AS_OF });
  const rows = a.seasons.map(
    (s) =>
      `  ${s.year} ${s.complete ? " " : "*"} ${s.label.padEnd(15)} ev=${s.evidence.toFixed(2)} pre=${f(s.preMin)} peak=${f(s.peak)} post=${f(s.postMin)} dry=${f(s.dryLevel)} std=${f(s.homogeneity)} rvi+=${f(s.radarRise)} n=${s.observations} pct=${f(s.neighbourPercentile)}${s.flood ? " FLOOD" : ""}`,
  );
  console.log(`\n■ ${name}  area=${b.areaHa.toFixed(2)}ha photos=${b.optical.length}/${b.scenesFound} radar=${b.radar.length} worldcover=${JSON.stringify(b.landCover.worldCoverClasses)}`);
  console.log(rows.join("\n"));
  console.log(`  → SkyScore ${a.score.score} band ${a.score.band} ${a.score.decision}${a.score.ghost ? " GHOST" : ""} (${a.score.cultivatedSeasons}/${a.score.seasonsConsidered}) ${a.score.factors.map((x) => `${x.key}:${x.points}`).join(" ")}`);
  return a;
}
const f = (v: number | null) => (v === null ? " -  " : v.toFixed(2));
