# Launch checklist: production stays closed until every item is signed off

**Status: NOT APPROVED. Do not deploy to production or enter real participant data.**

The API enforces this list in code. With `NODE_ENV=production` it refuses to start, and names each unmet item, unless all of the following hold (`apps/api/src/config.ts → productionBlockers`):

- `AUTH_MODE=supabase` (development sign-in is never allowed);
- staff MFA is on (`REQUIRE_STAFF_MFA` defaults to true and may not be `false`);
- `CORS_ORIGINS` lists only `https://` production origins;
- the privacy notice version is no longer a `draft-*` version (`PRIVACY_NOTICE_VERSION` in `packages/contracts`);
- `LAUNCH_APPROVED=true` is set. Set it **only** after every item below is checked and signed off.

## A. Accounts and environments (TBD-36, TBD-46)

- [x] Organisation-owned Supabase **staging** project: `startup-jathara-staging` in the ISF organisation, ap-south-1, migrations 0001–0007 applied, Data API closed (see [docs/STAGING.md](/docs/STAGING.md)). Done 15 Oct 2026.
- [ ] Organisation-owned Supabase **production** project (ap-south-1) on the Pro plan, with PITR on during the critical windows (TBD-33, TBD-46; budget approval needed). Never use any personal project.
- [ ] Cloud, domain, Vercel, GitHub organisation, WhatsApp Business and Apple/Google store accounts are owned by the organisers' legal entity (TBD-36). Store accounts are **organisation** accounts (a D-U-N-S number is needed; request it early). Zeny2Labs has member access only.
- [ ] Secrets are stored in the secret manager. `SUPABASE_SERVICE_ROLE_KEY` goes to the API service only, never to any `NEXT_PUBLIC_*` or `EXPO_PUBLIC_*` value.
- [ ] Repository made **private** until launch approval (OD-04, owner action). It is currently public.

## B. Live Supabase staging tests (B-06). The code is tested against Supabase-shaped data, not a live project.

Two tools support this section:

- **Automated server-side checks:** `pnpm --filter @sj/api staging:verify` (`apps/api/scripts/staging-verify.ts`). It covers real email OTP and SMS OTP (via a Supabase test number) sessions, JWKS keys, session refresh, sign-out revocation, the unconfirmed-email linking attack, and TOTP MFA elevation. It runs only against an approved staging project: `STAGING_SUPABASE_PROJECT_REF` must be on the approved list in `scripts/staging-guard.ts` and match the URL exactly, and `STAGING_CONFIRM` is also required. It deletes only users that it provably created, never pre-existing accounts.
- **Real phones:** [docs/DEVICE_TEST_PROTOCOL.md](/docs/DEVICE_TEST_PROTOCOL.md), cases D1–D12: keychain persistence, background refresh, sign-out, reinstall behaviour, and console MFA on phone browsers.

**What the automated checks do and do not prove.** `staging:verify` creates email OTP sessions with codes issued through Supabase's Admin API, and SMS sessions with a Supabase *test number*. That proves the session and token flow, linking and MFA. It does **not** prove that real emails arrive, that real SMS messages are delivered by carriers, or that the DLT sender and template registration works. Those are covered by device protocol D1 and D2 and the items below.

Not run yet: the staging project now exists (`startup-jathara-staging`), but its secrets and hosted API are pending (docs/STAGING.md). Run each case on staging and record the result and date:

