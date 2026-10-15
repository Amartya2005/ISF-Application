# Staging environment

| Item | Value |
|---|---|
| Supabase organisation | **ISF** (free plan) |
| Project | `startup-jathara-staging` · ref `chiafggvergjwliqvlwv` · **Mumbai (ap-south-1)** · created 15 Oct 2026 |
| API URL | `https://chiafggvergjwliqvlwv.supabase.co` |
| Publishable key (public) | `sb_publishable_g70WFso8X3RevFDQhNAxxw_aGhcSxk_`. Safe to ship in web and app builds; it grants no table access (see below). |
| JWT signing | Asymmetric **ES256** key published at `/auth/v1/.well-known/jwks.json`, as the API's verifier requires |
| Database schema | Migrations 0001–0006 applied and recorded in `schema_migrations` with the same checksums as `db/migrations`, so `pnpm db:migrate` sees staging as up to date |
| Data API | Closed. All 32 tables have row-level security on with no policies, and `anon`/`authenticated` hold no privileges (checked in SQL on 15 Oct 2026; Supabase security advisor shows only the expected "RLS enabled, no policy" notes) |

Also in the ISF organisation: "Amartya2005's Project" (Sydney, ap-southeast-2) was created automatically, is empty, and is **paused** to free the free-plan project slot. Restore or delete it from the dashboard as you prefer. The personal "n8n" organisation and its project are not used.

## Still to do before staging tests can run (owner: whoever holds the ISF Supabase account)

1. **Secrets** (dashboard → Project settings). Never commit these, and never put them in `NEXT_PUBLIC_*` or `EXPO_PUBLIC_*`:
   - the service-role / secret key → `SUPABASE_SERVICE_ROLE_KEY` for the staging API and `STAGING_SUPABASE_SERVICE_ROLE_KEY` for `staging:verify`;
   - the database password and connection string → `DATABASE_URL` for the staging API. Use the session pooler or a direct connection; postgres.js needs session mode.
2. **Auth settings** (dashboard → Authentication):
   - email OTP: set the email template to show `{{ .Token }}` (the 6-digit code), because the apps use codes, not links;
   - SMS OTP: an SMS provider (DLT-registered for India, TBD-35), plus one or more **test phone numbers** with fixed OTPs for automated tests;
   - MFA: TOTP enabled;
   - for the device protocol run, temporarily shorten the JWT expiry to 300 s.
3. **Host the staging API** (AUTH_MODE=supabase, REQUIRE_STAFF_MFA=true, NODE_ENV=staging), plus the website and console with `NEXT_PUBLIC_AUTH_MODE=supabase` and the URL and key above. Hosting is TBD-46.
4. Seed one Management account (and one never-signed-in Management account for the linking-attack check), then run `pnpm --filter @sj/api staging:verify` and the device protocol.
