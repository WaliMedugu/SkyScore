// Register a farmer, map their field, and apply — the agent's workflow, in the console.
import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router";
import type { Polygon } from "@skyscore/engine";
import { areaHa } from "@skyscore/engine";
import { api, errorText, post } from "../../lib/api";
import type { Farm, Farmer, Meta, ShowcaseField } from "../../lib/types";
import { Pill, useToast } from "../../components/chrome";
import { MapView } from "../../components/MapView";
import { PageHead } from "./Layout";

const HUBS = ["Zaria Youth Agripreneur Hub", "Kachia Young Farmers Hub", "Bida Rice Youth Hub", "Kuje Agripreneur Hub"];

export function NewFarmer() {
  const nav = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const { data: meta } = useQuery({ queryKey: ["meta"], queryFn: () => api<Meta>("/meta") });
  const { data: fields = [] } = useQuery({ queryKey: ["showcase"], queryFn: () => api<ShowcaseField[]>("/showcase") });
  const existing = params.get("farmer");
  const { data: known } = useQuery({ queryKey: ["farmer", existing], queryFn: () => api<Farmer>(`/farmers/${existing}`), enabled: !!existing });

  const [farmer, setFarmer] = useState<Farmer | null>(null);
  const [form, setForm] = useState({ firstName: "", lastName: "", phone: "", gender: "female", birthYear: "2001", bvn: "", hub: HUBS[0], trained: true, cooperative: "", language: "en", consent: false });
  const [polygon, setPolygon] = useState<Polygon | null>(null);
  const [fieldKey, setFieldKey] = useState<string | null>(params.get("field"));
  const [drawing, setDrawing] = useState(false);
  const [crop, setCrop] = useState("maize");
  const [tenure, setTenure] = useState("family");
  const [busy, setBusy] = useState(false);
  const [bvnMsg, setBvnMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (known) setFarmer(known);
  }, [known]);
  useEffect(() => {
    const f = fields.find((x) => x.key === fieldKey);
    if (f) {
      setPolygon(f.polygon);
      setCrop(f.crop);
    }
  }, [fieldKey, fields]);

  const set = (k: keyof typeof form) => (e: { target: { value: string; checked?: boolean; type?: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const register = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await post<{ farmer: Farmer; bvn: { verified: boolean; message: string } | null }>("/farmers", {
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone,
        gender: form.gender,
        birthYear: Number(form.birthYear) || undefined,
        bvn: form.bvn || undefined,
        hub: form.hub || undefined,
        trained: form.trained,
        cooperative: form.cooperative || undefined,
        language: form.language,
        consent: form.consent,
      });
      setFarmer(r.farmer);
      if (r.bvn) setBvnMsg({ ok: r.bvn.verified, text: r.bvn.message });
      toast(`${r.farmer.name} registered.`);
    } catch (x) {
      toast(errorText(x), true);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!farmer || !polygon) return;
    setBusy(true);
    try {
      const f = await post<{ farm: Farm }>("/farms", { farmerId: farmer.id, polygon, crop, tenure, mapMethod: fieldKey ? "saved" : "tap" });
      const a = await post<{ applicationId: string }>("/applications", { farmId: f.farm.id });
      toast("Application created: reading the field's satellite history.");
      nav(`/console/applications/${a.applicationId}`);
    } catch (x) {
      toast(errorText(x), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHead label="New application" title="Register, map, apply." />
      <section className="ruled cols-3">
        {[
          ["01", "Farmer and consent", !!farmer],
          ["02", "Map the field", !!polygon],
          ["03", "Score from space", false],
        ].map(([n, t, done]) => (
          <div key={n as string} className={`pad row between ${done ? "accent" : ""}`}>
            <span className="label">
              {n} · {t}
            </span>
            {done ? <span>✓</span> : null}
          </div>
        ))}
      </section>

      {!farmer ? (
        <form onSubmit={register} className="pad-lg stack gap-24" style={{ maxWidth: 860 }}>
          <div className="form-grid">
            <label className="field">
              <span className="label">First name</span>
              <input className="input" value={form.firstName} onChange={set("firstName")} required minLength={2} />
            </label>
            <label className="field">
              <span className="label">Last name</span>
              <input className="input" value={form.lastName} onChange={set("lastName")} required minLength={2} />
            </label>
            <label className="field">
              <span className="label">Phone</span>
              <input className="input" value={form.phone} onChange={set("phone")} placeholder="0803 123 4567" required />
            </label>
            <label className="field">
              <span className="label">BVN (optional now, needed to borrow)</span>
              <input className="input" inputMode="numeric" maxLength={11} value={form.bvn} onChange={(e) => setForm((f) => ({ ...f, bvn: e.target.value.replace(/\D/g, "") }))} />
            </label>
            <label className="field">
              <span className="label">Gender</span>
              <select className="select" value={form.gender} onChange={set("gender")}>
                <option value="female">Female</option>
                <option value="male">Male</option>
              </select>
            </label>
            <label className="field">
              <span className="label">Year of birth</span>
              <input className="input" inputMode="numeric" value={form.birthYear} onChange={set("birthYear")} />
            </label>
            <label className="field">
              <span className="label">Training hub</span>
              <select className="select" value={form.hub} onChange={set("hub")}>
                {HUBS.map((h) => (
                  <option key={h}>{h}</option>
                ))}
                <option value="">None</option>
              </select>
            </label>
            <label className="field">
              <span className="label">Cooperative (optional)</span>
              <input className="input" value={form.cooperative} onChange={set("cooperative")} />
            </label>
            <label className="field">
              <span className="label">Language for SMS</span>
              <select className="select" value={form.language} onChange={set("language")}>
                <option value="en">English</option>
                <option value="ha">Hausa</option>
                <option value="yo">Yoruba</option>
                <option value="ig">Igbo</option>
                <option value="pcm">Pidgin</option>
              </select>
            </label>
            <label className="check" style={{ alignSelf: "end" }}>
              <input type="checkbox" checked={form.trained} onChange={set("trained")} /> Completed agripreneur training
            </label>
          </div>
          <label className="check fogbg pad">
            <input type="checkbox" checked={form.consent} onChange={set("consent")} required />
            <span>
              The farmer agrees that Ecobank may check their BVN, store their details and read satellite photos of the field they register, to assess and monitor an input loan (Nigeria Data Protection Act 2023). They can withdraw consent at any time.
            </span>
          </label>
          <div>
            <button className="btn lime" disabled={busy || !form.consent}>
              Register farmer <span className="arrow">→</span>
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="pad-lg row between wrap gap-12" style={{ borderBottom: "1px solid var(--rule)" }}>
            <div className="stack gap-4">
              <span className="d-sm">{farmer.name}</span>
              <span className="muted">
                {farmer.phone} · {farmer.hub ?? "no hub"}
              </span>
            </div>
            <div className="row gap-8 wrap">
              <Pill status={farmer.bvnVerified ? "VERIFIED" : "PENDING"} label={farmer.bvnVerified ? "BVN verified" : "BVN not verified"} />
              {bvnMsg && <span className={bvnMsg.ok ? "muted" : "err"}>{bvnMsg.text}</span>}
            </div>
          </div>
          <section className="ruled" style={{ gridTemplateColumns: "minmax(0,1.5fr) minmax(320px,1fr)" }}>
            <div style={{ position: "relative", minHeight: 480 }}>
              <MapView
                shapes={polygon ? [{ id: "p", polygon, outline: true }] : fields.filter((f) => f.kind === "showcase").map((f) => ({ id: f.key, polygon: f.polygon, status: "APPROVED", tooltip: `${f.place} (saved real field)` }))}
                onSelect={(id) => setFieldKey(id)}
                drawing={drawing}
                onDraw={(p) => {
                  setPolygon(p);
                  setFieldKey(null);
                  setDrawing(false);
                }}
                onCancelDraw={() => setDrawing(false)}
                center={[10.2, 7.6]}
                zoom={7}
              />
            </div>
            <div className="pad-lg stack gap-16">
              <span className="label sq">The field</span>
              {polygon ? (
                <p className="lead">{areaHa(polygon).toFixed(2)} hectares{fieldKey ? ` · ${fields.find((f) => f.key === fieldKey)?.place}` : " · drawn on the map"}</p>
              ) : (
                <p className="muted">In the field, the agent walks the boundary with the SkyScore app. Here, tap the corners on the satellite map, or pick a saved real field.</p>
              )}
              <div className="row gap-8 wrap">
                <button className="btn ghost small" onClick={() => setDrawing(true)} disabled={drawing}>
                  Draw on the map
                </button>
                {fields
                  .filter((f) => f.kind === "showcase" || f.key === "control-gwagwalada-town")
                  .map((f) => (
                    <button key={f.key} className={`btn small ${fieldKey === f.key ? "" : "ghost"}`} onClick={() => setFieldKey(f.key)}>
                      {f.place.split(",")[0]}
                    </button>
                  ))}
              </div>
              <div className="form-grid">
                <label className="field">
                  <span className="label">Crop this season</span>
                  <select className="select" value={crop} onChange={(e) => setCrop(e.target.value)}>
                    {(meta?.crops ?? []).map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label} ({c.hausa})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="label">Land tenure</span>
                  <select className="select" value={tenure} onChange={(e) => setTenure(e.target.value)}>
                    <option value="family">Family land</option>
                    <option value="owned">Owned</option>
                    <option value="leased">Leased</option>
                    <option value="allocated">Allocated (community / programme)</option>
                    <option value="rented">Rented</option>
                  </select>
                </label>
              </div>
              <button className="btn lime" disabled={!polygon || busy} onClick={apply}>
                Map field and apply <span className="arrow">→</span>
              </button>
              <p className="faint" style={{ fontSize: 12 }}>
                A field that overlaps one already registered is refused: one field can back only one loan.
              </p>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
