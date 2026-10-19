// The API as it runs on Vercel: no background work between requests, so each request finishes its own job.
import { beforeAll, describe, expect, it } from "vitest";

process.env.SKYSCORE_SERVERLESS = "1";
type App = { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
let app: App;
let token = "";

async function req(method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json()) as any };
}

beforeAll(async () => {
  // Imported after the flag is set: the configuration is read once, at import.
  const { createApp } = await import("../src/app.ts");
  const { snapshots } = await import("../src/satellite.ts");
  const { seedAll } = await import("../src/seed/seed.ts");
  const { DEMO_USERS } = await import("../src/seed/users.ts");
  snapshots.load();
  await seedAll({ reset: true });
  app = createApp();
  const agent = DEMO_USERS.find((u) => u.role === "agent")!;
  const login = await req("POST", "/api/v1/auth/login", { username: agent.username, pin: agent.pin });
  token = login.data.token;
});

describe("serverless mode", () => {
  it("scores an application within the request that creates it", async () => {
    const { snapshots } = await import("../src/satellite.ts");
    const f = await req("POST", "/api/v1/farmers", { firstName: "Ada", lastName: "Musa", phone: "08033445566", bvn: "22144556677", consent: true });
    const farm = await req("POST", "/api/v1/farms", { farmerId: f.data.farmer.id, polygon: snapshots.get("showcase-bida")!.polygon, crop: "rice" });
    expect(farm.status).toBe(201);
    expect(farm.data.jobId).toBeNull();
    const t0 = Date.now();
    const a = await req("POST", "/api/v1/applications", { farmId: farm.data.farm.id });
    expect(a.status).toBe(201);
    expect(a.data.application.status).not.toBe("ANALYZING");
    expect(a.data.application.score).toBeGreaterThan(0);
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});
