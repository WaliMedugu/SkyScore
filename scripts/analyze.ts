// Usage: npx tsx analyze.ts <lng> <lat> [sideMetres=100] [fromYear=2018]
import { buildBundle } from "@skyscore/satellite";
import { AS_OF, http, square, summarise } from "./lib.ts";

const [lng, lat, side = "100", from = "2018"] = process.argv.slice(2);
const t0 = Date.now();
const b = await buildBundle(http, square([Number(lng), Number(lat)], Number(side)), {
  asOf: AS_OF,
  fromYear: Number(from),
  onProgress: (p) => {
    if (p.stage !== "optical" || p.done % 25 === 0 || p.done === p.total) process.stdout.write(`\r${p.stage} ${p.done}/${p.total} ${p.message.padEnd(60)}`);
  },
});
console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)}s, http`, http.stats);
summarise(`${lng},${lat}`, b);
