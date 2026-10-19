// In-season monitoring on the saved real fields, as the API runs it. Usage: npx tsx monitor-report.ts [season] [asOf] [key-filter]
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_POLICY as P, analyzeSeasons, monitorField, usableOptical, type CropKey, type SatelliteBundle } from "@skyscore/engine";
import { SNAP_DIR } from "./lib.ts";

const season = Number(process.argv[2] ?? 2025);
const asOf = process.argv[3] ?? `${season}-08-20`;
const filter = process.argv[4] ?? "";

for (const f of readdirSync(SNAP_DIR).filter((x) => x.endsWith(".json") && x !== "index.json" && x.includes(filter))) {
  const s = JSON.parse(readFileSync(join(SNAP_DIR, f), "utf8")) as { key: string; crop: CropKey; bundle: SatelliteBundle };
  const crop = P.crops[s.crop];
  const planting = `${season}-${String(crop.plantMonth).padStart(2, "0")}-15`;
  // The API takes the bare-field level from the application's season analysis (judged on 1 March).
  const pre = analyzeSeasons(s.bundle, P, { asOf: `${season}-03-01` }).find((x) => x.year === season)?.preMin ?? null;
  const m = monitorField({ crop: s.crop, plantingDate: planting, asOf, optical: s.bundle.optical, radar: s.bundle.radar, preMin: pre, policy: P });
  const clear = new Set(usableOptical(s.bundle.optical, P).map((o) => o.sceneId));
  const obs = s.bundle.optical
    .filter((o) => o.date >= `${season}-04-01` && o.date <= asOf)
    .map((o) => `${o.date.slice(5)}:${o.ndvi.toFixed(2)}${clear.has(o.sceneId) ? "" : "c"}`)
    .join(" ");
  const rvi = s.bundle.radar
    .filter((r) => r.date >= `${season}-04-01` && r.date <= asOf)
    .map((r) => `${r.date.slice(5)}:${r.rvi.toFixed(2)}`)
    .join(" ");
  console.log(`■ ${s.key} ${s.crop} planted ${planting} preMin(api)=${pre ?? "—"} → ${m.health} greenUp=${m.greenUp} stage=${m.stage} latest=${m.latestNdvi} (${m.latestDate}) expected=${m.expectedNdvi}`);
  console.log(`  alerts: ${m.alerts.map((a) => a.type).join(", ") || "none"}`);
  console.log(`  optical: ${obs}`);
  console.log(`  radar:   ${rvi}`);
}
