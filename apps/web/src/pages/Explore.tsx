// Public field explorer: draw any field (or pick a real one) and watch eight years of satellite evidence stream in.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import type { Polygon } from "@skyscore/engine";
import { api } from "../lib/api";
import { ha, naira, pct, words } from "../lib/format";
import { useAnalysisJob } from "../lib/stream";
import type { Meta, ShowcaseField } from "../lib/types";
import { Pill, TopBar, useToast } from "../components/chrome";
import { MapView, type MapShape } from "../components/MapView";
import { FactorBars, HistoryChart, ScoreDial, SeasonChips, Timelapse } from "../components/science";
import { useSession } from "../lib/session";

const STAGES: Record<string, string> = {
  search: "Searching the archive",
  optical: "Reading photos",
  radar: "Reading radar",
  neighbours: "Comparing neighbours",
  landcover: "Land-cover maps",
  rainfall: "Rainfall records",
  done: "Done",
};

export function Explore() {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const { user } = useSession();
  const { data: fields = [] } = useQuery({ queryKey: ["showcase"], queryFn: () => api<ShowcaseField[]>("/showcase") });
  const { data: meta } = useQuery({ queryKey: ["meta"], queryFn: () => api<Meta>("/meta") });
  const { state, start, reset } = useAnalysisJob();
  const [drawing, setDrawing] = useState(false);
  const [polygon, setPolygon] = useState<Polygon | null>(null);
  const [fieldKey, setFieldKey] = useState<string | null>(null);
  const [crop, setCrop] = useState<string>("");

  const picked = fields.find((f) => f.key === fieldKey) ?? null;
  // The stream ends with the scored analysis and an offer for every crop, so switching crops needs no request.
  const result = state.result;
  const offer = result ? (result.offers?.[crop] ?? result.offer) : null;

  const run = (p: Polygon, key: string | null) => {
    setPolygon(p);
    setFieldKey(key);
    setDrawing(false);
    const fieldCrop = key ? (fields.find((f) => f.key === key)?.crop ?? "maize") : "maize";
    setCrop(fieldCrop);
    void start(p, { crop: fieldCrop });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // ?field=showcase-zaria starts that field straight away.
  const wanted = params.get("field");
  useEffect(() => {
    if (!wanted || !fields.length || state.status !== "idle") return;
    const f = fields.find((x) => x.key === wanted);
    if (f) run(f.polygon, f.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, fields.length]);

  useEffect(() => {
    if (state.status === "error" && state.error) toast(state.error, true);
  }, [state.status, state.error, toast]);

  const shapes: MapShape[] = useMemo(() => {
    const out: MapShape[] = [];
    if (polygon) out.push({ id: "current", polygon, outline: true, tooltip: picked ? picked.place : "Your field" });
    else
      for (const f of fields)
        out.push({
          id: f.key,
          polygon: f.polygon,
          status: f.ghost ? "GHOST" : f.decision === "APPROVE" ? "HEALTHY" : "WATCH",
          tooltip: `${f.place} · ${f.kind === "control" ? "not a farm" : f.cropLabel} · score ${f.score}`,
        });
    return out;
  }, [polygon, fields, picked]);

  const running = state.status === "starting" || state.status === "running";
  const p = state.progress;
  const clearSoFar = state.observations.filter((o) => o.clear).length;
  const firstYear = 2018;

  const clearAll = () => {
    reset();
    setPolygon(null);
    setFieldKey(null);
    setParams({});
  };

  return (
    <div>
      <TopBar
        links={[
          { to: "/", label: "Home", end: true },
          { to: "/explore", label: "Explore" },
          { to: "/console", label: "Console" },
        ]}
        cta={{ to: user ? "/console" : "/login", label: user ? "Console" : "Sign in" }}
      />

      <section className="ruled" style={{ gridTemplateColumns: "minmax(0, 1.5fr) minmax(340px, 1fr)", minHeight: "min(72vh, 720px)" }}>
        <div style={{ position: "relative", minHeight: 420 }}>
          <MapView
            shapes={shapes}
            onSelect={(id) => {
              const f = fields.find((x) => x.key === id);
              if (f && !running) run(f.polygon, f.key);
            }}
            center={[10.2, 7.6]}
            zoom={7}
            drawing={drawing}
            onDraw={(poly) => run(poly, null)}
            onCancelDraw={() => setDrawing(false)}
          />
        </div>

        <aside className="stack" style={{ maxHeight: "min(72vh, 720px)", overflowY: "auto" }}>
          {state.status === "idle" && !drawing && (
            <>
              <div className="pad-lg stack gap-16" style={{ borderBottom: "1px solid var(--rule)" }}>
                <span className="label sq">Field explorer</span>
                <h1 className="display d-md">Is this a farm? Ask the satellites.</h1>
                <p className="muted">Draw any field in Nigeria, or pick a real one below. SkyScore reads every photo of it since 2018 and scores it the way the bank would.</p>
                <button className="btn lime" onClick={() => setDrawing(true)}>
                  Draw a field on the map <span className="arrow">→</span>
                </button>
              </div>
              {fields.map((f) => (
                <button key={f.key} onClick={() => run(f.polygon, f.key)} className="row between gap-12 pad" style={{ border: 0, borderBottom: "1px solid var(--rule)", background: "var(--bg)", textAlign: "left", cursor: "pointer" }}>
                  <div className="stack gap-4">
                    <span style={{ fontWeight: 500 }}>{f.place}</span>
                    <span className="label faint">
                      {f.kind === "control" ? "Not a farm" : f.cropLabel} · {ha(f.areaHa)} · {f.photosFound} photos
                    </span>
                  </div>
                  <span className="row gap-12">
                    <Pill status={f.ghost ? "GHOST_DECLINED" : f.decision} label={f.ghost ? "ghost" : f.decision === "APPROVE" ? `band ${f.band}` : words(f.decision)} />
                    <span>→</span>
                  </span>
                </button>
              ))}
            </>
          )}

          {drawing && (
            <div className="pad-lg stack gap-16">
              <span className="label sq">Draw your field</span>
              <h2 className="display d-md">Zoom in on farmland, then tap each corner.</h2>
              <p className="muted">Fields between 0.05 and 50 hectares, anywhere in Nigeria. Saved demo fields replay instantly; new fields are read live from the Planetary Computer (about a minute).</p>
              <button className="btn ghost" onClick={() => setDrawing(false)}>
                Back to real fields
              </button>
            </div>
          )}

          {(running || state.status === "done" || state.status === "error") && (
            <div className="stack">
              <div className="pad-lg stack gap-12" style={{ borderBottom: "1px solid var(--rule)" }}>
                <span className="label sq">{picked ? `${picked.place}, ${picked.state}` : "Your field"}</span>
                <div className="row gap-16" style={{ alignItems: "baseline" }}>
                  <span className="display d-lg num">{state.observations.length}</span>
                  <span className="label muted">
                    photos read
                    <br />
                    {clearSoFar} clear enough to use
                  </span>
                </div>
                {running && (
                  <>
                    <div className="loading-bar" />
                    <span className="label">
                      {STAGES[p?.stage ?? "search"] ?? p?.stage} {p && p.total > 1 ? `· ${p.done}/${p.total}` : ""}
                    </span>
                    <ul className="stack gap-4" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                      {state.messages.slice(-4).map((m, i) => (
                        <li key={i} className="mono faint" style={{ fontSize: 12 }}>
                          › {m}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {state.status === "error" && <p className="err">{state.error}</p>}
              </div>
              {result?.ready && (
                <div className="pad-lg stack gap-16" style={{ borderBottom: "1px solid var(--rule)", alignItems: "center" }}>
                  <ScoreDial score={result.score.score} band={result.score.band} decision={result.score.decision} ghost={result.score.ghost} />
                  <p className="center lead" style={{ maxWidth: 360 }}>
                    {result.score.headline}
                  </p>
                </div>
              )}
              <div className="pad row gap-8 wrap">
                <button className="btn ghost small" onClick={clearAll}>
                  Try another field
                </button>
                {result?.ready && user && (user.role === "agent" || user.role === "officer" || user.role === "admin") && (
                  <Link className="btn small" to={`/console/farmers/new${fieldKey ? `?field=${fieldKey}` : ""}`}>
                    Register this farm <span className="arrow">→</span>
                  </Link>
                )}
              </div>
            </div>
          )}
        </aside>
      </section>

      {(running || state.status === "done") && (
        <section className="ruled">
          <div className="pad-lg stack gap-16">
            <div className="row between wrap gap-12">
              <span className="label sq">Eight years of greenness · each dot is one satellite photo</span>
              <span className="label faint">● clear · ○ cloudy · shaded = rainy season (lime: farmed, amber: unclear)</span>
            </div>
            <HistoryChart
              optical={result?.ready ? result.series.optical : state.observations}
              seasons={result?.ready ? result.seasons : state.seasons}
              radar={result?.ready ? result.series.radar : undefined}
              from={`${firstYear}-01-01`}
              to={new Date().toISOString().slice(0, 10)}
              height={260}
            />
            <SeasonChips seasons={result?.ready ? result.seasons : state.seasons} live={running} />
          </div>
        </section>
      )}

      {result?.ready && (
        <>
          <section className="ruled cols-3">
            <div className="pad-lg stack gap-16">
              <span className="label sq">Why this score</span>
              <FactorBars factors={result.score.factors} />
            </div>
            <div className="pad-lg stack gap-16">
              <span className="label sq">Strengths</span>
              <ul className="bullets">
                {result.score.strengths.map((s) => (
                  <li key={s} style={{ textTransform: "none", fontFamily: "var(--sans)", fontSize: 14, letterSpacing: 0 }}>
                    {s}
                  </li>
                ))}
              </ul>
              <span className="label sq" style={{ marginTop: 16 }}>
                Concerns
              </span>
              {result.score.concerns.length ? (
                <ul className="stack gap-8" style={{ paddingLeft: 18, margin: 0 }}>
                  {result.score.concerns.map((s) => (
                    <li key={s} style={{ fontSize: 14 }}>
                      {s}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">None.</p>
              )}
              <p className="faint" style={{ fontSize: 12, marginTop: "auto" }}>
                Scored for a typical applicant (BVN verified, trained, cooperative member, first loan). Confidence: {words(result.score.confidence)}.
              </p>
            </div>
            <div className="pad-lg stack gap-16">
              <div className="row between">
                <span className="label sq">The offer</span>
                <select className="select" style={{ width: "auto", padding: "6px 8px" }} value={crop} onChange={(e) => setCrop(e.target.value)} aria-label="Crop">
                  {(meta?.crops ?? []).map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              {offer?.eligible ? (
                <>
                  <div className="row between" style={{ alignItems: "baseline" }}>
                    <span className="display d-md num">{naira(offer.principal)}</span>
                    <span className="label faint">in inputs</span>
                  </div>
                  <table className="table">
                    <tbody>
                      {offer.items.map((i) => (
                        <tr key={i.key}>
                          <td>
                            {i.qty} × {i.name}
                            <div className="label faint">
                              {i.unit} · tranche {i.tranche}
                            </div>
                          </td>
                          <td className="r num">{naira(i.amount)}</td>
                        </tr>
                      ))}
                      <tr>
                        <td className="muted">Interest + insurance</td>
                        <td className="r num">{naira(offer.interest + offer.insurance)}</td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: 600 }}>Repay after harvest</td>
                        <td className="r num" style={{ fontWeight: 600 }}>
                          {naira(offer.totalRepayable)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <p className="muted" style={{ fontSize: 13 }}>
                    {ha(offer.financedHa)} financed · expected harvest {naira(offer.expectedRevenue)} · repayment is {pct(offer.repaymentToRevenue)} of it.
                  </p>
                </>
              ) : (
                <p className="muted">{offer?.reason ?? "No offer for this field."}</p>
              )}
            </div>
          </section>

          <section className="ruled">
            <div className="pad-lg stack gap-16">
              <span className="label sq">The field from space, dry season and rainy season each year</span>
              <Timelapse frames={result.frames} snap={result.snapshotKey} columns={6} />
            </div>
          </section>

          <section className="ruled cols-3">
            <div className="pad-lg stack gap-12">
              <span className="label sq">Land cover</span>
              {Object.entries(result.landCover.worldCoverClasses)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([k, v]) => (
                  <div key={k} className="row between">
                    <span>{k}</span>
                    <span className="mono num">{pct(v)}</span>
                  </div>
                ))}
              <span className="label faint">ESA WorldCover 2021</span>
            </div>
            <div className="pad-lg stack gap-12">
              <span className="label sq">Against the neighbours</span>
              {result.neighbours.slice(-5).map((n) => (
                <div key={n.season} className="row between gap-12">
                  <span className="mono">{n.season}</span>
                  <span style={{ fontSize: 14 }}>
                    greener than <b className="num">{pct(n.percentile)}</b> of the land around it
                  </span>
                </div>
              ))}
              {!result.neighbours.length && <p className="muted">No clear peak-season photo to compare.</p>}
            </div>
            <div className="pad-lg stack gap-12">
              <span className="label sq">Sources</span>
              <ul className="stack gap-4" style={{ paddingLeft: 16, margin: 0 }}>
                {result.sources.map((s) => (
                  <li key={s} className="muted" style={{ fontSize: 13 }}>
                    {s}
                  </li>
                ))}
              </ul>
              <span className="label faint">
                {result.photosFound} photos on record · {result.clearPhotos} clear · {result.radarPasses} radar passes · {result.source === "snapshot" ? "saved snapshot" : "read live"}
              </span>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
