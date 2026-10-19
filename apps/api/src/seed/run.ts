// npm run seed — wipe the database and rebuild the demo bank from the real-field snapshots.
// --template: also compact it into a single self-contained file (the serverless build ships it as data/demo.db).
import { db } from "../db.ts";
import { snapshots } from "../satellite.ts";
import { seedAll } from "./seed.ts";

const n = snapshots.load();
if (!n) {
  console.error("No snapshots in data/snapshots. Run `npm run snapshots` first (needs internet once).");
  process.exit(1);
}
const t0 = Date.now();
const r = await seedAll({ reset: true });
console.log(`Seeded ${r.farmers} farmers, ${r.farms} farms and ${r.loans} loans on ${n} real fields in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
if (process.argv.includes("--template")) {
  // Fold the write-ahead log into the main file so the database is one file that can be copied anywhere.
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.exec("PRAGMA journal_mode = DELETE");
  db.exec("VACUUM");
  db.close();
  console.log("Compacted into a single template file.");
} else {
  console.log("Demo sign-ins are listed in apps/api/src/seed/users.ts.");
}
