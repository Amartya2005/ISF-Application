import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import {
  ACCOUNT_STATUSES, ActivationRequest, DecisionRequest, DevSessionRequest, normaliseMobile, IMPORT_CATEGORIES, ImportCommitRequest, ImportPreviewRequest, INTERNAL_STATUSES,
  RegistrationRequest, ReleaseRequest, ROLES, RoleGrantRequest, SelectionLimitRequest,
} from "@sj/contracts";
import { z } from "zod";
import type { Config } from "./config.js";
import type { Sql } from "./db/client.js";
import { getUser, grantRole, issueActivation, listUsers, me, redeemActivation, revokeRole, setStatus } from "./modules/accounts/service.js";
import { listEditions, toPublic } from "./modules/editions/service.js";
import { commitBatch, discardBatch, getBatch, listBatches, previewImport, templateCsv } from "./modules/imports/service.js";
import { myNotifications } from "./modules/notifications/service.js";
import { myApplications, register } from "./modules/registration/service.js";
import { draftDecision, getApplication, listApplications, releaseDecisions, setSelectionLimit, withdrawDraft } from "./modules/selection/service.js";
import { issueDevToken, type IdentityResolver, type TokenVerifier } from "./platform/auth.js";
import { AppError, parse, registerErrorHandler } from "./platform/errors.js";
import { authenticate, principalOf, requireEditionAccess, requirePermission, resolvePrincipal } from "./platform/principal.js";

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
  // Accepts pending_activation accounts (with no roles or access): only for "who am I" and activation.
  const authPending = authenticate((t) => verifier.verify(t), sql, { requireStaffMfa: config.requireStaffMfa, identity, allowPending: true });

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

  // ---------------------------------------------------------------- my account (Phase 3)
  app.get("/v1/me", { preHandler: [authPending] }, async (req) => me(principalOf(req)));

  app.post("/v1/me/activation", {
    preHandler: [authPending],
    config: { rateLimit: { max: config.activationRateLimit, timeWindow: "1 minute" } },
  }, async (req) => {
    const { token } = parse(ActivationRequest, req.body);
    await redeemActivation(sql, principalOf(req), token, now());
    // Re-resolve so the response reflects the now-active account with its roles.
    return me(await resolvePrincipal(sql, principalOf(req).claims, { requireStaffMfa: config.requireStaffMfa, identity }));
  });

  // ---------------------------------------------------------------- admin: accounts and roles (FR-IAM-05/06/09)
  const UserQuery = z.object({
    q: z.string().trim().max(100).optional(),
    role: z.enum(ROLES).optional(),
    status: z.enum(ACCOUNT_STATUSES).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  });
  app.get("/v1/admin/users", { preHandler: [auth, requirePermission("user.read")] }, async (req) =>
    listUsers(sql, parse(UserQuery, req.query)));
  app.get("/v1/admin/users/:id", { preHandler: [auth, requirePermission("user.read")] }, async (req) =>
    getUser(sql, parse(Id, req.params).id));
  app.post("/v1/admin/users/:id/roles", { preHandler: [auth, requirePermission("role.assign")] }, async (req, reply) => {
    const body = parse(RoleGrantRequest, req.body);
    return reply.status(201).send(await grantRole(sql, principalOf(req), parse(Id, req.params).id, body.role, body.edition ?? null));
  });
  app.delete("/v1/admin/users/:id/roles/:grantId", { preHandler: [auth, requirePermission("role.assign")] }, async (req) => {
    const { id, grantId } = parse(z.object({ id: z.string().uuid(), grantId: z.string().regex(/^\d{1,18}$/) }), req.params);
    return revokeRole(sql, principalOf(req), id, grantId);
  });
  app.post("/v1/admin/users/:id/deactivate", { preHandler: [auth, requirePermission("user.manage")] }, async (req) =>
    setStatus(sql, principalOf(req), parse(Id, req.params).id, "deactivated"));
  app.post("/v1/admin/users/:id/reactivate", { preHandler: [auth, requirePermission("user.manage")] }, async (req) =>
    setStatus(sql, principalOf(req), parse(Id, req.params).id, "reactivated"));
  app.post("/v1/admin/users/:id/activation", { preHandler: [auth, requirePermission("activation.issue")] }, async (req, reply) =>
    reply.status(201).send(await issueActivation(sql, principalOf(req), parse(Id, req.params).id, config.activationTtlHours, now())));

  // ---------------------------------------------------------------- admin: bulk import (FR-IMP-*)
  app.get("/v1/admin/imports", { preHandler: [auth, requirePermission("import.manage")] }, async () => listBatches(sql));
  app.get("/v1/admin/imports/templates/:category", { preHandler: [auth, requirePermission("import.manage")] }, async (req, reply) => {
    const { category } = parse(z.object({ category: z.enum(IMPORT_CATEGORIES) }), req.params);
    return reply.header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="sj-import-${category}.csv"`).send(templateCsv(category));
  });
  app.post("/v1/admin/imports", { preHandler: [auth, requirePermission("import.manage")], bodyLimit: 3 * 1024 * 1024 }, async (req, reply) =>
    reply.status(201).send(await previewImport(sql, principalOf(req), parse(ImportPreviewRequest, req.body))));
  app.get("/v1/admin/imports/:id", { preHandler: [auth, requirePermission("import.manage")] }, async (req) =>
    getBatch(sql, parse(Id, req.params).id));
  app.post("/v1/admin/imports/:id/commit", { preHandler: [auth, requirePermission("import.manage")] }, async (req) =>
    commitBatch(sql, principalOf(req), parse(Id, req.params).id, parse(ImportCommitRequest, req.body ?? {}).excludeRows ?? []));
  app.post("/v1/admin/imports/:id/discard", { preHandler: [auth, requirePermission("import.manage")] }, async (req) =>
    discardBatch(sql, principalOf(req), parse(Id, req.params).id));

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
      const body = parse(DevSessionRequest, req.body);
      const phone = body.phone ? normaliseMobile(body.phone) : null;
      if (body.phone && !phone) throw new AppError(400, "validation_failed", "Enter a valid mobile number");
      return { token: await issueDevToken(config.devAuthSecret!, body.email ?? null, { aal: body.mfa ? "aal2" : "aal1", ...(phone ? { phone } : {}) }) };
    });
  }

  return app;
}
