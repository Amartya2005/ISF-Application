// Integration-test harness: every test file gets its own freshly migrated PostgreSQL database.
// Needs a reachable server: TEST_DATABASE_URL (admin connection) or the local one from scripts/dev-db.sh.
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import type { Role } from "@sj/contracts";
import { buildApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import { createSql, type Sql } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { devIdentityResolver, devVerifier, issueDevToken, type IdentityResolver, type TokenVerifier } from "../src/platform/auth.js";

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/postgres";
export const SECRET = "test-secret-that-is-at-least-32-characters";

/** 20 Oct 2026, 10:00 IST: both editions open. */
export const BEFORE_DEADLINE = new Date("2026-10-20T10:00:00+05:30");
export const AT_DEADLINE = new Date("2026-11-05T23:59:59+05:30");
export const AFTER_DEADLINE = new Date("2026-11-06T00:00:00+05:30");

function withDb(url: string, db: string) {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

export async function createTestDb(): Promise<{ url: string; sql: Sql; drop: () => Promise<void> }> {
  const name = `sj_test_${randomBytes(6).toString("hex")}`;
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`create database ${name}`);
  } catch (e) {
    throw new Error(`Cannot create a test database via ${ADMIN_URL}. Start one with "pnpm db:start" or set TEST_DATABASE_URL. (${(e as Error).message})`);
  } finally {
    await admin.end();
  }
  const url = withDb(ADMIN_URL, name);
  const sql = createSql(url, { max: 8 });
  await migrate(sql);
  return {
    url,
    sql,
    async drop() {
      await sql.end({ timeout: 5 });
      const a = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
      await a.unsafe(`drop database if exists ${name} with (force)`);
      await a.end();
    },
  };
}

type CallOpts = { as?: string; aal?: "aal1" | "aal2"; body?: unknown; token?: string };

export async function createTestApp(
  opts: { now?: Date; requireStaffMfa?: boolean; corsOrigins?: string[]; verifier?: TokenVerifier; identity?: IdentityResolver } = {},
) {
  const db = await createTestDb();
  let current = opts.now ?? BEFORE_DEADLINE;
  const config: Config = {
    nodeEnv: "test", databaseUrl: db.url, port: 0, authMode: "dev", devAuthSecret: SECRET,
    requireStaffMfa: opts.requireStaffMfa ?? false, corsOrigins: opts.corsOrigins ?? [], logLevel: "silent", registrationRateLimit: 1000, activationTtlHours: 72, activationRateLimit: 1000,
  };
  const app = await buildApp({
    config, sql: db.sql, verifier: opts.verifier ?? devVerifier(SECRET), identity: opts.identity ?? devIdentityResolver,
    clock: () => current, logger: false,
  });

  const t = {
    app,
    sql: db.sql,
    setNow(d: Date) { current = d; },
    token: (email: string, aal: "aal1" | "aal2" = "aal1") => issueDevToken(SECRET, email, { aal }),
    /** Dev token with explicit verification assertions (what the dev identity resolver will report as proven). */
    tokenWith: (email: string | null, o: Parameters<typeof issueDevToken>[2] = {}) => issueDevToken(SECRET, email, o),
    /** Creates a pre-provisioned staff account already linked to its dev identity. */
    async staff(email: string, roles: Role[]): Promise<string> {
      const [u] = await db.sql<{ id: string }[]>`
        insert into user_accounts (auth_subject, email, full_name) values (${`dev|${email}`}, ${email}, ${email}) returning id`;
      for (const r of roles) await db.sql`insert into role_grants (user_id, role) values (${u!.id}, ${r})`;
      return u!.id;
    },
    async call(method: "GET" | "POST" | "PUT" | "DELETE", url: string, o: CallOpts = {}) {
      const headers: Record<string, string> = {};
      const token = o.token ?? (o.as ? await t.token(o.as, o.aal) : undefined);
      if (token) headers.authorization = `Bearer ${token}`;
      const res = await app.inject({ method, url, headers, ...(o.body !== undefined ? { payload: o.body as object } : {}) });
      return { status: res.statusCode, json: res.body ? (JSON.parse(res.body) as any) : null, headers: res.headers };
    },
    async close() {
      await app.close();
      await db.drop();
    },
  };
  return t;
}
export type TestApp = Awaited<ReturnType<typeof createTestApp>>;

export function registration(overrides: { yearOption?: string; name?: string; mobile?: string; [k: string]: unknown } = {}) {
  const { yearOption = "2026", name = "Forest Labs", mobile = "98765 43210", ...rest } = overrides;
  return {
    yearOption,
    startup: { name, description: "Low-cost sensors for tribal agriculture co-operatives.", city: "Gunupur", state: "Odisha" },
    leader: { fullName: "Asha Patra", mobile },
    formAnswers: { ...FORM_ANSWERS },
    privacyNoticeAccepted: true,
    adultDeclaration: true,
    ...rest,
  };
}

/** Valid answers to the seeded application form (migration 0007, TBD-39). */
export const FORM_ANSWERS: Record<string, string> = {
  problem: "Smallholder co-operatives cannot see soil moisture in time to save crops.",
  solution: "Solar sensors that report over SMS, priced for co-operatives rather than single farms.",
  stage: "Pilot with three co-operatives in Rayagada since June; 40 paying members.",
  market: "About 2,000 farmer co-operatives in southern Odisha, then neighbouring states.",
  impact: "Fewer failed harvests and lower water use for tribal farming households.",
  team: "Two founders: an electronics engineer and an agronomist with ten years in extension work.",
};
