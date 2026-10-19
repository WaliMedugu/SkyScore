// Public site: what SkyScore is, shown with real fields from space.
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { api, frameUrl } from "../lib/api";
import { naira, nairaShort, tone } from "../lib/format";
import type { Frame, ShowcaseField } from "../lib/types";
import { Logo, Pill, TopBar, useReveal } from "../components/chrome";
import { Halftone } from "../components/Halftone";
import { Timelapse } from "../components/science";

interface Stats {
  farmers: number;
  hectares: number;
  loans: number;
  disbursed: number;
  repaymentRate: number | null;
  ghostFarmsBlocked: number;
  averageScore: number | null;
  photosRead: number;
  radarPasses: number;
  photosOnRecord: number;
  realFields: number;
}

/** A dry-season and a rainy-season photo from the same year: the field "breathing". */
function breathing(f: ShowcaseField | undefined): Frame[] {
  if (!f?.frames.length) return [];
  const years = [...new Set(f.frames.map((x) => x.date.slice(0, 4)))].sort().reverse();
  for (const y of years) {
    const dry = f.frames.find((x) => x.date.startsWith(y) && x.date.slice(5, 7) <= "04");
    const wet = f.frames.find((x) => x.date.startsWith(y) && x.date.slice(5, 7) >= "08");
    if (dry && wet) return [dry, wet];
  }
  return f.frames.slice(-2);
}

const STEPS = [
  {
    n: "01",
    title: "Map the field",
    text: "A field agent walks the boundary with the SkyScore app, or taps its corners on the satellite map. The farmer consents and their BVN is checked.",
    bullets: ["GPS boundary walk", "BVN check with consent (NDPA 2023)", "Duplicate-field check", "Works on a basic Android"],
  },
  {
    n: "02",
    title: "Read eight seasons",
    text: "Every Sentinel-2 photo of that exact field since 2018, radar that sees through rainy-season cloud, ESA land-cover maps and NASA rainfall — read in under a minute.",
    bullets: ["Sentinel-2 greenness, every 5 days", "Sentinel-1 radar through cloud", "ESA WorldCover cropland check", "NASA POWER rainfall"],
  },
  {
    n: "03",
    title: "Score and explain",
    text: "SkyScore turns the field's farming record into a 0–100 score with six factors and plain reasons. Land that has never been farmed is caught as a ghost farm.",
    bullets: ["Six explainable factors", "Ghost-farm detection", "Officer review for thin records", "Policy the bank controls"],
  },
  {
    n: "04",
    title: "Lend inputs, not cash",
    text: "The offer is sized to the field: seed, fertiliser and herbicide as a voucher redeemed at a vetted agro-dealer. Tranche two waits until the satellites see the crop come up.",
    bullets: ["Two-tranche voucher", "Dealer paid instantly", "Double-entry ledger", "Crop insurance built in"],
  },
  {
    n: "05",
    title: "Watch the season",
    text: "Every new photo and radar pass updates the loan: green-up verified, stress and flooding flagged, harvest detected and a repayment reminder sent. Farmers repay by USSD on any phone.",
    bullets: ["Weekly checks from space", "Flood-triggered insurance", "Harvest-timed reminders", "USSD *326*77#"],
  },
];

const OBJECTIONS = [
  { k: "Ghost farms", v: "Land with no farming history scores 15 and is declined automatically.", tag: "Fraud" },
  { k: "Clouds", v: "Radar sees through rainy-season cloud; no crop is ever declared missing from clouds alone.", tag: "Coverage" },
  { k: "The wrong field", v: "GPS walk by an agent, BVN check, and one field can back only one loan.", tag: "Identity" },
  { k: "Diverted loans", v: "Inputs as vouchers at vetted dealers; tranche two only after green-up.", tag: "Use of funds" },
  { k: "Bad weather", v: "Flooding seen from space opens an insurance claim and a restructure.", tag: "Risk" },
];

const TEAM = [
  { name: "Helen", role: "Team lead & pitch" },
  { name: "Wali Medugu", role: "Engineering" },
  { name: "Joan Ginikachi Azike", role: "Research" },
  { name: "Timothy Ojo Adetunji", role: "Engineering" },
];

function Orbit({ seed }: { seed: number }) {
  return (
    <svg viewBox="0 0 200 200" width="100%" height="100%" aria-hidden style={{ maxWidth: 180 }}>
      {[30, 46, 62, 78].map((r, i) => (
        <ellipse key={r} cx="100" cy="100" rx={r} ry={r * (0.32 + ((seed + i) % 3) * 0.12)} transform={`rotate(${seed * 23 + i * 31} 100 100)`} fill="none" stroke="currentColor" strokeWidth="1" opacity={0.75 - i * 0.12} />
      ))}
      <circle cx="100" cy="100" r="5" fill="var(--lime)" />
      <circle cx={100 + 78 * Math.cos(seed)} cy={100 + 30 * Math.sin(seed)} r="3" fill="currentColor" />
    </svg>
  );
}

