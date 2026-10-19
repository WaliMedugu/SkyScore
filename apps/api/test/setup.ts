// Each test run gets a fresh database, works offline (saved real fields only) and runs in sandbox mode.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "skyscore-test-"));
process.env.SKYSCORE_DB = join(dir, "test.db");
process.env.SKYSCORE_OFFLINE = "1";
process.env.SKYSCORE_SANDBOX = "1";
process.env.SKYSCORE_DEMO_CLOCK = "1";
process.env.SKYSCORE_JWT_SECRET = "test-secret-not-for-production";
