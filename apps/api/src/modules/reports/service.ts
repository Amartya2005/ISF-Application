// Reports and controlled exports (FR-RPT-*; TBD-31). CSV only, always through platform/csv-export.ts (formula-
// injection escaping) and always audited. Export is a permission separate from viewing a resource: every function
// here is called only after the route checks `report.export`, and each one additionally checks:
//   - the resource-view permission (defence in depth — redundant today, since every role holding `report.export`
//     also holds the matching view permission, by construction of ROLE_PERMISSIONS);
//   - the OWNING ROLE named in TBD-31 (`REPORT_OWNER`). This second check is not redundant: `volunteer.read` and
//     `application.read_all` are each held by both Admin and Management for different reasons (one administers the
//     data, the other reviews it), but TBD-31 draws the export line by role, not by who may merely view the data —
//     Admin exports accounts/imports/volunteers; Management exports applications/selection/jury; neither exports
//     the other's.
// Sorting is done in JavaScript, not SQL `order by name`: local (C.UTF-8) and CI (en_US) Postgres collations can
// order the same names differently (the same fix as `supportQueue()` in Phase 8).
import { REPORT_OWNER, type ReportKind } from "@sj/contracts";
import type { Db } from "../../db/client.js";
import { toCsv } from "../../platform/csv-export.js";
import { audit } from "../../platform/audit.js";
import { permissionsOf, type Principal } from "../../platform/principal.js";
import { forbidden } from "../../platform/errors.js";
import type { Permission } from "../../platform/permissions.js";

export type Report = { fileName: string; csv: string };
const byName = (a: string | null, b: string | null) => (a ?? "").localeCompare(b ?? "", "en");

function assertCan(p: Principal, perm: Permission): void {
  if (!permissionsOf(p).has(perm)) throw forbidden();
}

/** TBD-31 draws the export boundary by role, not by shared view permissions (see module comment above). */
function assertOwner(p: Principal, kind: ReportKind): void {
  if (!p.roles.has(REPORT_OWNER[kind])) throw forbidden();
}

async function record(db: Db, p: Principal, kind: ReportKind, edition: number | null, rowCount: number): Promise<void> {
  await audit(db, { actorUserId: p.account!.id, action: "report.exported", entityType: "report", entityId: kind, editionId: edition, data: { rowCount } });
}

// ---------------------------------------------------------------- Admin: accounts, imports, volunteer assignments

export async function exportAccounts(db: Db, p: Principal): Promise<Report> {
  assertCan(p, "report.export");
  assertCan(p, "user.read");
  assertOwner(p, "accounts");
  const rows = await db<{
    id: string; fullName: string; email: string | null; mobile: string | null; status: string;
    createdAt: Date; activatedAt: Date | null; roles: string[]; editions: number[];
  }[]>`
    select u.id, u.full_name as "fullName", u.email, u.mobile_e164 as mobile, u.status, u.created_at as "createdAt", u.activated_at as "activatedAt",
           coalesce(array_agg(distinct rg.role) filter (where rg.role is not null), '{}') as roles,
           coalesce(array_agg(distinct ea.edition_id) filter (where ea.edition_id is not null), '{}') as editions
    from user_accounts u
    left join role_grants rg on rg.user_id = u.id and rg.revoked_at is null
    left join edition_access ea on ea.user_id = u.id and ea.revoked_at is null
    group by u.id`;
  rows.sort((a, b) => byName(a.fullName, b.fullName) || byName(a.id, b.id));
  const csv = toCsv(
    ["id", "full_name", "email", "mobile", "status", "roles", "edition_access", "created_at", "activated_at"],
    rows.map((r) => [r.id, r.fullName, r.email, r.mobile, r.status, r.roles.sort().join("; "), r.editions.sort().join("; "), r.createdAt, r.activatedAt]),
  );
  await record(db, p, "accounts", null, rows.length);
  return { fileName: "sj-accounts.csv", csv };
}

export async function exportImports(db: Db, p: Principal): Promise<Report> {
  assertCan(p, "report.export");
  assertCan(p, "import.manage");
  assertOwner(p, "imports");
  const rows = await db<{
    id: string; category: string; edition: number; fileName: string; state: string; rowCount: number; errorCount: number;
    uploadedBy: string; uploadedAt: Date; committedAt: Date | null;
  }[]>`
    select b.id, b.category, b.edition_id as edition, b.file_name as "fileName", b.state, b.row_count as "rowCount", b.error_count as "errorCount",
           u.full_name as "uploadedBy", b.uploaded_at as "uploadedAt", b.committed_at as "committedAt"
    from import_batches b join user_accounts u on u.id = b.uploaded_by`;
  rows.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
  const csv = toCsv(
    ["id", "category", "edition", "file_name", "state", "row_count", "error_count", "uploaded_by", "uploaded_at", "committed_at"],
    rows.map((r) => [r.id, r.category, r.edition, r.fileName, r.state, r.rowCount, r.errorCount, r.uploadedBy, r.uploadedAt, r.committedAt]),
  );
  await record(db, p, "imports", null, rows.length);
  return { fileName: "sj-imports.csv", csv };
}

