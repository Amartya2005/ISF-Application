# Delivery phases (10)

All phases build on the locked architecture in [ARCHITECTURE.md](ARCHITECTURE.md). "Done" means implemented, tested on real PostgreSQL and run end-to-end. Dates are the plan's targets (EXECUTION_PLAN §8), and the event is 18–20 Dec 2026.

| # | Phase | Scope | PRD refs | Status |
|---|---|---|---|---|
| 1 | **Foundation** | Monorepo, contracts, typed client, DB schema and migrations, identity verification, RBAC, audit log, CI | FR-IAM-01…04, -06, -11, NFR | ✅ Done |
| 2 | **Registration and selection** | Website registration for 2026/2027/both; deadline; duplicates; Management review, draft, release; in-app result notices; edition access; security hardening | FR-REG-*, FR-SEL-*, AT-06…10, AT-13…15 | ✅ Done |
| 3 | **Accounts and bulk import (Admin)** | Import of predefined startups, jury, volunteers and delegates (validate → preview → commit); duplicate and shared-number detection; secure single-use activation; user and role administration; deactivation; `GET /v1/me` | FR-IMP-01…11, FR-IAM-05, -08…10, AT-01…05 | ✅ Done (this delivery) |
| 4 | **Mobile app foundation (Android + iOS)** | Expo app: sign-in, activation, role-aware home, new-startup registration, application status per year, notifications | RQ §4 (interface 2), FR-REG-01, FR-IAM-02 | ✅ Done (this delivery) |
| 5 | **AI ranking** | Criteria sets (draft v1, TBD-01), ranking runs with explanations, ranking view in Management review, override reasons (TBD-18), two-person decision correction and withdrawal (TBD-37), result email/SMS (TBD-14); AI never decides | FR-RNK-*, AT-11…15, AT-40 | ✅ Done (15 Oct 2026) · live model blocked on TBD-35 |
| 6 | **Jury and volunteers** | Jury assignments, scoring by Management-defined parameters (draft rubric, TBD-43), submission lock; one-to-one random volunteer assignment, review, reassignment; mobile sign-out after reinstall (OD-02) | FR-JRY-*, FR-VOL-*, AT-16…23 | ✅ Jury and volunteers done (15 Oct 2026) · OD-02 **not built** (due before store submission) |
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

## Phase 5: what was built (15 Oct 2026)

