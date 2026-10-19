import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { OPS } from "../src/openapi.ts";
import { snapshots } from "../src/satellite.ts";
import { seedAll } from "../src/seed/seed.ts";
import { DEMO_FARMER_USSD_PIN, DEMO_USERS } from "../src/seed/users.ts";

const app = createApp();
type Res = { status: number; data: any; headers: Headers };

async function req(method: string, path: string, body?: unknown, token?: string): Promise<Res> {
  const res = await app.request(path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* plain text */
  }
  return { status: res.status, data, headers: res.headers };
}

const pin = (u: string) => DEMO_USERS.find((x) => x.username === u)!.pin;
async function login(u: string) {
  const r = await req("POST", "/api/v1/auth/login", { username: u, pin: pin(u) });
  expect(r.status).toBe(200);
  return r.data.token as string;
}
async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 30_000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (ok(v)) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 100));
  }
}
const ussd = (phone: string, text: string) => req("POST", "/api/v1/ussd", { sessionId: "t1", serviceCode: "*326*77#", phoneNumber: phone, text });

let officer = "";
let agent = "";
let dealer = "";

beforeAll(async () => {
  expect(snapshots.load()).toBeGreaterThan(10);
  await seedAll({ reset: true });
  [officer, agent, dealer] = await Promise.all([login("amina"), login("ibrahim"), login("musa")]);
});

describe("system and docs", () => {
  it("is healthy and describes itself", async () => {
    const h = await req("GET", "/api/v1/health");
    expect(h.data.ok).toBe(true);
    const meta = await req("GET", "/api/v1/meta");
    expect(meta.data.crops.length).toBeGreaterThanOrEqual(7);
    expect(meta.data.businessDate).toBe("2025-08-20");
  });
  it("documents every endpoint it serves", async () => {
    const doc = (await req("GET", "/openapi.json")).data;
    const served = app.routes
      .filter((r) => r.path.startsWith("/api/v1/") && r.method !== "ALL")
      .map((r) => `${r.method.toLowerCase()} ${r.path.replace(/:(\w+)/g, "{$1}")}`);
    const missing = [...new Set(served)].filter((s) => {
      const [m, p] = s.split(" ");
      return !doc.paths[p]?.[m];
    });
    expect(missing).toEqual([]);
    expect(Object.keys(doc.paths).length).toBe(new Set(OPS.map((o) => o.path)).size);
  });
  it("answers unknown API paths with JSON 404", async () => {
    const r = await req("GET", "/api/v1/nope");
    expect(r.status).toBe(404);
    expect(r.data.error.message).toBeTruthy();
  });
});

describe("auth and roles", () => {
  it("rejects a wrong PIN and locks after five tries", async () => {
    for (let i = 0; i < 5; i++) expect((await req("POST", "/api/v1/auth/login", { username: "grace", pin: "0000" })).status).toBe(401);
    expect((await req("POST", "/api/v1/auth/login", { username: "grace", pin: pin("grace") })).status).toBe(429);
  });
  it("needs a token, and checks roles", async () => {
    expect((await req("GET", "/api/v1/farmers")).status).toBe(401);
    expect((await req("GET", "/api/v1/farmers/")).status).toBe(401);
    expect((await req("GET", "/api/v1/farmers", undefined, dealer)).status).toBe(403);
    expect((await req("GET", "/api/v1/farmers", undefined, agent)).status).toBe(200);
    const me = await req("GET", "/api/v1/me", undefined, dealer);
    expect(me.data.dealer.name).toBe("Albarka Agro Inputs");
  });
});

