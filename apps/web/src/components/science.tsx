// The satellite story: score dial, factor bars, season chips, greenness charts and time-lapse.
import { useEffect, useMemo, useRef, useState } from "react";
import { scaleLinear, scaleTime } from "d3-scale";
import { area, curveMonotoneX, line } from "d3-shape";
import { frameUrl } from "../lib/api";
import { BAND_COLOR, dateShort, monthYear } from "../lib/format";
import type { Frame, OpticalPoint, RadarPoint, ScoreResult, SeasonChart as SeasonChartData, SeasonResult } from "../lib/types";

function useWidth<T extends HTMLElement>(initial = 800) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const T = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`);

/* ── Score ─────────────────────────────────────────────────────────────── */

export function ScoreDial({ score, band, decision, ghost }: { score: number; band: string; decision: string; ghost?: boolean }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 900);
      setShown(Math.round(score * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [score]);
  const r = 46;
  const c = 2 * Math.PI * r;
  const color = ghost ? "var(--ghost)" : (BAND_COLOR[band] ?? "var(--lime)");
  return (
    <div className="dial">
      <svg viewBox="0 0 100 100" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--rule)" strokeWidth="5" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="5" strokeDasharray={`${(c * shown) / 100} ${c}`} strokeLinecap="butt" />
      </svg>
      <div className="center">
        <span className="label faint">SkyScore</span>
        <span className="score num">{shown}</span>
        <span className="label" style={{ marginTop: 8 }}>
          {ghost ? "Ghost farm" : `Band ${band} · ${decision}`}
        </span>
      </div>
    </div>
  );
}

export function FactorBars({ factors }: { factors: ScoreResult["factors"] }) {
  return (
    <div className="stack">
      {factors.map((f) => (
        <div key={f.key} style={{ padding: "12px 0", borderBottom: "1px solid var(--rule)" }}>
          <div className="row between gap-12">
            <span style={{ fontWeight: 500 }}>{f.label}</span>
            <span className="mono num" style={{ fontSize: 13 }}>
              {f.points.toFixed(f.points % 1 ? 1 : 0)}
              <span className="faint">/{f.max}</span>
            </span>
          </div>
          <div style={{ height: 6, background: "var(--bg-2)", margin: "8px 0 6px" }}>
            <div style={{ height: "100%", width: `${(f.points / f.max) * 100}%`, background: f.points / f.max >= 0.6 ? "var(--lime)" : f.points / f.max >= 0.35 ? "var(--watch)" : "var(--stress)", transition: "width .8s ease" }} />
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            {f.detail}
          </p>
        </div>
      ))}
    </div>
  );
}

const LABEL_TEXT: Record<string, string> = { CULTIVATED: "Farmed", UNCERTAIN: "Unclear", NOT_CULTIVATED: "Not farmed", NO_DATA: "No data" };

export function SeasonChips({ seasons, live }: { seasons: Pick<SeasonResult, "year" | "label" | "peak" | "complete">[]; live?: boolean }) {
  if (!seasons.length) return null;
  return (
    <div className="chips" role="list" aria-label="Season by season">
      {seasons.map((s) => (
        <div key={s.year} className={`chip ${s.label} ${s.complete ? "" : "open"}`} role="listitem" title={`${s.year}: ${LABEL_TEXT[s.label]}${s.peak !== null ? `, peak NDVI ${s.peak.toFixed(2)}` : ""}`}>
          <span className="yr">
            {s.year}
            {!s.complete && <span className="faint">{live ? "" : " *"}</span>}
          </span>
          <span className="bar" />
          <span className="t">{LABEL_TEXT[s.label]}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Multi-year greenness ──────────────────────────────────────────────── */

export function HistoryChart({
  optical,
  seasons,
  radar,
  height = 240,
  from,
  to,
}: {
  optical: OpticalPoint[];
  seasons?: Pick<SeasonResult, "year" | "label">[];
  radar?: RadarPoint[];
  height?: number;
  from?: string;
  to?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const m = { t: 14, r: 12, b: 26, l: 34 };
  const sorted = useMemo(() => [...optical].sort((a, b) => a.date.localeCompare(b.date)), [optical]);
  const start = from ?? sorted[0]?.date ?? "2018-01-01";
  const end = to ?? sorted.at(-1)?.date ?? new Date().toISOString().slice(0, 10);
  const x = scaleTime().domain([T(start), T(end)]).range([m.l, width - m.r]);
  const y = scaleLinear().domain([-0.1, 0.95]).range([height - m.b, m.t]);
  const clear = sorted.filter((o) => o.clear);
  const path = line<OpticalPoint>()
    .x((d) => x(T(d.date)))
    .y((d) => y(d.ndvi))
    .curve(curveMonotoneX)(clear);
  const years: number[] = [];
  for (let yr = T(start).getUTCFullYear(); yr <= T(end).getUTCFullYear(); yr++) years.push(yr);
  const seasonOf = new Map((seasons ?? []).map((s) => [s.year, s.label]));
  const rv = radar?.length ? scaleLinear().domain([0, 1.2]).range([height - m.b, m.t]) : null;
  const radarPath = rv && radar ? line<RadarPoint>().x((d) => x(T(d.date))).y((d) => rv(d.rvi)).curve(curveMonotoneX)([...radar].sort((a, b) => a.date.localeCompare(b.date))) : null;

  return (
    <div ref={ref} style={{ width: "100%" }}>
      <svg className="chart" width={width} height={height} role="img" aria-label="Greenness (NDVI) of the field over the years">
        {years.map((yr) => {
          const a = Math.max(x(T(`${yr}-06-01`)), m.l);
          const b = Math.min(x(T(`${yr}-10-31`)), width - m.r);
          const lab = seasonOf.get(yr);
          if (b <= a) return null;
          return (
            <g key={yr}>
              <rect x={a} y={m.t} width={b - a} height={height - m.t - m.b} fill={lab === "CULTIVATED" ? "var(--lime)" : lab === "UNCERTAIN" ? "var(--watch)" : "var(--bg-2)"} opacity={lab === "CULTIVATED" ? 0.22 : lab === "UNCERTAIN" ? 0.14 : 0.6} />
              <text x={x(T(`${yr}-07-01`))} y={height - 8} textAnchor="middle">
                {yr}
              </text>
            </g>
          );
        })}
        <g className="grid">
          {[0, 0.25, 0.5, 0.75].map((v) => (
            <g key={v}>
              <line x1={m.l} x2={width - m.r} y1={y(v)} y2={y(v)} strokeDasharray="2 4" />
              <text x={m.l - 6} y={y(v) + 3} textAnchor="end">
                {v.toFixed(2)}
              </text>
            </g>
          ))}
        </g>
        {radarPath && <path d={radarPath} fill="none" stroke="var(--sky)" strokeWidth="1" opacity="0.55" />}
        {path && <path d={path} fill="none" stroke="var(--fg)" strokeWidth="1.4" />}
        {sorted.map((o) =>
          o.clear ? (
            <circle key={o.sceneId} cx={x(T(o.date))} cy={y(o.ndvi)} r={2.6} fill="var(--fg)" className="pt" />
          ) : (
            <circle key={o.sceneId} cx={x(T(o.date))} cy={y(Math.max(-0.1, o.ndvi))} r={1.7} fill="none" stroke="var(--fg-3)" strokeWidth="0.8" opacity="0.6" />
          ),
        )}
        <text x={m.l} y={m.t - 4}>
          NDVI
        </text>
      </svg>
    </div>
  );
}

/* ── One loan's season ─────────────────────────────────────────────────── */

export function SeasonChart({ data, height = 280, stressDrop = 0.15 }: { data: SeasonChartData; height?: number; stressDrop?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const m = { t: 18, r: 44, b: 28, l: 36 };
  const x = scaleTime().domain([T(data.from), T(data.to)]).range([m.l, width - m.r]);
  const y = scaleLinear().domain([-0.05, 0.9]).range([height - m.b, m.t]);
  const vh = scaleLinear().domain([-26, -8]).range([height - m.b, m.t]);
  const exp = data.expected.filter((e) => e.date <= data.to);
  const band = area<{ date: string; ndvi: number }>()
    .x((d) => x(T(d.date)))
    .y0((d) => y(Math.max(-0.05, d.ndvi - stressDrop)))
    .y1((d) => y(d.ndvi))
    .curve(curveMonotoneX)(exp);
  const expLine = line<{ date: string; ndvi: number }>()
    .x((d) => x(T(d.date)))
    .y((d) => y(d.ndvi))
    .curve(curveMonotoneX)(exp);
  const radar = data.radar.filter((r) => r.vhDb !== undefined).sort((a, b) => a.date.localeCompare(b.date));
  const radarLine = line<RadarPoint>()
    .x((d) => x(T(d.date)))
    .y((d) => vh(d.vhDb!))
    .curve(curveMonotoneX)(radar);
  const months: Date[] = [];
  for (let d = new Date(T(data.from)); d <= T(data.to); d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) months.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
  const today = x(T(data.upTo));
  const marker = (d: string, label: string, color = "var(--fg-2)", row = 0) =>
    d >= data.from && d <= data.to ? (
      <g>
        <line x1={x(T(d))} x2={x(T(d))} y1={m.t} y2={height - m.b} stroke={color} strokeDasharray="3 3" />
        <text x={x(T(d)) + 4} y={m.t + 8 + row * 13} style={{ fill: color }}>
          {label}
        </text>
      </g>
    ) : null;

  return (
    <div ref={ref} style={{ width: "100%" }}>
      <svg className="chart" width={width} height={height} role="img" aria-label="This season's greenness against a healthy crop">
        <rect x={x(T(data.greenupWindow[0]))} y={m.t} width={Math.max(0, x(T(data.greenupWindow[1])) - x(T(data.greenupWindow[0])))} height={height - m.t - m.b} fill="var(--lime)" opacity="0.12" />
        {months.map((d) => (
          <text key={d.toISOString()} x={x(d)} y={height - 8}>
            {d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })}
          </text>
        ))}
        <g className="grid">
          {[0, 0.2, 0.4, 0.6, 0.8].map((v) => (
            <g key={v}>
              <line x1={m.l} x2={width - m.r} y1={y(v)} y2={y(v)} strokeDasharray="2 4" />
              <text x={m.l - 6} y={y(v) + 3} textAnchor="end">
                {v.toFixed(1)}
              </text>
            </g>
          ))}
          {[-24, -18, -12].map((v) => (
            <text key={v} x={width - m.r + 6} y={vh(v) + 3} style={{ fill: "var(--sky)" }}>
              {v}dB
            </text>
          ))}
        </g>
        {band && <path d={band} fill="var(--lime)" opacity="0.28" />}
        {expLine && <path d={expLine} fill="none" stroke="#7d8c00" strokeWidth="1.2" strokeDasharray="5 4" />}
        {radarLine && <path d={radarLine} fill="none" stroke="var(--sky)" strokeWidth="1.3" opacity="0.85" />}
        {radar.map((r) => (
          <rect key={r.date} x={x(T(r.date)) - 1.8} y={vh(r.vhDb!) - 1.8} width={3.6} height={3.6} fill="var(--sky)" />
        ))}
        {data.observed.map((o) =>
          o.clear ? (
            <circle key={o.sceneId} cx={x(T(o.date))} cy={y(o.ndvi)} r={3.4} fill="var(--fg)" />
          ) : (
            <circle key={o.sceneId} cx={x(T(o.date))} cy={y(Math.max(-0.05, o.ndvi))} r={2.4} fill="var(--bg)" stroke="var(--fg-3)" strokeWidth="1" />
          ),
        )}
        {marker(data.plantingDate, "agreed planting")}
        {data.plantedAround && marker(data.plantedAround, "planted (seen from space)", "#7d8c00", 1)}
        {today >= m.l && today <= width - m.r && (
          <g>
            <line x1={today} x2={today} y1={m.t - 6} y2={height - m.b} stroke="var(--stress)" strokeWidth="1.5" />
            <text x={today - 4} y={m.t - 8} textAnchor="end" style={{ fill: "var(--stress)", fontWeight: 600 }}>
              {dateShort(data.upTo).toUpperCase()}
            </text>
          </g>
        )}
      </svg>
      <div className="row gap-16 wrap label faint" style={{ padding: "6px 0 0 36px" }}>
        <span>● clear photo</span>
        <span>○ cloudy photo</span>
        <span style={{ color: "#7d8c00" }}>- - healthy crop</span>
        <span style={{ color: "var(--sky)" }}>■ radar VH (sees through cloud)</span>
        <span>green-up window shaded</span>
      </div>
    </div>
  );
}

/* ── Time-lapse ────────────────────────────────────────────────────────── */

export function Timelapse({ frames, snap, columns = 6 }: { frames: Frame[]; snap?: string | null; columns?: number }) {
  const [kind, setKind] = useState<"rgb" | "ndvi">("rgb");
  const [i, setI] = useState(frames.length - 1);
  const [playing, setPlaying] = useState(false);
  useEffect(() => setI(frames.length - 1), [frames.length]);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setI((x) => (x + 1) % frames.length), 900);
    return () => clearInterval(t);
  }, [playing, frames.length]);
  if (!frames.length) return <div className="empty">No clear photos yet.</div>;
  const cur = frames[Math.min(i, frames.length - 1)];
  return (
    <div className="ruled cols-2" style={{ border: "1px solid var(--rule)" }}>
      <div style={{ position: "relative", aspectRatio: "1", alignSelf: "start", width: "100%" }}>
        <img className="frame-img" src={frameUrl(cur, kind, snap, 512)} alt={`Satellite photo of the field, ${cur.date}`} style={{ position: "absolute", inset: 0, height: "100%" }} />
        <div className="row between" style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: 10, background: "linear-gradient(transparent, rgba(2,27,38,.75))", color: "#fff" }}>
          <span className="label">{monthYear(cur.date)}</span>
          <span className="label">{cur.date.slice(5, 7) >= "07" && cur.date.slice(5, 7) <= "11" ? "rainy season" : "dry season"}</span>
        </div>
      </div>
      <div className="stack">
        <div className="row gap-8 pad" style={{ borderBottom: "1px solid var(--rule)", flexWrap: "wrap" }}>
          <button className={`btn small ${kind === "rgb" ? "" : "ghost"}`} onClick={() => setKind("rgb")}>
            True colour
          </button>
          <button className={`btn small ${kind === "ndvi" ? "" : "ghost"}`} onClick={() => setKind("ndvi")}>
            Greenness
          </button>
          <button className="btn small lime" onClick={() => setPlaying((p) => !p)}>
            {playing ? "Pause" : "Play"} <span className="arrow">{playing ? "❚❚" : "▶"}</span>
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: 1, background: "var(--rule)", overflowY: "auto", maxHeight: 420 }}>
          {frames.map((f, k) => (
            <button
              key={f.sceneId}
              onClick={() => {
                setPlaying(false);
                setI(k);
              }}
              style={{ border: 0, padding: 0, background: "var(--bg)", cursor: "pointer", outline: k === i ? "2px solid var(--lime)" : "none", outlineOffset: -2, position: "relative" }}
              aria-label={`Show ${f.date}`}
            >
              <img src={frameUrl(f, kind, snap, 128)} alt="" loading="lazy" style={{ width: "100%", aspectRatio: 1, objectFit: "cover" }} />
              <span className="label" style={{ position: "absolute", left: 4, bottom: 3, color: "#fff", fontSize: 9, textShadow: "0 0 3px #000" }}>
                {f.date.slice(2, 7).replace("-", "/")}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
