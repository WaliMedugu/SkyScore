import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router";
import { api } from "../../lib/api";
import { ago, ha } from "../../lib/format";
import type { Farmer } from "../../lib/types";
import { Empty, Loading, Pill } from "../../components/chrome";
import { PageHead } from "./Layout";

type Row = Farmer & { farms: number; hectares: number; latestLoan: { id: string; state: string; health: string } | null };

export function Farmers() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const query = params.get("q") ?? "";
  const { data, isLoading } = useQuery({ queryKey: ["farmers", query], queryFn: () => api<{ total: number; items: Row[] }>(`/farmers?limit=200&q=${encodeURIComponent(query)}`) });

  return (
    <div>
      <PageHead label="Farmers" title="Young farmers on the book.">
        <form
          className="row gap-8"
          onSubmit={(e) => {
            e.preventDefault();
            setParams(q ? { q } : {});
          }}
        >
          <input className="input" style={{ width: 260 }} placeholder="Name, phone or hub" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search farmers" />
          <button className="btn ghost">Search</button>
        </form>
        <button className="btn lime" onClick={() => nav("/console/farmers/new")}>
          Register farmer <span className="arrow">→</span>
        </button>
      </PageHead>
      {isLoading ? (
        <Loading />
      ) : !data?.items.length ? (
        <Empty>No farmers found.</Empty>
      ) : (
        <div className="scroll-x">
          <table className="table">
            <thead>
              <tr>
                <th>Farmer</th>
                <th>Phone</th>
                <th>Hub</th>
                <th>KYC</th>
                <th className="r">Fields</th>
                <th>Latest loan</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((f) => (
                <tr key={f.id} className="click" onClick={() => nav(`/console/farmers/${f.id}`)}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{f.name}</div>
                    <div className="label faint">
                      {f.gender ?? ""} {f.age ? `· ${f.age}` : ""}
                    </div>
                  </td>
                  <td className="mono" style={{ fontSize: 13 }}>
                    {f.phone}
                  </td>
                  <td style={{ fontSize: 13 }}>{f.hub ?? <span className="faint">—</span>}</td>
                  <td>
                    <Pill status={f.bvnVerified ? "VERIFIED" : "PENDING"} label={f.bvnVerified ? "BVN ok" : "BVN missing"} />
                  </td>
                  <td className="r num">
                    {f.farms} · {ha(f.hectares)}
                  </td>
                  <td>{f.latestLoan ? <Pill status={f.latestLoan.state === "REPAID" ? "REPAID" : f.latestLoan.health} label={`${f.latestLoan.state.replace(/_/g, " ").toLowerCase()}`} /> : <span className="faint">—</span>}</td>
                  <td className="label faint">{ago(f.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="pad label faint">{data.total} farmers</p>
        </div>
      )}
    </div>
  );
}