describe("seeded bank", () => {
  it("has a believable portfolio built on real fields", async () => {
    const s = (await req("GET", "/api/v1/portfolio/summary", undefined, officer)).data;
    expect(s.farmers).toBeGreaterThanOrEqual(30);
    expect(s.ghostFarmsBlocked).toBeGreaterThanOrEqual(1);
    expect(s.applications.byStatus.REVIEW).toBeGreaterThanOrEqual(1);
    expect(s.loans.total).toBeGreaterThanOrEqual(25);
    expect(s.repaymentRate).toBe(100);
    expect(s.money.disbursed).toBeGreaterThan(0);
    const map = (await req("GET", "/api/v1/portfolio/map", undefined, officer)).data;
    expect(map.type).toBe("FeatureCollection");
    expect(map.features.some((f: any) => f.properties.status === "GHOST")).toBe(true);
  });
  it("keeps every loan's ledger balanced with what is owed", async () => {
    const loans = (await req("GET", "/api/v1/loans", undefined, officer)).data as any[];
    for (const l of loans.slice(0, 10)) {
      const d = (await req("GET", `/api/v1/loans/${l.id}`, undefined, officer)).data;
      for (const e of d.journal) {
        const dr = e.postings.reduce((a: number, p: any) => a + p.debit, 0);
        const cr = e.postings.reduce((a: number, p: any) => a + p.credit, 0);
        expect(dr).toBe(cr);
      }
      if (d.state === "REPAID") expect(d.outstanding).toBe(0);
    }
  });
});

describe("public explorer", () => {
  it("lists the real showcase fields and catches the ghost farms", async () => {
    const s = (await req("GET", "/api/v1/showcase")).data as any[];
    expect(s.filter((x) => x.kind === "showcase").every((x) => !x.ghost && x.decision === "APPROVE")).toBe(true);
    const controls = s.filter((x) => x.kind === "control");
    expect(controls.every((x) => x.decision !== "APPROVE")).toBe(true);
    expect(controls.filter((x) => x.ghost).length).toBeGreaterThanOrEqual(2);
  });
  it("analyses a field and streams every photo", async () => {
    const field = snapshots.get("showcase-zaria")!;
    const start = await req("POST", "/api/v1/analyses", { polygon: field.polygon });
    expect(start.status).toBe(202);
    const res = await app.request(`/api/v1/jobs/${start.data.jobId}/events`);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const stream = await res.text();
    expect(stream).toMatch(/event: observation/);
    expect(stream).toMatch(/event: done/);
    const a = (await req("GET", `/api/v1/analyses/${start.data.analysisId}`)).data;
    expect(a.ready).toBe(true);
    expect(a.score.band).toBe("A");
    expect(a.seasons.length).toBeGreaterThanOrEqual(6);
    expect(a.frames.length).toBeGreaterThan(4);
    const f = a.frames[0];
    const img = await app.request(`/api/v1/scenes/${f.sceneId}/image?bbox=${f.bbox.join(",")}&kind=rgb&snap=showcase-zaria`);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
  });
  it("analyses a field in one streamed request, ending with the result and an offer per crop", async () => {
    const field = snapshots.get("showcase-kachia")!;
    const res = await app.request("/api/v1/analyses/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ polygon: field.polygon, crop: "maize" }),
    });
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const text = await res.text();
    expect(text).toMatch(/event: observation/);
    const data = text.split("event: result\n")[1]?.split("\n").find((l) => l.startsWith("data: "));
    const result = JSON.parse(data!.slice(6));
    expect(result.score.band).toBe("A");
    expect(result.offers.maize.eligible).toBe(true);
    expect(Object.keys(result.offers).length).toBeGreaterThanOrEqual(7);
  });
  it("rejects a boundary outside Nigeria", async () => {
    const r = await req("POST", "/api/v1/analyses", {
      polygon: { type: "Polygon", coordinates: [[[-0.12, 51.5], [-0.11, 51.5], [-0.11, 51.51], [-0.12, 51.51], [-0.12, 51.5]]] },
    });
    expect(r.status).toBe(422);
  });
  it("fails gracefully offline for a field it has never seen", async () => {
    const r = await req("POST", "/api/v1/analyses", {
      polygon: { type: "Polygon", coordinates: [[[7.4, 9.1], [7.401, 9.1], [7.401, 9.101], [7.4, 9.101], [7.4, 9.1]]] },
    });
    const job = await until(() => req("GET", `/api/v1/jobs/${r.data.jobId}`), (x) => x.data.status !== "running");
    expect(job.data.status).toBe("error");
  });
});

