// Scan farming areas with ESA WorldCover to find 1-ha squares that are cropland (and non-farm controls).
// Output: data/candidates.json. Usage: npm run find-farms
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { worldCover } from "@skyscore/satellite";
import { boxAround, round, type LngLat } from "@skyscore/engine";
import { ROOT, http, square } from "./lib.ts";

const CLUSTERS: { key: string; name: string; state: string; centre: LngLat }[] = [
  { key: "zaria", name: "Samaru, Zaria", state: "Kaduna", centre: [7.62, 11.05] },
  { key: "kachia", name: "Kachia", state: "Kaduna", centre: [7.95, 9.87] },
  { key: "bida", name: "Bida", state: "Niger", centre: [6.01, 9.08] },
  { key: "kuje", name: "Kuje", state: "FCT", centre: [7.23, 8.88] },
];
const GRID = 7; // 7 x 7 candidates per cluster
const SPACING_M = 700;

// Non-farm controls for the ghost-farm demo.
const CONTROLS: { key: string; name: string; centre: LngLat; want: string }[] = [
  { key: "zuma", name: "Zuma Rock, Niger State", centre: [7.2287, 9.1269], want: "bare" },
  { key: "gwagwalada-town", name: "Gwagwalada town, FCT", centre: [7.08, 8.95], want: "built-up" },
  { key: "kagoro-woodland", name: "Kagoro hills woodland, Kaduna", centre: [8.39, 9.6], want: "trees" },
];

const offset = ([lng, lat]: LngLat, dxM: number, dyM: number): LngLat => {
  const b = boxAround([lng, lat], 1);
  const mPerDegLng = 2 / (b[2] - b[0]);
  const mPerDegLat = 2 / (b[3] - b[1]);
  return [round(lng + dxM / mPerDegLng, 6), round(lat + dyM / mPerDegLat, 6)];
};

const results: Record<string, unknown[]> = {};
for (const c of CLUSTERS) {
  const cands: { centre: LngLat; crop: number; classes: Record<string, number> }[] = [];
  const jobs: Promise<void>[] = [];
  const half = Math.floor(GRID / 2);
  for (let i = -half; i <= half; i++) {
    for (let j = -half; j <= half; j++) {
      const p = offset(c.centre, i * SPACING_M, j * SPACING_M);
      jobs.push(
        worldCover(http, square(p, 100))
          .then((wc) => {
            cands.push({ centre: p, crop: wc.share ?? 0, classes: wc.classes });
          })
          .catch(() => {}),
      );
    }
  }
  await Promise.all(jobs);
  cands.sort((a, b) => b.crop - a.crop);
  results[c.key] = cands;
  const full = cands.filter((x) => x.crop >= 0.98).length;
  console.log(`${c.name}: ${cands.length} squares scanned, ${full} fully cropland`);
}

const controls: unknown[] = [];
for (const k of CONTROLS) {
  // Search a small neighbourhood for the purest square of the wanted class.
  const opts: { centre: LngLat; share: number; classes: Record<string, number> }[] = [];
  await Promise.all(
    [-300, 0, 300].flatMap((dx) =>
      [-300, 0, 300].map((dy) => {
        const p = offset(k.centre, dx, dy);
        return worldCover(http, square(p, 100))
          .then((wc) => {
            opts.push({ centre: p, share: wc.classes[k.want] ?? 0, classes: wc.classes });
          })
          .catch(() => {});
      }),
    ),
  );
  opts.sort((a, b) => b.share - a.share);
  controls.push({ ...k, best: opts[0] });
  console.log(`${k.name}: best ${k.want} share ${opts[0]?.share} at ${opts[0]?.centre} ${JSON.stringify(opts[0]?.classes)}`);
}

writeFileSync(join(ROOT, "data", "candidates.json"), JSON.stringify({ clusters: CLUSTERS, results, controls }, null, 2));
console.log("wrote data/candidates.json", http.stats);