- **Criteria sets** (FR-RNK-01, -07; TBD-01): versioned; draft v1 seeded (the five RQ §7 example criteria, 20 % each, 1–5). Management creates and approves versions in the console; an approved version is frozen by a DB trigger, and a run can only use an approved version of its own edition.
- **Ranking runs** (FR-RNK-02…13): a run snapshots the whole cohort, only after that edition's registration has closed (TBD-42). The worker sends each application as data (no names, contacts or links; contacts inside answers are redacted), validates the output against the criteria (one in-range integer per criterion), retries once, and otherwise flags it for manual review. Totals and ranks are computed outside the model (weighted, competition ranking). Embedded instructions are flagged, never obeyed. Earlier runs stay viewable.
- **The AI cannot decide** (FR-RNK-04, AT-11): the worker runs every statement as the database role `sj_ranking_worker`, which cannot write decisions, read accounts or contact data, or move an application out of the AI-evaluation states.
- **Model adapter** (TBD-35): Google Vertex AI (`RANKING_PROVIDER=vertex`, optionally with a ranking-only service account, FR-RNK-12) and a development **stub that is not an AI** (`stub`, refused in production by the launch gate; the console labels its runs). `pnpm --filter @sj/api ranking:eval` (`apps/api/scripts/ranking-eval.ts`) evaluates a provider on synthetic applications: schema validity, stability, steering resistance and ordering.
- **Override reasons** (TBD-18): the selection limit (or, without one, the run's cut line) is N; selecting below it or not selecting within it needs a written reason. Rank, N and the override flag are stored with the decision.
- **Corrections and withdrawals** (TBD-37): a released decision changes only when a second Management member approves a reasoned request (API, DB constraint and trigger); access follows the corrected outcome and the applicant is told again. Applicants withdraw a year's application on the website or in the app until that year's event starts.
- **Result and activation messages** (TBD-13, TBD-14): an email/SMS outbox (in the same transaction as the decision) with retries and per-message status shown to Management. Providers: SMTP (Amazon SES) and MSG91 (DLT templates). Without a provider, messages stay queued; activation codes then fall back to manual hand-over. Codes are scrubbed from the outbox after delivery.
- **Workers**: in the API process (`RUN_WORKERS=true`) or separately (`start:worker`).
- **Console**: AI ranking page (criteria versions, approval, runs) and a run page (ranks, criterion scores, explanations, flags, score spread per criterion, cut line); applications in rank order with flags, override markers, pending corrections and message status.
- **Verification**: 292 API tests and 4 mobile tests; typecheck and production builds; seven browser flows including `scripts/e2e_ranking.py` (approve criteria → rank → override with reason → release → correction by a second manager → corrected result → withdrawal), run against a fresh database with a pinned clock.
- **Found on staging and fixed (migration 0009)**: on Supabase the API user is not a superuser. Creating the worker role gave it ADMIN membership without SET, so `SET ROLE sj_ranking_worker` failed (42501) and runs would have stayed queued. Local and CI databases run as superuser and could not show this. 0009 grants SET explicitly. `ranking-role-grant.test.ts` now reproduces the non-superuser case, and the workers check the role at start-up.
- **Not verified live** (blocked on accounts, TBD-35/36): a real Vertex AI model, Amazon SES and MSG91. Live ranking quality is unproven until `ranking:eval` passes against the chosen model.

## Phase 6: what was built (15 Oct 2026)

- **Migration 0010** (`db/migrations/0010_jury_volunteers.sql`): eligibility functions (who takes part in an edition), rubric approval and freezing, evaluation lifecycle and total, pitch-slot rules, one draft volunteer run per edition, and volunteer-assignment history rules. Each rule is a trigger or constraint, so it holds for every caller, not only the API.
- **Jury rubric** (TBD-43, TBD-50): draft v1 seeded unapproved for 2026 and 2027 (innovation, feasibility, scalability, market relevance, impact, pitch delivery; 1–10; equal relative weights). Management creates and approves versions; approved versions are frozen.
- **Jury assignments and scope** (TBD-20, AT-16): Management assigns jurors to startups of the edition. A juror sees only their assigned startups, the pitch schedule and the startup currently pitching. Profiles have no contact details and no AI data. Anything else is a 404.
- **Scoring** (FR-JRY-06…09, AT-17): drafts, then submission of every parameter as an in-range integer; the server computes the 0–100 total and records the rubric version. Submitted evaluations are locked (API and DB trigger). Only Management reopens one, with a reason, and the audit keeps the previous scores. Simultaneous submissions of one assignment produce one evaluation.
- **Pitch schedule** (TBD-21): slots per startup; starting a pitch finishes any other live pitch in the same transaction (one live pitch per edition, also a unique index).
- **Management review** (FR-JRY-16, AT-18): per-startup averages per rubric version and the submitted evaluations. **No winner** is computed.
- **Separation from AI ranking and selection**: no ranking, selection or release code reads jury data; `sj_ranking_worker` has no grant on any jury table (tested with `SET ROLE`); scoring changes no application, decision or ranking row (tested).
- **Volunteer generation** (TBD-22, AT-19, AT-20): seeded, reproducible shuffle; one-to-one pairs; shortages listed as unassigned targets and surpluses as unassigned volunteers; never doubled up. A run is a draft that participants cannot see until Management saves it (AT-23).
- **Review, reassignment and history** (TBD-23, TBD-47, AT-21, AT-22): Management saves or discards drafts, assigns by hand, reassigns (old row closed with actor, time and reason; new row points to it) and ends assignments. Closed rows are immutable. Every mutation locks the edition row, and unique indexes back the one-to-one rules, so concurrent requests cannot double-assign (tested with simultaneous requests).
- **Messages** (TBD-48): in-app notices plus one email/SMS per person through the existing outbox; the console shows each message's recorded status (queued until a provider accepts it).
- **Participant views** (TBD-49): a volunteer sees their saved assignment with the target's name and mobile; a startup leader or juror sees their volunteer's name and mobile. No email addresses.
- **Console**: Jury page (rubrics, assignments, pitch schedule, review and reopen) and Volunteers page (generate, draft review with shortage and surplus, save, current assignments with message statuses, reassign, end, assign by hand, history, runs). **App**: jury list, startup profile and scoring form, current pitch; "My volunteer assignment" and "My volunteer".
- **Verification**: 346 API tests (54 new: `jury.test.ts`, `volunteers.test.ts`) and 8 mobile tests; typecheck, production builds and the mobile web export; eight browser flows including the new `scripts/e2e_jury_volunteers.py`, each run against a fresh database.
- **Not done in Phase 6**: OD-02 (sign-out after reinstall) is still to build before store submission. Live email/SMS delivery remains blocked on provider accounts (TBD-35) and a DLT template for assignment SMS (TBD-48).

## Rules for every phase

1. Contracts first (`packages/contracts`), then API module and migration, then tests, then UI (console, web, mobile).
2. Each permission and each business rule has an integration test; DB constraints back the critical ones.
3. Decisions come from [DECISIONS.md](DECISIONS.md). A decision still awaiting approval stays configurable or is labelled as such in the UI and docs; it is never presented as confirmed.
4. A phase is closed only after typecheck, the full API suite, production builds and the browser end-to-end run all pass.
5. Any redirect target taken from a URL goes through `safeReturnPath` with an allow-list. Any CSV or spreadsheet export goes through `platform/csv-export.ts`.
