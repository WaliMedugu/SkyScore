import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { hash } from "@skyscore/engine";
import type { Cache } from "./http.ts";

/** Cache on disk, one file per response (used by the scripts). */
export class FileCache implements Cache {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }
  private path(key: string) {
    return join(this.dir, `${hash(key)}.json`);
  }
  get(key: string) {
    const p = this.path(key);
    return existsSync(p) ? readFileSync(p, "utf8") : null;
  }
  set(key: string, value: string) {
    writeFileSync(this.path(key), value);
  }
}