describe("a farmer's loan, end to end", () => {
  let farmerId = "";
  let farmId = "";
  let appId = "";
  let loan: any;
  const phone = "08099887766";
  const kuje = () => snapshots.get("showcase-kuje")!;

  it("registers a farmer with consent and a BVN check", async () => {
    const bad = await req("POST", "/api/v1/farmers", { firstName: "Amaka", lastName: "Obi", phone, consent: false }, agent);
    expect(bad.status).toBe(422);
    const r = await req(
      "POST",
      "/api/v1/farmers",
      { firstName: "Amaka", lastName: "Obi", phone, gender: "female", birthYear: 2002, bvn: "22198765432", hub: "Kuje Agripreneur Hub", trained: true, cooperative: "Kuje Youth Agro Cooperative", consent: true },
      agent,
    );
    expect(r.status).toBe(201);
    expect(r.data.bvn.verified).toBe(true);
    farmerId = r.data.farmer.id;
    expect((await req("POST", "/api/v1/farmers", { firstName: "A", lastName: "B", phone, consent: true }, agent)).status).toBe(422);
    expect((await req("POST", "/api/v1/farmers", { firstName: "Ama", lastName: "Obi", phone, consent: true }, agent)).status).toBe(409);
  });

  it("maps the field and refuses to register it twice", async () => {
    const r = await req("POST", "/api/v1/farms", { farmerId, polygon: kuje().polygon, crop: "maize", tenure: "family", mapMethod: "gps" }, agent);
    expect(r.status).toBe(201);
    farmId = r.data.farm.id;
    expect(r.data.farm.snapshotKey).toBe("showcase-kuje");
    const again = await req("POST", "/api/v1/farms", { farmerId, polygon: kuje().polygon, crop: "maize" }, agent);
    expect(again.status).toBe(409);
  });

  it("scores the application from space and approves it", async () => {
    const r = await req("POST", "/api/v1/applications", { farmId }, agent);
    expect(r.status).toBe(202);
    appId = r.data.applicationId;
    const app2 = await until(() => req("GET", `/api/v1/applications/${appId}`, undefined, agent), (x) => x.data.status !== "ANALYZING");
    expect(app2.data.status).toBe("APPROVED");
    expect(app2.data.offer.eligible).toBe(true);
    expect(app2.data.assessment.score.factors).toHaveLength(6);
    expect((await req("POST", "/api/v1/applications", { farmId }, agent)).status).toBe(409);
  });

  it("only an officer can override decisions", async () => {
    expect((await req("POST", `/api/v1/applications/${appId}/decision`, { action: "decline" }, agent)).status).toBe(403);
  });

  it("accepts with the farmer's one-time code and issues vouchers", async () => {
    const otp = await req("POST", `/api/v1/applications/${appId}/otp`, undefined, agent);
    expect(otp.data.sandboxOtp).toMatch(/^\d{6}$/);
    const wrong = await req("POST", `/api/v1/applications/${appId}/accept`, { otp: otp.data.sandboxOtp === "111111" ? "222222" : "111111" }, agent);
    expect(wrong.status).toBe(422);
    const ok = await req("POST", `/api/v1/applications/${appId}/accept`, { otp: otp.data.sandboxOtp }, agent);
    expect(ok.status).toBe(201);
    loan = ok.data;
    expect(loan.state).toBe("ACCEPTED");
    expect(loan.vouchers.map((v: any) => v.status)).toEqual(["ISSUED", "HELD"]);
  });

  it("lets the dealer hand over inputs once, and pays the dealer", async () => {
    const t1 = loan.vouchers[0].code;
    const look = await req("GET", `/api/v1/vouchers/${t1}`, undefined, dealer);
    expect(look.data.farmerName).toBe("Amaka Obi");
    const before = (await req("GET", "/api/v1/me", undefined, dealer)).data.dealer.balance;
    const r = await req("POST", `/api/v1/vouchers/${t1}/redeem`, {}, dealer);
    expect(r.status).toBe(200);
    const after = (await req("GET", "/api/v1/me", undefined, dealer)).data.dealer.balance;
    expect(after - before).toBe(loan.vouchers[0].amount);
    expect((await req("POST", `/api/v1/vouchers/${t1}/redeem`, {}, dealer)).status).toBe(409);
    expect((await req("POST", `/api/v1/vouchers/${loan.vouchers[1].code}/redeem`, {}, dealer)).status).toBe(409);
    expect((await req("POST", `/api/v1/vouchers/${t1}/redeem`, {}, agent)).status).toBe(403);
  });

  it("watches the crop from space through the season", async () => {
    const m = await req("POST", `/api/v1/loans/${loan.id}/monitor`, { asOf: "2025-08-20" }, officer);
    expect(m.status).toBe(200);
    expect(m.data.monitor.asOf).toBe("2025-08-20");
    expect(["HEALTHY", "WATCH", "STRESS", "FLOOD", "NO_DATA"]).toContain(m.data.health);
    expect(m.data.season.observed.length).toBeGreaterThan(5);
    expect(m.data.season.expected.length).toBeGreaterThan(10);
  });

  it("takes a repayment over USSD with the farmer's PIN", async () => {
    expect((await req("POST", `/api/v1/farmers/${farmerId}/ussd-pin`, { pin: DEMO_FARMER_USSD_PIN }, agent)).status).toBe(200);
    expect((await req("POST", "/api/v1/sandbox/deposit", { farmerId, amount: 50_000, memo: "Maize sale" }, agent)).status).toBe(200);
    expect((await ussd(phone, "")).data).toMatch(/^CON .*1\. My loan/s);
    expect((await ussd(phone, "1")).data).toMatch(/^END .*Owed/s);
    expect((await ussd(phone, "2*5000")).data).toMatch(/PIN/);
    expect((await ussd(phone, "2*5000*9999")).data).toMatch(/Wrong PIN/);
    expect((await ussd(phone, `2*5000*${DEMO_FARMER_USSD_PIN}`)).data).toMatch(/^END Paid N5,000/);
    const l = (await req("GET", `/api/v1/loans/${loan.id}`, undefined, officer)).data;
    expect(l.repaid).toBe(5000);
    expect((await ussd("08011112222", "")).data).toMatch(/^END .*isn't registered/);
  });
});

describe("ghost farms", () => {
  it("declines an application on land that has never been farmed", async () => {
    const f = await req("POST", "/api/v1/farmers", { firstName: "Tobi", lastName: "Ade", phone: "08055554444", bvn: "22111222333", consent: true }, agent);
    const town = snapshots.get("control-gwagwalada-town")!;
    const farm = await req("POST", "/api/v1/farms", { farmerId: f.data.farmer.id, polygon: town.polygon, crop: "maize" }, agent);
    expect(farm.status).toBe(201);
    const a = await req("POST", "/api/v1/applications", { farmId: farm.data.farm.id }, agent);
    const done = await until(() => req("GET", `/api/v1/applications/${a.data.applicationId}`, undefined, agent), (x) => x.data.status !== "ANALYZING");
    expect(done.data.status).toBe("DECLINED");
    expect(done.data.ghost).toBe(true);
    expect((await req("POST", `/api/v1/applications/${a.data.applicationId}/decision`, { action: "approve" }, officer)).status).toBe(409);
  });
});

describe("credit policy and season replay", () => {
  it("validates policy changes", async () => {
    const bad = await req("PATCH", "/api/v1/policy", { score: { weights: { history: 50 } } }, officer);
    expect(bad.status).toBe(422);
    expect((await req("PATCH", "/api/v1/policy", { lending: { interestFlat: 0.05 } }, agent)).status).toBe(403);
    const ok = await req("PATCH", "/api/v1/policy", { lending: { interestFlat: 0.05 } }, officer);
    expect(ok.status).toBe(200);
    expect(ok.data.lending.interestFlat).toBe(0.05);
    expect(ok.data.version).toBe(2);
    expect((await req("POST", "/api/v1/policy/reset", undefined, officer)).data.lending.interestFlat).toBe(0.06);
  });
  it("replays the season and re-checks every loan from space", async () => {
    const r = await req("POST", "/api/v1/demo/replay", { date: "2025-09-30" }, officer);
    expect(r.status).toBe(200);
    expect(r.data.checked).toBeGreaterThan(10);
    expect((await req("GET", "/api/v1/demo/clock", undefined, agent)).data.date).toBe("2025-09-30");
    const alerts = (await req("GET", "/api/v1/alerts", undefined, officer)).data as any[];
    expect(Array.isArray(alerts)).toBe(true);
  });
});
