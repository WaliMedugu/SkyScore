// USSD simulator: the same callback Africa's Talking would hit, on a phone the presenter can tap.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { Farmer, Meta } from "../../lib/types";
import { PageHead } from "./Layout";

export function Ussd() {
  const qc = useQueryClient();
  const { data: meta } = useQuery({ queryKey: ["meta"], queryFn: () => api<Meta>("/meta") });
  const { data: farmers } = useQuery({ queryKey: ["farmers", ""], queryFn: () => api<{ items: (Farmer & { latestLoan: { state: string } | null })[] }>("/farmers?limit=200") });
  const [phone, setPhone] = useState("");
  const [screen, setScreen] = useState("");
  const [path, setPath] = useState<string[] | null>(null);
  const [input, setInput] = useState("");
  const [session] = useState(() => `sim-${Math.random().toString(36).slice(2, 10)}`);
  const withLoans = (farmers?.items ?? []).filter((f) => f.latestLoan && f.latestLoan.state !== "REPAID");

  const send = async (parts: string[]) => {
    const res = await fetch("/api/v1/ussd", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ sessionId: session, serviceCode: meta?.ussdCode ?? "*326*77#", phoneNumber: phone, text: parts.join("*") }),
    });
    const text = await res.text();
    setScreen(text.replace(/^(CON|END) /, ""));
    setPath(text.startsWith("CON") ? parts : null);
    setInput("");
    if (text.startsWith("END")) void qc.invalidateQueries();
  };

  const key = (k: string) => setInput((v) => (v + k).slice(0, 12));

  return (
    <div>
      <PageHead label="USSD" title={`Dial ${meta?.ussdCode ?? "*326*77#"} on any phone.`} />
      <section className="ruled cols-2">
        <div className="pad-lg stack gap-16">
          <span className="label sq">Pick a farmer's phone</span>
          <p className="muted">Farmers check their loan, repay with a 4-digit PIN, see their farm's health from space and fetch their vouchers — no smartphone or data needed. Seeded farmers' PIN is in apps/api/src/seed/users.ts.</p>
          <select className="select" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Farmer phone">
            <option value="">Choose a farmer…</option>
            {withLoans.map((f) => (
              <option key={f.id} value={f.phone}>
                {f.name} · {f.phone}
              </option>
            ))}
          </select>
          <button className="btn lime" disabled={!phone} onClick={() => send([])}>
            Dial {meta?.ussdCode ?? "*326*77#"} <span className="arrow">→</span>
          </button>
          <p className="faint" style={{ fontSize: 13 }}>
            The console calls <span className="mono">POST /api/v1/ussd</span> exactly as Africa's Talking would; point an AT USSD channel at it to go live.
          </p>
        </div>
        <div className="pad-lg" style={{ display: "grid", placeItems: "center", background: "var(--bg-2)" }}>
          <div className="phone">
            <div className="row between label" style={{ color: "#9fb3bb", marginBottom: 10, fontSize: 10 }}>
              <span>MTN NG</span>
              <span>{phone || "no SIM"}</span>
            </div>
            <div className="screen">
              {screen || (phone ? "Press Dial to start." : "Choose a farmer to load their SIM.")}
              {path && (
                <div style={{ marginTop: 12, borderTop: "1px solid #b9c4c8", paddingTop: 8 }}>
                  &gt; {input}
                  <span className="blink">_</span>
                </div>
              )}
            </div>
            <div className="keypad">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((k) => (
                <button key={k} onClick={() => key(k)} disabled={!path}>
                  {k}
                </button>
              ))}
            </div>
            <div className="row gap-8" style={{ marginTop: 12 }}>
              <button className="btn small ghost grow" style={{ color: "#fff" }} onClick={() => setInput((v) => v.slice(0, -1))} disabled={!path}>
                Del
              </button>
              <button className="btn small lime grow" onClick={() => path && send([...path, input])} disabled={!path || !input}>
                Send
              </button>
              <button
                className="btn small ghost grow"
                style={{ color: "#fff" }}
                onClick={() => {
                  setPath(null);
                  setScreen("");
                }}
              >
                End
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
