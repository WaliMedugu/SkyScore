import { randomInt } from "node:crypto";
import type { Context } from "hono";
import type { ZodType, z } from "zod";

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
/** Short, sortable-enough ids with a readable prefix, e.g. frm_8k2j9x4m. */
export const id = (prefix: string, len = 10) => `${prefix}_${Array.from({ length: len }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")}`;

/** Errors that map straight onto HTTP responses. */
export class ApiError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}
export const notFound = (what: string) => new ApiError(404, `${what} not found.`);
export const badRequest = (msg: string, details?: unknown) => new ApiError(400, msg, details);
export const conflict = (msg: string) => new ApiError(409, msg);

/** Parse and validate a JSON body with Zod, raising a readable 422 on failure. */
export async function body<S extends ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiError(400, "Request body must be JSON.");
  }
  const r = schema.safeParse(raw);
  if (!r.success) {
    throw new ApiError(
      422,
      "Some fields are missing or invalid.",
      r.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    );
  }
  return r.data;
}

export function query<S extends ZodType>(c: Context, schema: S): z.infer<S> {
  const r = schema.safeParse(c.req.query());
  if (!r.success) throw new ApiError(422, "Invalid query parameters.", r.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })));
  return r.data;
}

export const today = () => new Date().toISOString().slice(0, 10);
export const naira = (v: number) => `N${Math.round(v).toLocaleString("en-NG")}`;
