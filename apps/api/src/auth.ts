import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { sign, verify } from "hono/jwt";
import { config } from "./config.ts";
import { one } from "./db.ts";
import { ApiError } from "./util.ts";

export type Role = "officer" | "agent" | "dealer" | "admin";
export interface AuthUser {
  id: string;
  username: string;
  name: string;
  role: Role;
  dealerId: string | null;
}

/** scrypt hash of a PIN: "salt:hash" in hex. */
export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(pin, salt, 32).toString("hex")}`;
}
export function checkPin(pin: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [s, h] = stored.split(":");
  const got = scryptSync(pin, Buffer.from(s, "hex"), 32);
  const want = Buffer.from(h, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function issueToken(u: AuthUser): Promise<string> {
  const nowS = Math.floor(Date.now() / 1000);
  return sign({ sub: u.id, role: u.role, name: u.name, dealerId: u.dealerId, iat: nowS, exp: nowS + 60 * 60 * 12 }, config.jwtSecret, "HS256");
}

type Vars = { Variables: { user: AuthUser } };

/** Require a valid bearer token; optionally restrict to roles (admin always passes). */
export function requireAuth(...roles: Role[]): MiddlewareHandler<Vars> {
  return async (c, next) => {
    const h = c.req.header("authorization") ?? "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : c.req.query("token");
    if (!token) throw new ApiError(401, "Sign in first.");
    let payload: Record<string, unknown>;
    try {
      payload = (await verify(token, config.jwtSecret, "HS256")) as Record<string, unknown>;
    } catch {
      throw new ApiError(401, "Your session has expired. Sign in again.");
    }
    const u = one<{ id: string; username: string; name: string; role: Role; dealer_id: string | null }>(
      "SELECT id, username, name, role, dealer_id FROM users WHERE id = ?",
      payload.sub,
    );
    if (!u) throw new ApiError(401, "Account no longer exists.");
    if (roles.length && u.role !== "admin" && !roles.includes(u.role)) throw new ApiError(403, "Your role can't do this.");
    c.set("user", { id: u.id, username: u.username, name: u.name, role: u.role, dealerId: u.dealer_id });
    await next();
  };
}

/** Narrow an already-authenticated route to some roles (admin always passes). */
export function requireRole(...roles: Role[]): MiddlewareHandler<Vars> {
  return async (c, next) => {
    const u = c.get("user");
    if (!u) throw new ApiError(401, "Sign in first.");
    if (u.role !== "admin" && !roles.includes(u.role)) throw new ApiError(403, "Your role can't do this.");
    await next();
  };
}

/** Sign-in throttle: 5 wrong PINs lock a username for 5 minutes. */
const failures = new Map<string, { n: number; until: number }>();
export function loginAllowed(username: string): boolean {
  const f = failures.get(username);
  return !f || f.until < Date.now() || f.n < 5;
}
export function loginFailed(username: string) {
  const f = failures.get(username);
  const n = f && f.until > Date.now() ? f.n + 1 : 1;
  failures.set(username, { n, until: Date.now() + 5 * 60_000 });
}
export const loginSucceeded = (username: string) => failures.delete(username);

export type AppEnv = Vars;
