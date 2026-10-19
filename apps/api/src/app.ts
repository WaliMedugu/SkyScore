// The SkyScore HTTP app: /api/v1 routes, OpenAPI + Scalar docs, and the web console/site.
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { Scalar } from "@scalar/hono-api-reference";
import { LoanTransitionError } from "@skyscore/engine";
import { OfflineMiss } from "@skyscore/satellite";
import type { AppEnv } from "./auth.ts";
import { openApiDoc } from "./openapi.ts";
import { alertRoutes, dealerRoutes, demoRoutes, eventRoutes, meRoutes, policyRoutes, portfolioRoutes, sandboxRoutes, smsRoutes } from "./routes/console.ts";
import { farmRoutes, farmerRoutes } from "./routes/farmers.ts";
import { applicationRoutes, loanRoutes, voucherRoutes } from "./routes/lending.ts";
import { publicRoutes } from "./routes/public.ts";
import { serveWeb } from "./static.ts";
import { ApiError } from "./util.ts";

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use(
    "/api/*",
    cors({
      origin: (origin) => origin ?? "*",
      allowHeaders: ["Authorization", "Content-Type", "Last-Event-ID"],
      allowMethods: ["GET", "POST", "PATCH", "OPTIONS"],
      maxAge: 600,
    }),
  );
  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  });

  const v1 = "/api/v1";
  app.route(v1, publicRoutes);
  app.route(`${v1}/me`, meRoutes);
  app.route(`${v1}/farmers`, farmerRoutes);
  app.route(`${v1}/farms`, farmRoutes);
  app.route(`${v1}/applications`, applicationRoutes);
  app.route(`${v1}/loans`, loanRoutes);
  app.route(`${v1}/vouchers`, voucherRoutes);
  app.route(`${v1}/dealers`, dealerRoutes);
  app.route(`${v1}/portfolio`, portfolioRoutes);
  app.route(`${v1}/alerts`, alertRoutes);
  app.route(`${v1}/sms`, smsRoutes);
  app.route(`${v1}/events`, eventRoutes);
  app.route(`${v1}/policy`, policyRoutes);
  app.route(`${v1}/demo`, demoRoutes);
  app.route(`${v1}/sandbox`, sandboxRoutes);

  app.get("/openapi.json", (c) => c.json(openApiDoc()));
  app.get("/docs", Scalar({ url: "/openapi.json", pageTitle: "SkyScore API" }));

  app.all("/api/*", (c) => c.json({ error: { message: "No such endpoint." } }, 404));
  app.get("*", serveWeb);

  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json({ error: { message: err.message, ...(err.details ? { details: err.details } : {}) } }, err.status);
    if (err instanceof LoanTransitionError) return c.json({ error: { message: err.message } }, 409);
    if (err instanceof OfflineMiss) return c.json({ error: { message: "The server is offline and this field isn't saved. Try a saved field." } }, 503);
    if (err instanceof HTTPException) return err.getResponse();
    console.error(`[${c.req.method} ${c.req.path}]`, err);
    return c.json({ error: { message: "Something went wrong on our side. Please try again." } }, 500);
  });
  app.notFound((c) => (c.req.path.startsWith("/api/") ? c.json({ error: { message: "No such endpoint." } }, 404) : serveWeb(c)));
  return app;
}
