import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createSql } from "./db/client.js";
import { devIdentityResolver, devVerifier, supabaseIdentityResolver, supabaseVerifier } from "./platform/auth.js";

const config = loadConfig();
const sql = createSql(config.databaseUrl);
const supabase = config.authMode === "supabase";
const verifier = supabase ? supabaseVerifier(config.supabaseUrl!) : devVerifier(config.devAuthSecret!);
const identity = supabase
  ? supabaseIdentityResolver({ supabaseUrl: config.supabaseUrl!, serviceRoleKey: config.supabaseServiceRoleKey! })
  : devIdentityResolver;
const app = await buildApp({ config, sql, verifier, identity });

const close = async () => {
  await app.close();
  await sql.end({ timeout: 5 });
  process.exit(0);
};
process.on("SIGTERM", close);
process.on("SIGINT", close);

await app.listen({ port: config.port, host: "0.0.0.0" });