export function Landing() {
  const nav = useNavigate();
  const root = useReveal<HTMLDivElement>();
  const { data: showcase = [] } = useQuery({ queryKey: ["showcase"], queryFn: () => api<ShowcaseField[]>("/showcase") });
  const { data: stats } = useQuery({ queryKey: ["stats"], queryFn: () => api<Stats>("/stats") });
  const farms = showcase.filter((s) => s.kind === "showcase");
  const zaria = farms.find((s) => s.key === "showcase-zaria") ?? farms[0];
  const kachia = farms.find((s) => s.key === "showcase-kachia") ?? farms[1];
  const kuje = farms.find((s) => s.key === "showcase-kuje") ?? farms[2];
  const heroA = breathing(zaria).map((f) => frameUrl(f, "rgb", zaria?.key, 512));
  const heroB = breathing(kachia).reverse().map((f) => frameUrl(f, "rgb", kachia?.key, 512));
  const fieldsImg = breathing(kuje).map((f) => frameUrl(f, "rgb", kuje?.key, 512));

  return (
    <div ref={root}>
      <TopBar
        links={[
          { to: "/explore", label: "Explore" },
          { to: "/#how", label: "How it works" },
          { to: "/#evidence", label: "Evidence" },
          { to: "/#team", label: "Team" },
        ]}
        cta={{ to: "/console", label: "Open console" }}
      />

      {/* Hero */}
      <section className="ruled cols-2" style={{ minHeight: "calc(100vh - 56px)", gridTemplateRows: "1fr 1fr" }}>
        <div className="stack pad-lg fit" style={{ justifyContent: "space-between" }}>
          <div className="stack gap-8">
            <span className="label sq">Credit for young farmers</span>
            <span className="label faint">Underwritten from space · Built for Ecobank</span>
          </div>
          <h1 className="display d-fit">SkyScore</h1>
        </div>
        <div style={{ minHeight: 280 }}>{heroA.length > 0 && <Halftone src={heroA} cell={7} interval={3.2} label="A real maize field near Zaria, dry season and rainy season" />}</div>
        <div style={{ minHeight: 280 }}>{heroB.length > 0 && <Halftone src={heroB} cell={8} interval={4.1} shape="square" label="A real field near Kachia from space" />}</div>
        <div className="ruled cols-2" style={{ borderBottom: 0 }}>
          <div className="block stack pad-lg">
            <p className="lead">Eight years of satellite photos prove a young farmer's field is real and farmed. SkyScore turns that proof into an input loan in minutes.</p>
            <div className="end" style={{ paddingTop: 24 }}>
              <button className="btn on-block full" onClick={() => nav("/explore")}>
                Try it on a real farm <span className="arrow">→</span>
              </button>
            </div>
          </div>
          <div className="accent stack pad-lg">
            <p className="lead">No collateral. No paperwork. Evidence.</p>
            <p className="muted" style={{ marginTop: 14 }}>
              Copernicus Sentinel-1 &amp; -2 · ESA WorldCover · NASA POWER — free, open and refreshed every five days.
            </p>
            <div className="end label" style={{ paddingTop: 24 }}>
              {stats ? `${stats.photosOnRecord.toLocaleString()} photos on record for the demo fields` : " "}
            </div>
          </div>
        </div>
      </section>

      {/* Statement */}
      <section className="ruled cols-2">
        <div className="block stack pad-lg" style={{ minHeight: 420, justifyContent: "flex-end" }}>
          <h2 className="display d-xl upper reveal">
            Proven
            <br />
            from space.
          </h2>
        </div>
        <div className="stack" style={{ minHeight: 420 }}>
          <div className="fogbg pad-lg" style={{ borderBottom: "1px solid var(--rule)" }}>
            <h2 className="display d-xl reveal">Fields</h2>
          </div>
          <div style={{ flex: 1, minHeight: 240 }}>{fieldsImg.length > 0 && <Halftone src={fieldsImg} cell={6} interval={3.6} label="A real field near Kuje from space" />}</div>
        </div>
      </section>

      {/* Problem */}
      <section className="ruled cols-2">
        <div className="pad-lg stack gap-16">
          <span className="label sq">The problem</span>
          <p className="faint" style={{ maxWidth: 380 }}>
            Banks can't see a smallholder's field without a costly visit, so they don't lend — and when they do, ghost farms and diverted cash make agri-lending a byword for loss.
          </p>
        </div>
        <div className="pad-lg stack gap-24" style={{ maxWidth: 820 }}>
          <p className="d-sm reveal">Nigeria's young farmers can't get credit. They have no land title, no credit history and no collateral — only a field and the will to farm it.</p>
          <p className="d-sm reveal muted">But every field in Nigeria has been photographed from space every five days since 2017. Its farming record already exists. SkyScore reads it.</p>
        </div>
      </section>

      {/* Stats */}
      <section className="ruled cols-4">
        <div className="kpi block">
          <span className="v">
            5<small>days</small>
          </span>
          <span className="label k">Between Sentinel-2 photos of every field in Nigeria</span>
        </div>
        <div className="kpi">
          <span className="v">
            &lt;60<small>sec</small>
          </span>
          <span className="label k">To read eight seasons of a field's history</span>
        </div>
        <div className="kpi accent">
          <span className="v num">{stats ? stats.photosRead.toLocaleString() : "—"}</span>
          <span className="label k">Satellite photos behind this demo's loan book</span>
        </div>
        <div className="kpi fogbg">
          <span className="v num">{stats?.repaymentRate !== null && stats?.repaymentRate !== undefined ? `${Math.round(stats.repaymentRate)}%` : "—"}</span>
          <span className="label k">
            {stats ? `${stats.loans} sandbox loans · ${nairaShort(stats.disbursed)} in inputs · ${stats.ghostFarmsBlocked} ghost farms blocked` : "Sandbox loan book"}
          </span>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="ruled cols-2">
        <div className="fogbg pad-lg stack sticky-col" style={{ justifyContent: "space-between", minHeight: 360 }}>
          <span className="label sq">How it works</span>
          <h2 className="display d-xl upper reveal">
            From
            <br />
            orbit to
            <br />
            inputs
          </h2>
        </div>
        <div className="block">
          {STEPS.map((s, i) => (
            <div key={s.n} className="ruled" style={{ gridTemplateColumns: "1fr 1.4fr", background: "rgba(255,255,255,.12)", borderBottom: i < STEPS.length - 1 ? "1px solid rgba(255,255,255,.12)" : 0 }}>
              <div className="block pad-lg stack gap-16">
                <span className="label muted">{s.n}</span>
                <h3 className="d-sm">{s.title}</h3>
                <div style={{ color: "rgba(255,255,255,.65)", marginTop: 8 }} className="hide-sm">
                  <Orbit seed={i + 1} />
                </div>
              </div>
              <div className="block pad-lg stack gap-24">
                <p className="muted">{s.text}</p>
                <ul className="bullets end">
                  {s.bullets.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Evidence */}
      <section id="evidence">
        <div className="ruled cols-2">
          <div className="pad-lg stack gap-16">
            <span className="label sq">Evidence</span>
            <h2 className="display d-lg reveal">Real fields, real verdicts.</h2>
          </div>
          <div className="pad-lg stack gap-16" style={{ justifyContent: "flex-end" }}>
            <p className="muted" style={{ maxWidth: 520 }}>
              Four farms in Kaduna, Niger and the FCT, and three pieces of land that aren't farms at all — a town, a woodland and the bush near Zuma Rock. Same pipeline, same policy. Click any to see the satellites work.
            </p>
            <div>
              <Link to="/explore" className="btn">
                Draw your own field <span className="arrow">→</span>
              </Link>
            </div>
          </div>
        </div>
        <div className="ruled cols-4">
          {showcase.map((s) => (
            <button key={s.key} onClick={() => nav(`/explore?field=${s.key}`)} className="stack" style={{ border: 0, padding: 0, textAlign: "left", cursor: "pointer", background: "var(--bg)" }}>
              <div style={{ aspectRatio: "4/3", position: "relative", background: "var(--bg-2)" }}>
                {s.thumbnail && <Halftone src={frameUrl(s.thumbnail, "rgb", s.key, 512)} cell={5} label={`${s.place} from space`} />}
                <span className={`pill solid ${tone(s.ghost ? "GHOST_DECLINED" : s.decision)}`} style={{ position: "absolute", left: 12, top: 12, background: "var(--bg)" }}>
                  {s.ghost ? "Ghost farm · declined" : s.decision === "APPROVE" ? `Band ${s.band} · approve` : s.decision === "REVIEW" ? "Officer review" : "Declined"}
                </span>
              </div>
              <div className="pad stack gap-8" style={{ borderTop: "1px solid var(--rule)" }}>
                <div className="row between">
                  <span style={{ fontWeight: 500, fontSize: 18, letterSpacing: "-0.02em" }}>{s.place}</span>
                  <span className="mono num" style={{ fontSize: 26, letterSpacing: "-0.04em" }}>
                    {s.score}
                  </span>
                </div>
                <span className="label faint">
                  {s.kind === "control" ? "Not a farm" : s.cropLabel} · {s.areaHa.toFixed(2)} ha · {s.cultivatedSeasons}/{s.seasonsConsidered} seasons farmed
                </span>
              </div>
            </button>
          ))}
          <button onClick={() => nav("/explore")} className="accent stack pad-lg" style={{ border: 0, textAlign: "left", cursor: "pointer", justifyContent: "space-between", minHeight: 280 }}>
            <span className="label sq">Your turn</span>
            <span className="display d-md">Draw any field in Nigeria.</span>
            <span className="row between label">
              Open the explorer <span style={{ fontSize: 20 }}>→</span>
            </span>
          </button>
        </div>
      </section>

      {/* Time-lapse */}
      {zaria && (
        <section className="ruled cols-2">
          <div className="pad-lg stack gap-16">
            <span className="label sq">Watch a field breathe</span>
            <h2 className="display d-md reveal">Brown every dry season, green every rainy season, eight years running.</h2>
            <p className="muted" style={{ maxWidth: 460 }}>
              {zaria.place}: {zaria.cultivatedSeasons} of the last {zaria.seasonsConsidered} seasons farmed, read from {zaria.clearPhotos} clear photos out of {zaria.photosFound} on record. That rhythm is the credit history the farmer never had on paper.
            </p>
            <div className="end">
              <Pill status="CULTIVATED" label={`SkyScore ${zaria.score} · band ${zaria.band}`} />
            </div>
          </div>
          <div>
            <Timelapse frames={zaria.frames} snap={zaria.key} columns={4} />
          </div>
        </section>
      )}

      {/* Objections */}
      <section className="ruled cols-2">
        <div className="fogbg pad-lg stack sticky-col" style={{ justifyContent: "space-between" }}>
          <span className="label sq">Why it holds up</span>
          <h2 className="display d-lg reveal">Built for the hard questions.</h2>
        </div>
        <div>
          {OBJECTIONS.map((o) => (
            <div key={o.k} className="row between gap-24 pad-lg" style={{ borderBottom: "1px solid var(--rule)", alignItems: "flex-start" }}>
              <div className="stack gap-8">
                <h3 className="d-sm">{o.k}</h3>
                <p className="muted" style={{ maxWidth: 520 }}>
                  {o.v}
                </p>
              </div>
              <span className="label faint" style={{ whiteSpace: "nowrap" }}>
                {o.tag}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Team */}
      <section id="team" className="ruled cols-4">
        {TEAM.map((t, i) => (
          <div key={t.name} className="stack" style={{ minHeight: 360 }}>
            <div style={{ flex: 1, minHeight: 220, position: "relative" }}>
              {farms[i] && <Halftone src={frameUrl(farms[i].thumbnail ?? farms[i].frames[0], "rgb", farms[i].key, 512)} cell={6} shape={i % 2 ? "square" : "circle"} label="Farmland from space" />}
            </div>
            <div className="accent row between pad" style={{ alignItems: "flex-end" }}>
              <div className="stack gap-4">
                <span style={{ fontSize: 22, fontWeight: 500, letterSpacing: "-0.03em", lineHeight: 1.05 }}>{t.name}</span>
                <span className="label">{t.role}</span>
              </div>
              <span style={{ fontSize: 20 }}>→</span>
            </div>
          </div>
        ))}
      </section>

      {/* Footer */}
      <footer className="block">
        <div className="ruled cols-2" style={{ background: "rgba(255,255,255,.12)", borderBottom: 0 }}>
          <div className="block pad-lg stack gap-24 fit" style={{ minHeight: 320, justifyContent: "space-between" }}>
            <div className="row gap-12">
              <Logo size={36} />
              <span className="label">Tensor Labs · InnovateX 2026, Abuja</span>
            </div>
            <h2 className="display d-fit">SkyScore</h2>
          </div>
          <div className="block pad-lg stack gap-24">
            <div className="ruled cols-2" style={{ background: "transparent", borderBottom: 0, gap: 24 }}>
              {[
                ["Explore a field", "/explore"],
                ["Loan officer console", "/console"],
                ["Agro-dealer portal", "/dealer"],
                ["API reference", "/docs"],
                ["Field app (Android)", "/skyscore-field.apk"],
              ].map(([label, to]) => (
                <a key={to} href={to} className="row between label" style={{ background: "transparent", borderBottom: "1px solid rgba(255,255,255,.2)", paddingBottom: 10 }}>
                  {label} <span>→</span>
                </a>
              ))}
            </div>
            <p className="muted end" style={{ fontSize: 13, maxWidth: 560 }}>
              Prototype for the InnovateX 2026 hackathon. Sandbox only: accounts, BVN checks and SMS are simulated and no real money moves. Contains modified Copernicus Sentinel data (2018–2026), processed via the Microsoft Planetary Computer; ESA WorldCover 2021; Impact Observatory land cover; NASA POWER. {stats ? `Demo book: ${stats.farmers} farmers, ${stats.hectares} ha, ${naira(stats.disbursed)} in inputs.` : ""}
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
