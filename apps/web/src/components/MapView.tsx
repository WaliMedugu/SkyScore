// Satellite basemap with farm boundaries, coloured by status; optional draw-a-field mode.
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { areaHa, polygonFrom, validateFarmPolygon, type LngLat, type Polygon } from "@skyscore/engine";
import { STATUS_FILL } from "../lib/format";

export interface MapShape {
  id: string;
  polygon: Polygon;
  status?: string;
  tooltip?: string;
  /** Outline only (e.g. the field being analysed). */
  outline?: boolean;
  color?: string;
}

interface Props {
  shapes?: MapShape[];
  onSelect?: (id: string) => void;
  selected?: string | null;
  /** Fit the view to these shapes when they change (default true). */
  fit?: boolean;
  center?: [number, number];
  zoom?: number;
  drawing?: boolean;
  onDraw?: (p: Polygon) => void;
  onCancelDraw?: () => void;
  className?: string;
  /** Extra markers (dealers etc.). */
  points?: { id: string; lng: number; lat: number; label: string; color?: string }[];
}

const toLatLngs = (p: Polygon) => p.coordinates[0].map(([lng, lat]) => L.latLng(lat, lng));

export function MapView({ shapes = [], onSelect, selected, fit = true, center = [9.6, 7.6], zoom = 7, drawing = false, onDraw, onCancelDraw, className, points = [] }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const shapeLayer = useRef<L.LayerGroup | null>(null);
  const pointLayer = useRef<L.LayerGroup | null>(null);
  const drawLayer = useRef<L.LayerGroup | null>(null);
  const [verts, setVerts] = useState<LngLat[]>([]);
  const fittedKey = useRef("");
  const pendingFit = useRef<{ bounds: L.LatLngBounds; maxZoom: number } | null>(null);

  // Create the map once.
  useEffect(() => {
    if (!el.current || map.current) return;
    // Wheel-zoom only after the map is clicked, so scrolling the page never gets trapped by the map.
    const m = L.map(el.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false }).setView(center, zoom);
    m.on("click focus", () => m.scrollWheelZoom.enable());
    m.on("mouseout blur", () => m.scrollWheelZoom.disable());
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19,
      maxNativeZoom: 18,
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
    }).addTo(m);
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19,
      maxNativeZoom: 18,
      opacity: 0.85,
    }).addTo(m);
    shapeLayer.current = L.layerGroup().addTo(m);
    pointLayer.current = L.layerGroup().addTo(m);
    drawLayer.current = L.layerGroup().addTo(m);
    map.current = m;
    const ro = new ResizeObserver(() => {
      m.invalidateSize();
      // A fit requested while the map had no size (hidden tab, still laying out) is applied once it has one.
      const host = m.getContainer();
      if (pendingFit.current && host.clientWidth > 0 && host.clientHeight > 0) {
        const { bounds, maxZoom } = pendingFit.current;
        pendingFit.current = null;
        m.fitBounds(bounds, { padding: [40, 40], maxZoom });
      }
    });
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Farm shapes.
  useEffect(() => {
    const m = map.current;
    const g = shapeLayer.current;
    if (!m || !g) return;
    g.clearLayers();
    const all: L.LatLng[] = [];
    for (const s of shapes) {
      const ll = toLatLngs(s.polygon);
      all.push(...ll);
      const fill = s.color ?? STATUS_FILL[s.status ?? ""] ?? "#BED600";
      const isSel = selected === s.id;
      const poly = L.polygon(ll, {
        color: s.outline ? "#BED600" : isSel ? "#ffffff" : "#023448",
        weight: s.outline ? 3 : isSel ? 3 : 1.2,
        fillColor: fill,
        fillOpacity: s.outline ? 0.08 : 0.72,
        dashArray: s.outline ? "6 5" : undefined,
      });
      if (s.tooltip) poly.bindTooltip(s.tooltip, { className: "sk-tip", sticky: true, direction: "top" });
      if (onSelect) poly.on("click", () => onSelect(s.id));
      poly.addTo(g);
      // Small fields vanish at low zoom: add a dot at the centre too.
      if (!s.outline) {
        const c = poly.getBounds().getCenter();
        const dot = L.circleMarker(c, { radius: isSel ? 7 : 5, color: "#023448", weight: 1, fillColor: fill, fillOpacity: 1 });
        if (s.tooltip) dot.bindTooltip(s.tooltip, { className: "sk-tip", direction: "top" });
        if (onSelect) dot.on("click", () => onSelect(s.id));
        dot.addTo(g);
      }
    }
    const key = shapes.map((s) => s.id).join(",");
    if (fit && all.length && key !== fittedKey.current) {
      fittedKey.current = key;
      const bounds = L.latLngBounds(all);
      const maxZoom = shapes.length === 1 ? 16 : 15;
      const host = m.getContainer();
      if (host.clientWidth > 0 && host.clientHeight > 0) {
        pendingFit.current = null;
        m.invalidateSize();
        m.fitBounds(bounds, { padding: [40, 40], maxZoom });
      } else {
        pendingFit.current = { bounds, maxZoom };
      }
    }
  }, [shapes, selected, onSelect, fit]);

  // Other points (dealers).
  useEffect(() => {
    const g = pointLayer.current;
    if (!g) return;
    g.clearLayers();
    for (const p of points) {
      L.circleMarker([p.lat, p.lng], { radius: 6, color: "#fff", weight: 2, fillColor: p.color ?? "#0082BB", fillOpacity: 1 })
        .bindTooltip(p.label, { className: "sk-tip", direction: "top" })
        .addTo(g);
    }
  }, [points]);

  // Drawing: click corners, undo, finish.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!drawing) {
      setVerts([]);
      drawLayer.current?.clearLayers();
      m.getContainer().style.cursor = "";
      return;
    }
    m.getContainer().style.cursor = "crosshair";
    m.doubleClickZoom.disable();
    const click = (e: L.LeafletMouseEvent) => setVerts((v) => [...v, [Number(e.latlng.lng.toFixed(7)), Number(e.latlng.lat.toFixed(7))]]);
    m.on("click", click);
    return () => {
      m.off("click", click);
      m.doubleClickZoom.enable();
      m.getContainer().style.cursor = "";
    };
  }, [drawing]);

  useEffect(() => {
    const g = drawLayer.current;
    if (!g) return;
    g.clearLayers();
    if (!verts.length) return;
    const ll = verts.map(([lng, lat]) => L.latLng(lat, lng));
    if (ll.length >= 3) L.polygon(ll, { color: "#BED600", weight: 2.5, fillColor: "#BED600", fillOpacity: 0.25 }).addTo(g);
    else L.polyline(ll, { color: "#BED600", weight: 2.5 }).addTo(g);
    ll.forEach((p) => L.circleMarker(p, { radius: 5, color: "#023448", weight: 2, fillColor: "#BED600", fillOpacity: 1 }).addTo(g));
  }, [verts]);

  const draft = verts.length >= 3 ? polygonFrom(verts) : null;
  const check = draft ? validateFarmPolygon(draft) : null;

  return (
    <div className={`map ${className ?? ""}`}>
      <div ref={el} className="leaflet-host" style={{ position: "absolute", inset: 0 }} />
      {drawing && (
        <div className="map-overlay" style={{ left: 12, right: 12, bottom: 12, padding: 12 }}>
          <div className="row between gap-12 wrap">
            <div className="stack gap-4">
              <span className="label sq">Draw the field</span>
              <span className="muted" style={{ fontSize: 13 }}>
                {verts.length < 3
                  ? `Tap each corner of the field on the photo (${verts.length} so far).`
                  : check?.ok
                    ? `${areaHa(draft!).toFixed(2)} ha — looks good.`
                    : (check?.problems[0] ?? "")}
              </span>
            </div>
            <div className="row gap-8">
              <button className="btn ghost small" onClick={() => setVerts((v) => v.slice(0, -1))} disabled={!verts.length}>
                Undo
              </button>
              <button
                className="btn ghost small"
                onClick={() => {
                  setVerts([]);
                  onCancelDraw?.();
                }}
              >
                Cancel
              </button>
              <button className="btn lime small" disabled={!check?.ok} onClick={() => draft && onDraw?.(draft)}>
                Use this field <span className="arrow">→</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
