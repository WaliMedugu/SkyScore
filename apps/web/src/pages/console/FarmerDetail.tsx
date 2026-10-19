import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";
import { api, errorText, post } from "../../lib/api";
import { date, ha, naira, time } from "../../lib/format";
import type { Application, Farm, Farmer, Loan, Sms } from "../../lib/types";
import { Loading, Modal, Pill, useToast } from "../../components/chrome";
import { MapView } from "../../components/MapView";
import { PageHead } from "./Layout";

type Detail = Farmer & {
  account: { account_no: string; balance: number } | null;
  farms: Farm[];
  applications: Application[];
  loans: Loan[];
  sms: Sms[];
  ussdPinSet: boolean;
};

export function FarmerDetail() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: f } = useQuery({ queryKey: ["farmer", id], queryFn: () => api<Detail>(`/farmers/${id}`) });
  const [modal, setModal] = useState<"bvn" | "pin" | "deposit" | null>(null);
  const [value, setValue] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  if (!f) return <Loading />;

  const submit = async () => {
    setBusy(true);
    try {
      if (modal === "bvn") {
        const r = await post<{ verified: boolean; message: string }>(`/farmers/${f.id}/verify-bvn`, value ? { bvn: value } : {});
        toast(r.message, !r.verified);
      } else if (modal === "pin") {
        await post(`/farmers/${f.id}/ussd-pin`, { pin: value });
        toast("USSD PIN set.");
      } else if (modal === "deposit") {
        await post("/sandbox/deposit", { farmerId: f.id, amount: Number(value), memo: memo || undefined });
        toast(`${naira(Number(value))} credited to the farmer's account.`);
      }
      setModal(null);
      setValue("");
      setMemo("");
      await qc.invalidateQueries();
    } catch (e) {
      toast(errorText(e), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHead label={`Farmer · joined ${date(f.createdAt)}`} title={f.name}>
        <Pill status={f.bvnVerified ? "VERIFIED" : "PENDING"} label={f.bvnVerified ? `BVN ${f.bvnMasked}` : "BVN not verified"} />
        <button className="btn ghost" onClick={() => setModal("bvn")}>
          Verify BVN
        </button>
        <button className="btn ghost" onClick={() => setModal("pin")}>
          {f.ussdPinSet ? "Reset" : "Set"} USSD PIN
        </button>
        <button className="btn ghost" onClick={() => setModal("deposit")}>
          Credit account (sandbox)
        </button>
        <button className="btn lime" onClick={() => nav(`/console/farmers/new?farmer=${f.id}`)}>
          Map a field <span className="arrow">→</span>
        </button>
      </PageHead>

      <section className="ruled cols-4">
        <div className="kpi block">
          <span className="v num">{f.account ? naira(f.account.balance) : "—"}</span>
          <span className="label k">Ecobank account {f.account?.account_no ?? "opens with the first loan"}</span>
        </div>
        <div className="kpi">
          <span className="v num">{f.farms.length}</span>
          <span className="label k">Fields · {ha(f.farms.reduce((a, x) => a + x.areaHa, 0))}</span>
        </div>
        <div className="kpi accent">
          <span className="v num">{f.priorOnTimeLoans}</span>
          <span className="label k">Loans repaid on time — each one raises the next limit</span>
        </div>
        <div className="kpi fogbg">
          <span className="v" style={{ fontSize: 28, letterSpacing: "-0.02em" }}>
            {f.phone}
          </span>
          <span className="label k">
            {f.gender ?? ""} {f.age ? `· ${f.age} years` : ""} · {f.language.toUpperCase()} · {f.hub ?? "no hub"} {f.cooperative ? `· ${f.cooperative}` : ""}
          </span>
        </div>
      </section>

      <section className="ruled" style={{ gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)" }}>
        <div style={{ position: "relative", minHeight: 380 }}>
          <MapView shapes={f.farms.map((x) => ({ id: x.id, polygon: x.polygon, status: x.loan?.state === "REPAID" ? "REPAID" : (x.loan?.health ?? x.application?.status ?? "MAPPED"), tooltip: x.name }))} />
        </div>
        <div className="stack">
          {f.farms.map((x) => (
            <div key={x.id} className="pad stack gap-8" style={{ borderBottom: "1px solid var(--rule)" }}>
              <div className="row between">
                <span style={{ fontWeight: 500 }}>{x.name}</span>
                <span className="label faint">
                  {x.cropLabel} · {ha(x.areaHa)}
                </span>
              </div>
              <span className="muted" style={{ fontSize: 13 }}>
                {x.place} · {x.tenure ?? "tenure not given"} · mapped by {x.mapMethod ?? "map"}
              </span>
              <div className="row gap-8 wrap">
                {x.application && (
                  <Link to={`/console/applications/${x.application.id}`}>
                    <Pill status={x.application.status} label={`${x.application.seasonYear}: ${x.application.status.toLowerCase()}${x.application.score !== null ? ` · ${x.application.score}` : ""}`} />
                  </Link>
                )}
                {x.loan && (
                  <Link to={`/console/loans/${x.loan.id}`}>
                    <Pill status={x.loan.state === "REPAID" ? "REPAID" : x.loan.health} label={`loan ${x.loan.state.replace(/_/g, " ").toLowerCase()}`} />
                  </Link>
                )}
                {!x.application && (
                  <button
                    className="btn small"
                    onClick={async () => {
                      try {
                        const r = await post<{ applicationId: string }>("/applications", { farmId: x.id });
                        nav(`/console/applications/${r.applicationId}`);
                      } catch (e) {
                        toast(errorText(e), true);
                      }
                    }}
                  >
                    Apply for inputs <span className="arrow">→</span>
                  </button>
                )}
              </div>
            </div>
          ))}
          {!f.farms.length && <p className="pad muted">No fields mapped yet.</p>}
        </div>
      </section>

      <section className="ruled cols-2">
        <div className="stack">
          <div className="pad" style={{ borderBottom: "1px solid var(--rule)" }}>
            <span className="label sq">Loans</span>
          </div>
          {f.loans.map((l) => (
            <Link key={l.id} to={`/console/loans/${l.id}`} className="pad row between gap-12" style={{ borderBottom: "1px solid var(--rule)" }}>
              <span>
                {l.seasonYear} · {l.cropLabel} · {naira(l.principal)}
              </span>
              <span className="row gap-8">
                <Pill status={l.state} />
                <span>→</span>
              </span>
            </Link>
          ))}
          {!f.loans.length && <p className="pad muted">No loans yet.</p>}
        </div>
        <div className="stack">
          <div className="pad" style={{ borderBottom: "1px solid var(--rule)" }}>
            <span className="label sq">Messages sent to {f.firstName}</span>
          </div>
          <div className="pad stack gap-8" style={{ maxHeight: 420, overflowY: "auto" }}>
            {f.sms.map((m) => (
              <div key={m.id} className="bubble">
                {m.body}
                <div className="label faint" style={{ marginTop: 6 }}>
                  {m.kind} · {date(m.created_at)} {time(m.created_at)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {modal && (
        <Modal title={modal === "bvn" ? "Verify BVN" : modal === "pin" ? "USSD PIN" : "Credit account (sandbox)"} onClose={() => setModal(null)}>
          <form
            className="stack gap-16"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            {modal === "bvn" && <p className="muted">The farmer approves the check on their phone (NIBSS iGree in production). Leave empty to re-check the BVN on file.</p>}
            {modal === "pin" && <p className="muted">The farmer types a 4-digit PIN on the agent's phone. It protects USSD repayments.</p>}
            {modal === "deposit" && <p className="muted">Simulates money arriving in the farmer's account, e.g. from a harvest sale, so repayments can be shown.</p>}
            <input
              className="input big"
              inputMode="numeric"
              type={modal === "pin" ? "password" : "text"}
              maxLength={modal === "bvn" ? 11 : modal === "pin" ? 4 : 9}
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
              placeholder={modal === "bvn" ? "11-digit BVN" : modal === "pin" ? "••••" : "Amount in naira"}
              aria-label="Value"
            />
            {modal === "deposit" && <input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Memo, e.g. Maize sale at Samaru market" />}
            <button className="btn lime" disabled={busy || (modal === "pin" && value.length !== 4) || (modal === "deposit" && !Number(value))}>
              Confirm <span className="arrow">→</span>
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
