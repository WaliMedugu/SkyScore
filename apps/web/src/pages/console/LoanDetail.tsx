// One loan through its season: what the satellites see, the vouchers, the money, the alerts.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { api, errorText, post } from "../../lib/api";
import { date, dateShort, naira, words } from "../../lib/format";
import type { Loan, Policy } from "../../lib/types";
import { Loading, Modal, Pill, useToast } from "../../components/chrome";
import { Qr } from "../../components/Qr";
import { SeasonChart, Timelapse } from "../../components/science";
import { PageHead } from "./Layout";

const KIND: Record<string, string> = {
  VOUCHER_REDEEMED: "Inputs handed over",
  DEALER_PAID: "Dealer paid",
  FEES_CHARGED: "Interest and insurance",
  REPAYMENT: "Repayment",
  INSURANCE_CLAIM: "Insurance claim",
};

export function LoanDetail() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: l } = useQuery({ queryKey: ["loan", id], queryFn: () => api<Loan>(`/loans/${id}`) });
  const { data: policy } = useQuery({ queryKey: ["policy"], queryFn: () => api<Policy>("/policy") });
  const [busy, setBusy] = useState(false);
  const [repayOpen, setRepayOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [channel, setChannel] = useState("AGENT");

  if (!l) return <Loading />;
  const m = l.monitor;
  const open = !["REPAID", "DECLINED", "EXPIRED"].includes(l.state);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast(ok);
      await qc.invalidateQueries();
    } catch (e) {
      toast(errorText(e), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHead label={`Loan · ${l.cropLabel} · ${l.seasonYear} season`} title={l.farmer?.name ?? "Loan"}>
        <Pill status={l.state} />
        {l.state !== "REPAID" && <Pill status={l.health} />}
        {open && (
          <>
            <button className="btn lime" disabled={busy} onClick={() => run(() => post(`/loans/${l.id}/monitor`, {}), "Checked from space with the latest photos.")}>
              Check from space now <span className="arrow">→</span>
            </button>
            <button className="btn ghost" disabled={busy} onClick={() => setRepayOpen(true)}>
              Record repayment
            </button>
          </>
        )}
      </PageHead>

      <section className="ruled cols-4">
        <div className="kpi block span-2" style={{ minHeight: 0, gap: 16 }}>
          <span className="label">From space · {m ? date(m.asOf) : "not checked yet"}</span>
          <p className="d-sm">{m?.summary ?? "The crop hasn't been checked yet."}</p>
          {m && (
            <div className="row gap-24 wrap label" style={{ opacity: 0.85 }}>
              <span>Stage: {words(m.stage)}</span>
              <span>Green-up: {words(m.greenUp)}</span>
              <span>Week {Math.max(0, Math.round(m.weeksSincePlanting))}</span>
              {m.latestNdvi !== null && (
                <span>
                  Last clear photo {dateShort(m.latestDate)}: NDVI {m.latestNdvi.toFixed(2)}
                </span>
              )}
              {m.radarRise !== null && <span>Radar {m.radarRise >= 0 ? "+" : ""}{m.radarRise.toFixed(1)} dB since the dry season</span>}
            </div>
          )}
          {m?.evidence && <span className="muted" style={{ fontSize: 13 }}>Evidence: {m.evidence}</span>}
        </div>
        <div className="kpi">
          <span className="v num">{naira(l.outstanding)}</span>
          <span className="label k">
            Owed of {naira(l.total)} · repaid {naira(l.repaid)}
            {l.insurancePaid ? ` · insurance ${naira(l.insurancePaid)}` : ""}
          </span>
        </div>
        <div className="kpi accent">
          <span className="v num">{naira(l.disbursed)}</span>
          <span className="label k">
            Inputs handed over of {naira(l.principal)} · due {date(l.dueDate)}
          </span>
        </div>
      </section>

      {l.season && (
        <section className="ruled">
          <div className="pad-lg stack gap-12">
            <div className="row between wrap gap-12">
              <span className="label sq">This season, photo by photo</span>
              <span className="label faint">
                Agreed planting {date(l.plantingDate)}
                {l.season.plantedAround ? ` · seen planted around ${date(l.season.plantedAround)}` : ""}
              </span>
            </div>
            <SeasonChart data={l.season} stressDrop={policy?.monitor.stressDrop ?? 0.15} />
          </div>
        </section>
      )}

      {l.season && l.season.frames.length > 0 && (
        <section className="ruled">
          <div className="pad-lg stack gap-12">
            <span className="label sq">The season from space, up to {date(l.season.upTo)}</span>
            <Timelapse frames={l.season.frames} snap={l.season.snapshotKey} columns={5} />
          </div>
        </section>
      )}

      <section className="ruled cols-2">
        {l.vouchers.map((v) => (
          <div key={v.code} className="pad-lg row gap-24" style={{ alignItems: "flex-start" }}>
            <div style={{ opacity: v.status === "ISSUED" ? 1 : 0.35, flex: "none" }}>
              <Qr value={v.code} size={136} />
            </div>
            <div className="stack gap-8 grow">
              <div className="row between gap-8">
                <span className="label sq">Tranche {v.tranche}</span>
                <Pill status={v.status} label={v.status === "HELD" ? "held until green-up" : undefined} />
              </div>
              <span className="mono" style={{ fontSize: 20, letterSpacing: "0.06em" }}>
                {v.code}
              </span>
              <span className="d-sm num">{naira(v.amount)}</span>
              <ul className="stack gap-4" style={{ paddingLeft: 16, margin: 0, fontSize: 14 }}>
                {v.items.map((i) => (
                  <li key={i.name}>
                    {i.qty} × {i.name} <span className="faint">({i.unit})</span>
                  </li>
                ))}
              </ul>
              <span className="label faint">
                {v.status === "REDEEMED" ? `Redeemed at ${v.dealerName} · ${date(v.redeemedAt)}` : v.expiresAt ? `Valid until ${date(v.expiresAt)}` : "Released when the crop greens up"}
              </span>
            </div>
          </div>
        ))}
      </section>

      <section className="ruled" style={{ gridTemplateColumns: "minmax(0,1.5fr) minmax(0,1fr)" }}>
        <div className="stack">
          <div className="pad" style={{ borderBottom: "1px solid var(--rule)" }}>
            <span className="label sq">Ledger · every entry balances</span>
          </div>
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Entry</th>
                  <th>Account</th>
                  <th className="r">Debit</th>
                  <th className="r">Credit</th>
                </tr>
              </thead>
              <tbody>
                {(l.journal ?? []).flatMap((e) =>
                  e.postings.map((p, i) => (
                    <tr key={`${e.id}-${i}`}>
                      <td className="label faint">{i === 0 ? dateShort(e.createdAt) : ""}</td>
                      <td>{i === 0 ? KIND[e.kind] ?? e.kind : ""}</td>
                      <td className="mono" style={{ fontSize: 12 }}>
                        {p.account.replace(/:(loan|dlr|frm)_\w+/, ":$1")}
                      </td>
                      <td className="r num">{p.debit ? naira(p.debit) : ""}</td>
                      <td className="r num">{p.credit ? naira(p.credit) : ""}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="stack">
          <div className="pad" style={{ borderBottom: "1px solid var(--rule)" }}>
            <span className="label sq">Alerts</span>
          </div>
          {(l.alerts ?? []).map((a) => (
            <div key={a.id} className="pad stack gap-4" style={{ borderBottom: "1px solid var(--rule)" }}>
              <div className="row between gap-8">
                <span style={{ fontWeight: 500 }}>{a.title}</span>
                <Pill status={a.status === "OPEN" ? a.type : a.status} label={a.status === "OPEN" ? undefined : words(a.status)} />
              </div>
              <span className="muted" style={{ fontSize: 13 }}>
                {a.detail}
              </span>
              <span className="label faint">{date(a.created_at)}</span>
            </div>
          ))}
          {!l.alerts?.length && <p className="pad muted">No alerts on this loan.</p>}
          <div className="pad" style={{ borderBottom: "1px solid var(--rule)", borderTop: "1px solid var(--rule)" }}>
            <span className="label sq">History</span>
          </div>
          {(l.events ?? []).slice(0, 24).map((e) => (
            <div key={e.id} className="pad stack gap-4" style={{ borderBottom: "1px solid var(--rule)" }}>
              <span style={{ fontSize: 14 }}>{e.message}</span>
              <span className="label faint">{date(e.created_at)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="ruled cols-3">
        <div className="pad-lg stack gap-8">
          <span className="label sq">Farmer</span>
          {l.farmer && (
            <Link to={`/console/farmers/${l.farmer.id}`} className="d-sm">
              {l.farmer.name} →
            </Link>
          )}
          <span className="muted">{l.farmer?.phone} · account {l.farmer?.accountNo ?? "—"}</span>
        </div>
        <div className="pad-lg stack gap-8">
          <span className="label sq">Field</span>
          <span>
            {l.farm?.name} · {l.farm?.areaHa.toFixed(2)} ha
          </span>
          <span className="muted">{l.farm?.place}</span>
        </div>
        <div className="pad-lg stack gap-8">
          <span className="label sq">Application</span>
          <Link to={`/console/applications/${l.applicationId}`} className="row gap-8">
            Score and evidence →
          </Link>
          <span className="muted">Accepted with the farmer's one-time SMS consent code.</span>
        </div>
      </section>

      {repayOpen && (
        <Modal title="Record a repayment" onClose={() => setRepayOpen(false)}>
          <form
            className="stack gap-16"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => post(`/loans/${l.id}/repayments`, { amount: Math.round(Number(amount)), channel }), "Repayment recorded and receipt sent by SMS.").then(() => setRepayOpen(false));
            }}
          >
            <p className="muted">Debits the farmer's Ecobank account ({l.farmer?.accountNo}). Owed: {naira(l.outstanding)}.</p>
            <label className="field">
              <span className="label">Amount (₦)</span>
              <input className="input big" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} placeholder={String(l.outstanding)} />
            </label>
            <label className="field">
              <span className="label">Channel</span>
              <select className="select" value={channel} onChange={(e) => setChannel(e.target.value)}>
                <option value="AGENT">Agent</option>
                <option value="BRANCH">Branch</option>
                <option value="APP">App</option>
                <option value="USSD">USSD</option>
              </select>
            </label>
            <div className="row gap-8">
              <button type="button" className="btn ghost" onClick={() => setAmount(String(l.outstanding))}>
                Full amount
              </button>
              <button className="btn lime grow" disabled={busy || !Number(amount)}>
                Record repayment <span className="arrow">→</span>
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
