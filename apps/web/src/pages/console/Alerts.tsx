import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api, errorText, post } from "../../lib/api";
import { date } from "../../lib/format";
import type { Alert } from "../../lib/types";
import { Empty, Loading, Pill, useToast } from "../../components/chrome";
import { PageHead } from "./Layout";

export function Alerts() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState("OPEN");
  const { data, isLoading } = useQuery({ queryKey: ["alerts", status], queryFn: () => api<Alert[]>(`/alerts${status ? `?status=${status}` : ""}`), refetchInterval: 15_000 });

  const ack = async (id: string) => {
    try {
      await post(`/alerts/${id}/ack`, {});
      toast("Alert acknowledged.");
      await qc.invalidateQueries();
    } catch (e) {
      toast(errorText(e), true);
    }
  };

  return (
    <div>
      <PageHead label="Alerts" title="What the satellites flagged.">
        {["OPEN", "ACKNOWLEDGED", "RESOLVED", ""].map((s) => (
          <button key={s} className={`btn small ${status === s ? "" : "ghost"}`} onClick={() => setStatus(s)}>
            {s ? s.toLowerCase() : "all"}
          </button>
        ))}
      </PageHead>
      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <Empty>{status === "OPEN" ? "No open alerts. Every active crop looks fine from space." : "Nothing here."}</Empty>
      ) : (
        <div className="scroll-x">
          <table className="table">
            <thead>
              <tr>
                <th>Raised</th>
                <th>Alert</th>
                <th>Farmer · field</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.id}>
                  <td className="label faint">{date(a.createdAt)}</td>
                  <td style={{ maxWidth: 520 }}>
                    <div className="row gap-8">
                      <Pill status={a.type} />
                      <span style={{ fontWeight: 500 }}>{a.title}</span>
                    </div>
                    <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                      {a.detail}
                    </div>
                  </td>
                  <td>
                    {a.farmerName}
                    <div className="label faint">{a.farmName}</div>
                  </td>
                  <td>
                    <Pill status={a.status === "OPEN" ? a.severity : a.status} label={a.status.toLowerCase()} />
                  </td>
                  <td className="r">
                    <div className="row gap-8" style={{ justifyContent: "flex-end" }}>
                      {a.status === "OPEN" && (
                        <button className="btn small ghost" onClick={() => ack(a.id)}>
                          Acknowledge
                        </button>
                      )}
                      {a.loanId && (
                        <button className="btn small" onClick={() => nav(`/console/loans/${a.loanId}`)}>
                          Loan <span className="arrow">→</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
