// Start the SkyScore server: load real-satellite snapshots, seed demo data on first run, serve API + web.
import { serve } from "@hono/node-server";
import { networkInterfaces } from "node:os";
import { createApp } from "./app.ts";
import { config } from "./config.ts";
import { one } from "./db.ts";
import { snapshots } from "./satellite.ts";
import { seedAll } from "./seed/seed.ts";

const n = snapshots.load();
if (!one("SELECT 1 FROM users LIMIT 1")) {
  console.log("First run: creating the demo bank (users, dealers, farmers, a season of loans)…");
  const t0 = Date.now();
  const s = await seedAll();
  console.log(`  ${s.farmers} farmers, ${s.farms} farms, ${s.loans} loans seeded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

const app = createApp();
const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  const lan = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => `http://${i!.address}:${info.port}`);
  console.log(`\n  SkyScore is up  (${n} real fields on file${config.offline ? ", OFFLINE mode" : ""}${config.sandbox ? ", sandbox" : ""})`);
  console.log(`  Local:    http://localhost:${info.port}`);
  for (const u of lan) console.log(`  Network:  ${u}   ← use this in the field app`);
  console.log(`  API docs: http://localhost:${info.port}/docs\n`);
});

const stop = () => {
  server.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
