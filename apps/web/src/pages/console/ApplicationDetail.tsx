// One application: the satellite evidence, the score and the offer, and the officer's or agent's next step.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";
import { api, errorText, post } from "../../lib/api";
import { ago, date, ha, naira, pct, words } from "../../lib/format";
import { useSession } from "../../lib/session";
import type { Analysis, Application, Loan } from "../../lib/types";
import { Loading, Modal, Pill, useToast } from "../../components/chrome";
import { MapView } from "../../components/MapView";
import { FactorBars, HistoryChart, ScoreDial, SeasonChips, Timelapse } from "../../components/science";
import { PageHead } from "./Layout";

export function OfferTable({ offer }: { offer: NonNullable<Application["offer"]> }) {
  return (
    <table className="table">
      <tbody>
        {offer.items.map((i) => (
          <tr key={i.key}>
            <td>
              {i.qty} × {i.name}
              <div className="label faint">
                {i.unit} · {naira(i.unitPrice)} each · tranche {i.tranche}
              </div>
            </td>
            <td className="r num">{naira(i.amount)}</td>
          </tr>
        ))}
        <tr>
          <td className="muted">Tranche 1 at signing · tranche 2 after green-up</td>
          <td className="r num">
            {naira(offer.tranche1)} + {naira(offer.tranche2)}
          </td>
        </tr>
        <tr>
          <td className="muted">Flat interest + crop insurance</td>
          <td className="r num">
            {naira(offer.interest)} + {naira(offer.insurance)}
          </td>
        </tr>
        <tr>
          <td style={{ fontWeight: 600 }}>Repay by {date(offer.dueDate)}</td>
          <td className="r num" style={{ fontWeight: 600 }}>
            {naira(offer.totalRepayable)}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

export function ApplicationDetail() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useSession();
  const { data: a } = useQuery({
    queryKey: ["application", id],
    queryFn: () => api<Application>(`/applications/${id}`),
    refetchInterval: (q) => (q.state.data?.status === "ANALYZING" ? 1500 : false),
  });
  const { data: an } = useQuery({
    queryKey: ["farm-analysis", a?.farm?.id, a?.analysisId, a?.status],
    queryFn: () => api<Analysis>(`/farms/${a!.farm!.id}/analysis`),
    enabled: !!a?.farm?.id && !!a.analysisId && a.status !== "ANALYZING",
  });
  const [decide, setDecide] = useState<"approve" | "decline" | null>(null);
  const [note, setNote] = useState("");
  const [otp, setOtp] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!a) return <Loading />;
  const officer = user?.role === "officer" || user?.role === "admin";
  const sc = a.assessment?.score;
  const refresh = () => qc.invalidateQueries();

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast(ok);
      await refresh();
    } catch (e) {
      toast(errorText(e), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHead label={`Application · ${a.seasonYear} season`} title={a.farmer?.name ?? "Application"}>
        <Pill status={a.status} />
        {a.ghost && <Pill status="GHOST" label="ghost farm" />}
        {a.status === "REVIEW" && officer && (
          <>
            <button className="btn lime" onClick={() => setDecide("approve")} disabled={busy}>
              Approve <span className="arrow">→</span>
            </button>
            <button className="btn ghost" onClick={() => setDecide("decline")} disabled={busy}>
              Decline
            </button>
          </>
        )}
        {a.status === "APPROVED" && (
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              act(async () => {
                const r = await post<{ to: string; sandboxOtp?: string }>(`/applications/${a.id}/otp`);
                setSentTo(r.to);
                toast(r.sandboxOtp ? `Code sent to ${r.to}. Sandbox code: ${r.sandboxOtp}` : `Code sent to ${r.to}.`);
              })
            }
          >
            Text the farmer a consent code <span className="arrow">→</span>
          </button>
        )}
        {officer && ["REVIEW", "APPROVED", "DECLINED", "ERROR"].includes(a.status) && (
          <button className="btn ghost" disabled={busy} onClick={() => act(() => post(`/applications/${a.id}/rescore`), "Re-scored with the current credit policy.")}>
            Re-score
          </button>
        )}
        {a.loanId && (
          <Link className="btn lime" to={`/console/loans/${a.loanId}`}>
            Open loan <span className="arrow">→</span>
          </Link>
        )}
      </PageHead>

      {a.status === "ANALYZING" && (
        <div className="pad-lg stack gap-12" style={{ borderBottom: "1px solid var(--rule)" }}>
          <div className="loading-bar" />
          <p className="lead">Reading this field's satellite history…</p>
        </div>
      )}

      {(a.status === "APPROVED" && (a.otpPending || sentTo)) && (
        <form
          className="row gap-12 wrap pad-lg accent"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              const loan = await post<Loan>(`/applications/${a.id}/accept`, { otp });
              toast(`Loan created. Voucher ${loan.vouchers[0]?.code} sent to the farmer.`);
              nav(`/console/loans/${loan.id}`);
            });
          }}
        >
          <span className="label">The farmer reads you the 6-digit code from their SMS</span>
          <input className="input big" style={{ maxWidth: 220 }} inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} placeholder="000000" aria-label="Consent code" />
          <button className="btn" disabled={otp.length !== 6 || busy}>
            Accept the offer <span className="arrow">→</span>
          </button>
        </form>
      )}

      {sc && (
        <section className="ruled cols-3">
          <div className="pad-lg stack gap-16" style={{ alignItems: "center" }}>
            <ScoreDial score={sc.score} band={sc.band} decision={sc.decision} ghost={sc.ghost} />
            <p className="center lead">{sc.headline}</p>
            <span className="label faint">
              Judged as at {date(a.assessment!.asOf)} · confidence {words(sc.confidence)}
            </span>
          </div>
          <div className="pad-lg stack gap-12">
            <span className="label sq">Factors</span>
            <FactorBars factors={sc.factors} />
          </div>
          <div className="pad-lg stack gap-12">
            <span className="label sq">Concerns</span>
            {sc.concerns.length ? (
              <ul className="stack gap-8" style={{ paddingLeft: 18, margin: 0 }}>
                {sc.concerns.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            ) : (
              <p className="muted">None.</p>
            )}
            <span className="label sq" style={{ marginTop: 12 }}>
              Strengths
            </span>
            <ul className="bullets">
              {sc.strengths.map((c) => (
                <li key={c} style={{ textTransform: "none", fontFamily: "var(--sans)", fontSize: 14, letterSpacing: 0 }}>
                  {c}
                </li>
              ))}
            </ul>
            {a.officerNote && (
              <div className="fogbg pad" style={{ marginTop: 12 }}>
                <span className="label">Officer's note · {date(a.decidedAt)}</span>
                <p style={{ marginTop: 6 }}>{a.officerNote}</p>
              </div>
            )}
          </div>
        </section>
      )}

      <section className="ruled cols-3">
        <div className="pad-lg stack gap-12">
          <span className="label sq">Farmer</span>
          {a.farmer && (
            <>
              <Link to={`/console/farmers/${a.farmer.id}`} className="d-sm">
                {a.farmer.name} →
              </Link>
              <div className="stack gap-4 muted" style={{ fontSize: 14 }}>
                <span>
                  {a.farmer.gender ?? ""} {a.farmer.age ? `· ${a.farmer.age} years` : ""} · {a.farmer.phone}
                </span>
                <span>{a.farmer.hub ?? "No training hub"}</span>
                <span>{a.farmer.cooperative ?? "No cooperative"}</span>
              </div>
              <div className="row gap-8 wrap">
                <Pill status={a.farmer.bvnVerified ? "VERIFIED" : "PENDING"} label={a.farmer.bvnVerified ? `BVN ${a.farmer.bvnMasked}` : "BVN not verified"} />
                {a.farmer.trained && <Pill status="HEALTHY" label="trained" />}
                {a.farmer.priorOnTimeLoans > 0 && <Pill status="REPAID" label={`${a.farmer.priorOnTimeLoans} loan repaid`} />}
              </div>
            </>
          )}
        </div>
        <div className="pad-lg stack gap-12 span-2">
          <span className="label sq">The offer</span>
          {a.offer?.eligible ? (
            <>
              <div className="row between" style={{ alignItems: "baseline" }}>
                <span className="display d-md num">{naira(a.offer.principal)}</span>
                <span className="label faint">
                  {a.farm?.cropLabel} · {ha(a.offer.financedHa)} financed{a.offer.capApplied ? " · first-loan cap applied" : ""}
                </span>
              </div>
              <OfferTable offer={a.offer} />
              <p className="muted" style={{ fontSize: 13 }}>
                Expected harvest {naira(a.offer.expectedRevenue)}; repayment is {pct(a.offer.repaymentToRevenue)} of it. Green-up check between {date(a.offer.greenupCheckFrom)} and {date(a.offer.greenupCheckBy)}.
              </p>
            </>
          ) : (
            <p className="muted">{a.offer?.reason ?? "No offer."}</p>
          )}
        </div>
      </section>

      {an?.ready && (
        <>
          <section className="ruled">
            <div className="pad-lg stack gap-16">
              <div className="row between wrap gap-12">
                <span className="label sq">The field's farming record · {an.photosFound} photos on record, {an.clearPhotos} clear</span>
                <span className="label faint">{an.source === "snapshot" ? "Saved real-satellite snapshot" : `Read live ${ago(an.asOf)}`}</span>
              </div>
              <SeasonChips seasons={a.assessment?.seasons ?? an.seasons} />
              <HistoryChart optical={an.series.optical} seasons={a.assessment?.seasons ?? an.seasons} radar={an.series.radar} height={240} />
            </div>
          </section>
          <section className="ruled" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr)" }}>
            <div style={{ position: "relative", minHeight: 420 }}>
              <MapView shapes={[{ id: "f", polygon: an.polygon, outline: true, tooltip: a.farm?.name }]} />
            </div>
            <div className="pad-lg stack gap-12">
              <span className="label sq">Time-lapse</span>
              <Timelapse frames={an.frames} snap={an.snapshotKey} columns={5} />
            </div>
          </section>
        </>
      )}

      {a.events && (
        <section className="ruled">
          <div className="pad-lg stack gap-8">
            <span className="label sq">History</span>
            {a.events.map((e) => (
              <div key={e.id} className="row gap-16" style={{ borderBottom: "1px solid var(--rule)", padding: "10px 0", alignItems: "flex-start" }}>
                <span className="label faint" style={{ width: 150, flex: "none" }}>
                  {date(e.created_at)}
                </span>
                <span>{e.message}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {decide && (
        <Modal title={decide === "approve" ? "Approve application" : "Decline application"} onClose={() => setDecide(null)}>
          <form
            className="stack gap-16"
            onSubmit={(e) => {
              e.preventDefault();
              void act(() => post(`/applications/${a.id}/decision`, { action: decide, note }), decide === "approve" ? "Approved. The farmer has been told by SMS." : "Declined.").then(() => setDecide(null));
            }}
          >
            <p className="muted">{decide === "approve" ? "Record why you're approving despite the concerns (agent visit, documents, references)." : "Record why. The farmer is told by SMS how to qualify next season."}</p>
            <textarea className="input" rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the file" required />
            <button className={`btn ${decide === "approve" ? "lime" : "danger"}`} disabled={busy || !note.trim()}>
              {decide === "approve" ? "Approve" : "Decline"} <span className="arrow">→</span>
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
