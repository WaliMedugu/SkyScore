// Tiny API client: JSON in/out, bearer token, readable errors.

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: { field: string; message: string }[],
  ) {
    super(message);
  }
}

export interface User {
  id: string;
  username: string;
  name: string;
  role: "officer" | "agent" | "dealer" | "admin";
  dealerId: string | null;
}

const KEY = "skyscore.session";
function load(): { token: string; user: User } | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as { token: string; user: User }) : null;
  } catch {
    return null;
  }
}
let session = load();

export const auth = {
  get token() {
    return session?.token ?? null;
  },
  get user() {
    return session?.user ?? null;
  },
  set(token: string, user: User) {
    session = { token, user };
    try {
      localStorage.setItem(KEY, JSON.stringify(session));
    } catch {
      /* private mode: keep it in memory */
    }
    window.dispatchEvent(new Event("skyscore:auth"));
  },
  clear() {
    session = null;
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event("skyscore:auth"));
  },
};

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (session?.token) headers.authorization = `Bearer ${session.token}`;
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "Can't reach the SkyScore server. Check the connection.");
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = (data as { error?: { message?: string; details?: { field: string; message: string }[] } } | null)?.error;
    if (res.status === 401 && session) auth.clear();
    throw new ApiError(res.status, err?.message ?? `Request failed (${res.status}).`, err?.details);
  }
  return data as T;
}

export const post = <T = unknown>(path: string, body: unknown = {}) => api<T>(path, { method: "POST", body });
export const patch = <T = unknown>(path: string, body: unknown) => api<T>(path, { method: "PATCH", body });

/** URL of one time-lapse frame (served from saved snapshots when available). */
export function frameUrl(f: { sceneId: string; bbox: number[] }, kind: "rgb" | "ndvi" = "rgb", snap?: string | null, size = 256) {
  const q = new URLSearchParams({ bbox: f.bbox.join(","), kind, size: String(size) });
  if (snap) q.set("snap", snap);
  return `/api/v1/scenes/${encodeURIComponent(f.sceneId)}/image?${q}`;
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.details?.length ? `${e.message} ${e.details.map((d) => d.message).join(" ")}` : e.message;
  return e instanceof Error ? e.message : String(e);
}
