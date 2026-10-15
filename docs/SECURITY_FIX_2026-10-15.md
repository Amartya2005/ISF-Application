# Security fix report — identity verification, account linking, activation (15 Oct 2026)

Scope: `startup-jathara-m1`. No architecture, API-contract or PRD changes. No production credentials were used and nothing was deployed.

## 1. Findings and root causes

| # | Finding | Root cause | Severity |
|---|---|---|---|
| F1 | A Supabase user could be treated as owning an email they never confirmed | The verifier accepted `user_metadata.email_verified` (user-editable via `updateUser({ data })`) and the amr method `otp`, which Supabase uses for **both** email OTP and SMS OTP. A phone-OTP user with an unconfirmed email in their profile looked "email verified". | Critical |
| F2 | Pre-created staff accounts (e.g. `management`) could be taken over | Linking matched the token email against unlinked accounts, so F1 let an attacker inherit the account's roles on first sign-in. | Critical |
| F3 | No activation enforcement | `pending_activation` accounts were linked and received their roles, so imported or invited accounts were usable without activation. Only `deactivated` was checked. | High |
| F4 | Registration stored unproven identifiers | New applicant accounts stored the token email whether verified or not. Someone could reserve another person's email before that person's account was imported, which blocked the import or the later link. | High |
| F5 | Linking accepted deactivated accounts and ambiguous matches | There was no status filter, no conflict handling (email → account A, phone → account B), and no handling of shared mobile numbers. | Medium |
| F6 | Weak JWT options for external tokens | Algorithm not pinned, `exp` not required, anonymous sessions and non-`authenticated` roles (e.g. `service_role`) accepted. | Medium |
| F7 | Release could grant edition access to a deactivated leader | The `edition_access` insert on release had no status check. | Low |

## 2. Changes

**Identity (`apps/api/src/platform/auth.ts`)**
- Responsibilities are split. A `TokenVerifier` proves who the session is (`sub`, `aal`). A new `IdentityResolver` proves which email or phone that identity controls.
- In Supabase mode the resolver reads `GET /auth/v1/admin/users/{sub}` with the server-side service-role key.
- An email or phone counts as proven only when all three hold:
  - `email_confirmed_at` / `phone_confirmed_at` is set;
  - the record's value matches the token's (phone normalised to E.164);
  - the user is not banned, deleted or anonymous, and the record id equals `sub`.
- Fails closed: a 5xx response, network error or bad JSON gives 503 `identity_unavailable`, never "verified".
- The resolver runs only for subjects not yet linked, so already-linked accounts do not depend on it.
- The JWKS verifier now:
  - accepts only ES256/RS256;
  - requires `sub` and `exp`;
  - rejects anonymous sessions and any `role` other than `authenticated`;
  - ignores `user_metadata` and `amr`.
- Dev tokens (local and tests only, refused in production) carry signed `email_verified` / `phone_verified` assertions so tests can model every case.

**Linking (`principal.ts`)**
- Linking uses proven identifiers only.
- Candidates must be unlinked and not deactivated.
- These cases are refused and audited as `identity.link_refused`:
  - email and phone match different accounts;
  - more than one candidate (shared mobile);
  - a phone-only match on an account whose email on file was not proven.
- The link is an atomic conditional update, audited as `identity.linked` with the method used.

**Activation (`principal.ts`)**
- The account status check runs before any role or edition access is loaded, on every protected request.
- Responses: `pending_activation` → 403 `account_not_active`; `deactivated` → 403 `account_deactivated`; any other state → 403 (fail closed).
- No endpoint changes account status, so a direct API request cannot activate an account.

**Registration (`modules/registration/service.ts`)**
- A new account requires a proven email or phone; otherwise 403 `identity_unverified`.
- Only proven identifiers are stored. A phone-only identity gets `email = null` and its verified mobile.

**Database (`db/migrations/0003_activation_guards.sql`, new forward-only migration)**
- DC-02 is strengthened: a decision maker must be an **active** account with a management grant.
- New trigger: `released_by` must also be an active management account.
- New triggers refuse inserts into `role_grants` and `edition_access` for deactivated accounts (hint `ACCOUNT-STATUS`).

**Selection release** — the `edition_access` grant now skips deactivated leaders (F7).

**Config** — new `SUPABASE_SERVICE_ROLE_KEY`, required when `AUTH_MODE=supabase`, server-side only. `.env.example` and README are updated.

## 3. Selection limit (inspected, unchanged)

Current behaviour:
- `PUT /selection-limit` sets the limit.
- Drafting decisions is never limited.
- `listApplications` reports `selectedTotal` (drafted + released `selected`) against `selectionLimit`.
- Release is **permitted** above the limit and returns a `warnings[]` entry.

This matches PRD FR-SEL-04 as written ("warn"). It is not a security or integrity defect:
- only an active management account can release, and DB trigger DC-02 enforces this;
- every release is audited;
- the count is computed in the same transaction.

The behaviour is therefore kept. **TBD-19 (open):** should exceeding the limit warn only, require explicit confirmation, or block? Not decided; nothing was invented.

## 4. Tests added

