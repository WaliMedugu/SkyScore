import type { BBox, LngLat, Polygon } from "./types.ts";
import { hash, round } from "./util.ts";

const R = 6_371_008.8; // mean Earth radius, metres
const rad = (d: number) => (d * Math.PI) / 180;

/** Outer ring without the repeated closing point. */
export function ring(p: Polygon): LngLat[] {
  const r = p.coordinates[0] ?? [];
  if (r.length > 1) {
    const [a, b] = [r[0], r[r.length - 1]];
    if (a[0] === b[0] && a[1] === b[1]) return r.slice(0, -1);
  }
  return r;
}

export function polygonFrom(points: LngLat[]): Polygon {
  const pts = points.map(([x, y]) => [round(x, 7), round(y, 7)] as LngLat);
  return { type: "Polygon", coordinates: [[...pts, pts[0]]] };
}

/** Project to local metres around the ring's mean latitude (fine for farm-sized shapes). */
function project(points: LngLat[]): [number, number][] {
  const lat0 = points.reduce((a, p) => a + p[1], 0) / points.length;
  const kx = R * Math.cos(rad(lat0)) * (Math.PI / 180);
  const ky = R * (Math.PI / 180);
  return points.map(([lng, lat]) => [lng * kx, lat * ky]);
}

export function areaM2(p: Polygon): number {
  const pts = project(ring(p));
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

export const areaHa = (p: Polygon) => areaM2(p) / 10_000;

export function perimeterM(p: Polygon): number {
  const r = ring(p);
  let d = 0;
  for (let i = 0; i < r.length; i++) d += distanceM(r[i], r[(i + 1) % r.length]);
  return d;
}

/** Haversine distance in metres. */
export function distanceM(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function centroid(p: Polygon): LngLat {
  const r = ring(p);
  const pts = project(r);
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    const f = x1 * y2 - x2 * y1;
    a += f;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const n = r.length || 1;
    return [r.reduce((s, q) => s + q[0], 0) / n, r.reduce((s, q) => s + q[1], 0) / n];
  }
  // Undo the projection using the same constants.
  const lat0 = r.reduce((s, q) => s + q[1], 0) / r.length;
  const kx = R * Math.cos(rad(lat0)) * (Math.PI / 180);
  const ky = R * (Math.PI / 180);
  return [round(cx / (3 * a) / kx, 7), round(cy / (3 * a) / ky, 7)];
}

export function bbox(p: Polygon): BBox {
  const r = ring(p);
  const xs = r.map((q) => q[0]);
  const ys = r.map((q) => q[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Square box of `halfSizeM` metres around a point. */
export function boxAround([lng, lat]: LngLat, halfSizeM: number): BBox {
  const dLat = halfSizeM / ((R * Math.PI) / 180);
  const dLng = halfSizeM / ((R * Math.cos(rad(lat)) * Math.PI) / 180);
  return [round(lng - dLng, 7), round(lat - dLat, 7), round(lng + dLng, 7), round(lat + dLat, 7)];
}

export function bboxPolygon([a, b, c, d]: BBox): Polygon {
  return polygonFrom([
    [a, b],
    [c, b],
    [c, d],
    [a, d],
  ]);
}

/** Pad a bbox to at least `minSideM` metres per side and by `factor` around its centre. */
export function padBBox(bb: BBox, factor: number, minSideM: number): BBox {
  const c: LngLat = [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2];
  const w = distanceM([bb[0], c[1]], [bb[2], c[1]]);
  const h = distanceM([c[0], bb[1]], [c[0], bb[3]]);
  const half = Math.max((Math.max(w, h) * factor) / 2, minSideM / 2);
  return boxAround(c, half);
}

function segmentsIntersect(p1: LngLat, p2: LngLat, p3: LngLat, p4: LngLat): boolean {
  const d = (a: LngLat, b: LngLat, c: LngLat) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export interface PolygonCheck {
  ok: boolean;
  problems: string[];
  areaHa: number;
}

/** Validate an agent-drawn farm boundary. */
export function validateFarmPolygon(p: Polygon, limits = { minHa: 0.05, maxHa: 50 }): PolygonCheck {
  const problems: string[] = [];
  const r = ring(p);
  if (p.type !== "Polygon" || !Array.isArray(p.coordinates)) problems.push("Not a GeoJSON Polygon.");
  if (r.length < 3) problems.push("A farm boundary needs at least 3 corners.");
  for (const [lng, lat] of r) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      problems.push("Boundary has an invalid coordinate.");
      break;
    }
  }
  // Nigeria's bounding box (with a small margin) — the service covers Nigeria.
  if (r.some(([lng, lat]) => lng < 2.4 || lng > 14.9 || lat < 3.9 || lat > 14.1)) {
    problems.push("Boundary is outside Nigeria.");
  }
  if (r.length >= 4) {
    outer: for (let i = 0; i < r.length; i++) {
      for (let j = i + 1; j < r.length; j++) {
        if (Math.abs(i - j) <= 1 || (i === 0 && j === r.length - 1)) continue;
        if (segmentsIntersect(r[i], r[(i + 1) % r.length], r[j], r[(j + 1) % r.length])) {
          problems.push("Boundary lines cross each other.");
          break outer;
        }
      }
    }
  }
  const ha = r.length >= 3 ? areaHa(p) : 0;
  if (r.length >= 3 && ha < limits.minHa) problems.push(`Farm is too small (${round(ha, 2)} ha; minimum ${limits.minHa} ha).`);
  if (ha > limits.maxHa) problems.push(`Farm is too large (${round(ha, 1)} ha; maximum ${limits.maxHa} ha).`);
  return { ok: problems.length === 0, problems, areaHa: round(ha, 3) };
}

/** Stable key for a polygon (coordinates rounded to ~1 cm). */
export function polygonKey(p: Polygon): string {
  return hash(JSON.stringify(ring(p).map(([x, y]) => [round(x, 7), round(y, 7)])));
}

export function pointInPolygon([x, y]: LngLat, p: Polygon): boolean {
  const r = ring(p);
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i];
    const [xj, yj] = r[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
