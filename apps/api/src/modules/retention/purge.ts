// Data-retention purge (TBD-32). Config-gated off by default (RETENTION_PURGE_ENABLED=false) pending Legal approval
// of the retention schedule; when enabled, it defaults to a dry run (RETENTION_DRY_RUN=true) that counts candidates
// without deleting anything, so an operator can see what a live run would remove before switching it on. Every run
// writes one row per category to `retention_sweeps` and one audit event, whether or not anything was deleted.
//
// Scope (see docs/DECISIONS.md TBD-32 and TBD-59 for the full reasoning):
//   - Raw import rows, 30 days after the batch was committed (the batch and its summary are kept).
//   - Activation code hashes, 90 days after use, revocation or expiry.
//   - Help Desk transcripts, 90 days after the conversation's last message — but only once no support ticket
//     references it; a conversation that became ticket evidence is kept for that ticket's lifetime.
//
// Deliberately NOT built: purging applications, decisions, jury evaluations or accounts (TBD-32's other
// categories) — anonymising rather than deleting them needs its own design pass across several dependent tables.
// Support and emergency tickets cannot be purged by deletion at all under the current schema: migration 0012's
// `support_ticket_rules` trigger refuses to delete a support ticket ("support tickets are kept, never deleted",
// hint TICKET-HISTORY), and `ticket_events` and `support_alerts` are themselves append-only. That is a deliberate
// Phase 8 design decision (ticket history and alerts are part of the audit trail), not an oversight this phase
// should work around; TBD-59 records it as open for a future, deliberate decision (most likely anonymising the
// ticket's contact fields rather than deleting the row).
import type { Db } from "../../db/client.js";
import { audit } from "../../platform/audit.js";

export type SweepResult = { category: string; deletedCount: number; dryRun: boolean; detail: Record<string, unknown> };
const DAY_MS = 24 * 60 * 60 * 1000;

async function logSweep(db: Db, r: SweepResult): Promise<void> {
  await db`insert into retention_sweeps (category, dry_run, deleted_count, detail) values (${r.category}, ${r.dryRun}, ${r.deletedCount}, ${db.json(r.detail as never)})`;
  await audit(db, {
    actorUserId: null, actorType: "system", action: r.dryRun ? "retention.dry_run" : "retention.purged",
    entityType: "retention_sweep", entityId: r.category, data: { deletedCount: r.deletedCount, ...r.detail },
  });
}

async function purgeImportRows(db: Db, now: Date, dryRun: boolean): Promise<SweepResult> {
  const cutoff = new Date(now.getTime() - 30 * DAY_MS);
  const batches = await db<{ id: string }[]>`select id from import_batches where state = 'committed' and committed_at < ${cutoff}`;
  let deletedCount = 0;
  if (batches.length) {
    const ids = batches.map((b) => b.id);
    deletedCount = dryRun
      ? (await db<{ n: number }[]>`select count(*)::int as n from import_rows where batch_id in ${db(ids)}`)[0]!.n
      : (await db`delete from import_rows where batch_id in ${db(ids)} returning 1`).length;
  }
  const r: SweepResult = { category: "import_rows", deletedCount, dryRun, detail: { batches: batches.length } };
  await logSweep(db, r);
  return r;
}

async function purgeActivationTokens(db: Db, now: Date, dryRun: boolean): Promise<SweepResult> {
  const cutoff = new Date(now.getTime() - 90 * DAY_MS);
  const where = db`
    where (used_at is not null and used_at < ${cutoff})
       or (revoked_at is not null and revoked_at < ${cutoff})
       or (used_at is null and revoked_at is null and expires_at < ${cutoff})`;
  const deletedCount = dryRun
    ? (await db<{ n: number }[]>`select count(*)::int as n from activation_tokens ${where}`)[0]!.n
    : (await db`delete from activation_tokens ${where} returning 1`).length;
  const r: SweepResult = { category: "activation_tokens", deletedCount, dryRun, detail: {} };
  await logSweep(db, r);
  return r;
}

async function purgeHelpdeskTranscripts(db: Db, now: Date, dryRun: boolean): Promise<SweepResult> {
  const cutoff = new Date(now.getTime() - 90 * DAY_MS);
  const candidates = await db<{ id: string }[]>`
    select c.id from helpdesk_conversations c
    where coalesce((select max(m.at) from helpdesk_messages m where m.conversation_id = c.id), c.started_at) < ${cutoff}
      and not exists (select 1 from support_tickets t where t.conversation_id = c.id)`;
  let deletedCount = 0;
  if (candidates.length) {
    const ids = candidates.map((c) => c.id);
    if (dryRun) {
      deletedCount = ids.length;
    } else {
      await db`delete from helpdesk_messages where conversation_id in ${db(ids)}`;
      deletedCount = (await db`delete from helpdesk_conversations where id in ${db(ids)} returning 1`).length;
    }
  }
  const r: SweepResult = { category: "helpdesk_transcripts", deletedCount, dryRun, detail: { conversations: candidates.length } };
  await logSweep(db, r);
  return r;
}

export async function sweepRetention(db: Db, opts: { enabled: boolean; dryRun: boolean }, now: Date): Promise<SweepResult[]> {
  if (!opts.enabled) return [];
  return [
    await purgeImportRows(db, now, opts.dryRun),
    await purgeActivationTokens(db, now, opts.dryRun),
    await purgeHelpdeskTranscripts(db, now, opts.dryRun),
  ];
}

export async function recentSweeps(db: Db, limit = 20): Promise<{ id: string; category: string; ranAt: string; dryRun: boolean; deletedCount: number; detail: Record<string, unknown> }[]> {
  const rows = await db<{ id: string; category: string; ranAt: Date; dryRun: boolean; deletedCount: number; detail: Record<string, unknown> }[]>`
    select id::text as id, category, ran_at as "ranAt", dry_run as "dryRun", deleted_count as "deletedCount", detail
    from retention_sweeps order by ran_at desc limit ${limit}`;
  return rows.map((r) => ({ ...r, ranAt: r.ranAt.toISOString() }));
}
