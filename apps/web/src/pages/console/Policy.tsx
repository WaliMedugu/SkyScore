// The credit policy, owned by the bank: weights, bands, gates, loan sizes and monitoring thresholds.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, errorText, patch, post } from "../../lib/api";
import { naira } from "../../lib/format";
import { useSession } from "../../lib/session";
import type { Policy } from "../../lib/types";
import { Loading, useToast } from "../../components/chrome";
import { PageHead } from "./Layout";

type Path = (string | number)[];
const get = (o: unknown, p: Path): unknown => p.reduce<unknown>((a, k) => (a as Record<string | number, unknown>)?.[k], o);
function set<T>(o: T, p: Path, v: unknown): T {
  const copy = structuredClone(o) as Record<string | number, unknown>;
  let cur = copy;
  for (let i = 0; i < p.length - 1; i++) cur = cur[p[i]] as Record<string | number, unknown>;
  cur[p[p.length - 1]] = v;
  return copy as T;
}

export function PolicyPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useSession();
  const { data } = useQuery({ queryKey: ["policy"], queryFn: () => api<Policy>("/policy") });
  const [p, setP] = useState<Policy | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data) setP(structuredClone(data));
  }, [data]);
  if (!p || !data) return <Loading />;
  const can = user?.role === "officer" || user?.role === "admin";
  const dirty = JSON.stringify(p) !== JSON.stringify(data);
  const weightSum = Object.values(p.score.weights).reduce((a, b) => a + b, 0);

  // A render helper (not a component), so inputs keep focus while typing.
  const num = (path: Path, label: string, { scale = 1, step = 1, suffix }: { scale?: number; step?: number; suffix?: string } = {}) => {
    const v = get(p, path) as number;
    return (
      <label className="field" key={path.join(".")}>
        <span className="label">{label}</span>
        <div className="row gap-8">
          <input
            className="input num"
            type="number"
            step={step}
            disabled={!can}
            value={Number.isFinite(v) ? Math.round(v * scale * 1000) / 1000 : ""}
            onChange={(e) => setP(set(p, path, e.target.value === "" ? NaN : Number(e.target.value) / scale))}
          />
          {suffix && <span className="label faint">{suffix}</span>}
        </div>
      </label>
    );
  };

  const save = async () => {
    setBusy(true);
    setProblems([]);
    try {
      const saved = await patch<Policy>("/policy", { score: p.score, lending: p.lending, monitor: p.monitor, crops: p.crops, evidence: p.evidence });
      qc.setQueryData(["policy"], saved);
      toast(`Policy v${saved.version} saved. New applications use it; re-score queued ones from their page.`);
      await qc.invalidateQueries();
    } catch (e) {
      if (e instanceof ApiError && e.details) setProblems(e.details.map((d) => d.message));
      toast(errorText(e), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHead label={`Credit policy · version ${data.version}`} title="The bank's rules, in the bank's hands.">
        {can && (
          <>
            <button className="btn ghost" disabled={busy} onClick={() => setP(structuredClone(data))}>
              Discard changes
            </button>
            <button
              className="btn ghost"
              disabled={busy}
              onClick={async () => {
                await post("/policy/reset");
                await qc.invalidateQueries();
                toast("Policy reset to the calibrated defaults.");
              }}
            >
              Reset to defaults
            </button>
            <button className="btn lime" disabled={busy || !dirty} onClick={save}>
              Save policy <span className="arrow">→</span>
            </button>
          </>
        )}
      </PageHead>
      {problems.length > 0 && (
        <div className="pad-lg" style={{ borderBottom: "1px solid var(--rule)", background: "color-mix(in srgb, var(--stress) 10%, var(--bg))" }}>
          <ul className="stack gap-4" style={{ margin: 0, paddingLeft: 18 }}>
            {problems.map((x) => (
              <li key={x} className="err">
                {x}
              </li>
            ))}
          </ul>
        </div>
      )}

      <section className="ruled cols-3">
        <div className="pad-lg stack gap-16">
          <div className="row between">
            <span className="label sq">Score weights</span>
            <span className={`label ${Math.round(weightSum) === 100 ? "" : "err"}`}>sum {weightSum}/100</span>
          </div>
          <div className="form-grid">
            {num(["score", "weights", "history"], "Farming history")}
            {num(["score", "weights", "vigour"], "Crop vigour")}
            {num(["score", "weights", "consistency"], "Consistency")}
            {num(["score", "weights", "climate"], "Climate resilience")}
            {num(["score", "weights", "landcover"], "Land-cover check")}
            {num(["score", "weights", "farmer"], "Farmer profile")}
          </div>
        </div>
        <div className="pad-lg stack gap-16">
          <span className="label sq">Bands (minimum score)</span>
          <div className="form-grid">
            {num(["score", "bands", "A"], "Band A · approve")}
            {num(["score", "bands", "B"], "Band B · approve")}
            {num(["score", "bands", "C"], "Band C · review")}
            {num(["score", "bands", "D"], "Band D · decline")}
          </div>
          <p className="faint" style={{ fontSize: 12 }}>
            Below D is band E. A and B are approved automatically unless a gate sends them to review.
          </p>
        </div>
        <div className="pad-lg stack gap-16">
          <span className="label sq">Gates</span>
          <div className="form-grid">
            {num(["score", "ghost", "maxCultivatedSeasons"], "Ghost: farmed seasons ≤")}
            {num(["score", "ghost", "maxCropShare"], "Ghost: cropland share <", { scale: 100, suffix: "%" })}
            {num(["score", "ghost", "cap"], "Ghost score cap")}
            {num(["score", "landGate", "minCropShare"], "Review if cropland <", { scale: 100, suffix: "%" })}
            {num(["score", "historyGate", "minCultivated"], "Approve needs farmed seasons ≥")}
            {num(["score", "historyGate", "minShare"], "…and share of seasons ≥", { scale: 100, suffix: "%" })}
          </div>
        </div>
      </section>

      <section className="ruled cols-3">
        <div className="pad-lg stack gap-16">
          <span className="label sq">Loan size</span>
          <div className="form-grid">
            {num(["lending", "caps", 0], "First loan cap", { suffix: "₦", step: 50000 })}
            {num(["lending", "caps", 1], "After 1 repaid", { suffix: "₦", step: 50000 })}
            {num(["lending", "caps", 2], "After 2 repaid", { suffix: "₦", step: 50000 })}
            {num(["lending", "multipliers", "A"], "Band A share of package", { scale: 100, suffix: "%" })}
            {num(["lending", "multipliers", "B"], "Band B share", { scale: 100, suffix: "%" })}
            {num(["lending", "multipliers", "C"], "Band C share (review)", { scale: 100, suffix: "%" })}
          </div>
        </div>
        <div className="pad-lg stack gap-16">
          <span className="label sq">Price and terms</span>
          <div className="form-grid">
            {num(["lending", "interestFlat"], "Flat interest", { scale: 100, step: 0.5, suffix: "%" })}
            {num(["lending", "insurancePremium"], "Crop insurance", { scale: 100, step: 0.5, suffix: "%" })}
            {num(["lending", "graceDays"], "Grace after harvest", { suffix: "days" })}
            {num(["lending", "voucherValidityDays"], "Voucher valid for", { suffix: "days" })}
          </div>
        </div>
        <div className="pad-lg stack gap-16">
          <span className="label sq">Monitoring</span>
          <div className="form-grid">
            {num(["monitor", "greenupFromWeek"], "Green-up check from week")}
            {num(["monitor", "greenupByWeek"], "…until week")}
            {num(["monitor", "greenupRise"], "NDVI rise that proves a crop", { step: 0.01 })}
            {num(["monitor", "radarVhRise"], "Radar VH rise that proves a crop", { step: 0.5, suffix: "dB" })}
            {num(["monitor", "stressDrop"], "Stress: below healthy curve by", { step: 0.01 })}
            {num(["monitor", "floodWater"], "Flood: water share ≥", { scale: 100, suffix: "%" })}
          </div>
        </div>
      </section>

      <section className="ruled">
        <div className="pad-lg stack gap-12">
          <span className="label sq">Input packages per hectare</span>
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Crop</th>
                  <th>Item</th>
                  <th>Unit</th>
                  <th className="r">Per hectare</th>
                  <th className="r">Unit price (₦)</th>
                  <th>Tranche</th>
                </tr>
              </thead>
              <tbody>
                {Object.values(p.crops).flatMap((c) =>
                  c.items.map((it, i) => (
                    <tr key={`${c.key}-${it.key}`}>
                      <td>{i === 0 ? `${c.label} (${c.hausa})` : ""}</td>
                      <td>{it.name}</td>
                      <td className="faint">{it.unit}</td>
                      <td className="r" style={{ width: 120 }}>
                        <input className="input num" type="number" disabled={!can} value={it.qtyPerHa} onChange={(e) => setP(set(p, ["crops", c.key, "items", i, "qtyPerHa"], Number(e.target.value)))} />
                      </td>
                      <td className="r" style={{ width: 160 }}>
                        <input className="input num" type="number" step={500} disabled={!can} value={it.unitPrice} onChange={(e) => setP(set(p, ["crops", c.key, "items", i, "unitPrice"], Number(e.target.value)))} />
                      </td>
                      <td className="mono">T{it.tranche}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
          <p className="faint" style={{ fontSize: 12 }}>
            A one-hectare maize package today costs {naira(p.crops.maize.items.reduce((a, i) => a + i.qtyPerHa * i.unitPrice, 0))}.
          </p>
        </div>
      </section>
    </div>
  );
}
