// Re-score saved snapshots with the current policy (no network). Usage: npx tsx calibrate.ts [kind]
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { SatelliteBundle } from "@skyscore/engine";
import { SNAP_DIR, summarise } from "./lib.ts";

const kind = process.argv[2];
const files = readdirSync(SNAP_DIR).filter((f) => f.endsWith(".json") && f !== "index.json");
const rows: string[] = [];
for (const f of files) {
  const s = JSON.parse(readFileSync(join(SNAP_DIR, f), "utf8")) as { key: string; kind: string; bundle: SatelliteBundle };
  if (kind && s.kind !== kind) continue;
  const a = kind ? summarise(s.key, s.bundle) : null;
  if (!kind) {
    const { assess, DEFAULT_POLICY } = await import("@skyscore/engine");
    const r = assess({ bundle: s.bundle, farmer: { bvnVerified: true, trained: true, cooperative: true, priorOnTimeLoans: 0 }, policy: DEFAULT_POLICY, asOf: new Date().toISOString().slice(0, 10) });
    rows.push(`${s.key.padEnd(28)} ${String(r.score.score).padStart(3)} ${r.score.band} ${r.score.decision.padEnd(8)}${r.score.ghost ? " GHOST" : ""} ${r.score.cultivatedSeasons}/${r.score.seasonsConsidered} wc=${s.bundle.landCover.worldCoverCropShare}`);
  }
  void a;
}
if (rows.length) console.log(rows.join("\n"));
