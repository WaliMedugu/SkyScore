import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router";
import { api, errorText, frameUrl } from "../lib/api";
import { ROLE_LABEL, useSession } from "../lib/session";
import type { ShowcaseField } from "../lib/types";
import { TopBar } from "../components/chrome";
import { Halftone } from "../components/Halftone";

const ROLES = [
  { username: "amina", role: "officer" },
  { username: "ibrahim", role: "agent" },
  { username: "musa", role: "dealer" },
] as const;

export function Login() {
  const nav = useNavigate();
  const loc = useLocation();
  const { signIn } = useSession();
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: fields = [] } = useQuery({ queryKey: ["showcase"], queryFn: () => api<ShowcaseField[]>("/showcase") });
  const bg = fields.find((f) => f.key === "showcase-kachia") ?? fields[0];
  const from = (loc.state as { from?: string } | null)?.from;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const u = await signIn(username.trim(), pin);
      nav(from ?? (u.role === "dealer" ? "/dealer" : "/console"), { replace: true });
    } catch (x) {
      setErr(errorText(x));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <TopBar links={[{ to: "/", label: "Home", end: true }, { to: "/explore", label: "Explore" }]} />
      <section className="ruled cols-2" style={{ minHeight: "calc(100vh - 56px)" }}>
        <div className="block stack" style={{ position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, opacity: 0.28 }}>{bg?.thumbnail && <Halftone src={frameUrl(bg.thumbnail, "rgb", bg.key, 512)} cell={7} color="#BED600" label="Farmland near Kachia" />}</div>
          <div className="pad-lg stack" style={{ position: "relative", flex: 1, justifyContent: "flex-end" }}>
            <span className="label">Ecobank agri-finance · sandbox</span>
            <h1 className="display d-xl" style={{ marginTop: 16 }}>
              Console
            </h1>
          </div>
        </div>
        <div className="pad-lg" style={{ display: "grid", placeItems: "center" }}>
        <form onSubmit={submit} className="stack gap-24" style={{ maxWidth: 480, width: "100%" }}>
          <span className="label sq">Sign in</span>
          <h2 className="display d-md">Loan officers, field agents and agro-dealers.</h2>
          <label className="field">
            <span className="label">Username</span>
            <input className="input" aria-label="Username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
          </label>
          <label className="field">
            <span className="label">PIN</span>
            <input className="input" aria-label="PIN" type="password" inputMode="numeric" autoComplete="current-password" pattern="\d{4,6}" value={pin} onChange={(e) => setPin(e.target.value)} required />
          </label>
          {err && <p className="err">{err}</p>}
          <button className="btn lime full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"} <span className="arrow">→</span>
          </button>
          <div className="stack gap-8">
            <span className="label faint">Sandbox accounts (PINs in apps/api/src/seed/users.ts)</span>
            <div className="row gap-8 wrap">
              {ROLES.map((r) => (
                <button type="button" key={r.username} className="btn ghost small" onClick={() => setUsername(r.username)}>
                  {ROLE_LABEL[r.role]}: {r.username}
                </button>
              ))}
            </div>
          </div>
        </form>
        </div>
      </section>
    </div>
  );
}
