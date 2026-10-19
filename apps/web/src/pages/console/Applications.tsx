import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api } from "../../lib/api";
import { ago, ha, naira } from "../../lib/format";
import type { Application } from "../../lib/types";
import { Empty, Loading, Pill } from "../../components/chrome";
import { PageHead } from "./Layout";

const TABS = [
  { k: "", label: "All" },
  { k: "REVIEW", label: "Needs review" },
  { k: "APPROVED", label: "Awaiting consent" },
  { k: "ACCEPTED", label: "Became loans" },
  { k: "DECLINED", label: "Declined" },
  { k: "ANALYZING", label: "Reading satellites" },
];

export function Applications() {
  const nav = useNavigate();
  const [status, setStatus] = useState("");
  const [season, setSeason] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["applications", status, season],
    queryFn: () => api<Application[]>(`/applications?${new URLSearchParams({ ...(status ? { status } : {}), ...(season ? { season } : {}) })}`),
    refetchInterval: 10_000,
  });

  return (
    <div>
      <PageHead label="Applications" title="Every field, scored from space.">
        <select className="select" style={{ width: "auto" }} value={season} onChange={(e) => setSeason(e.target.value)} aria-label="Season">
          <option value="">All seasons</option>
          <option value="2025">2025 season</option>
          <option value="2024">2024 season</option>
        </select>
        <button className="btn lime" onClick={() => nav("/console/farmers/new")}>
          New application <span className="arrow">→</span>
        </button>
      </PageHead>
      <div className="row wrap" style={{ borderBottom: "1px solid var(--rule)" }}>
        {TABS.map((t) => (
          <button
            key={t.k}
            onClick={() => setStatus(t.k)}
            className="label"
            style={{ border: 0, borderRight: "1px solid var(--rule)", padding: "14px 18px", cursor: "pointer", background: status === t.k ? "var(--block)" : "var(--bg)", color: status === t.k ? "var(--on-block)" : "inherit" }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <Empty>No applications here.</Empty>
      ) : (
        <div className="scroll-x">
          <table className="table">
            <thead>
              <tr>
                <th>Farmer</th>
                <th>Field</th>
                <th>Season</th>
                <th className="r">SkyScore</th>
                <th>Status</th>
                <th className="r">Offer</th>
                <th>Applied</th>
              </tr>
            </thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.id} className="click" onClick={() => nav(`/console/applications/${a.id}`)}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{a.farmer?.name}</div>
                    <div className="label faint">{a.farmer?.hub ?? "No hub"}</div>
                  </td>
                  <td>
                    {a.farm?.cropLabel} · {ha(a.farm?.areaHa)}
                    <div className="label faint">{a.farm?.place}</div>
                  </td>
                  <td className="mono">{a.seasonYear}</td>
                  <td className="r">
                    <span className="mono num" style={{ fontSize: 18 }}>
                      {a.score ?? "—"}
                    </span>
                    {a.band && <span className="label faint"> {a.band}</span>}
                  </td>
                  <td>
                    <div className="row gap-8 wrap">
                      <Pill status={a.status} />
                      {a.ghost && <Pill status="GHOST" label="ghost farm" />}
                    </div>
                  </td>
                  <td className="r num">{a.offer?.eligible ? naira(a.offer.principal) : "—"}</td>
                  <td className="label faint">{ago(a.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
