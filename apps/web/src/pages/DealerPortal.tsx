// Agro-dealer counter: scan or type a voucher, hand over the inputs, get paid instantly.
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "react-router";
import { api, errorText, post } from "../lib/api";
import { date, naira } from "../lib/format";
import { useSession } from "../lib/session";
import type { Dealer, Voucher } from "../lib/types";
import { Clock, Logo, Pill, ThemeToggle, useToast } from "../components/chrome";

/** SKY-ABCD-EFGH as the dealer types. */
function formatCode(raw: string) {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^SKY/, "").slice(0, 8);
  return `SKY-${s.slice(0, 4)}${s.length > 4 ? `-${s.slice(4)}` : ""}`;
}

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

function Scanner({ onCode, onClose }: { onCode: (c: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let alive = true;
    const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    if (!BD) {
      setErr("This browser can't scan QR codes. Type the code instead, or use the SkyScore field app.");
      return;
    }
    const detector = new BD({ formats: ["qr_code"] });
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then(async (s) => {
        stream = s;
        if (!video.current) return;
        video.current.srcObject = s;
        await video.current.play();
        const tick = async () => {
          if (!alive || !video.current) return;
          try {
            const codes = await detector.detect(video.current);
            const hit = codes.find((c) => /SKY-?[A-Z0-9]{4}-?[A-Z0-9]{4}/i.test(c.rawValue));
            if (hit) {
              onCode(formatCode(hit.rawValue));
              return;
            }
          } catch {
            /* keep scanning */
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      })
      .catch(() => setErr("Camera not available. Type the code instead."));
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onCode]);
  return (
    <div className="stack gap-12">
      {err ? <p className="err">{err}</p> : <video ref={video} muted playsInline style={{ width: "100%", background: "#000", aspectRatio: "4/3", objectFit: "cover" }} />}
      <button className="btn ghost" onClick={onClose}>
        Close camera
      </button>
    </div>
  );
}

export function DealerPortal() {
  const { user, signOut } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [code, setCode] = useState("SKY-");
  const [voucher, setVoucher] = useState<Voucher | null>(null);
  const [paid, setPaid] = useState<{ amount: number; settledTo: string } | null>(null);
  const [scan, setScan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dealerId, setDealerId] = useState("");
  const isDealer = user?.role === "dealer";
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => api<{ dealer: Dealer | null }>("/me"), enabled: !!user });
  const { data: dealers = [] } = useQuery({ queryKey: ["dealers"], queryFn: () => api<Dealer[]>("/dealers"), enabled: !!user && !isDealer });
  const { data: recent = [] } = useQuery({ queryKey: ["vouchers", "REDEEMED"], queryFn: () => api<Voucher[]>("/vouchers?status=REDEEMED"), enabled: !!user, refetchInterval: 15_000 });

  if (!user) return <Navigate to="/login" replace state={{ from: "/dealer" }} />;
  if (user.role === "agent") return <Navigate to="/console" replace />;
  const shop = me?.dealer;

  const lookup = async (c = code) => {
    setPaid(null);
    setVoucher(null);
    setBusy(true);
    try {
      setVoucher(await api<Voucher>(`/vouchers/${encodeURIComponent(c)}`));
    } catch (e) {
      toast(errorText(e), true);
    } finally {
      setBusy(false);
    }
  };

  const redeem = async () => {
    if (!voucher) return;
    setBusy(true);
    try {
      const r = await post<{ amount: number; settledTo: string; voucher: Voucher }>(`/vouchers/${voucher.code}/redeem`, isDealer ? {} : { dealerId });
      setPaid(r);
      setVoucher(r.voucher);
      await qc.invalidateQueries();
    } catch (e) {
      toast(errorText(e), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <header className="topbar">
        <div className="logo-cell">
          <Logo />
        </div>
        <div className="clock">
          <Clock />
        </div>
        <nav>
          <span className="label">{shop?.name ?? user.name}</span>
          <ThemeToggle />
        </nav>
        <button className="cta" style={{ border: 0, cursor: "pointer" }} onClick={signOut}>
          Sign out <span aria-hidden>→</span>
        </button>
      </header>

      <section className="ruled" style={{ gridTemplateColumns: "minmax(0,1.3fr) minmax(300px,1fr)", minHeight: "calc(100vh - 56px)" }}>
        <div className="pad-lg stack gap-24">
          <div className="stack gap-8">
            <span className="label sq">Agro-dealer counter</span>
            <h1 className="display d-lg">Scan. Hand over. Get paid.</h1>
          </div>
          {!isDealer && (
            <label className="field" style={{ maxWidth: 420 }}>
              <span className="label">Redeeming on behalf of</span>
              <select className="select" value={dealerId} onChange={(e) => setDealerId(e.target.value)}>
                <option value="">Choose the dealer…</option>
                {dealers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <form
            className="row gap-12 wrap"
            onSubmit={(e) => {
              e.preventDefault();
              void lookup();
            }}
          >
            <input className="input big" style={{ maxWidth: 360 }} value={code} onChange={(e) => setCode(formatCode(e.target.value))} aria-label="Voucher code" spellCheck={false} autoCapitalize="characters" />
            <button className="btn" disabled={busy || code.length < 13}>
              Look up <span className="arrow">→</span>
            </button>
            <button type="button" className="btn ghost" onClick={() => setScan(true)}>
              Scan QR
            </button>
          </form>
          {scan && (
            <div style={{ maxWidth: 480 }}>
              <Scanner
                onCode={(c) => {
                  setScan(false);
                  setCode(c);
                  void lookup(c);
                }}
                onClose={() => setScan(false)}
              />
            </div>
          )}

          {voucher && (
            <div className="ruled" style={{ border: "1px solid var(--rule)", maxWidth: 720 }}>
              <div className={`pad-lg stack gap-12 ${paid ? "accent" : ""}`}>
                <div className="row between wrap gap-8">
                  <span className="mono" style={{ fontSize: 22, letterSpacing: "0.06em" }}>
                    {voucher.code}
                  </span>
                  <Pill status={voucher.status} label={voucher.status === "HELD" ? "on hold until the crop greens up" : undefined} />
                </div>
                <p className="lead">
                  {voucher.farmerName} · {voucher.farmerPhoneMasked} · {voucher.crop} · tranche {voucher.tranche}
                </p>
                <table className="table">
                  <tbody>
                    {voucher.items.map((i) => (
                      <tr key={i.name}>
                        <td className="d-sm" style={{ fontSize: 20 }}>
                          {i.qty} ×
                        </td>
                        <td>
                          {i.name}
                          <div className="label faint">{i.unit}</div>
                        </td>
                        <td className="r num">{naira(i.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {paid ? (
                  <div className="stack gap-8">
                    <span className="d-md num">{naira(paid.amount)} paid</span>
                    <span className="label">Settled to account {paid.settledTo}. The farmer has an SMS receipt.</span>
                    <button
                      className="btn"
                      onClick={() => {
                        setVoucher(null);
                        setPaid(null);
                        setCode("SKY-");
                      }}
                    >
                      Next voucher <span className="arrow">→</span>
                    </button>
                  </div>
                ) : voucher.status === "ISSUED" ? (
                  <button className="btn lime" disabled={busy || (!isDealer && !dealerId)} onClick={redeem}>
                    Inputs handed over: pay me {naira(voucher.amount)} <span className="arrow">→</span>
                  </button>
                ) : (
                  <p className="muted">
                    {voucher.status === "REDEEMED" ? `Already redeemed at ${voucher.dealerName} on ${date(voucher.redeemedAt)}.` : voucher.status === "HELD" ? "Tranche 2 is released when satellites confirm the crop has come up." : `This voucher is ${voucher.status.toLowerCase()}.`}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <aside className="stack">
          <div className="kpi block" style={{ minHeight: 150 }}>
            <span className="v num">{naira(shop?.balance ?? 0)}</span>
            <span className="label k">{shop ? `Account ${shop.accountNo}` : "Shop balance"}</span>
          </div>
          <div className="kpi accent" style={{ minHeight: 130 }}>
            <span className="v num">{shop?.vouchersRedeemed ?? recent.length}</span>
            <span className="label k">Vouchers redeemed · {naira(shop?.valueRedeemed ?? recent.reduce((a, v) => a + v.amount, 0))}</span>
          </div>
          <div className="pad" style={{ borderBottom: "1px solid var(--rule)" }}>
            <span className="label sq">Recent hand-overs</span>
          </div>
          <div style={{ overflowY: "auto" }}>
            {recent.slice(0, 20).map((v) => (
              <div key={v.code} className="pad row between gap-12" style={{ borderBottom: "1px solid var(--rule)" }}>
                <div className="stack gap-4">
                  <span className="mono" style={{ fontSize: 13 }}>
                    {v.code}
                  </span>
                  <span className="label faint">
                    {v.farmerName} · {date(v.redeemedAt)}
                  </span>
                </div>
                <span className="num">{naira(v.amount)}</span>
              </div>
            ))}
          </div>
        </aside>
      </section>
    </div>
  );
}
