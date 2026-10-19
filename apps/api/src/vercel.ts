// Vercel Function entry: the whole Hono app behind Vercel's Node launcher. Bundled by scripts/build-vercel.mjs.
import type { IncomingMessage, ServerResponse } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { createApp } from "./app.ts";
import { one } from "./db.ts";
import { snapshots } from "./satellite.ts";
import { seedAll } from "./seed/seed.ts";

snapshots.load();

// The bundle ships a seeded template database; seed here only if it is missing.
let ready: Promise<void> | null = null;
const boot = () =>
  (ready ??= (async () => {
    if (!one("SELECT 1 FROM users LIMIT 1")) await seedAll();
  })());

const listener = getRequestListener(createApp().fetch);
const API_PATH = /^\/(api\/|docs$|openapi\.json$)/;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  // Routing sends /api/*, /docs and /openapi.json here as /api?__p=<path>. Vercel normally keeps the original
  // path; if it ever arrives as /api, rebuild it from __p. Either way, drop the helper parameter.
  const url = new URL(req.url ?? "/", "http://localhost");
  const original = url.searchParams.get("__p");
  if (original !== null) {
    url.searchParams.delete("__p");
    if (!API_PATH.test(url.pathname)) url.pathname = `/${original}`;
    req.url = `${url.pathname}${url.search}`;
  }
  await boot();
  return listener(req, res);
}
