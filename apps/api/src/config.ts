import { PRIVACY_NOTICE_VERSION } from "@sj/contracts";
import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().default(4000),
  AUTH_MODE: z.enum(["dev", "supabase"]).default("dev"),
  DEV_AUTH_SECRET: z.string().min(32).optional(),
  SUPABASE_URL: z.string().url().optional().or(z.literal("").transform(() => undefined)),
  // Server-side secret used only to read authoritative user records (email/phone confirmation). Never expose to clients.
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional().or(z.literal("").transform(() => undefined)),
  // Staff MFA (FR-IAM-11). Defaults to on in production and may not be turned off there (checked in loadConfig).
  REQUIRE_STAFF_MFA: z.enum(["true", "false"]).optional(),
  CORS_ORIGINS: z.string().default("http://localhost:3000,http://localhost:3001"),
  LOG_LEVEL: z.string().default("info"),
  REGISTRATION_RATE_LIMIT: z.coerce.number().int().positive().default(10),
  // Activation codes are single-use and time-limited (FR-IAM-10). 72 hours is the recommended validity (TBD-13,
  // docs/DECISIONS.md), awaiting organiser approval; it stays configurable.
  ACTIVATION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(72),
  ACTIVATION_RATE_LIMIT: z.coerce.number().int().positive().default(10),
  // Explicit sign-off that every item in docs/LAUNCH_CHECKLIST.md is complete. Required to start in production.
  LAUNCH_APPROVED: z.enum(["true", "false"]).optional(),
});

export type Config = {
  nodeEnv: "development" | "test" | "production";
  databaseUrl: string;
  port: number;
  authMode: "dev" | "supabase";
  devAuthSecret?: string;
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  requireStaffMfa: boolean;
  corsOrigins: string[];
  logLevel: string;
  registrationRateLimit: number;
  activationTtlHours: number;
  activationRateLimit: number;
};

/**
 * Fail-closed launch gate: in production the API refuses to start until the launch checks are complete
 * (docs/LAUNCH_CHECKLIST.md). Each unmet item is listed so the operator knows exactly what is missing.
 */
export function productionBlockers(e: z.output<typeof Env>, privacyNoticeVersion = PRIVACY_NOTICE_VERSION): string[] {
  const blockers: string[] = [];
  if (e.AUTH_MODE !== "supabase") blockers.push("AUTH_MODE must be supabase (development sign-in is never allowed in production)");
  if (e.REQUIRE_STAFF_MFA === "false") blockers.push("REQUIRE_STAFF_MFA=false is not allowed: staff roles must use MFA (FR-IAM-11)");
  const origins = e.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
  if (!origins.length || origins.some((o) => !o.startsWith("https://") || /localhost|127\.0\.0\.1/.test(o))) {
    blockers.push("CORS_ORIGINS must list only the production https:// origins");
  }
  if (privacyNoticeVersion.startsWith("draft")) {
    blockers.push(`the privacy notice is still a draft (${privacyNoticeVersion}); publish the approved text and version first (TBD-32)`);
  }
  if (e.LAUNCH_APPROVED !== "true") {
    blockers.push("LAUNCH_APPROVED=true is not set: complete and sign off docs/LAUNCH_CHECKLIST.md (live Supabase staging tests, approved privacy text, remaining launch checks)");
  }
  return blockers;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, opts: { privacyNoticeVersion?: string } = {}): Config {
  const e = Env.parse(env);
  if (e.NODE_ENV === "production") {
    const blockers = productionBlockers(e, opts.privacyNoticeVersion);
    if (blockers.length) throw new Error(`Production start refused. Launch checks incomplete:\n- ${blockers.join("\n- ")}`);
  }
  if (e.AUTH_MODE === "dev") {
    if (e.NODE_ENV === "production") throw new Error("AUTH_MODE=dev is not allowed when NODE_ENV=production");
    if (!e.DEV_AUTH_SECRET) throw new Error("DEV_AUTH_SECRET (>= 32 chars) is required when AUTH_MODE=dev");
  }
  const production = e.NODE_ENV === "production";
  if (production && e.REQUIRE_STAFF_MFA === "false") {
    throw new Error("REQUIRE_STAFF_MFA=false is not allowed when NODE_ENV=production: staff roles must use MFA (FR-IAM-11)");
  }
  const requireStaffMfa = e.REQUIRE_STAFF_MFA ? e.REQUIRE_STAFF_MFA === "true" : production;
  if (e.AUTH_MODE === "supabase" && (!e.SUPABASE_URL || !e.SUPABASE_SERVICE_ROLE_KEY)) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required when AUTH_MODE=supabase");
  }
  return {
    nodeEnv: e.NODE_ENV,
    databaseUrl: e.DATABASE_URL,
    port: e.PORT,
    authMode: e.AUTH_MODE,
    devAuthSecret: e.DEV_AUTH_SECRET,
    supabaseUrl: e.SUPABASE_URL,
    supabaseServiceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY,
    requireStaffMfa,
    corsOrigins: e.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
    logLevel: e.LOG_LEVEL,
    registrationRateLimit: e.REGISTRATION_RATE_LIMIT,
    activationTtlHours: e.ACTIVATION_TTL_HOURS,
    activationRateLimit: e.ACTIVATION_RATE_LIMIT,
  };
}
