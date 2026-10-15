import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { DecisionRequest, INTERNAL_STATUSES, RegistrationRequest, ReleaseRequest, SelectionLimitRequest } from "@sj/contracts";
import { z } from "zod";
import type { Config } from "./config.js";
import type { Sql } from "./db/client.js";
import { listEditions, toPublic } from "./modules/editions/service.js";
import { myNotifications } from "./modules/notifications/service.js";
import { myApplications, register } from "./modules/registration/service.js";
import { draftDecision, getApplication, listApplications, releaseDecisions, setSelectionLimit, withdrawDraft } from "./modules/selection/service.js";
import { issueDevToken, type IdentityResolver, type TokenVerifier } from "./platform/auth.js";
import { parse, registerErrorHandler } from "./platform/errors.js";
import { authenticate, principalOf, requireEditionAccess, requirePermission } from "./platform/principal.js";

export type Clock = () => Date;
export type AppDeps = {
  config: Config;
  sql: Sql;
  verifier: TokenVerifier;
  /** Authoritative source for "which email/phone has this identity proven" (linking and account creation). */
  identity: IdentityResolver;
  clock?: Clock;
  logger?: boolean | object;
};

const Year = z.object({ year: z.coerce.number().int().min(2026).max(2100) });
const Id = z.object({ id: z.string().uuid() });

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config, sql, verifier, identity } = deps;
  const now = deps.clock ?? (() => new Date());
  const app = Fastify({
    logger: deps.logger ?? { level: config.logLevel, redact: ["req.headers.authorization", "req.headers.cookie"] },
    trustProxy: true,
    bodyLimit: 256 * 1024,
  });
  app.decorateRequest("principal", null);
  registerErrorHandler(app);
  await app.register(helmet);
  await app.register(cors, {
    origin: config.corsOrigins,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["authorization", "content-type"],
    credentials: false,
    maxAge: 600,
  });
  await app.register(rateLimit, { global: false });

  const auth = authenticate((t) => verifier.verify(t), sql, { requireStaffMfa: config.requireStaffMfa, identity });

  // ---------------------------------------------------------------- health
  app.get("/healthz", async () => {
    await sql`select 1`;
    return { ok: true };
  });

  // ---------------------------------------------------------------- public
  app.get("/v1/public/editions", async () => (await listEditions(sql)).map((e) => toPublic(e, now())));

  // ---------------------------------------------------------------- applicant (any signed-in user, own data)
  app.post("/v1/me/registrations", {
    preHandler: [auth, requirePermission("registration.submit")],
    config: { rateLimit: { max: config.registrationRateLimit, timeWindow: "1 minute" } },
  }, async (req, reply) => {
    const input = parse(RegistrationRequest, req.body);
    const result = await register(sql, principalOf(req), input, now());
    return reply.status(201).send(result);
  });

  app.get("/v1/me/applications", { preHandler: [auth, requirePermission("application.read_own")] }, async (req) => {
    const p = principalOf(req);
    return p.account ? myApplications(sql, p.account.id) : { startup: null, applications: [] };
  });

  app.get("/v1/me/notifications", { preHandler: [auth, requirePermission("notification.read_own")] }, async (req) => {
    const p = principalOf(req);
    return p.account ? myNotifications(sql, p.account.id) : [];
  });

  // Participant home for an edition: reachable only with edition access (FR-IAM-12, AT-09).
  app.get("/v1/editions/:year/me", { preHandler: [auth, requireEditionAccess()] }, async (req) => {
    const p = principalOf(req);
    const { year } = parse(Year, req.params);
    return { edition: year, access: true, roles: [...p.roles].sort() };
  });

  // ---------------------------------------------------------------- management
  app.get("/v1/manage/editions/:year/applications", { preHandler: [auth, requirePermission("application.read_all")] }, async (req) => {
    const { year } = parse(Year, req.params);
    const q = parse(z.object({ status: z.enum(INTERNAL_STATUSES).optional() }), req.query);
    return listApplications(sql, year, q);
  });

  app.get("/v1/manage/applications/:id", { preHandler: [auth, requirePermission("application.read_all")] }, async (req) => {
    const { id } = parse(Id, req.params);
    return getApplication(sql, id);
  });

  app.put("/v1/manage/applications/:id/decision", { preHandler: [auth, requirePermission("decision.draft")] }, async (req) => {
    const { id } = parse(Id, req.params);
    return draftDecision(sql, principalOf(req), id, parse(DecisionRequest, req.body));
  });

  app.delete("/v1/manage/applications/:id/decision", { preHandler: [auth, requirePermission("decision.draft")] }, async (req) => {
    const { id } = parse(Id, req.params);
    return withdrawDraft(sql, principalOf(req), id);
  });

  app.post("/v1/manage/editions/:year/decisions/release", { preHandler: [auth, requirePermission("decision.release")] }, async (req) => {
    const { year } = parse(Year, req.params);
    const body = parse(ReleaseRequest, req.body ?? {});
    return releaseDecisions(sql, principalOf(req), year, body.applicationIds);
  });

  app.put("/v1/manage/editions/:year/selection-limit", { preHandler: [auth, requirePermission("selection_limit.configure")] }, async (req) => {
    const { year } = parse(Year, req.params);
    return setSelectionLimit(sql, principalOf(req), year, parse(SelectionLimitRequest, req.body).limit);
  });

  // ---------------------------------------------------------------- development sign-in (never in production)
  if (config.authMode === "dev" && config.nodeEnv !== "production") {
    app.post("/v1/dev/session", async (req) => {
      const body = parse(z.object({ email: z.string().trim().toLowerCase().email(), mfa: z.boolean().optional() }), req.body);
      return { token: await issueDevToken(config.devAuthSecret!, body.email, { aal: body.mfa ? "aal2" : "aal1" }) };
    });
  }

  return app;
}
