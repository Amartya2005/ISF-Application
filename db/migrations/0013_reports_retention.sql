-- 0013_reports_retention: Phase 9 — audit-view indexes and the data-retention sweep log (TBD-32).
-- Reports and exports (FR-RPT-*, TBD-31) read existing tables directly and need no schema change.
-- The retention sweep (apps/api/src/modules/retention/purge.ts) only ever deletes rows this phase's design review
-- found unambiguous and low-risk (see docs/DECISIONS.md TBD-32, TBD-59); it writes one row here per category per
-- run, so Admin can see what ran and when, and it stays config-gated off by default pending Legal approval of the
-- retention schedule (RETENTION_PURGE_ENABLED, apps/api/src/config.ts).

create table retention_sweeps (
  id             bigint generated always as identity primary key,
  category       text not null,
  ran_at         timestamptz not null default now(),
  dry_run        boolean not null,
  deleted_count  integer not null,
  detail         jsonb not null default '{}'::jsonb
);
alter table retention_sweeps enable row level security;
create index retention_sweeps_category on retention_sweeps (category, ran_at desc);

-- The admin audit log viewer (FR-AUD-*, AT-16) filters and paginates by time and by actor.
create index audit_events_at on audit_events (at desc);
create index audit_events_actor on audit_events (actor_user_id, at desc);
