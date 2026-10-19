// Console shell: signed-in top bar, left rail with live counts, page outlet.
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, NavLink, Outlet, useLocation } from "react-router";
import { api } from "../../lib/api";
import { date } from "../../lib/format";
import { ROLE_LABEL, useSession } from "../../lib/session";
import type { Summary } from "../../lib/types";
import { Clock, Logo, ThemeToggle } from "../../components/chrome";

export function useSummary() {
  return useQuery({ queryKey: ["summary"], queryFn: () => api<Summary>("/portfolio/summary"), refetchInterval: 15_000 });
}

export function ConsoleLayout() {
  const { user, signOut } = useSession();
  const loc = useLocation();
  const { data: s } = useSummary();
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (user.role === "dealer") return <Navigate to="/dealer" replace />;

  const items: { to: string; label: string; count?: number; end?: boolean }[] = [
    { to: "/console", label: "Overview", end: true },
    { to: "/console/applications", label: "Applications", count: s?.applications.byStatus.REVIEW },
    { to: "/console/loans", label: "Loans" },
    { to: "/console/farmers", label: "Farmers" },
    { to: "/console/alerts", label: "Alerts", count: s?.alertsOpen },
    { to: "/console/dealers", label: "Agro-dealers" },
    { to: "/console/ussd", label: "USSD *326*77#" },
    { to: "/console/messages", label: "SMS outbox" },
    { to: "/console/policy", label: "Credit policy" },
    { to: "/console/activity", label: "Activity" },
  ];

  return (
    <div>
      <header className="topbar">
        <Link to="/" className="logo-cell" aria-label="SkyScore home">
          <Logo />
        </Link>
        <div className="clock gap-16">
          <Clock />
          {s && (
            <span className="label hide-sm" style={{ padding: "4px 8px", background: "var(--lime)", color: "var(--navy)" }} title="Business date: the season clock the demo replays">
              Season {s.season} · {date(s.demoClock)}
            </span>
          )}
        </div>
        <nav>
          <span className="label">
            {user.name} · {ROLE_LABEL[user.role]}
          </span>
          <ThemeToggle />
        </nav>
        <button className="cta" style={{ border: 0, cursor: "pointer" }} onClick={signOut}>
          Sign out <span aria-hidden>→</span>
        </button>
      </header>
      <div className="console">
        <aside className="rail" aria-label="Console">
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => (isActive ? "active" : "")}>
              <span className="t">{i.label}</span>
              {!!i.count && <span className="count">{i.count}</span>}
            </NavLink>
          ))}
          <a href="/docs" target="_blank" rel="noreferrer">
            <span className="t">API reference ↗</span>
          </a>
          <div className="pad end hide-sm">
            <p className="faint" style={{ fontSize: 12 }}>
              Sandbox: accounts, BVN and SMS are simulated. Satellite data is real.
            </p>
          </div>
        </aside>
        <main style={{ minWidth: 0 }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function PageHead({ label, title, children }: { label: string; title: string; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="stack gap-8">
        <span className="label sq">{label}</span>
        <h1 className="display d-md">{title}</h1>
      </div>
      {children && <div className="row gap-8 wrap">{children}</div>}
    </div>
  );
}
