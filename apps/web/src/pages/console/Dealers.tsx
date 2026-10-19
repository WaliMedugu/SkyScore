import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { date, naira } from "../../lib/format";
import type { Dealer } from "../../lib/types";
import { Loading, Pill } from "../../components/chrome";
import { MapView } from "../../components/MapView";
import { PageHead } from "./Layout";

export function Dealers() {
  const { data: dealers } = useQuery({ queryKey: ["dealers"], queryFn: () => api<Dealer[]>("/dealers") });
  const [sel, setSel] = useState<string | null>(null);
  const { data: detail } = useQuery({ queryKey: ["dealer", sel], queryFn: () => api<Dealer>(`/dealers/${sel}`), enabled: !!sel });
  if (!dealers) return <Loading />;
  const total = dealers.reduce((a, d) => a + d.valueRedeemed, 0);

  return (
    <div>
      <PageHead label="Agro-dealers" title="Inputs handed over, dealers paid at once.">
        <span className="label">{naira(total)} redeemed in total</span>
      </PageHead>
      <section className="ruled" style={{ gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)" }}>
        <div className="scroll-x">
          <table className="table">
            <thead>
              <tr>
                <th>Dealer</th>
                <th>Where</th>
                <th className="r">Vouchers</th>
                <th className="r">Paid out</th>
                <th className="r">Balance</th>
              </tr>
            </thead>
            <tbody>
              {dealers.map((d) => (
                <tr key={d.id} className="click" onClick={() => setSel(d.id)} style={sel === d.id ? { background: "var(--bg-3)" } : undefined}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{d.name}</div>
                    <div className="label faint">{d.owner}</div>
                  </td>
                  <td style={{ fontSize: 13 }}>
                    {d.address}, {d.state}
                  </td>
                  <td className="r num">{d.vouchersRedeemed}</td>
                  <td className="r num">{naira(d.valueRedeemed)}</td>
                  <td className="r num">{naira(d.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ position: "relative", minHeight: 360 }}>
          <MapView points={dealers.filter((d) => d.lat && d.lng).map((d) => ({ id: d.id, lat: d.lat!, lng: d.lng!, label: d.name, color: d.id === sel ? "#BED600" : "#0082BB" }))} center={[10.2, 7.6]} zoom={7} />
        </div>
      </section>
      {detail && (
        <section className="ruled">
          <div className="pad-lg stack gap-12">
            <span className="label sq">
              {detail.name} · account {detail.accountNo}
            </span>
            <div className="scroll-x">
              <table className="table">
                <thead>
                  <tr>
                    <th>Redeemed</th>
                    <th>Voucher</th>
                    <th>Farmer</th>
                    <th>Items</th>
                    <th className="r">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail.vouchers ?? []).map((v) => (
                    <tr key={v.code}>
                      <td className="label faint">{date(v.redeemedAt)}</td>
                      <td className="mono">
                        {v.code} <Pill status={v.status} label={`T${v.tranche}`} />
                      </td>
                      <td>{v.farmerName}</td>
                      <td style={{ fontSize: 13 }}>{v.items.map((i) => `${i.qty} × ${i.name}`).join(", ")}</td>
                      <td className="r num">{naira(v.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
