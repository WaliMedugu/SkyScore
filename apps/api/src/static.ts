// Serves the built web app (apps/web/dist) with an SPA fallback, so one process hosts API + site.
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import type { Context } from "hono";
import { WEB_DIST } from "./config.ts";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".apk": "application/vnd.android.package-archive",
};

const NOT_BUILT = `<!doctype html><meta charset="utf-8"><title>SkyScore API</title>
<body style="font:16px/1.5 system-ui;margin:48px;max-width:640px;color:#023448">
<h1>SkyScore API is running</h1>
<p>The web console hasn't been built yet. Run <code>npm run build</code> in the repo root, or <code>npm run dev</code> for live reload.</p>
<p><a href="/docs">API reference →</a></p></body>`;

function file(path: string) {
  try {
    const s = statSync(path);
    return s.isFile() ? s : null;
  } catch {
    return null;
  }
}

export function serveWeb(c: Context) {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") return c.json({ error: { message: "Not found." } }, 404);
  const rel = decodeURIComponent(new URL(c.req.url).pathname);
  const root = normalize(WEB_DIST + sep);
  const target = normalize(join(WEB_DIST, rel));
  // Refuse anything that escapes the web root.
  if (!target.startsWith(root) && target !== normalize(WEB_DIST)) return c.text("Not found", 404);
  // A folder with its own index.html is a separate app (the Flutter field app at /field/).
  try {
    if (statSync(target).isDirectory() && existsSync(join(target, "index.html"))) {
      if (!rel.endsWith("/")) return c.redirect(`${rel}/`, 301);
      return c.body(readFileSync(join(target, "index.html"), "utf8"), 200, { "content-type": TYPES[".html"], "cache-control": "no-cache" });
    }
  } catch {
    /* not a folder */
  }
  const hit = file(target);
  if (hit) {
    const type = TYPES[extname(target).toLowerCase()] ?? "application/octet-stream";
    const immutable = rel.startsWith("/assets/");
    return c.body(new Uint8Array(readFileSync(target)), 200, {
      "content-type": type,
      "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    });
  }
  // Unknown file with an extension: a real 404. Otherwise it's a client-side route: serve the app shell.
  if (extname(rel)) return c.text("Not found", 404);
  const index = join(WEB_DIST, "index.html");
  if (!existsSync(index)) return c.html(NOT_BUILT);
  return c.body(readFileSync(index, "utf8"), 200, { "content-type": TYPES[".html"], "cache-control": "no-cache" });
}