export async function exportVolunteers(db: Db, p: Principal, year: number): Promise<Report> {
  assertCan(p, "report.export");
  assertCan(p, "volunteer.read");
  assertOwner(p, "volunteers");
  const rows = await db<{
    id: string; volunteerName: string; volunteerEmail: string | null; targetKind: "startup" | "jury"; targetName: string;
    state: string; createdAt: Date; closedAt: Date | null; closeReason: string | null;
  }[]>`
    select a.id, v.full_name as "volunteerName", v.email as "volunteerEmail",
           case when a.target_startup_id is not null then 'startup' else 'jury' end as "targetKind",
           coalesce(s.name, j.full_name) as "targetName",
           a.state, a.created_at as "createdAt", a.closed_at as "closedAt", a.close_reason as "closeReason"
    from volunteer_assignments a
    join user_accounts v on v.id = a.volunteer_user_id
    left join startups s on s.id = a.target_startup_id
    left join user_accounts j on j.id = a.target_jury_user_id
    where a.edition_id = ${year}`;
  rows.sort((a, b) => byName(a.volunteerName, b.volunteerName) || byName(a.id, b.id));
  const csv = toCsv(
    ["assignment_id", "volunteer_name", "volunteer_email", "target_kind", "target_name", "state", "created_at", "closed_at", "close_reason"],
    rows.map((r) => [r.id, r.volunteerName, r.volunteerEmail, r.targetKind, r.targetName, r.state, r.createdAt, r.closedAt, r.closeReason]),
  );
  await record(db, p, "volunteers", year, rows.length);
  return { fileName: `sj-volunteers-${year}.csv`, csv };
}

// ---------------------------------------------------------------- Management: applications, selection, jury

export async function exportApplications(db: Db, p: Principal, year: number): Promise<Report> {
  assertCan(p, "report.export");
  assertCan(p, "application.read_all");
  assertOwner(p, "applications");
  const rows = await db<{
    id: string; startupName: string; leaderName: string; leaderEmail: string | null; status: string;
    flags: string[]; submittedAt: Date; withdrawnAt: Date | null;
  }[]>`
    select a.id, s.name as "startupName", u.full_name as "leaderName", u.email as "leaderEmail", a.status, a.flags,
           a.submitted_at as "submittedAt", a.withdrawn_at as "withdrawnAt"
    from applications a
    join startups s on s.id = a.startup_id
    join startup_memberships m on m.startup_id = s.id and m.position = 'leader'
    join user_accounts u on u.id = m.user_id
    where a.edition_id = ${year}`;
  rows.sort((a, b) => byName(a.startupName, b.startupName) || byName(a.id, b.id));
  const csv = toCsv(
    ["application_id", "startup_name", "leader_name", "leader_email", "status", "flags", "submitted_at", "withdrawn_at"],
    rows.map((r) => [r.id, r.startupName, r.leaderName, r.leaderEmail, r.status, r.flags.join("; "), r.submittedAt, r.withdrawnAt]),
  );
  await record(db, p, "applications", year, rows.length);
  return { fileName: `sj-applications-${year}.csv`, csv };
}

export async function exportSelection(db: Db, p: Principal, year: number): Promise<Report> {
  assertCan(p, "report.export");
  assertCan(p, "application.read_all");
  assertOwner(p, "selection");
  const rows = await db<{
    applicationId: string; startupName: string; outcome: string; decidedBy: string; decidedAt: Date;
    releasedAt: Date | null; isOverride: boolean | null; reason: string | null; aiRank: number | null;
  }[]>`
    select d.application_id as "applicationId", s.name as "startupName", d.outcome,
           u.full_name as "decidedBy", d.decided_at as "decidedAt", d.released_at as "releasedAt",
           d.is_override as "isOverride", d.reason, d.ai_rank_at_decision as "aiRank"
    from selection_decisions d
    join applications a on a.id = d.application_id
    join startups s on s.id = a.startup_id
    join user_accounts u on u.id = d.decided_by
    where a.edition_id = ${year}`;
  rows.sort((a, b) => byName(a.startupName, b.startupName) || byName(a.applicationId, b.applicationId));
  const csv = toCsv(
    ["application_id", "startup_name", "outcome", "ai_rank", "decided_by", "decided_at", "released_at", "is_override", "reason"],
    rows.map((r) => [r.applicationId, r.startupName, r.outcome, r.aiRank, r.decidedBy, r.decidedAt, r.releasedAt, r.isOverride, r.reason]),
  );
  await record(db, p, "selection", year, rows.length);
  return { fileName: `sj-selection-${year}.csv`, csv };
}

export async function exportJury(db: Db, p: Principal, year: number): Promise<Report> {
  assertCan(p, "report.export");
  assertCan(p, "jury.review");
  assertOwner(p, "jury");
  const rows = await db<{
    juryName: string; startupName: string; rubricVersion: number; state: string;
    totalScore: string | null; comments: string | null; submittedAt: Date | null;
  }[]>`
    select u.full_name as "juryName", s.name as "startupName", r.version as "rubricVersion", e.state,
           e.total_score::text as "totalScore", e.comments, e.submitted_at as "submittedAt"
    from evaluations e
    join jury_assignments j on j.id = e.jury_assignment_id
    join startups s on s.id = j.startup_id
    join user_accounts u on u.id = j.jury_user_id
    join scoring_rubrics r on r.id = e.rubric_id
    where j.edition_id = ${year} and e.submitted_at is not null`;
  rows.sort((a, b) => byName(a.startupName, b.startupName) || byName(a.juryName, b.juryName));
  const csv = toCsv(
    ["startup_name", "jury_name", "rubric_version", "state", "total_score", "comments", "submitted_at"],
    rows.map((r) => [r.startupName, r.juryName, r.rubricVersion, r.state, r.totalScore === null ? null : Number(r.totalScore), r.comments, r.submittedAt]),
  );
  await record(db, p, "jury", year, rows.length);
  return { fileName: `sj-jury-${year}.csv`, csv };
}
