import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { date, time } from "../../lib/format";
import type { EventRow } from "../../lib/types";
import { Empty, Loading } from "../../components/chrome";
import { PageHead } from "./Layout";

const ENTITIES = ["", "application", "loan", "farmer", "farm", "system"];

export function Activity() {
  const [entity, setEntity] = useState("");
  const { data, isLoading } = useQuery({ queryKey: ["events", entity], queryFn: () => api<EventRow[]>(`/events?limit=300${entity ? `&entity=${entity}` : ""}`), refetchInterval: 10_000 });
  return (
    <div>
      <PageHead label="Activity · audit log" title="Everything that happened, and who did it.">
        {ENTITIES.map((e) => (
          <button key={e} className={`btn small ${entity === e ? "" : "ghost"}`} onClick={() => setEntity(e)}>
            {e || "all"}
          </button>
        ))}
      </PageHead>
      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <Empty>No activity.</Empty>
      ) : (
        <div className="scroll-x">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>What</th>
                <th>Event</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {data.map((e) => (
                <tr key={e.id}>
                  <td className="label faint" style={{ whiteSpace: "nowrap" }}>
                    {date(e.createdAt)} {time(e.createdAt!)}
                  </td>
                  <td>{e.message}</td>
                  <td className="mono" style={{ fontSize: 11 }}>
                    {e.entity}.{e.type.toLowerCase()}
                  </td>
                  <td style={{ fontSize: 13 }}>{e.actor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
