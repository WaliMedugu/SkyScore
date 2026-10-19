// Satellite access for the API: SQLite-cached HTTP, saved snapshots, image proxy.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Http, imageUrl, type Cache } from "@skyscore/satellite";
import { polygonKey, type CropKey, type Polygon, type SatelliteBundle } from "@skyscore/engine";
import { config, SNAP_DIR } from "./config.ts";
import { one, run, now } from "./db.ts";

class SqliteCache implements Cache {
  get(key: string) {
    return one<{ value: string }>("SELECT value FROM http_cache WHERE key = ?", key)?.value ?? null;
  }
  set(key: string, value: string) {
    run("INSERT OR REPLACE INTO http_cache(key, value, created_at) VALUES(?,?,?)", key, value, now());
  }
}

export const http = new Http({ cache: new SqliteCache(), offline: config.offline, concurrency: 8, retries: 4 });

export interface Snapshot {
  key: string;
  kind: "showcase" | "control" | "portfolio";
  cluster: string;
  place: string;
  state: string;
  crop: CropKey;
  polygon: Polygon;
  bundle: SatelliteBundle;
  frames: { sceneId: string; date: string; bbox: [number, number, number, number] }[];
}

/** Real satellite data saved by scripts/build-snapshots.ts, indexed by key and polygon. */
class SnapshotStore {
  private byKey = new Map<string, Snapshot>();
  private byPoly = new Map<string, Snapshot>();
  load() {
    this.byKey.clear();
    this.byPoly.clear();
    if (!existsSync(SNAP_DIR)) return 0;
    for (const f of readdirSync(SNAP_DIR)) {
      if (!f.endsWith(".json") || f === "index.json") continue;
      try {
        const s = JSON.parse(readFileSync(join(SNAP_DIR, f), "utf8")) as Snapshot;
        this.byKey.set(s.key, s);
        this.byPoly.set(polygonKey(s.polygon), s);
      } catch {
        /* skip a bad file */
      }
    }
    return this.byKey.size;
  }
  get(key: string) {
    return this.byKey.get(key);
  }
  forPolygon(p: Polygon) {
    return this.byPoly.get(polygonKey(p));
  }
  list(kind?: Snapshot["kind"]) {
    return [...this.byKey.values()].filter((s) => !kind || s.kind === kind);
  }
}
export const snapshots = new SnapshotStore();

const SCENE_RE = /^[A-Za-z0-9_.-]{10,120}$/;

/** One time-lapse frame as PNG: saved snapshot image first, then the (cached) Planetary Computer. */
export async function sceneImage(sceneId: string, bbox: [number, number, number, number], kind: "rgb" | "ndvi", snapKey?: string, size = 256) {
  if (!SCENE_RE.test(sceneId)) throw new Error("Bad scene id");
  if (snapKey && /^[a-z0-9-]+$/.test(snapKey)) {
    const p = join(SNAP_DIR, "images", snapKey, `${sceneId}_${kind}.png`);
    if (existsSync(p)) return { data: readFileSync(p), type: "image/png" };
  }
  if (bbox.some((v) => !Number.isFinite(v)) || bbox[0] >= bbox[2] || bbox[1] >= bbox[3] || bbox[2] - bbox[0] > 0.2) throw new Error("Bad bbox");
  const img = await http.bytes(imageUrl(sceneId, bbox, kind, Math.min(Math.max(size, 64), 512)));
  return { data: Buffer.from(img.data), type: img.type };
}
