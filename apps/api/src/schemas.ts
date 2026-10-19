import { z } from "zod";
import { CROP_KEYS, validateFarmPolygon, type Polygon } from "@skyscore/engine";

const coord = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

export const PolygonSchema = z
  .object({ type: z.literal("Polygon"), coordinates: z.array(z.array(coord).min(4)).min(1) })
  .superRefine((p, ctx) => {
    const r = validateFarmPolygon(p as Polygon);
    for (const problem of r.problems) ctx.addIssue({ code: "custom", message: problem });
  })
  .describe("GeoJSON Polygon of the farm boundary (longitude, latitude), closed ring.");

export const LoginSchema = z.object({
  username: z.string().min(2).max(40).describe("Username, e.g. amina"),
  pin: z.string().regex(/^\d{4,6}$/).describe("4–6 digit PIN"),
});

export const AnalysisCreateSchema = z.object({
  polygon: PolygonSchema,
  fromYear: z.number().int().min(2017).max(2026).optional().describe("First season to read (default 2018)"),
  fresh: z.boolean().optional().describe("Ignore cached results and fetch again"),
});

export const AnalysisStreamSchema = AnalysisCreateSchema.extend({
  crop: z.enum(CROP_KEYS as [string, ...string[]]).optional().describe("Crop for the headline offer (offers for every crop are included)"),
});

const phone = z
  .string()
  .transform((s) => s.replace(/[^\d+]/g, ""))
  .pipe(z.string().regex(/^(\+?234|0)[789][01]\d{8}$/, "Use a Nigerian mobile number, e.g. 08031234567"))
  .transform((s) => (s.startsWith("+234") ? `0${s.slice(4)}` : s.startsWith("234") ? `0${s.slice(3)}` : s));

export const FarmerCreateSchema = z.object({
  firstName: z.string().trim().min(2).max(40),
  lastName: z.string().trim().min(2).max(40),
  phone,
  gender: z.enum(["female", "male"]).optional(),
  birthYear: z.number().int().min(1940).max(2012).optional(),
  bvn: z.string().regex(/^\d{11}$/, "A BVN has 11 digits").optional(),
  nin: z.string().regex(/^\d{11}$/, "A NIN has 11 digits").optional(),
  hub: z.string().max(80).optional().describe("Training hub, e.g. Zaria Youth Agripreneur Hub"),
  trained: z.boolean().optional(),
  cooperative: z.string().max(80).optional(),
  language: z.enum(["en", "ha", "yo", "ig", "pcm"]).optional(),
  consent: z.literal(true, { error: "The farmer must agree to the data and BVN check (NDPA 2023)." }),
});

export const FarmCreateSchema = z.object({
  farmerId: z.string().min(3),
  name: z.string().trim().max(60).optional(),
  polygon: PolygonSchema,
  crop: z.enum(CROP_KEYS as [string, ...string[]]),
  plantingMonth: z.number().int().min(1).max(12).optional(),
  tenure: z.enum(["owned", "family", "leased", "allocated", "rented"]).optional().describe("allocated = land allocated by a community or youth programme"),
  place: z.string().max(80).optional(),
  state: z.string().max(40).optional(),
  mapMethod: z.enum(["gps", "tap", "saved"]).optional(),
});

export const ApplicationCreateSchema = z.object({
  farmId: z.string().min(3),
  seasonYear: z.number().int().min(2024).max(2030).optional(),
});

export const DecisionSchema = z.object({
  action: z.enum(["approve", "decline"]),
  note: z.string().max(400).optional(),
});

export const AcceptSchema = z.object({ otp: z.string().regex(/^\d{6}$/, "The code has 6 digits") });
export const RedeemSchema = z.object({ dealerId: z.string().optional().describe("Officers redeem on behalf of a dealer") });
export const RepaySchema = z.object({
  amount: z.number().int().positive(),
  channel: z.enum(["APP", "AGENT", "USSD", "BRANCH"]).optional(),
});
export const MonitorSchema = z.object({ asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
export const ReplaySchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
export const BvnSchema = z.object({ bvn: z.string().regex(/^\d{11}$/).optional() });
export const UssdPinSchema = z.object({ pin: z.string().regex(/^\d{4}$/) });
export const PolicyPatchSchema = z
  .object({
    evidence: z.record(z.string(), z.unknown()).optional(),
    score: z.record(z.string(), z.unknown()).optional(),
    lending: z.record(z.string(), z.unknown()).optional(),
    monitor: z.record(z.string(), z.unknown()).optional(),
    crops: z.record(z.string(), z.unknown()).optional(),
    quality: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export const DepositSchema = z.object({
  farmerId: z.string().min(3),
  amount: z.number().int().positive().max(50_000_000),
  memo: z.string().max(80).optional().describe("Shown on the farmer's SMS, e.g. Maize sale - Zaria market"),
});
export const UssdSchema = z.object({
  sessionId: z.string().min(1),
  serviceCode: z.string().optional(),
  phoneNumber: z.string().min(7),
  text: z.string().default(""),
});
