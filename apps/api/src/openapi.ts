// OpenAPI 3.1 description of every /api/v1 endpoint. Request bodies come straight from the Zod schemas
// the handlers validate with, so the docs can't drift from the code (a test checks every route is listed).
import { z, type ZodType } from "zod";
import type { Role } from "./auth.ts";
import { VERSION } from "./routes/public.ts";
import {
  AcceptSchema,
  AnalysisCreateSchema,
  AnalysisStreamSchema,
  ApplicationCreateSchema,
  BvnSchema,
  DecisionSchema,
  DepositSchema,
  FarmCreateSchema,
  FarmerCreateSchema,
  LoginSchema,
  MonitorSchema,
  PolicyPatchSchema,
  RedeemSchema,
  RepaySchema,
  ReplaySchema,
  UssdPinSchema,
  UssdSchema,
} from "./schemas.ts";

type Method = "get" | "post" | "patch";
interface Op {
  method: Method;
  path: string;
  tag: string;
  summary: string;
  description?: string;
  /** undefined = public; [] = any signed-in user. */
  roles?: Role[];
  body?: ZodType;
  query?: [name: string, description: string][];
  ok?: number;
  produces?: string;
}

const AGENT_OFFICER: Role[] = ["agent", "officer"];

export const OPS: Op[] = [
  // System
  { method: "get", path: "/api/v1/health", tag: "System", summary: "Health check" },
  { method: "get", path: "/api/v1/meta", tag: "System", summary: "Season, business date, crops and input packages" },
  { method: "get", path: "/api/v1/stats", tag: "System", summary: "Aggregate numbers for the public site (no personal data)" },
  { method: "post", path: "/api/v1/auth/login", tag: "Auth", summary: "Sign in with username and PIN", body: LoginSchema, description: "Returns a 12-hour bearer token. Five wrong PINs lock the username for 5 minutes." },
  { method: "get", path: "/api/v1/me", tag: "Auth", summary: "The signed-in user (and their shop, for dealers)", roles: [] },

  // Satellite
  {
    method: "post",
    path: "/api/v1/analyses",
    tag: "Satellite",
    summary: "Analyse any field from space",
    body: AnalysisCreateSchema,
    ok: 202,
    description:
      "Starts reading 6–8 years of Sentinel-2 photos, Sentinel-1 radar, land-cover maps and rainfall for the polygon. Returns a job to stream. Saved demo fields replay instantly; others are fetched live from the Microsoft Planetary Computer (20 per hour per address).",
  },
  {
    method: "get",
    path: "/api/v1/analyses/:id",
    tag: "Satellite",
    summary: "Seasons, SkyScore, offer and chart data for a finished analysis",
    query: [
      ["crop", "maize | rice | sorghum | soybean | millet | groundnut | cowpea"],
      ["plantingMonth", "1–12"],
      ["seasonYear", "Loan season year"],
      ["asOf", "Judge history as at this date (YYYY-MM-DD)"],
    ],
    description: "Public explorer results are scored for a typical applicant (BVN-verified, trained, cooperative member, first loan).",
  },
  {
    method: "post",
    path: "/api/v1/analyses/stream",
    tag: "Satellite",
    summary: "Analyse a field in one streamed request (server-sent events)",
    body: AnalysisStreamSchema,
    produces: "text/event-stream",
    description:
      "The same live events as a job stream, then a `result` event with the scored analysis and an offer for every crop. Use this behind serverless hosting, where a follow-up request may reach a different instance.",
  },
  { method: "get", path: "/api/v1/jobs/:id", tag: "Satellite", summary: "Job status and latest partial result" },
  {
    method: "get",
    path: "/api/v1/jobs/:id/events",
    tag: "Satellite",
    summary: "Live stream of a job (server-sent events)",
    produces: "text/event-stream",
    query: [["after", "Resume after this event number (or send Last-Event-ID)"]],
    description: "Events: `progress`, `observation` (one per photo read), `partial` (season verdicts so far), `done` {analysisId} or `error`.",
  },
  {
    method: "get",
    path: "/api/v1/scenes/:sceneId/image",
    tag: "Satellite",
    summary: "Time-lapse frame as PNG",
    produces: "image/png",
    query: [
      ["bbox", "minLng,minLat,maxLng,maxLat"],
      ["kind", "rgb (true colour) or ndvi (greenness)"],
      ["snap", "Snapshot key to serve the saved copy"],
      ["size", "64–512 px"],
    ],
  },
  { method: "get", path: "/api/v1/showcase", tag: "Satellite", summary: "Real fields that ship with the demo: proven farms and non-farm land" },

  // Farmers & farms
  { method: "get", path: "/api/v1/farmers", tag: "Farmers", summary: "List or search farmers", roles: AGENT_OFFICER, query: [["q", "Name, phone, hub or id"], ["limit", "1–200"], ["offset", "Skip"]] },
  { method: "post", path: "/api/v1/farmers", tag: "Farmers", summary: "Register a farmer (with NDPA consent and BVN check)", roles: AGENT_OFFICER, body: FarmerCreateSchema, ok: 201 },
  { method: "get", path: "/api/v1/farmers/:id", tag: "Farmers", summary: "Farmer with account, farms, applications, loans and SMS", roles: AGENT_OFFICER },
  { method: "post", path: "/api/v1/farmers/:id/verify-bvn", tag: "Farmers", summary: "Verify (or re-verify) the farmer's BVN", roles: AGENT_OFFICER, body: BvnSchema },
  { method: "post", path: "/api/v1/farmers/:id/ussd-pin", tag: "Farmers", summary: "Set the farmer's 4-digit USSD PIN", roles: AGENT_OFFICER, body: UssdPinSchema },
  { method: "get", path: "/api/v1/farms", tag: "Farms", summary: "List farms", roles: AGENT_OFFICER, query: [["farmerId", "Only this farmer's farms"], ["limit", "1–500"]] },
  {
    method: "post",
    path: "/api/v1/farms",
    tag: "Farms",
    summary: "Map a farm boundary and start its satellite analysis",
    roles: AGENT_OFFICER,
    body: FarmCreateSchema,
    ok: 201,
    description: "Rejects boundaries that overlap a registered field (one field can back only one loan).",
  },
  { method: "get", path: "/api/v1/farms/:id", tag: "Farms", summary: "One farm", roles: AGENT_OFFICER },
  { method: "get", path: "/api/v1/farms/:id/analysis", tag: "Farms", summary: "The farm's satellite story, scored for its farmer", roles: AGENT_OFFICER, query: [["asOf", "YYYY-MM-DD (default: the season's decision date)"]] },
  { method: "post", path: "/api/v1/farms/:id/analyse", tag: "Farms", summary: "Re-run the farm's satellite analysis", roles: AGENT_OFFICER, ok: 202, query: [["fresh", "1 to ignore cached results"]] },

  // Applications
  { method: "get", path: "/api/v1/applications", tag: "Applications", summary: "List applications", roles: AGENT_OFFICER, query: [["status", "ANALYZING | APPROVED | REVIEW | DECLINED | ACCEPTED | ERROR"], ["season", "Season year"]] },
  { method: "post", path: "/api/v1/applications", tag: "Applications", summary: "Apply for an input loan on a mapped farm", roles: AGENT_OFFICER, body: ApplicationCreateSchema, ok: 202, description: "Scored automatically when the analysis finishes: APPROVED, REVIEW (officer decides) or DECLINED (including ghost farms)." },
  { method: "get", path: "/api/v1/applications/:id", tag: "Applications", summary: "Application with assessment and history", roles: AGENT_OFFICER },
  { method: "post", path: "/api/v1/applications/:id/decision", tag: "Applications", summary: "Officer approves or declines", roles: ["officer"], body: DecisionSchema },
  { method: "post", path: "/api/v1/applications/:id/otp", tag: "Applications", summary: "Text the farmer a one-time consent code", roles: AGENT_OFFICER },
  { method: "post", path: "/api/v1/applications/:id/accept", tag: "Applications", summary: "Accept the offer with the farmer's code: creates the loan and vouchers", roles: AGENT_OFFICER, body: AcceptSchema, ok: 201 },
  { method: "post", path: "/api/v1/applications/:id/rescore", tag: "Applications", summary: "Re-score with the current policy (or retry a failed analysis)", roles: ["officer"] },

  // Loans
  { method: "get", path: "/api/v1/loans", tag: "Loans", summary: "List loans", roles: AGENT_OFFICER, query: [["state", "Loan state"], ["health", "HEALTHY | WATCH | STRESS | FLOOD | NO_DATA"], ["season", "Season year"], ["farmerId", "Farmer"]] },
  { method: "get", path: "/api/v1/loans/:id", tag: "Loans", summary: "Loan with ledger, vouchers, alerts and the season chart", roles: AGENT_OFFICER },
  { method: "post", path: "/api/v1/loans/:id/monitor", tag: "Loans", summary: "Check the crop from space now (or at a date)", roles: AGENT_OFFICER, body: MonitorSchema },
  { method: "post", path: "/api/v1/loans/:id/repayments", tag: "Loans", summary: "Record a repayment from the farmer's account", roles: AGENT_OFFICER, body: RepaySchema, ok: 201 },

  // Vouchers & dealers
  { method: "get", path: "/api/v1/vouchers", tag: "Vouchers", summary: "List vouchers (dealers see their own redemptions)", roles: ["dealer", "agent", "officer"], query: [["status", "ISSUED | HELD | REDEEMED"], ["dealerId", "Dealer"]] },
  { method: "get", path: "/api/v1/vouchers/:code", tag: "Vouchers", summary: "Look up a voucher by code", roles: ["dealer", "agent", "officer"] },
  { method: "post", path: "/api/v1/vouchers/:code/redeem", tag: "Vouchers", summary: "Hand over the inputs: pays the dealer, draws the loan", roles: ["dealer", "officer"], body: RedeemSchema },
  { method: "get", path: "/api/v1/dealers", tag: "Dealers", summary: "Agro-dealers with balances and redemptions", roles: AGENT_OFFICER },
  { method: "get", path: "/api/v1/dealers/:id", tag: "Dealers", summary: "One dealer and their redeemed vouchers", roles: ["dealer", "agent", "officer"] },

  // Portfolio
  { method: "get", path: "/api/v1/portfolio/summary", tag: "Portfolio", summary: "Book totals, health and repayment rate", roles: AGENT_OFFICER },
  { method: "get", path: "/api/v1/portfolio/map", tag: "Portfolio", summary: "Every farm as GeoJSON with its status colour", roles: AGENT_OFFICER },
  { method: "get", path: "/api/v1/alerts", tag: "Portfolio", summary: "Alerts raised by satellite monitoring", roles: AGENT_OFFICER, query: [["status", "OPEN | ACKNOWLEDGED | RESOLVED"]] },
  { method: "post", path: "/api/v1/alerts/:id/ack", tag: "Portfolio", summary: "Acknowledge an alert", roles: AGENT_OFFICER },
  { method: "get", path: "/api/v1/sms", tag: "Portfolio", summary: "SMS outbox (sandbox)", roles: AGENT_OFFICER, query: [["phone", "Only this number"], ["limit", "Up to 500"]] },
  { method: "get", path: "/api/v1/events", tag: "Portfolio", summary: "Activity and audit log", roles: AGENT_OFFICER, query: [["entity", "farmer | farm | application | loan | system"], ["entityId", "Id"], ["limit", "Up to 500"]] },

  // Policy & clock
  { method: "get", path: "/api/v1/policy", tag: "Policy", summary: "The live credit policy", roles: [] },
  { method: "patch", path: "/api/v1/policy", tag: "Policy", summary: "Change part of the credit policy (validated)", roles: ["officer"], body: PolicyPatchSchema },
  { method: "post", path: "/api/v1/policy/reset", tag: "Policy", summary: "Reset to the calibrated defaults", roles: ["officer"] },
  { method: "get", path: "/api/v1/demo/clock", tag: "Season clock", summary: "The business date", roles: [] },
  { method: "post", path: "/api/v1/demo/replay", tag: "Season clock", summary: "Move the season clock and re-check every loan from space", roles: ["officer"], body: ReplaySchema },
  { method: "post", path: "/api/v1/sandbox/deposit", tag: "Sandbox", summary: "Credit a farmer's account (e.g. harvest sale)", roles: AGENT_OFFICER, body: DepositSchema },

  // USSD
  {
    method: "post",
    path: "/api/v1/ussd",
    tag: "USSD",
    summary: "USSD callback (Africa's Talking format)",
    body: UssdSchema,
    produces: "text/plain",
    description: "Form or JSON: sessionId, serviceCode, phoneNumber, text (choices joined by *). Replies `CON …` to continue or `END …`.",
  },
];

