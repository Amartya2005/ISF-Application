# Security self-review (Phase 10)

**This is a self-review, not the independent security review / penetration test that
[LAUNCH_CHECKLIST.md](/docs/LAUNCH_CHECKLIST.md) §D requires before launch.** It exists to make that external
review's job easier (a map of what is already covered, with evidence, and what is explicitly out of scope so
far), and to give an honest internal checkpoint. It does **not** close the §D item, and no one should treat it
as having done so.

Scope: the whole repository as of Phase 10 (commit history through this delivery). The deepest single incident
response so far is [SECURITY_FIX_2026-10-15.md](/docs/SECURITY_FIX_2026-10-15.md) (identity verification, account
linking, activation, open redirects, formula injection); this document is a broader, shallower pass across the
rest of the PRD's NFR-05 ("test event isolation, role enforcement, file access, session handling, rate limiting
and audit integrity").

## 1. What has test-backed coverage already

| Area | Control | Evidence |
|---|---|---|
| Authentication | Supabase OTP (email/SMS) in production; JWKS verification pinned to ES256/RS256, requires `sub`/`exp`, rejects anonymous sessions and non-`authenticated` roles. Dev-mode token auth is refused when `NODE_ENV=production`. | `apps/api/src/platform/auth.ts`; `auth.test.ts`, `security.test.ts` |
| Identity linking | An account is linked to an email/phone only once Supabase's Admin API confirms it; ambiguous or conflicting matches are refused and audited. | `principal.ts`; `security.test.ts` (linking-attack cases) |
| Staff MFA | `REQUIRE_STAFF_MFA` forced on in production; every privileged route answers `mfa_required` without aal2. | `config.ts`; `auth.test.ts`, `e2e_mfa.py` |
| Authorisation | Default-deny: every route names one permission; participant routes also check edition access; services re-check relationships (e.g. "this juror is assigned to this startup"). | `platform/permissions.ts`, `requirePermission`, `requireEditionAccess`; every `*.test.ts` file asserts its own route's permission matrix |
| Event isolation | Role grants and edition access are edition-scoped; cross-edition reads are refused at the service layer, not just hidden in the UI. | `security.test.ts` role/edition matrix; `jury.test.ts`, `volunteers.test.ts` isolation cases |
| Row-level security | Every table has RLS on; `anon`/`authenticated` hold no table privileges; all access goes through the API. Checked by a test that walks `information_schema` for every table. | Migration `0005_lockdown_data_api.sql`; `data-api-lockdown.test.ts` |
| Database-enforced rules | Rules a client could otherwise bypass (append-only audit/history, one-per-X constraints, lifecycle transitions) are also triggers/constraints, not just API checks. | `schema.test.ts`, `data-api-lockdown.test.ts`, and rule-specific tests across the suite |
| Function hijacking | Every PL/pgSQL function pins `search_path = public, pg_temp`. | Migration `0006_function_search_path.sql` |
| Open redirects | Any redirect target taken from a URL goes through `safeReturnPath` with an allow-list, on the website, console sign-in and console MFA pages. | `safeReturnPath`; 18 tests (per SECURITY_FIX_2026-10-15.md §"Review follow-up") |
| CSV / formula injection | Imports reject formula-prefixed cells (`=`, `+`, `-`, `@`, tab, CR, full-width forms); every export goes through one escaping helper. | `platform/csv-export.ts`; import validation tests, `reports.test.ts` |
| Rate limiting | Registration, activation and Help Desk questions are rate-limited per minute; the emergency endpoint is deliberately never rate-limited (so a real emergency is never throttled). | `config.ts`; `support.test.ts`, `helpdesk.test.ts` |
| File access | Documents are never public; a 60-second signed link is issued only after an audience check; anything outside the audience is "not found", not "forbidden" (no existence leak). | `content.test.ts` |
| AI prompt-injection | Deterministic emergency/human-request/injection checks run before any model call; the model only ever sees scoped tool results as data, never account-wide reads; output is checked for leaked identifiers not present in what was given to it. | `helpdesk.test.ts` (24 cases including injection and leak-blocking) |
| SQL injection | All queries use postgres.js tagged-template parameterisation; no string-built SQL anywhere in the codebase (checked by grep as part of this review — see §3). | — |
| Secrets hygiene | Service-role keys, SMTP/SMS credentials never appear in `NEXT_PUBLIC_*`/`EXPO_PUBLIC_*`; `.env` is gitignored; the production launch gate refuses to start with any of the dev/stub providers active. | `config.ts` `productionBlockers()`; `.gitignore` |
| Cross-origin exposure | CORS restricted to configured origins; **found and fixed in this phase**: `content-disposition` was not in `exposedHeaders`, so the console's CSV downloads (Phase 9) could not read their own file name cross-origin — harmless to security (no data exposure; a client-side cosmetic failure), but is exactly the kind of thing an independent reviewer should be checking for, so it is recorded here. | `apps/api/src/app.ts`; `auth.test.ts` ("exposes content-disposition cross-origin") |

## 2. What this self-review did NOT do (an independent reviewer should)

- No external attack-surface scan (no port scan, no dependency CVE audit run as part of this pass, no fuzzing).
- No review by anyone who did not write the code. Every item in §1 is evidence the *author* produced; an
  independent reviewer asking "what did you miss" is the point of §D, not something this document can substitute
  for.
- No review of the hosting platform once it exists (Cloud Run / Vercel / Supabase configuration, network
  policies, IAM) — none of that exists yet (TBD-36, TBD-46).
- No social-engineering, physical, or operational-security review (on-call handling of secrets, who can approve
  `LAUNCH_APPROVED`, etc. — those are process controls already described in LAUNCH_CHECKLIST.md, not tested here).
- `npm audit` / dependency vulnerability scanning was not run as part of this document and should be, on a
  schedule, independent of this one-time pass.

## 3. One check actually run for this review

A grep across `apps/api/src` for string-built SQL (template literals or string concatenation passed to a query
function instead of a tagged `sql`/`db` template) found none — every database call in the codebase uses
postgres.js's tagged-template parameterisation, which is what prevents SQL injection by construction. This is a
point-in-time check, not a standing control; a future change that builds a query string manually would not be
caught by anything automatic today, so the production launch gate and code review stay the backstop.

## 4. Status

**Independent security review / penetration test: not started.** This remains blocked on an external
party being engaged, which is organisational/budget action (LAUNCH_CHECKLIST.md §A, §D), not an engineering task
this delivery can complete on its own.
