// The officer's command view: loan book from space, with a season replay driven by real satellite data.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { addDays } from "@skyscore/engine";
import { api, errorText, post } from "../../lib/api";
import { ago, date, ha, naira, nairaShort, STATUS_FILL, words } from "../../lib/format";
import { useSession } from "../../lib/session";
import type { Alert, Dealer, EventRow, MapFeature } from "../../lib/types";
import { Pill, useToast } from "../../components/chrome";
import { MapView, type MapShape } from "../../components/MapView";
import { PageHead, useSummary } from "./Layout";

const LEGEND = ["HEALTHY", "WATCH", "STRESS", "FLOOD", "NO_DATA", "REPAID", "REVIEW", "APPROVED", "GHOST", "DECLINED"];

/** Weekly dates from before planting to harvest — the replay stops before any repayment falls due. */
function seasonWeeks(season: number) {
  const out: string[] = [];
  for (let d = `${season}-05-01`; d <= `${season}-10-31`; d = addDays(d, 7)) out.push(d);
  return out;
}

function Replay({ current, season }: { current: string; season: number }) {
  const { user } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const weeks = useMemo(() => seasonWeeks(season), [season]);
  const nearest = weeks.reduce((best, d, i) => (Math.abs(Date.parse(d) - Date.parse(current)) < Math.abs(Date.parse(weeks[best]) - Date.parse(current)) ? i : best), 0);
  const [idx, setIdx] = useState(nearest);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const can = user?.role === "officer" || user?.role === "admin";
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => setIdx(nearest), [nearest]);

  const go = async (i: number, quiet = false) => {
    setBusy(true);
    try {
      const r = await post<{ checked: number; defaulted: number }>("/demo/replay", { date: weeks[i] });
      await qc.invalidateQueries();
      if (!quiet) toast(`Season replayed to ${date(weeks[i])}: ${r.checked} loans checked from space.`);
    } catch (e) {
      toast(errorText(e), true);
      setPlaying(false);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!playing) return;
    let cancelled = false;
    const step = async (i: number) => {
      if (cancelled || i >= weeks.length) {
        setPlaying(false);
        return;
      }
      setIdx(i);
      await go(i, true);
      timer.current = window.setTimeout(() => step(i + 1), 700);
    };
    void step(idx + 1 < weeks.length ? idx + 1 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  return (
    <div className="stack gap-8" style={{ minWidth: "min(520px, 100%)" }}>
      <div className="row between gap-12 wrap">
        <span className="label">Season replay · real satellite data</span>
        <span className="label num" style={{ padding: "2px 6px", background: "var(--lime)", color: "var(--navy)" }}>
          {date(weeks[idx])}
        </span>
      </div>
      <div className="row gap-12">
        <button className="btn small lime" disabled={!can || (busy && !playing)} onClick={() => setPlaying((p) => !p)} title={can ? "" : "Officers can replay the season"}>
          {playing ? "Pause" : "Play"} <span className="arrow">{playing ? "❚❚" : "▶"}</span>
        </button>
        <input
          type="range"
          min={0}
          max={weeks.length - 1}
          value={idx}
          disabled={!can || playing}
          onChange={(e) => setIdx(Number(e.target.value))}
          onPointerUp={() => void go(idx)}
          onKeyUp={(e) => (e.key.startsWith("Arrow") ? void go(idx) : undefined)}
          style={{ flex: 1, accentColor: "var(--navy)" }}
          aria-label="Season date"
        />
      </div>
      <div className="row between label faint">
        <span>May · planting</span>
        <span>Jul · green-up</span>
        <span>Oct · harvest</span>
      </div>
    </div>
  );
}

export function Overview() {
  const nav = useNavigate();
  const { data: s } = useSummary();
  const { data: map } = useQuery({ queryKey: ["map"], queryFn: () => api<{ features: MapFeature[] }>("/portfolio/map"), refetchInterval: 20_000 });
  const { data: dealers = [] } = useQuery({ queryKey: ["dealers"], queryFn: () => api<Dealer[]>("/dealers") });
  const { data: alerts = [] } = useQuery({ queryKey: ["alerts", "OPEN"], queryFn: () => api<Alert[]>("/alerts?status=OPEN"), refetchInterval: 20_000 });
  const { data: events = [] } = useQuery({ queryKey: ["events", "recent"], queryFn: () => api<EventRow[]>("/events?limit=14"), refetchInterval: 20_000 });
  const [sel, setSel] = useState<string | null>(null);

  const features = map?.features ?? [];
  const shapes: MapShape[] = features.map((f) => ({
    id: f.properties.farmId,
    polygon: f.geometry,
    status: f.properties.status,
    tooltip: `${f.properties.farmer ?? "—"} · ${f.properties.cropLabel} · ${f.properties.status.replace(/_/g, " ").toLowerCase()}`,
  }));
  const selected = features.find((f) => f.properties.farmId === sel)?.properties;
  const counts = features.reduce<Record<string, number>>((a, f) => ((a[f.properties.status] = (a[f.properties.status] ?? 0) + 1), a), {});

  return (
    <div>
      <PageHead label="Portfolio" title="The loan book, from space.">
        {s && <Replay current={s.demoClock} season={s.season} />}
      </PageHead>

      <section className="ruled cols-4">
        <div className="kpi block">
          <span className="v num">{s?.loans.active ?? "—"}</span>
          <span className="label k">
            Active loans · {s?.health.HEALTHY ?? 0} healthy · {(s?.health.STRESS ?? 0) + (s?.health.FLOOD ?? 0)} need attention
          </span>
        </div>
        <div className="kpi">
          <span className="v num">{nairaShort(s?.money.disbursed)}</span>
          <span className="label k">
            Inputs disbursed · {nairaShort(s?.money.outstanding)} outstanding · {nairaShort(s?.money.repaid)} repaid
          </span>
        </div>
        <div className="kpi accent">
          <span className="v num">{s?.repaymentRate !== null && s?.repaymentRate !== undefined ? `${Math.round(s.repaymentRate)}%` : "—"}</span>
          <span className="label k">Repaid on time ({s?.loans.byState.REPAID ?? 0} closed loans)</span>
        </div>
        <div className="kpi fogbg">
          <span className="v num">{s?.ghostFarmsBlocked ?? "—"}</span>
          <span className="label k">Ghost farms blocked · {ha(s?.ghostHectaresBlocked)} of non-farmland refused</span>
        </div>
      </section>

      <section className="ruled" style={{ gridTemplateColumns: "minmax(0, 1.7fr) minmax(300px, 1fr)" }}>
        <div style={{ position: "relative", height: "min(64vh, 620px)", minHeight: 380 }}>
          <MapView shapes={shapes} selected={sel} onSelect={setSel} points={dealers.filter((d) => d.lat && d.lng).map((d) => ({ id: d.id, lat: d.lat!, lng: d.lng!, label: `${d.name} (agro-dealer)` }))} />
        </div>
        <div className="stack">
          {selected ? (
            <div className="pad-lg stack gap-12" style={{ borderBottom: "1px solid var(--rule)" }}>
              <div className="row between">
                <span className="label sq">{selected.place}</span>
                <button className="btn ghost small" onClick={() => setSel(null)}>
                  Close
                </button>
              </div>
              <h2 className="d-sm">{selected.farmer}</h2>
              <p className="muted">
                {selected.cropLabel} · {ha(selected.areaHa)} · SkyScore {selected.score ?? "—"} {selected.band ? `(band ${selected.band})` : ""}
              </p>
              <div className="row gap-8 wrap">
                <Pill status={selected.status} />
                {selected.loanState && <Pill status={selected.loanState} />}
              </div>
              <div className="row gap-8 wrap" style={{ marginTop: 8 }}>
                {selected.loanId && (
                  <button className="btn small" onClick={() => nav(`/console/loans/${selected.loanId}`)}>
                    Open loan <span className="arrow">→</span>
                  </button>
                )}
                <button className="btn ghost small" onClick={() => nav(`/console/farmers?q=${encodeURIComponent(selected.farmer ?? "")}`)}>
                  Farmer
                </button>
              </div>
            </div>
          ) : (
            <div className="pad-lg stack gap-12" style={{ borderBottom: "1px solid var(--rule)" }}>
              <span className="label sq">Map key</span>
              {LEGEND.filter((k) => counts[k]).map((k) => (
                <div key={k} className="row between">
                  <span className="row gap-8">
                    <i style={{ width: 12, height: 12, background: STATUS_FILL[k], border: "1px solid var(--navy)", display: "inline-block" }} />
                    {words(k)}
                  </span>
                  <span className="mono num">{counts[k]}</span>
                </div>
              ))}
              <p className="faint" style={{ fontSize: 12 }}>
                {s ? `${s.farms} farms · ${s.hectares} ha · ${s.dealers} agro-dealers (blue dots)` : ""}. Click a field for details.
              </p>
            </div>
          )}
          <div className="stack" style={{ overflowY: "auto", flex: 1 }}>
            <div className="row between pad" style={{ borderBottom: "1px solid var(--rule)" }}>
              <span className="label sq">Open alerts</span>
              <Link to="/console/alerts" className="label">
                All →
              </Link>
            </div>
            {alerts.slice(0, 6).map((a) => (
              <button key={a.id} onClick={() => a.loanId && nav(`/console/loans/${a.loanId}`)} className="stack gap-4 pad" style={{ border: 0, borderBottom: "1px solid var(--rule)", background: "var(--bg)", textAlign: "left", cursor: "pointer" }}>
                <span className="row between gap-8">
                  <span style={{ fontWeight: 500 }}>{a.title}</span>
                  <Pill status={a.type} />
                </span>
                <span className="muted" style={{ fontSize: 13 }}>
                  {a.farmerName} · {a.farmName}
                </span>
              </button>
            ))}
            {!alerts.length && <p className="pad muted">No open alerts. Every active crop looks fine from space.</p>}
          </div>
        </div>
      </section>

      <section className="ruled cols-2">
        <div className="pad-lg stack gap-12">
          <span className="label sq">Book by status</span>
          {s &&
            Object.entries(s.applications.byStatus).map(([k, v]) => (
              <div key={k} className="row between" style={{ borderBottom: "1px solid var(--rule)", paddingBottom: 8 }}>
                <Pill status={k} />
                <span className="mono num">{v} applications</span>
              </div>
            ))}
          {s && (
            <p className="muted" style={{ fontSize: 13 }}>
              Average SkyScore {s.averageScore ?? "—"} · approved {naira(s.money.approved)} · insurance paid {naira(s.money.insurancePaid)}
            </p>
          )}
        </div>
        <div className="stack">
          <div className="row between pad" style={{ borderBottom: "1px solid var(--rule)" }}>
            <span className="label sq">Activity</span>
            <Link to="/console/activity" className="label">
              All →
            </Link>
          </div>
          {events.map((e) => (
            <div key={e.id} className="row gap-12 pad" style={{ borderBottom: "1px solid var(--rule)", alignItems: "flex-start" }}>
              <span className="label faint" style={{ width: 90, flex: "none" }}>
                {ago(e.createdAt)}
              </span>
              <span style={{ fontSize: 14 }}>{e.message}</span>
            </div>
          ))}
          {!events.length && <p className="pad muted">Nothing yet.</p>}
        </div>
      </section>
    </div>
  );
}
