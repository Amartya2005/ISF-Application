# Launch checklist: production stays closed until every item is signed off

**Status: NOT APPROVED. Do not deploy to production or enter real participant data.**

The API enforces this list in code. With `NODE_ENV=production` it refuses to start, and names each unmet item, unless all of the following hold (`apps/api/src/config.ts → productionBlockers`):

- `AUTH_MODE=supabase` (development sign-in is never allowed);
- staff MFA is on (`REQUIRE_STAFF_MFA` defaults to true and may not be `false`);
- `CORS_ORIGINS` lists only `https://` production origins;
- the privacy notice version is no longer a `draft-*` version (`PRIVACY_NOTICE_VERSION` in `packages/contracts`);
- `LAUNCH_APPROVED=true` is set. Set it **only** after every item below is checked and signed off.

## A. Accounts and environments (TBD-36, TBD-46)

- [ ] Organisation-owned Supabase **staging** and **production** projects (ap-south-1). Never use any personal project.
- [ ] Cloud, domain, Vercel, GitHub organisation, and Apple/Google store accounts are owned by the organisers.
- [ ] Secrets are stored in the secret manager. `SUPABASE_SERVICE_ROLE_KEY` goes to the API service only, never to any `NEXT_PUBLIC_*` or `EXPO_PUBLIC_*` value.
- [ ] Repository visibility is decided. It is currently public; the README recommends private until approval.

## B. Live Supabase staging tests (B-06). The code is tested against Supabase-shaped data, not a live project.

Run each case on staging and record the result and date:

- [ ] Email OTP sign-in: a new applicant registers; their email is stored only after Supabase confirms it.
- [ ] SMS OTP sign-in (needs the SMS provider and DLT registration, TBD-35): the phone-only applicant flow works; no email is stored.
- [ ] An unconfirmed email in the user's own metadata does **not** link to a pre-created staff account.
- [ ] An imported participant signs in with the confirmed email/mobile, the account links, the activation code works, and the code can't be reused.
- [ ] Email and phone matching different accounts → refused and audited (`identity.link_refused`).
- [ ] JWKS verification passes with the project's real signing keys (ES256/RS256); anonymous sessions are rejected.
- [ ] Admin API outage → 503 for unlinked identities only. Check the rate limits against the expected sign-up volume.
- [ ] Staff TOTP MFA: enrol, verify, get aal2; without aal2 → `mfa_required` on every privileged endpoint.
- [ ] Mobile app on a real Android and iPhone: the session persists in the keychain across restarts, and sign-out clears it.

## C. Content and policy decisions

- [ ] **Privacy notice text approved** (TBD-32, DPDP review). Publish it on `/privacy` and bump `PRIVACY_NOTICE_VERSION` to the approved version.
- [ ] Exact 2026 registration cut-off time confirmed (TBD-11); set `event_editions.closes_at_confirmed = true`.
- [ ] Final application form fields (TBD-39) and result-notification wording (TBD-14).
- [ ] Sign-in identifier decided (TBD-12). Set `NEXT_PUBLIC_SIGNIN_METHODS` / `EXPO_PUBLIC_SIGNIN_METHODS` accordingly.
- [ ] Activation code delivery channel (TBD-13) and validity period (`ACTIVATION_TTL_HOURS`, provisional 72 h).
- [ ] Import file format agreed with the organising team (TBD-41). The CSV template is provisional.

## D. Security and operations

- [ ] Independent security review / penetration test of the API, console and app; findings closed.
- [ ] Load test at the agreed peak (registration close, event days).
- [ ] Backups and point-in-time recovery on; restore drill done on staging (AT-36).
- [ ] Monitoring, error reporting and uptime checks in place; on-call contact named.
- [ ] CI is green on the release commit (typecheck, API tests on Postgres, mobile unit tests, builds).
- [ ] Browser end-to-end suite run against **staging** (`scripts/e2e_*.py`).

## Sign-off

| Item group | Owner | Date | Evidence |
|---|---|---|---|
| A. Accounts and environments | | | |
| B. Live staging tests | | | |
| C. Content and policy | | | |
| D. Security and operations | | | |

Only when every row above is filled in: set `LAUNCH_APPROVED=true` in the production API environment.
