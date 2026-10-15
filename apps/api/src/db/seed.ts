// Development seed: staff accounts for local sign-in (AUTH_MODE=dev). Idempotent. Never run against production.
// Sign in on the console with one of these emails; the dev token subject is `dev|<email>`.
import { createSql } from "./client.js";
import { migrate } from "./migrate.js";

const STAFF = [
  { email: "manager@dev.local", name: "Dev Manager", roles: ["management"] },
  { email: "admin@dev.local", name: "Dev Admin (no management grant)", roles: ["admin"] },
  { email: "support@dev.local", name: "Dev Support", roles: ["customer_support"] },
] as const;

if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed a production database");
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const sql = createSql(url, { max: 1 });
try {
  await migrate(sql);
  for (const s of STAFF) {
    const [u] = await sql<{ id: string }[]>`
      insert into user_accounts (auth_subject, email, full_name)
      values (${`dev|${s.email}`}, ${s.email}, ${s.name})
      on conflict (auth_subject) do update set full_name = excluded.full_name
      returning id`;
    for (const role of s.roles) {
      await sql`
        insert into role_grants (user_id, role) select ${u!.id}, ${role}
        where not exists (select 1 from role_grants where user_id = ${u!.id} and role = ${role} and revoked_at is null)`;
    }
    console.log(`seeded ${s.email} → ${s.roles.join(", ")}`);
  }
} finally {
  await sql.end();
}
