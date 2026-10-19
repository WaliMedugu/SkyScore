// Build SkyScore for Vercel with the Build Output API (https://vercel.com/docs/build-output-api/v3):
//   .vercel/output/static/              the website (and the Flutter field app at /field/) on Vercel's CDN
//   .vercel/output/functions/api.func/  the whole API as one Node.js function, with the real-field snapshots
//                                       and a pre-seeded database that each cold start copies into /tmp
// Vercel runs this as the project's build command (see vercel.json). Locally: node scripts/build-vercel.mjs
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, ".vercel", "output");
const STATIC = join(OUT, "static");
const FUNC = join(OUT, "functions", "api.func");
const step = (msg) => console.log(`\n▸ ${msg}`);
const sh = (cmd, env = {}) => execSync(cmd, { cwd: ROOT, stdio: "inherit", env: { ...process.env, ...env } });

function sizeOf(dir) {
  let total = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) total += e.isDirectory() ? sizeOf(join(dir, e.name)) : statSync(join(dir, e.name)).size;
  return total;
}
const mb = (b) => `${(b / 1048576).toFixed(1)} MB`;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(STATIC, { recursive: true });
mkdirSync(join(FUNC, "data"), { recursive: true });

step("Website (Vite)");
sh("npm run build -w @skyscore/web");
cpSync(join(ROOT, "apps", "web", "dist"), STATIC, {
  recursive: true,
  // Flutter's debug symbol files aren't needed to run the field app.
  filter: (src) => !src.endsWith(".symbols"),
});
if (!existsSync(join(STATIC, "field", "index.html"))) console.warn("  (no Flutter field app in apps/web/public/field — run `npm run build:field` to include it)");

step("API function (esbuild → one ES module)");
await build({
  entryPoints: [join(ROOT, "apps", "api", "src", "vercel.ts")],
  outfile: join(FUNC, "index.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: false,
  legalComments: "none",
  logLevel: "warning",
  // Marks the bundle as serverless; bundled CommonJS dependencies get a working `require`.
  define: { "process.env.SKYSCORE_SERVERLESS": '"1"' },
  banner: { js: "import { createRequire as __skyCreateRequire } from 'node:module'; const require = __skyCreateRequire(import.meta.url);" },
});

step("Real-field snapshots");
cpSync(join(ROOT, "data", "snapshots"), join(FUNC, "data", "snapshots"), { recursive: true });

step("Pre-seeded demo bank (template database)");
const template = join(FUNC, "data", "demo.db");
sh(`npx tsx apps/api/src/seed/run.ts --template`, {
  SKYSCORE_DB: template,
  SKYSCORE_OFFLINE: "1",
  // The build machine needs no persistent secret; the deployment gets its own below.
  SKYSCORE_JWT_SECRET: "build-only",
});

step("Signing key");
if (process.env.SKYSCORE_JWT_SECRET) {
  console.log("  using SKYSCORE_JWT_SECRET from the project's environment variables");
} else {
  // One random key per deployment, shared by all of its instances (sessions survive cold starts).
  writeFileSync(join(FUNC, "data", ".jwt-secret"), randomBytes(32).toString("hex"));
  console.log("  generated a key for this deployment (set SKYSCORE_JWT_SECRET to keep sessions across deployments)");
}

writeFileSync(
  join(FUNC, ".vc-config.json"),
  JSON.stringify(
    {
      runtime: "nodejs24.x",
      handler: "index.mjs",
      launcherType: "Nodejs",
      shouldAddHelpers: false,
      supportsResponseStreaming: true,
      // Live reads of a never-seen field can take a minute; saved fields answer in seconds.
      maxDuration: 300,
      // Closest Vercel region to both Nigeria and the satellite archive (Microsoft Planetary Computer, West Europe).
      regions: [process.env.SKYSCORE_REGION ?? "lhr1"],
    },
    null,
    2,
  ),
);

step("Routing");
writeFileSync(
  join(OUT, "config.json"),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: "^/assets/(.*)$", headers: { "cache-control": "public, max-age=31536000, immutable" }, continue: true },
        // Every API path goes to the one function (it restores the original path from __p if needed).
        { src: "^/(api/.*|docs|openapi\\.json)$", dest: "/api?__p=$1" },
        { handle: "filesystem" },
        // The Flutter field app and the React single-page app each handle their own client-side routes.
        { src: "^/field(/.*)?$", dest: "/field/index.html" },
        { src: "^/(.*)$", dest: "/index.html" },
      ],
    },
    null,
    2,
  ),
);

console.log(`\n✓ Build output ready in ${relative(ROOT, OUT)}`);
console.log(`  static   ${mb(sizeOf(STATIC))}`);
console.log(`  function ${mb(sizeOf(FUNC))} (limit 250 MB)`);
