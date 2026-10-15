// Live verification against a Supabase STAGING project and the staging API (launch checklist §B).
// It exercises what unit tests cannot: real OTP sessions, JWKS signing keys, the Admin API identity check,
// account-linking refusal, token refresh, sign-out revocation and authenticator (TOTP) MFA elevation.
//
//   pnpm --filter @sj/api staging:verify
//
// Required environment (never production values; never commit them):
//   STAGING_CONFIRM=this-is-staging     explicit guard
//   STAGING_SUPABASE_URL, STAGING_SUPABASE_ANON_KEY, STAGING_SUPABASE_SERVICE_ROLE_KEY
//   STAGING_API_URL                     the staging API running with AUTH_MODE=supabase, REQUIRE_STAFF_MFA=true
// Optional (each enables more checks):
//   STAGING_STAFF_EMAIL                 a pre-created ACTIVE Management account in the staging database
//   STAGING_UNLINKED_STAFF_EMAIL        a pre-created Management account that has never signed in, and no Supabase user
//   STAGING_TEST_PHONE, STAGING_TEST_PHONE_OTP   a Supabase Auth "test phone number" and its fixed OTP
//
// Every user the script creates is deleted at the end. Results: PASS / FAIL / SKIP per check; exit code 1 on any FAIL.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { totp } from "./totp.js";

/** Projects this script must never touch (e.g. personal projects unrelated to Startup Jathara). */
const BLOCKED_PROJECT_REFS = ["owsbizpdcdzcvplvxfnt"];

type Result = { check: string; status: "PASS" | "FAIL" | "SKIP"; detail: string };
const results: Result[] = [];
const record = (check: string, status: Result["status"], detail = "") => {
  results.push({ check, status, detail });
  console.log(`${status.padEnd(4)}  ${check}${detail ? ` — ${detail}` : ""}`);
};

function env(name: string, required = true): string | undefined {
  const v = process.env[name]?.trim();
  if (required && !v) throw new Error(`${name} is required`);
  return v || undefined;
}

