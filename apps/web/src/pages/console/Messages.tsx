import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { date, time } from "../../lib/format";
import type { Sms } from "../../lib/types";
import { Empty, Loading, Pill } from "../../components/chrome";
import { PageHead } from "./Layout";

export function Messages() {
  const [phone, setPhone] = useState("");
  const { data, isLoading } = useQuery({ queryKey: ["sms", phone], queryFn: () => api<Sms[]>(`/sms?limit=300${phone ? `&phone=${phone}` : ""}`), refetchInterval: 5_000 });
  return (
    <div>
      <PageHead label="SMS outbox · sandbox" title="Every message a farmer receives.">
        <input className="input" style={{ width: 220 }} placeholder="Filter by phone" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} aria-label="Filter by phone" />
      </PageHead>
      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <Empty>No messages.</Empty>
      ) : (
        <div className="pad-lg stack gap-12" style={{ maxWidth: 820 }}>
          {data.map((m) => (
            <div key={m.id} className="row gap-16" style={{ alignItems: "flex-start" }}>
              <div className="stack gap-4" style={{ width: 150, flex: "none" }}>
                <span className="mono" style={{ fontSize: 13 }}>
                  {m.to_phone}
                </span>
                <span className="label faint">
                  {date(m.created_at)} {time(m.created_at)}
                </span>
              </div>
              <div className="bubble grow">
                {m.body}
                <div style={{ marginTop: 6 }}>
                  <Pill status={m.kind === "ALERT" ? "STRESS" : m.kind === "OTP" ? "WATCH" : "HEALTHY"} label={m.kind} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
