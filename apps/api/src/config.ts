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
  REQUIRE_STAFF_MFA: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  CORS_ORIGINS: z.string().default("http://localhost:3000,http://localhost:3001"),
  LOG_LEVEL: z.string().default("info"),
  REGISTRATION_RATE_LIMIT: z.coerce.number().int().positive().default(10),
  // Activation codes are single-use and time-limited (FR-IAM-10). The validity period is not specified in the
  // requirements; 72 hours is a provisional default the organisers can change.
  ACTIVATION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(72),
  ACTIVATION_RATE_LIMIT: z.coerce.number().int().positive().default(10),
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = Env.parse(env);
  if (e.AUTH_MODE === "dev") {
    if (e.NODE_ENV === "production") throw new Error("AUTH_MODE=dev is not allowed when NODE_ENV=production");
    if (!e.DEV_AUTH_SECRET) throw new Error("DEV_AUTH_SECRET (>= 32 chars) is required when AUTH_MODE=dev");
  }
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
    requireStaffMfa: e.REQUIRE_STAFF_MFA,
    corsOrigins: e.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
    logLevel: e.LOG_LEVEL,
    registrationRateLimit: e.REGISTRATION_RATE_LIMIT,
    activationTtlHours: e.ACTIVATION_TTL_HOURS,
    activationRateLimit: e.ACTIVATION_RATE_LIMIT,
  };
}
