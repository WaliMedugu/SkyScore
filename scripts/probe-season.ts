// Probe one field's full in-season record (every Sentinel-2 photo, every Sentinel-1 pass by track).
// Usage: npx tsx probe-season.ts <snapshot-key> [year]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { s1Reading, s2Reading, stacSearch } from "@skyscore/satellite";
import type { Polygon } from "@skyscore/engine";
import { SNAP_DIR, http } from "./lib.ts";

const key = process.argv[2] ?? "showcase-zaria";
const year = Number(process.argv[3] ?? 2025);
const snap = JSON.parse(readFileSync(join(SNAP_DIR, `${key}.json`), "utf8")) as { polygon: Polygon; crop: string };
const from = `${year}-04-01`;
const to = `${year}-11-30`;

const s1 = await stacSearch(http, "sentinel-1-rtc", snap.polygon, from, to);
const tracks = new Map<string, typeof s1>();
for (const s of s1) tracks.set(s.orbit ?? "?", [...(tracks.get(s.orbit ?? "?") ?? []), s]);
console.log(`■ ${key} (${snap.crop}) ${year}: ${s1.length} radar passes on ${tracks.size} tracks`);
for (const [orbit, list] of [...tracks].sort((a, b) => b[1].length - a[1].length)) {
  const rows = await Promise.all(list.map((s) => s1Reading(http, s, snap.polygon).catch(() => null)));
  const line = rows
    .filter((r): r is NonNullable<typeof r> => !!r)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => `${r.date.slice(5)}:${r.rvi.toFixed(2)}/${r.vhDb.toFixed(1)}`)
    .join(" ");
  console.log(`  ${orbit.padEnd(14)} ${list.length} passes  rvi/vhDb: ${line}`);
}

const s2 = await stacSearch(http, "sentinel-2-l2a", snap.polygon, from, to, { "eo:cloud_cover": { lt: 95 } });
const byDate = new Map(s2.map((s) => [s.date, s]));
const reads = await Promise.all([...byDate.values()].map((s) => s2Reading(http, s, snap.polygon).catch(() => null)));
const opt = reads.filter((r): r is NonNullable<typeof r> => !!r).sort((a, b) => a.date.localeCompare(b.date));
console.log(`  optical: ${opt.length} photos`);
console.log(`  ${opt.map((o) => `${o.date.slice(5)}:${o.ndvi.toFixed(2)}${o.cloud > 0.15 ? `(c${Math.round(o.cloud * 100)})` : ""}`).join(" ")}`);
console.log(http.stats);
