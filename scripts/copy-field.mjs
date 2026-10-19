// Copy the Flutter web build of the field app into the website, so the server hosts it at /field/.
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(ROOT, "apps", "field", "build", "web");
const to = join(ROOT, "apps", "web", "public", "field");
if (!existsSync(join(from, "index.html"))) {
  console.error("No Flutter web build found. Run `flutter build web --base-href /field/` in apps/field first.");
  process.exit(1);
}
rmSync(to, { recursive: true, force: true });
// Flutter's debug symbol files aren't needed to run the app.
cpSync(from, to, { recursive: true, filter: (src) => !src.endsWith(".symbols") });
console.log(`Field app copied to ${to}. Run \`npm run build\` to include it in the site.`);
