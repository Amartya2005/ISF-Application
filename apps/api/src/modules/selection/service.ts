// Management review and selection (PRD §7). Decisions are drafted, then released together; only release changes
// what applicants see and grants event access (FR-SEL-05, FR-SEL-09). Decisions are per application, so the
// 2026 and 2027 applications of one startup never affect each other (FR-REG-06, DC-03).
import type { DecisionRequest, InternalStatus, ManageApplication, ManageApplicationList, ReleaseResponse } from "@sj/contracts";
import type { Db, Sql } from "../../db/client.js";
import { audit } from "../../platform/audit.js";
import { AppError, notFound } from "../../platform/errors.js";
import type { Principal } from "../../platform/principal.js";
import { getEdition } from "../editions/service.js";
import { notifyInApp, resultMessage } from "../notifications/service.js";

type Row = {
  id: string; edition: number; status: InternalStatus; flags: string[]; submittedAt: Date; formAnswers: Record<string, unknown>;
  startupId: string; startupName: string; description: string | null; website: string | null; city: string | null; state: string | null;
  leaderId: string; leaderName: string; leaderEmail: string | null; leaderMobile: string | null;
  outcome: "selected" | "not_selected" | null; reason: string | null; decidedBy: string | null; decidedAt: Date | null; releasedAt: Date | null;
};

const SELECT = (db: Db) => db`
  select a.id, a.edition_id as edition, a.status, a.flags, a.submitted_at as "submittedAt", a.form_answers as "formAnswers",
         s.id as "startupId", s.name as "startupName", s.description, s.website, s.city, s.state,
         u.id as "leaderId", u.full_name as "leaderName", u.email as "leaderEmail", u.mobile_e164 as "leaderMobile",
         d.outcome, d.reason, d.decided_by as "decidedBy", d.decided_at as "decidedAt", d.released_at as "releasedAt"
  from applications a
  join startups s on s.id = a.startup_id
  join startup_memberships m on m.startup_id = s.id and m.position = 'leader'
  join user_accounts u on u.id = m.user_id
  left join selection_decisions d on d.application_id = a.id`;

async function otherEditions(db: Db, startupIds: string[]) {
  if (!startupIds.length) return new Map<string, { edition: number; status: InternalStatus }[]>();
  const rows = await db<{ startupId: string; edition: number; status: InternalStatus }[]>`
    select startup_id as "startupId", edition_id as edition, status from applications where startup_id in ${db(startupIds)}`;
  const m = new Map<string, { edition: number; status: InternalStatus }[]>();
  for (const r of rows) m.set(r.startupId, [...(m.get(r.startupId) ?? []), { edition: r.edition, status: r.status }]);
  return m;
}

function toDto(r: Row, others: Map<string, { edition: number; status: InternalStatus }[]>): ManageApplication {
  return {
    id: r.id, edition: r.edition, status: r.status, flags: r.flags, submittedAt: r.submittedAt.toISOString(),
    startup: { id: r.startupId, name: r.startupName, description: r.description, website: r.website, city: r.city, state: r.state },
    leader: { id: r.leaderId, fullName: r.leaderName, email: r.leaderEmail, mobile: r.leaderMobile },
    otherEditions: (others.get(r.startupId) ?? []).filter((o) => o.edition !== r.edition),
    decision: r.outcome
      ? { outcome: r.outcome, reason: r.reason, decidedBy: r.decidedBy!, decidedAt: r.decidedAt!.toISOString(), releasedAt: r.releasedAt?.toISOString() ?? null }
      : null,
    formAnswers: r.formAnswers,
  };
}

export async function listApplications(db: Db, year: number, filter: { status?: InternalStatus }): Promise<ManageApplicationList> {
  const edition = await getEdition(db, year);
  const rows = await db<Row[]>`${SELECT(db)} where a.edition_id = ${year}
    ${filter.status ? db`and a.status = ${filter.status}` : db``} order by a.submitted_at`;
  const others = await otherEditions(db, [...new Set(rows.map((r) => r.startupId))]);
  const counts = await db<{ status: string; n: number }[]>`
    select status, count(*)::int as n from applications where edition_id = ${year} group by status`;
  const [sel] = await db<{ n: number }[]>`
    select count(*)::int as n from selection_decisions d join applications a on a.id = d.application_id
    where a.edition_id = ${year} and d.outcome = 'selected'`;
  return {
    edition: year,
    counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
    selectionLimit: edition.selectionLimit,
    selectedTotal: sel?.n ?? 0,
    items: rows.map((r) => toDto(r, others)),
  };
}

export async function getApplication(db: Db, id: string): Promise<ManageApplication> {
  const [row] = await db<Row[]>`${SELECT(db)} where a.id = ${id}`;
  if (!row) throw notFound("Application");
  return toDto(row, await otherEditions(db, [row.startupId]));
}

