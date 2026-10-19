import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api } from "../../lib/api";
import { date, naira } from "../../lib/format";
import type { Loan } from "../../lib/types";
import { Empty, Loading, Pill } from "../../components/chrome";
import { PageHead } from "./Layout";

const HEALTH = ["", "HEALTHY", "WATCH", "STRESS", "FLOOD", "NO_DATA"];
const STATES = ["", "ACTIVE", "T2_RELEASED", "T2_HELD", "REPAID", "DEFAULTED"];

export function Loans() {
  const nav = useNavigate();
  const [health, setHealth] = useState("");
  const [state, setState] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["loans", health, state],
    queryFn: () => api<Loan[]>(`/loans?${new URLSearchParams({ ...(health ? { health } : {}), ...(state ? { state } : {}) })}`),
    refetchInterval: 15_000,
  });
  const total = (data ?? []).reduce((a, l) => a + l.outstanding, 0);

  return (
    <div>
      <PageHead label="Loans" title="Inputs out, crops watched.">
        <select className="select" style={{ width: "auto" }} value={state} onChange={(e) => setState(e.target.value)} aria-label="Loan state">
          {STATES.map((s) => (
            <option key={s} value={s}>
              {s ? s.replace(/_/g, " ").toLowerCase() : "Any state"}
            </option>
          ))}
        </select>
        <select className="select" style={{ width: "auto" }} value={health} onChange={(e) => setHealth(e.target.value)} aria-label="Crop health">
          {HEALTH.map((s) => (
            <option key={s} value={s}>
              {s ? s.replace(/_/g, " ").toLowerCase() : "Any health"}
            </option>
          ))}
        </select>
      </PageHead>
      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <Empty>No loans match.</Empty>
      ) : (
        <div className="scroll-x">
          <table className="table">
            <thead>
              <tr>
                <th>Farmer</th>
                <th>Crop</th>
                <th>Crop from space</th>
                <th>State</th>
                <th className="r">Principal</th>
                <th className="r">Owed</th>
                <th>Due</th>
              </tr>
            </thead>
            <tbody>
              {data.map((l) => (
                <tr key={l.id} className="click" onClick={() => nav(`/console/loans/${l.id}`)}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{l.farmer?.name}</div>
                    <div className="label faint">{l.farm?.place}</div>
                  </td>
                  <td>
                    {l.cropLabel}
                    <div className="label faint">{l.seasonYear} season</div>
                  </td>
                  <td style={{ maxWidth: 320 }}>
                    <Pill status={l.state === "REPAID" ? "REPAID" : l.health} />
                    {l.monitor && l.state !== "REPAID" && (
                      <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>
                        {l.monitor.summary}
                      </div>
                    )}
                  </td>
                  <td>
                    <Pill status={l.state} />
                  </td>
                  <td className="r num">{naira(l.principal)}</td>
                  <td className="r num">{naira(l.outstanding)}</td>
                  <td className="mono" style={{ fontSize: 13 }}>
                    {date(l.dueDate)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} className="label">
                  {data.length} loans
                </td>
                <td className="r num" style={{ fontWeight: 600 }}>
                  {naira(total)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