- `apps/api/test/auth.test.ts` (updated). These old cases asserted the insecure behaviour and were replaced with stricter ones:
  - forged `user_metadata.email_verified` + amr `otp` → no verification;
  - phone normalisation;
  - rejection of anonymous sessions, wrong audience, `service_role`, missing `exp` and HS256 tokens.
- `apps/api/test/security.test.ts` (new):
  - **Resolver with a fake Admin API:**
    - email confirmed, unconfirmed or mismatched;
    - phone OTP (phone confirmed, email unconfirmed), phone unconfirmed or mismatched;
    - id mismatch, banned, deleted, anonymous, 404;
    - 500 or network error → 503;
    - service-key header and URL-encoded `sub`.
  - **Linking attacks:**
    - unverified email → no link and no roles;
    - verified email → link;
    - already-linked account cannot be re-linked (409 `email_in_use` on registration);
    - deactivated account never linked;
    - email/phone conflict refused and audited;
    - phone-only links to a single email-less account;
    - phone cannot claim an account with an email on file;
    - shared mobile refused (`ambiguous`);
    - unverified phone ignored;
    - identity outage → 503 for new identities while linked accounts keep working.
  - **Full stack with Supabase-shaped ES256 tokens:** a forged-claim attacker cannot take over a staff account. They can register only with their confirmed phone, and their email is not stored.
  - **Registration:** no proven identifier → 403 and nothing created; phone-only → 201 with `email = null`.
  - **Activation matrix:**
    - all 8 roles × {pending, deactivated} × 10 protected endpoints → 403 with the right code;
    - status and grants unchanged afterwards and no application created (no bypass);
    - all 8 roles × active → expected access only.
  - **Pending account:** links on verified sign-in but stays locked.
  - **DB triggers:** pending manager cannot decide or release (DC-02); grants and edition access refused for deactivated accounts (`ACCOUNT-STATUS`).

## 5. Verification results

All commands were run on 15 Oct 2026 in the build workspace against a local PostgreSQL 16 server (`scripts/dev-db.sh`, 127.0.0.1:54329). No hosted or production services were used.

| Command | Result |
|---|---|
| `pnpm -r typecheck` | ✅ 6 of 6 packages pass (contracts, client, web-session, api, web, console) |
| `pnpm --filter @sj/api test` (real Postgres, fresh DB per file) | ✅ **81 of 81 pass in 5 files**. This is 34 more than the 47 before the fix: `security.test.ts` adds 35, and `auth.test.ts` lost one test (the "links pending account → 200" case, which expected the insecure behaviour). The first run had 2 failures; both were test-fixture bugs: one test granted roles to an already-deactivated account, which the new trigger correctly refused, and one fixture email was duplicated. The fixtures were fixed; no product code changed. |
| Mutation check: each fix reverted temporarily, then `security.test.ts` re-run | Activation check removed → 9 tests fail. Unconfirmed email trusted → 3 fail. Linking-conflict refusal removed → 2 fail. Source restored afterwards and verified identical to the fixed version. |
| `pnpm db:migrate` (dev DB) | ✅ `applied: 0003_activation_guards.sql` |
| `pnpm -r build` | ✅ API bundle, website and console production builds all done |
| `python3 scripts/e2e_smoke.py <dir>` against the production builds (API :4000, web :3000, console :3001) | ✅ `E2E smoke passed`. Covers website registration → console review → decision → release → applicant status. |

Not run: CI on GitHub (no repository linked) and Supabase staging (no project provisioned; see §6).

## 6. Remaining risks

1. **Staging validation pending.** The Admin API record shape, phone format and JWKS behaviour are tested against fakes modelled on Supabase docs, not against a real project (B-06). Run the sign-in matrix (email OTP, SMS OTP, both) on staging before launch.
2. **Admin API dependency for first sign-in.** Every request from a not-yet-linked identity (applicants before they register) calls the Admin API: there is no cache, and Supabase rate limits apply. An outage gives 503 for those users only. If load testing shows pressure, add a short-TTL cache keyed by `sub`.
3. **Service-role key is a high-value secret.** It must be held in Secret Manager for the API service only, never in web or console builds, and rotated if exposed.
4. **Activation flow not built (B-09).** Pending accounts are correctly locked out but cannot activate yet. Imports must not create staff as `pending_activation` until B-09 ships, or those staff stay locked.
5. **Email change after linking.** Linked accounts are matched by `sub`. If a user changes their email in Supabase, `user_accounts.email` is not re-synced. This is acceptable for M1; revisit with profile management.
6. **Selection-limit policy TBD-19** (see §3).
7. **Existing pending grants.** Pending accounts may hold pre-assigned grants (from imports). They stay inert because the API never loads them for non-active accounts, but any future non-API path must also check status.

## 7. Reproduce

```bash
pnpm install --frozen-lockfile
pnpm db:start && pnpm db:migrate        # local Postgres 16 on 127.0.0.1:54329
pnpm -r typecheck
pnpm --filter @sj/api test              # real Postgres, one fresh database per test file
pnpm -r build
# browser e2e: start API (:4000), web (:3000), console (:3001), then
python3 scripts/e2e_smoke.py /tmp/shots
```