- [ ] Email OTP sign-in: a new applicant registers; their email is stored only after Supabase confirms it.
- [ ] **Real email delivery:** OTP emails arrive at Gmail, Outlook and an institutional (e.g. GIET) inbox within a minute and not in spam. Custom SMTP and sender domain are configured (D1).
- [ ] SMS OTP sign-in (needs the DLT-registered sender and template through Supabase's Send SMS hook, TBD-35): the phone-only applicant flow works; no email is stored. Only then set the sign-in channels to `email,phone` (TBD-12).
- [ ] **Real SMS delivery:** OTP SMS arrives on Jio, Airtel, Vi and BSNL numbers via the DLT-approved sender ID and template (D2). A test number does not count.
- [ ] An unconfirmed email in the user's own metadata does **not** link to a pre-created staff account.
- [ ] An imported participant signs in with the confirmed email/mobile, the account links, the activation code works, and the code can't be reused.
- [ ] Email and phone matching different accounts → refused and audited (`identity.link_refused`).
- [ ] JWKS verification passes with the project's real signing keys (ES256/RS256); anonymous sessions are rejected.
- [ ] Admin API outage → 503 for unlinked identities only. Check the rate limits against the expected sign-up volume.
- [ ] Staff TOTP MFA: enrol, verify, get aal2; without aal2 → `mfa_required` on every privileged endpoint.
- [ ] Mobile app on a real Android and iPhone: every case in [docs/DEVICE_TEST_PROTOCOL.md](/docs/DEVICE_TEST_PROTOCOL.md) (D1–D12) passes, and the iOS reinstall behaviour (D8) is decided.
- [ ] `staging:verify` reports 0 failures and 0 skips, with all optional settings provided.

## C. Decision approvals ([docs/DECISIONS.md](/docs/DECISIONS.md))

Every TBD now has a recommended decision, and the code follows it. **None has been approved.** Tick an item only when the named approver confirms it in writing, and record who and when in the sign-off table.

**Before the registration website goes live:**

- [ ] **Legal: privacy notice approved** (TBD-32, DPDP review; draft in [docs/PRIVACY_NOTICE_DRAFT.md](/docs/PRIVACY_NOTICE_DRAFT.md)), together with the retention schedule, the 18+ policy (TBD-45) and vendors' cross-border processing (TBD-35). Publish it on `/privacy` and bump `PRIVACY_NOTICE_VERSION` to the approved version.
- [ ] **Organisers: 2026 cut-off** 5 Nov 2026 23:59:59 IST (TBD-11). Then set `event_editions.closes_at_confirmed = true`.
- [ ] **Organisers:** sign-in channels (TBD-12; set `NEXT_PUBLIC_SIGNIN_METHODS` / `EXPO_PUBLIC_SIGNIN_METHODS`), Junicorn rules not applied (TBD-08), website-only registration before 5 Nov (TBD-38), adults only (TBD-45), account-owning entity (TBD-36).
- [ ] **Management: application form wording** (TBD-39; the six questions in migration 0007; change them only before the first application, because the form freezes after that), duplicate rule (TBD-15), selection-limit confirmation (TBD-19).

**Before the phase that uses them:**

- [ ] **Organisers:** activation delivery and 72 h validity (TBD-13); import column set v1 signed off on a real sample (TBD-41); team-member onboarding after selection (TBD-16); delegate scope and no QR/allocation modules (TBD-04, TBD-30); content ownership (TBD-24); Help Desk on the website as a WhatsApp link (TBD-25); English only (TBD-26); export permissions (TBD-31); descope checkpoints (OD-05).
- [ ] **Organisers, before Phase 8:** emergency contacts (TBD-07), escalation windows (TBD-27), support roster (TBD-28).
- [ ] **Management, before results are released (by 20 Nov, TBD-40):** criteria set approved by 6 Nov (TBD-01); result channels and wording (TBD-14); override reasons (TBD-18); correction and withdrawal policy (TBD-37), with the correction process built; scores never shared (TBD-44).
- [ ] **Management, later phases:** TBD-05, TBD-10, TBD-17, TBD-20, TBD-21, TBD-22, TBD-23, TBD-29, TBD-42, TBD-43.
- [ ] **Budget:** hosting and budget ceiling (TBD-46), PITR windows and service targets (TBD-33), vendor contracts and DPAs (TBD-35).

## D. Security and operations

- [ ] Independent security review / penetration test of the API, console and app; findings closed.
- [ ] Any CSV/spreadsheet export added later uses `apps/api/src/platform/csv-export.ts` (formula-injection escaping). Reviewed in code review.
- [ ] Load test at the agreed peak (registration close, event days).
- [ ] Backups and point-in-time recovery on; restore drill done on staging (AT-36).
- [ ] Monitoring, error reporting and uptime checks in place; on-call contact named.
- [ ] CI is green on the release commit (typecheck, API tests on Postgres, mobile unit tests, builds).
- [ ] Browser end-to-end suite run against **staging** (`scripts/e2e_*.py`).
- [ ] Mobile: sign-out on the first launch after a reinstall is built (OD-02), and device case D8 shows "signed out" on both platforms.

## Sign-off

| Item group | Owner | Date | Evidence |
|---|---|---|---|
| A. Accounts and environments | | | |
| B. Live staging tests | | | |
| C. Content and policy | | | |
| D. Security and operations | | | |

Only when every row above is filled in: set `LAUNCH_APPROVED=true` in the production API environment.

### What the code enforces and what it does not

`apps/api/src/config.ts` refuses a production start unless these configuration facts hold:

- `AUTH_MODE=supabase`;
- staff MFA is on;
- `CORS_ORIGINS` is HTTPS-only;
- the privacy notice version is not a draft;
- `LAUNCH_APPROVED=true`.

It **cannot** check that the operational items above have evidence and signatures. `LAUNCH_APPROVED` is therefore a human attestation, and it must be tightly controlled:

- Only the named release owner may set it, in the production secret store.
- Write access to that store is limited to the release owner and one deputy.
- Every change is audit-logged by the platform.
- It is set only after the sign-off table above is complete, and the date and approver are recorded in the release notes.
- It is never set in staging, CI, `.env.example` or local `.env` files.
