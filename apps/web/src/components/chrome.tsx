// Site chrome: logo, live city clock, theme toggle, top bar, reveal-on-scroll, toasts, modal, pills.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink } from "react-router";
import { tone, words } from "../lib/format";

/** SkyScore mark: field strips under an orbiting satellite. */
export function Logo({ size = 28, color = "#fff", accent = "#BED600" }: { size?: number; color?: string; accent?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-label="SkyScore" role="img">
      <path d="M5 26 L13 9 M11 26 L19 9 M17 26 L25 9" stroke={accent} strokeWidth="2.6" strokeLinecap="square" fill="none" />
      <path d="M17.5 5.5 A 9 4 -20 0 1 30 9" stroke={color} strokeWidth="1.2" fill="none" opacity="0.7" />
      <circle cx="26.5" cy="6" r="2.6" fill={color} />
    </svg>
  );
}

const CITIES = [
  { name: "LAGOS", tz: "Africa/Lagos" },
  { name: "ACCRA", tz: "Africa/Accra" },
  { name: "LOMÉ", tz: "Africa/Lome" },
  { name: "NAIROBI", tz: "Africa/Nairobi" },
  { name: "ABUJA", tz: "Africa/Lagos" },
];

/** Live clock that cycles through cities where Ecobank's African network runs. */
export function Clock() {
  const [now, setNow] = useState(() => new Date());
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    const c = setInterval(() => setI((x) => (x + 1) % CITIES.length), 4000);
    return () => {
      clearInterval(t);
      clearInterval(c);
    };
  }, []);
  const city = CITIES[i];
  const s = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: city.tz });
  return (
    <span className="mono num" aria-live="off">
      {s} {city.name}
    </span>
  );
}

export function useTheme() {
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute("data-theme") ?? "light");
  const toggle = useCallback(() => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("skyscore.theme", next);
    } catch {
      /* ignore */
    }
    setTheme(next);
  }, [theme]);
  return { theme, toggle };
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button className="theme-toggle" onClick={toggle} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} title="Light / dark">
      <i className={theme === "light" ? "" : "on"} />
      <i className={theme === "light" ? "on" : ""} />
    </button>
  );
}

export function TopBar({ links, cta, extra }: { links?: { to: string; label: string; end?: boolean }[]; cta?: { to: string; label: string }; extra?: ReactNode }) {
  return (
    <header className="topbar">
      <Link to="/" className="logo-cell" aria-label="SkyScore home">
        <Logo />
      </Link>
      <div className="clock">
        <Clock />
        {extra}
      </div>
      <nav>
        {(links ?? []).map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => (isActive ? "active" : "")}>
            {l.label}
          </NavLink>
        ))}
        <ThemeToggle />
      </nav>
      {cta ? (
        <Link to={cta.to} className="cta">
          {cta.label} <span aria-hidden>→</span>
        </Link>
      ) : (
        <span />
      )}
    </header>
  );
}

/** Fade elements in as they scroll into view — including ones rendered later, when data arrives. */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    const watch = () => el.querySelectorAll(".reveal:not(.in)").forEach((i) => io.observe(i));
    watch();
    const mo = new MutationObserver(watch);
    mo.observe(el, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, []);
  return ref;
}

export function Pill({ status, label, solid }: { status: string | null | undefined; label?: string; solid?: boolean }) {
  if (!status) return <span className="faint">—</span>;
  return <span className={`pill ${tone(status)} ${solid ? "solid" : ""}`}>{label ?? words(status)}</span>;
}

/* ── Toasts ────────────────────────────────────────────────────────────── */

interface ToastItem {
  id: number;
  text: string;
  bad?: boolean;
}
const ToastCtx = createContext<(text: string, bad?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, bad = false) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, bad }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), bad ? 7000 : 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.bad ? "bad" : ""}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="row between pad" style={{ borderBottom: "1px solid var(--rule)" }}>
          <span className="label sq">{title}</span>
          <button className="btn ghost small" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="pad">{children}</div>
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div>
      <div className="loading-bar" />
      <div className="empty label">{label}…</div>
    </div>
  );
}
