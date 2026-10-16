# Restore drill runbook (TBD-33, AT-36)

**Status: NOT EXECUTED.** This is the step-by-step procedure to run the drill, prepared ahead of time so the drill
itself is a checklist, not an improvisation. It has not been run against any real Supabase project. Running it
needs:

- an ISF-owned staging (or production) Supabase project on a plan with **point-in-time recovery (PITR)** turned
  on (TBD-33, TBD-46 — currently `startup-jathara-staging` is on the **free plan**, which has no PITR; Budget must
  approve the Pro-plan upgrade and the PITR add-on first, per [LAUNCH_CHECKLIST.md](/docs/LAUNCH_CHECKLIST.md) §A);
  PITR is only budgeted for the TBD-33 critical windows, so the drill itself needs it switched on for the day;
- project-owner access to the Supabase dashboard for that project;
- authorisation to run a destructive drill against that project (§1) — **never** run step 2 below against a
  project anyone else is using for other testing at the time, and never against production outside a declared
  maintenance window.

**Target (TBD-33):** RPO ≤ 5 minutes inside the critical windows (1–6 Nov, 15–21 Dec 2026) with PITR on, ≤ 24
hours otherwise (daily backups); RTO ≤ 4 hours, proven by this drill on staging before 10 Dec 2026 (AT-36).

## 1. Before the drill

1. Confirm PITR is enabled on the target project (Supabase dashboard → **Database → Backups**; it shows the
   PITR retention window once on).
2. Pick a quiet window. The drill restores the whole project to a point in time, which **replaces current data**
   — treat it the same as a real incident, not a read-only check.
3. Record the pre-drill state at timestamp **T0**:
   ```sql
   select 'user_accounts' as t, count(*) from user_accounts
   union all select 'applications', count(*) from applications
   union all select 'selection_decisions', count(*) from selection_decisions
   union all select 'audit_events', count(*) from audit_events
   union all select 'support_tickets', count(*) from support_tickets;
   ```
   Save the output (file or screenshot) — this is what the restored database must match.
4. Confirm the migration state: `pnpm --filter @sj/api db:migrate` reports "nothing to apply" (so the restore's
   `schema_migrations` table can be compared against the same expectation afterwards).

## 2. Create the data-loss scenario

5. At timestamp **T1** (a few minutes after T0), make a clearly-identifiable, reversible change — e.g. insert one
   row into a scratch table created for the drill, or delete a single throwaway row the drill itself inserted
   earlier. **Do not** truncate, drop or edit any real table's existing rows for this — the drill only needs a
   marker to prove the restore went back far enough, not a rehearsal of actual damage.
6. Note T1 precisely (`select now();`). This stands in for "the moment data loss was discovered" in a real
   incident; the RTO clock below starts from a decision to restore, which in a real incident follows T1 by however
   long detection and triage take — this drill measures only the mechanical restore step, and that gap should be
   estimated separately when recording results (§4).

## 3. Restore

7. Supabase dashboard → **Database → Backups → Point in Time Recovery** → choose a restore target **at or just
   before T0** (strictly before the step-5 change) → confirm. Record **T_restore_start**.
8. Wait for Supabase to report the restore complete. Record **T_restore_end**.
9. Verify the restored data matches the T0 baseline: re-run the step-3 query and compare row counts exactly. The
   step-5 scratch change must be **absent** (proof the restore landed before T1).
10. Verify schema state: `pnpm --filter @sj/api db:migrate` against the restored database reports "nothing to
    apply" and the same migration list as before the drill (PITR restores the whole database, schema included —
    this just confirms nothing unexpected happened to `schema_migrations`).
11. Smoke-test the restored database: a basic sign-in and `GET /v1/me` against the API pointed at the restored
    project, or `pnpm --filter @sj/api staging:verify` if the project is the approved staging ref
    (`scripts/staging-guard.ts`).

## 4. Record the result

| Field | Value |
|---|---|
| Date | |
| Operator | |
| Project (ref) | |
| T0 (baseline) | |
| T1 (scratch change) | |
| T_restore_start | |
| T_restore_end | |
| Mechanical restore time (T_restore_end − T_restore_start) | |
| Estimated detection + decision time (not measured by this drill; record a reasoned estimate) | |
| **RTO achieved** (mechanical restore time + the estimate above) vs. **target ≤ 4 h** | Pass / Fail |
| Row-count check (step 9) | Pass / Fail |
| Migration-state check (step 10) | Pass / Fail |
| Smoke test (step 11) | Pass / Fail |
| Issues found | |

## 5. Known gaps this drill does not cover

The PRD's reliability planning inputs (§10.2) ask for restore of "database, object storage metadata, event
configurations and secret/provider configuration recovery" — broader than the database alone:

- **Object storage** (Phase 7's `event-documents` bucket, TBD-51): Supabase Storage is **not** covered by
  database PITR. There is no drilled procedure for recovering uploaded documents yet; this is an open gap to
  close before relying on the TBD-33 RPO/RTO targets for documents, not only database rows.
- **Secrets and provider configuration** (API keys, service-role key, provider credentials): these live in the
  hosting platform's secret manager, not the database, so a database restore does not touch them. Recovering
  them depends on whatever secret-manager backup/versioning the chosen host (TBD-46) provides; this has not been
  drilled either.
- **RPO inside the critical windows** (≤ 5 minutes) is a property of PITR itself (continuous WAL archiving), not
  something this drill measures directly — the drill proves *that* a restore to a point in time works and how
  long it takes, not how close to real-time PITR's continuous capture actually is. Confirming the 5-minute figure
  needs a timed test against a live, recent transaction once PITR is turned on, which this runbook does not yet
  include.

These gaps should be closed with their own drills once the relevant infrastructure exists, not assumed away.