export async function draftDecision(sql: Sql, p: Principal, id: string, input: DecisionRequest): Promise<ManageApplication> {
  await sql.begin(async (tx) => {
    const [app] = await tx<{ status: InternalStatus; edition: number; releasedAt: Date | null }[]>`
      select a.status, a.edition_id as edition, d.released_at as "releasedAt"
      from applications a left join selection_decisions d on d.application_id = a.id
      where a.id = ${id} for update of a`;
    if (!app) throw notFound("Application");
    if (app.releasedAt) throw new AppError(409, "decision_released", "Decision already released",
      "Released decisions cannot be changed until a reversal policy is agreed (TBD-37).");

    // FR-SEL-08: record the AI rank at decision time once ranking exists (M3); null in this slice.
    const [rank] = await tx<{ rank: number | null }[]>`
      select r.rank from ranking_results r join ranking_runs run on run.id = r.run_id
      where r.application_id = ${id} and run.status = 'completed' order by run.finished_at desc limit 1`;
    await tx`
      insert into selection_decisions (application_id, outcome, status_before_decision, decided_by, ai_rank_at_decision, reason)
      values (${id}, ${input.outcome}, ${app.status}, ${p.account!.id}, ${rank?.rank ?? null}, ${input.reason ?? null})
      on conflict (application_id) do update
        set outcome = excluded.outcome, decided_by = excluded.decided_by, decided_at = now(),
            ai_rank_at_decision = excluded.ai_rank_at_decision, reason = excluded.reason`;
    await tx`update applications set status = 'decision_drafted' where id = ${id}`;
    await audit(tx, { actorUserId: p.account!.id, action: "decision.drafted", entityType: "application", entityId: id,
      editionId: app.edition, data: { outcome: input.outcome, reason: input.reason ?? null } });
  });
  return getApplication(sql, id);
}

export async function withdrawDraft(sql: Sql, p: Principal, id: string): Promise<ManageApplication> {
  await sql.begin(async (tx) => {
    const [d] = await tx<{ releasedAt: Date | null; before: InternalStatus; edition: number }[]>`
      select d.released_at as "releasedAt", d.status_before_decision as before, a.edition_id as edition
      from selection_decisions d join applications a on a.id = d.application_id where d.application_id = ${id} for update`;
    if (!d) throw new AppError(404, "no_draft", "Not found", "There is no draft decision for this application");
    if (d.releasedAt) throw new AppError(409, "decision_released", "Decision already released", "Released decisions cannot be withdrawn (TBD-37).");
    await tx`delete from selection_decisions where application_id = ${id}`;
    await tx`update applications set status = ${d.before} where id = ${id}`;
    await audit(tx, { actorUserId: p.account!.id, action: "decision.draft_withdrawn", entityType: "application", entityId: id, editionId: d.edition });
  });
  return getApplication(sql, id);
}

/** Releases drafted decisions: applicants see the outcome, selected leaders gain edition access, everyone is notified. */
export async function releaseDecisions(sql: Sql, p: Principal, year: number, ids?: string[]): Promise<ReleaseResponse> {
  const edition = await getEdition(sql, year);
  return sql.begin(async (tx) => {
    const drafts = await tx<{ id: string; outcome: "selected" | "not_selected"; startupId: string; startupName: string; leaderId: string }[]>`
      select a.id, d.outcome, s.id as "startupId", s.name as "startupName", m.user_id as "leaderId"
      from selection_decisions d
      join applications a on a.id = d.application_id
      join startups s on s.id = a.startup_id
      join startup_memberships m on m.startup_id = s.id and m.position = 'leader'
      where a.edition_id = ${year} and d.released_at is null
        ${ids ? tx`and a.id in ${tx(ids)}` : tx``}
      for update of d, a`;
    if (ids && drafts.length !== ids.length) {
      throw new AppError(409, "not_releasable", "Some applications have no unreleased draft decision",
        "Release only applications that have a draft decision in this edition.");
    }
    let selected = 0;
    for (const d of drafts) {
      await tx`update selection_decisions set released_at = now(), released_by = ${p.account!.id} where application_id = ${d.id}`;
      await tx`update applications set status = ${d.outcome} where id = ${d.id}`;
      if (d.outcome === "selected") {
        selected += 1;
        // FR-REG-09 / FR-SEL-05: only management-selected applicants gain access to this edition.
        // Team members' access waits for TBD-16 (how members are onboarded).
        await tx`
          insert into edition_access (user_id, edition_id, source, granted_by)
          select ${d.leaderId}, ${year}, 'selected', ${p.account!.id}
          where exists (select 1 from user_accounts where id = ${d.leaderId} and status <> 'deactivated')
          on conflict (user_id, edition_id) do nothing`;
      }
      const [later] = await tx<{ n: number }[]>`
        select count(*)::int as n from applications where startup_id = ${d.startupId} and edition_id > ${year}`;
      const msg = resultMessage({ outcome: d.outcome, year, startupName: d.startupName, hasLaterApplication: (later?.n ?? 0) > 0 });
      await notifyInApp(tx, { userId: d.leaderId, editionId: year, ...msg, idempotencyKey: `decision-released:${d.id}` });
      await audit(tx, { actorUserId: p.account!.id, action: "decision.released", entityType: "application", entityId: d.id,
        editionId: year, data: { outcome: d.outcome, notification: "in_app" } });
    }
    const warnings: string[] = [];
    if (edition.selectionLimit !== null) {
      const [n] = await tx<{ n: number }[]>`
        select count(*)::int as n from applications where edition_id = ${year} and status = 'selected'`;
      if ((n?.n ?? 0) > edition.selectionLimit) {
        warnings.push(`${n!.n} startups are now selected for ${year}, above the configured limit of ${edition.selectionLimit}.`);
      }
    }
    return { released: drafts.length, selected, notSelected: drafts.length - selected, warnings };
  });
}

export async function setSelectionLimit(sql: Sql, p: Principal, year: number, limit: number | null) {
  await getEdition(sql, year);
  await sql.begin(async (tx) => {
    await tx`update event_editions set selection_limit = ${limit} where id = ${year}`;
    await audit(tx, { actorUserId: p.account!.id, action: "edition.selection_limit_set", entityType: "event_edition",
      entityId: String(year), editionId: year, data: { limit } });
  });
  return { edition: year, selectionLimit: limit };
}
