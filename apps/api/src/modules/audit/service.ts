// Admin audit log viewer (FR-AUD-*, AT-16; TBD-59). Read-only: audit_events is append-only at the database level
// (migration 0001, DC-13) and nothing here writes to it. Filters and paginates by time, actor, action, entity type
// and edition so a review of "what happened" does not mean reading the whole table.
import type { AuditEventView, AuditPage } from "@sj/contracts";
import type { Db } from "../../db/client.js";

export type AuditFilter = {
  actorUserId?: string; action?: string; entityType?: string; edition?: number; from?: Date; to?: Date;
  limit: number; offset: number;
};

type Row = {
  id: string; at: Date; actorType: "user" | "service" | "system"; actorUserId: string | null; actorName: string | null;
  action: string; entityType: string; entityId: string | null; editionId: number | null; data: Record<string, unknown>;
};

/** Built fresh per call: a postgres.js fragment is consumed by the one query it is interpolated into. */
const WHERE = (db: Db, f: AuditFilter) => db`
  where true
    ${f.actorUserId ? db`and e.actor_user_id = ${f.actorUserId}` : db``}
    ${f.action ? db`and e.action = ${f.action}` : db``}
    ${f.entityType ? db`and e.entity_type = ${f.entityType}` : db``}
    ${f.edition ? db`and e.edition_id = ${f.edition}` : db``}
    ${f.from ? db`and e.at >= ${f.from}` : db``}
    ${f.to ? db`and e.at <= ${f.to}` : db``}`;

export async function listAuditEvents(db: Db, f: AuditFilter): Promise<AuditPage> {
  const rows = await db<Row[]>`
    select e.id::text as id, e.at, e.actor_type as "actorType", e.actor_user_id as "actorUserId", u.full_name as "actorName",
           e.action, e.entity_type as "entityType", e.entity_id as "entityId", e.edition_id as "editionId", e.data
    from audit_events e left join user_accounts u on u.id = e.actor_user_id
    ${WHERE(db, f)}
    order by e.at desc, e.id desc
    limit ${f.limit} offset ${f.offset}`;
  const total = (await db<{ n: number }[]>`select count(*)::int as n from audit_events e ${WHERE(db, f)}`)[0]!.n;
  const events: AuditEventView[] = rows.map((r) => ({ ...r, at: r.at.toISOString() }));
  return { events, total, limit: f.limit, offset: f.offset };
}