async function api(path: string, token: string, init: RequestInit = {}) {
  const res = await fetch(`${env("STAGING_API_URL")!.replace(/\/$/, "")}${path}`, {
    ...init, headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function check(name: string, fn: () => Promise<string | void>) {
  try {
    const detail = await fn();
    record(name, "PASS", detail ?? "");
  } catch (e) {
    record(name, "FAIL", (e as Error).message);
  }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

async function main() {
  if (env("STAGING_CONFIRM") !== "this-is-staging") throw new Error("Set STAGING_CONFIRM=this-is-staging to confirm the target is staging");
  const url = env("STAGING_SUPABASE_URL")!;
  const ref = new URL(url).hostname.split(".")[0]!;
  if (BLOCKED_PROJECT_REFS.includes(ref)) throw new Error(`Refusing to run against blocked project ${ref}`);
  const anonKey = env("STAGING_SUPABASE_ANON_KEY")!;
  const admin = createClient(url, env("STAGING_SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  const client = (): SupabaseClient => createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const created: string[] = [];
  const stamp = Date.now();

  /** Real email OTP session without sending mail: the Admin API issues the same one-time code. */
  async function emailOtpSession(email: string) {
    const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (error) throw error;
    if (data.user && !created.includes(data.user.id) && !email.startsWith("staff")) created.push(data.user.id);
    const c = client();
    const { data: s, error: e2 } = await c.auth.verifyOtp({ email, token: data.properties.email_otp, type: "email" });
    if (e2 || !s.session) throw e2 ?? new Error("no session");
    return { c, session: s.session };
  }

  try {
    const health = await fetch(`${env("STAGING_API_URL")!.replace(/\/$/, "")}/healthz`);
    assert(health.ok, `staging API /healthz returned ${health.status}`);

    await check("JWKS publishes asymmetric signing keys (ES256/RS256) the API accepts", async () => {
      const res = await fetch(`${url}/auth/v1/.well-known/jwks.json`);
      const { keys } = (await res.json()) as { keys: { alg?: string; kty: string }[] };
      const algs = keys.map((k) => k.alg ?? k.kty);
      assert(keys.some((k) => k.alg === "ES256" || k.alg === "RS256"), `no ES256/RS256 key (found ${algs.join(", ") || "none"}); enable asymmetric JWT signing keys`);
      return algs.join(", ");
    });

    await check("Data API is closed: the public key can neither read nor write our tables (migration 0005)", async () => {
      for (const table of ["user_accounts", "applications", "event_editions", "activation_tokens"]) {
        const read = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, { headers: { apikey: anonKey } });
        const rows = read.ok ? ((await read.json()) as unknown[]) : [];
        assert(rows.length === 0, `${table}: ${rows.length} row(s) readable with the public key`);
        const write = await fetch(`${url}/rest/v1/${table}`, {
          method: "POST", headers: { apikey: anonKey, "content-type": "application/json", prefer: "return=minimal" }, body: "{}",
        });
        assert(!write.ok, `${table}: insert with the public key returned ${write.status}`);
      }
    });

    let applicant: Awaited<ReturnType<typeof emailOtpSession>> | null = null;
    await check("Email OTP: a real session is accepted by the API (new applicant, no account yet)", async () => {
      applicant = await emailOtpSession(`sj-staging-${stamp}@example.com`);
      const me = await api("/v1/me", applicant.session.access_token);
      assert(me.status === 200 && me.json.account === null, `GET /v1/me → ${me.status} ${JSON.stringify(me.json)}`);
    });

    await check("Session refresh: a refreshed access token is accepted", async () => {
      assert(applicant, "needs the email OTP session");
      const { data, error } = await applicant.c.auth.refreshSession({ refresh_token: applicant.session.refresh_token });
      assert(!error && data.session, `refresh failed: ${error?.message}`);
      const me = await api("/v1/me", data.session.access_token);
      assert(me.status === 200, `GET /v1/me with refreshed token → ${me.status}`);
      applicant.session = data.session;
    });

    await check("Sign-out revokes the refresh token (global scope)", async () => {
      assert(applicant, "needs the email OTP session");
      const refresh = applicant.session.refresh_token;
      await applicant.c.auth.setSession({ access_token: applicant.session.access_token, refresh_token: refresh });
      const { error } = await applicant.c.auth.signOut({ scope: "global" });
      assert(!error, `sign-out failed: ${error?.message}`);
      const { data } = await client().auth.refreshSession({ refresh_token: refresh });
      assert(!data.session, "the old refresh token still works after sign-out");
      return "access tokens already issued stay valid until they expire (JWT); keep their lifetime short";
    });

    const phone = env("STAGING_TEST_PHONE", false), phoneOtp = env("STAGING_TEST_PHONE_OTP", false);
    const unlinkedStaff = env("STAGING_UNLINKED_STAFF_EMAIL", false);
    if (phone && phoneOtp) {
      await check("SMS OTP: a phone-only session is accepted by the API", async () => {
        const c = client();
        await c.auth.signInWithOtp({ phone });
        const { data: s, error } = await c.auth.verifyOtp({ phone, token: phoneOtp, type: "sms" });
        assert(!error && s.session, `test-phone OTP failed: ${error?.message}`);
        try {
          const me = await api("/v1/me", s.session.access_token);
          assert(me.status === 200, `GET /v1/me → ${me.status}`);
        } finally {
          if (s.user) await admin.auth.admin.deleteUser(s.user.id);   // frees the test number for the next check
        }
      });
    } else {
      record("SMS OTP: phone-only session", "SKIP", "set STAGING_TEST_PHONE and STAGING_TEST_PHONE_OTP (Supabase Auth test phone numbers)");
    }

    if (phone && phoneOtp && unlinkedStaff) {
      await check("Attack: unconfirmed staff email + editable 'email_verified' metadata does NOT link to the staff account", async () => {
        const { data, error } = await admin.auth.admin.createUser({
          phone, phone_confirm: true, email: unlinkedStaff, email_confirm: false, user_metadata: { email_verified: true },
        });
        if (error) throw error;
        created.push(data.user.id);
        const c = client();
        await c.auth.signInWithOtp({ phone });
        const { data: s, error: e2 } = await c.auth.verifyOtp({ phone, token: phoneOtp, type: "sms" });
        assert(!e2 && s.session, `test-phone OTP failed: ${e2?.message}`);
        const me = await api("/v1/me", s.session.access_token);
        assert(me.status === 200 && me.json.account === null && !me.json.roles?.includes("management"),
          `attacker resolved to ${JSON.stringify(me.json.account)} with roles ${me.json.roles}`);
        return "phone-only identity; staff account untouched";
      });
    } else {
      record("Attack: unconfirmed staff email does not link", "SKIP", "set STAGING_TEST_PHONE, STAGING_TEST_PHONE_OTP and STAGING_UNLINKED_STAFF_EMAIL");
    }

    const staff = env("STAGING_STAFF_EMAIL", false);
    if (staff) {
      await check("Staff MFA: aal1 is refused, TOTP enrolment + verification elevates to aal2", async () => {
        const { c, session } = await emailOtpSession(staff);
        const weak = await api("/v1/me", session.access_token);
        assert(weak.status === 200 && weak.json.mfaRequired === true, `expected mfaRequired at aal1, got ${JSON.stringify(weak.json)}`);
        const denied = await api("/v1/manage/editions/2026/applications", session.access_token);
        assert(denied.json?.code === "mfa_required", `privileged call at aal1 → ${denied.status} ${denied.json?.code}`);
        await c.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
        const { data: f, error } = await c.auth.mfa.enroll({ factorType: "totp", friendlyName: `staging-verify-${stamp}` });
        if (error) throw error;
        try {
          const { data: v, error: e2 } = await c.auth.mfa.challengeAndVerify({ factorId: f.id, code: totp(f.totp.secret) });
          if (e2) throw e2;
          const strong = await api("/v1/me", v.access_token);
          assert(strong.json.mfaRequired === false, `still mfaRequired after aal2: ${JSON.stringify(strong.json)}`);
          const ok = await api("/v1/manage/editions/2026/applications", v.access_token);
          assert(ok.status === 200, `privileged call at aal2 → ${ok.status} ${ok.json?.code}`);
        } finally {
          await admin.auth.admin.mfa.deleteFactor({ userId: session.user.id, id: f.id });   // leave the staff account as found
        }
      });
    } else {
      record("Staff MFA elevation", "SKIP", "set STAGING_STAFF_EMAIL (active Management account in the staging database)");
    }
  } finally {
    for (const id of created) await admin.auth.admin.deleteUser(id).catch(() => undefined);
  }

  const failed = results.filter((r) => r.status === "FAIL").length;
  console.log(`\n${results.filter((r) => r.status === "PASS").length} passed, ${failed} failed, ${results.filter((r) => r.status === "SKIP").length} skipped`);
  console.log("Device checks (keychain persistence, background refresh, sign-out on real phones) are manual: docs/DEVICE_TEST_PROTOCOL.md");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(`Aborted: ${(e as Error).message}`); process.exit(2); });