function schemaOf(s: ZodType) {
  const { $schema: _drop, ...rest } = z.toJSONSchema(s, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  return rest;
}

const ERR = (description: string) => ({ description, content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } });

export function openApiDoc() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of OPS) {
    const p = op.path.replace(/:(\w+)/g, "{$1}");
    const params = [
      ...[...op.path.matchAll(/:(\w+)/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } })),
      ...(op.query ?? []).map(([name, description]) => ({ name, in: "query", required: false, description, schema: { type: "string" } })),
    ];
    const ok = op.ok ?? 200;
    const responses: Record<string, unknown> = {
      [ok]: { description: ok === 202 ? "Accepted: work continues in the background" : ok === 201 ? "Created" : "OK", content: { [op.produces ?? "application/json"]: {} } },
    };
    if (op.body) responses["422"] = ERR("Invalid fields (details list each problem)");
    if (op.roles) {
      responses["401"] = ERR("Not signed in or session expired");
      if (op.roles.length) responses["403"] = ERR(`Only ${op.roles.join(", ")} (or admin)`);
    }
    if (p.includes("{")) responses["404"] = ERR("Not found");
    paths[p] ??= {};
    paths[p][op.method] = {
      tags: [op.tag],
      summary: op.summary,
      ...(op.description ? { description: op.description } : {}),
      ...(op.roles ? { security: [{ bearer: [] }], "x-roles": op.roles.length ? op.roles : ["any signed-in user"] } : { security: [] }),
      ...(params.length ? { parameters: params } : {}),
      ...(op.body ? { requestBody: { required: true, content: { "application/json": { schema: schemaOf(op.body) } } } } : {}),
      responses,
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "SkyScore API",
      version: VERSION,
      description:
        "Credit for young farmers, underwritten from space. SkyScore reads a field's Sentinel-2 and Sentinel-1 history to prove it is farmed, scores it, lends inputs as dealer vouchers and watches the crop all season.\n\nSign in with `POST /api/v1/auth/login`, then send `Authorization: Bearer <token>`. Demo users are listed in `apps/api/src/seed/users.ts`.",
    },
    servers: [{ url: "/" }],
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
      schemas: {
        Error: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                message: { type: "string" },
                details: { type: "array", items: { type: "object", properties: { field: { type: "string" }, message: { type: "string" } } } },
              },
              required: ["message"],
            },
          },
        },
      },
    },
    tags: [...new Set(OPS.map((o) => o.tag))].map((name) => ({ name })),
    paths,
  };
}
