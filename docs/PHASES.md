# Delivery phases (10)

All phases build on the locked architecture in [ARCHITECTURE.md](ARCHITECTURE.md). "Done" means implemented, tested on real PostgreSQL and run end-to-end. Dates are the plan's targets (EXECUTION_PLAN §8), and the event is 18–20 Dec 2026.

| # | Phase | Scope | PRD refs | Status |
|---|---|---|---|---|
| 1 | **Foundation** | Monorepo, contracts, typed client, DB schema and migrations, identity verification, RBAC, audit log, CI | FR-IAM-01…04, -06, -11, NFR | ✅ Done |
| 2 | **Registration and selection** | Website registration for 2026/2027/both; deadline; duplicates; Management review, draft, release; in-app result notices; edition access; security hardening | FR-REG-*, FR-SEL-*, AT-06…10, AT-13…15 | ✅ Done |
| 3 | **Accounts and bulk import (Admin)** | Import of predefined startups, jury, volunteers and delegates (validate → preview → commit); duplicate and shared-number detection; secure single-use activation; user and role administration; deactivation; `GET /v1/me` | FR-IMP-01…11, FR-IAM-05, -08…10, AT-01…05 | ✅ Done (this delivery) |
| 4 | **Mobile app foundation (Android + iOS)** | Expo app: sign-in, activation, role-aware home, new-startup registration, application status per year, notifications | RQ §4 (interface 2), FR-REG-01, FR-IAM-02 | ✅ Done (this delivery) |
| 5 | AI ranking | Criteria sets (draft v1, TBD-01), ranking runs with explanations, ranking view in Management review, override reasons (TBD-18), two-person decision correction and withdrawal (TBD-37), result email/SMS (TBD-14); AI never decides | FR-RNK-*, AT-11…15 | Planned · 6–20 Nov |
| 6 | Jury and volunteers | Jury assignments, scoring by Management-defined parameters (draft rubric, TBD-43), submission lock; one-to-one random volunteer assignment, review, reassignment; mobile sign-out after reinstall (OD-02) | FR-JRY-*, FR-VOL-*, AT-16…23 | Planned · 16 Nov–1 Dec |
| 7 | Event information and notices | Server-driven schedule, venues, food, accommodation, documents; targeted notices; push notifications; no check-in or allocation modules for 2026 (TBD-30) | FR-EVT-*, FR-NOT-*, AT-24, AT-25 | Planned · 10–28 Nov |
| 8 | AI Help Desk, support and emergency | One help desk in the app and on WhatsApp; phone-number identity; tickets; Customer Support dashboard; emergency escalation | FR-HD-*, FR-SUP-*, FR-EMG-*, AT-26…32 | Planned · 17 Nov–8 Dec |
| 9 | Offline, reports and audit review | Offline cache for event info in the app; reports and controlled exports; admin audit view | FR-OFF-*, FR-RPT-*, AT-34 | Planned · 1–10 Dec |
| 10 | Hardening and launch | Security review and pen-test fixes, load test, backup restore drill, store submission (needs TBD-36 accounts), production release, freeze | NFR-*, AT-35, AT-36, AT-41 | Planned · 1–15 Dec |

## Hardening after Phase 4 (15 Oct 2026)

- Sign-in by email or mobile number (TBD-12: both; SMS once the DLT sender is live).
- Mobile sessions in the device keychain.
- Staff MFA mandatory in production, with a console step-up.
- Malformed-row import validation.
- The production launch gate ([docs/LAUNCH_CHECKLIST.md](/docs/LAUNCH_CHECKLIST.md)): production stays closed until live Supabase staging tests, the approved privacy text and the remaining checks are signed off.
- Decisions on every open TBD ([docs/DECISIONS.md](/docs/DECISIONS.md)). Built from them: the application form as edition configuration (TBD-39, migration 0007), the 18+ declaration (TBD-45), and confirmation for releases above the selection limit (TBD-19).

## Rules for every phase

1. Contracts first (`packages/contracts`), then API module and migration, then tests, then UI (console, web, mobile).
2. Each permission and each business rule has an integration test; DB constraints back the critical ones.
3. Decisions come from [DECISIONS.md](DECISIONS.md). A decision still awaiting approval stays configurable or is labelled as such in the UI and docs; it is never presented as confirmed.
4. A phase is closed only after typecheck, the full API suite, production builds and the browser end-to-end run all pass.
5. Any redirect target taken from a URL goes through `safeReturnPath` with an allow-list. Any CSV or spreadsheet export goes through `platform/csv-export.ts`.
