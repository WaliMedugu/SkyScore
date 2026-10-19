import { hash } from "@skyscore/engine";

/** Anything that can store strings by key (SQLite in the API, files in scripts, memory in tests). */
export interface Cache {
  get(key: string): string | null | Promise<string | null>;
  set(key: string, value: string): void | Promise<void>;
}

export class MemoryCache implements Cache {
  private m = new Map<string, string>();
  get(k: string) {
    return this.m.get(k) ?? null;
  }
  set(k: string, v: string) {
    this.m.set(k, v);
  }
}

export class OfflineMiss extends Error {
  constructor(url: string) {
    super(`Offline mode: no cached response for ${url.slice(0, 120)}`);
  }
}

export interface HttpOptions {
  cache: Cache;
  /** Answer only from cache (demo with no internet). */
  offline?: boolean;
  timeoutMs?: number;
  retries?: number;
  concurrency?: number;
  userAgent?: string;
}

/** Small concurrency gate so we stay polite to free public services. */
class Gate {
  private active = 0;
  private queue: (() => void)[] = [];
  constructor(private readonly max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** JSON/bytes HTTP client with retries, backoff, a concurrency gate and a response cache. */
export class Http {
  readonly cache: Cache;
  offline: boolean;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly gate: Gate;
  private readonly ua: string;
  stats = { requests: 0, cacheHits: 0, retries: 0, failures: 0 };

  constructor(o: HttpOptions) {
    this.cache = o.cache;
    this.offline = o.offline ?? false;
    this.timeoutMs = o.timeoutMs ?? 25_000;
    this.retries = o.retries ?? 4;
    this.gate = new Gate(o.concurrency ?? 6);
    this.ua = o.userAgent ?? "SkyScore/1.0 (InnovateX 2026; Tensor Labs)";
  }

  private key(method: string, url: string, body?: unknown) {
    return `${method} ${hash(url + (body === undefined ? "" : JSON.stringify(body)))}`;
  }

  async json<T>(method: "GET" | "POST", url: string, body?: unknown, opts: { cache?: boolean } = {}): Promise<T> {
    const useCache = opts.cache !== false;
    const key = this.key(method, url, body);
    if (useCache) {
      const hit = await this.cache.get(key);
      if (hit !== null) {
        this.stats.cacheHits++;
        return JSON.parse(hit) as T;
      }
    }
    if (this.offline) throw new OfflineMiss(url);
    const res = await this.request(method, url, body);
    const text = await res.text();
    if (useCache) await this.cache.set(key, text);
    return JSON.parse(text) as T;
  }

  async bytes(url: string): Promise<{ data: Uint8Array; type: string }> {
    const key = this.key("BYTES", url);
    const hit = await this.cache.get(key);
    if (hit !== null) {
      this.stats.cacheHits++;
      const o = JSON.parse(hit) as { b64: string; type: string };
      return { data: Uint8Array.from(Buffer.from(o.b64, "base64")), type: o.type };
    }
    if (this.offline) throw new OfflineMiss(url);
    const res = await this.request("GET", url);
    const data = new Uint8Array(await res.arrayBuffer());
    const type = res.headers.get("content-type") ?? "application/octet-stream";
    await this.cache.set(key, JSON.stringify({ b64: Buffer.from(data).toString("base64"), type }));
    return { data, type };
  }

  private async request(method: string, url: string, body?: unknown): Promise<Response> {
    return this.gate.run(async () => {
      let lastErr: unknown;
      for (let attempt = 0; attempt <= this.retries; attempt++) {
        if (attempt > 0) {
          this.stats.retries++;
          await sleep(Math.min(8000, 400 * 2 ** attempt) + Math.random() * 300);
        }
        this.stats.requests++;
        try {
          const res = await fetch(url, {
            method,
            headers: { "content-type": "application/json", "user-agent": this.ua, accept: "application/json, image/png, */*" },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(this.timeoutMs),
          });
          if (res.ok) return res;
          // Retry rate limits and server errors; give up on client errors.
          if (res.status === 429 || res.status >= 500) {
            lastErr = new Error(`HTTP ${res.status} from ${new URL(url).host}`);
            const ra = Number(res.headers.get("retry-after"));
            if (ra > 0) await sleep(Math.min(ra, 10) * 1000);
            continue;
          }
          const text = await res.text().catch(() => "");
          throw new HttpError(res.status, `HTTP ${res.status}: ${text.slice(0, 200)}`);
        } catch (e) {
          if (e instanceof HttpError) throw e;
          lastErr = e; // network error, timeout, reset: retry
        }
      }
      this.stats.failures++;
      throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    });
  }
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
