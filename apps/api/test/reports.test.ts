// Phase 9: reports and controlled exports (FR-RPT-*; TBD-31). Export is a permission separate from viewing: every
// route also needs the resource's own view permission, checked again inside the service (defence in depth).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseCsv } from "../src/modules/imports/csv.js";
import { createTestApp, type TestApp } from "./helpers.js";

let t: TestApp;
const ADMIN = "admin@reports.test", MANAGER = "manager@reports.test", SUPPORT = "support@reports.test";

beforeAll(async () => { t = await createTestApp(); await t.staff(ADMIN, ["admin"]); await t.staff(MANAGER, ["management"]); await t.staff(SUPPORT, ["customer_support"]); });
afterAll(async () => { await t.close(); });

/** CSV routes return text, not JSON, so a plain `inject` is used instead of `t.call` (which always JSON-parses the body). */
async function getCsv(url: string, as: string) {
  const res = await t.app.inject({ method: "GET", url, headers: { authorization: `Bearer ${await t.token(as)}` } });
  return { status: res.statusCode, body: res.body, disposition: res.headers["content-disposition"] as string | undefined };
}

describe("export is a permission separate from viewing", () => {
  it("refuses Customer Support and an unauthenticated caller on every report", async () => {
    for (const url of ["/v1/admin/reports/accounts.csv", "/v1/admin/reports/imports.csv", "/v1/admin/editions/2026/reports/volunteers.csv",
      "/v1/manage/editions/2026/reports/applications.csv", "/v1/manage/editions/2026/reports/selection.csv", "/v1/manage/editions/2026/reports/jury.csv"]) {
      expect((await getCsv(url, SUPPORT)).status).toBe(403);
      expect((await t.app.inject({ method: "GET", url })).statusCode).toBe(401);
    }
  });

  it("refuses Management on Admin's reports, and Admin on Management's reports, even though both hold report.export", async () => {
    expect((await getCsv("/v1/admin/reports/accounts.csv", MANAGER)).status).toBe(403);
    expect((await getCsv("/v1/admin/reports/imports.csv", MANAGER)).status).toBe(403);
    expect((await getCsv("/v1/admin/editions/2026/reports/volunteers.csv", MANAGER)).status).toBe(403);
    expect((await getCsv("/v1/manage/editions/2026/reports/applications.csv", ADMIN)).status).toBe(403);
    expect((await getCsv("/v1/manage/editions/2026/reports/selection.csv", ADMIN)).status).toBe(403);
    expect((await getCsv("/v1/manage/editions/2026/reports/jury.csv", ADMIN)).status).toBe(403);
  });
});

describe("accounts export (Admin)", () => {
  it("lists accounts with their roles and edition access, sorted by name", async () => {
    await t.staff("zeta@reports.test", ["management"]);
    await t.staff("alpha@reports.test", ["volunteer"]);
    const r = await getCsv("/v1/admin/reports/accounts.csv", ADMIN);
    expect(r.status).toBe(200);
    expect(r.disposition).toContain("sj-accounts.csv");
    const rows = parseCsv(r.body);
    expect(rows[0]).toEqual(["id", "full_name", "email", "mobile", "status", "roles", "edition_access", "created_at", "activated_at"]);
    const names = rows.slice(1).map((row) => row[1]);
    expect(names.indexOf("alpha@reports.test")).toBeLessThan(names.indexOf("zeta@reports.test"));
    const zeta = rows.find((row) => row[1] === "zeta@reports.test")!;
    expect(zeta[5]).toBe("management");
  });

  it("is audited with a row count, never the row data", async () => {
    const before = (await t.sql`select count(*)::int as n from audit_events where action = 'report.exported' and entity_id = 'accounts'`)[0]!.n;
    await getCsv("/v1/admin/reports/accounts.csv", ADMIN);
    const [row] = await t.sql<{ data: { rowCount: number } }[]>`
      select data from audit_events where action = 'report.exported' and entity_id = 'accounts' order by id desc limit 1`;
    const after = (await t.sql`select count(*)::int as n from audit_events where action = 'report.exported' and entity_id = 'accounts'`)[0]!.n;
    expect(after).toBe(before + 1);
    expect(row!.data.rowCount).toBeGreaterThan(0);
  });
});

describe("imports export (Admin)", () => {
  it("lists import batches with uploader name and commit state", async () => {
    const uploaderId = (await t.sql<{ id: string }[]>`select id from user_accounts where email = ${ADMIN}`)[0]!.id;
    await t.sql`insert into import_batches (category, file_name, file_sha256, state, uploaded_by, edition_id, committed_at, row_count, error_count)
                values ('volunteers', 'vols.csv', ${"a".repeat(64)}, 'committed', ${uploaderId}, 2026, now(), 5, 1)`;
    const r = await getCsv("/v1/admin/reports/imports.csv", ADMIN);
    const rows = parseCsv(r.body);
    expect(rows[0]).toEqual(["id", "category", "edition", "file_name", "state", "row_count", "error_count", "uploaded_by", "uploaded_at", "committed_at"]);
    const vols = rows.find((row) => row[3] === "vols.csv")!;
    expect(vols[1]).toBe("volunteers");
    expect(vols[4]).toBe("committed");
    expect(vols[5]).toBe("5");
  });
});

describe("volunteer assignments export (Admin)", () => {
  it("shows the target's kind and name for both a startup and a jury member target", async () => {
    const volunteer1 = await t.participant("vol-rep1@reports.test", "volunteer", 2026, { name: "Vera Volunteer" });
    const volunteer2 = await t.participant("vol-rep2@reports.test", "volunteer", 2026, { name: "Vik Volunteer" });
    const jury = await t.participant("jury-rep@reports.test", "jury_member", 2026, { name: "Jay Juror" });
    const startup = await t.startup("Report Co", "lead-rep@reports.test", 2026);
    const admin = (await t.sql<{ id: string }[]>`select id from user_accounts where email = ${ADMIN}`)[0]!.id;
    await t.sql`insert into volunteer_assignments (edition_id, volunteer_user_id, target_startup_id, state, created_by, reason)
                values (2026, ${volunteer1}, ${startup.id}, 'active', ${admin}, 'Assigned by hand (test)')`;
    await t.sql`insert into volunteer_assignments (edition_id, volunteer_user_id, target_jury_user_id, state, created_by, reason)
                values (2026, ${volunteer2}, ${jury}, 'active', ${admin}, 'Assigned by hand (test)')`;
    const r = await getCsv("/v1/admin/editions/2026/reports/volunteers.csv", ADMIN);
    const rows = parseCsv(r.body);
    expect(rows[0]).toEqual(["assignment_id", "volunteer_name", "volunteer_email", "target_kind", "target_name", "state", "created_at", "closed_at", "close_reason"]);
    const startupRow = rows.find((x) => x[1] === "Vera Volunteer")!;
    expect(startupRow[3]).toBe("startup");
    expect(startupRow[4]).toBe("Report Co");
    const juryRow = rows.find((x) => x[1] === "Vik Volunteer")!;
    expect(juryRow[3]).toBe("jury");
    expect(juryRow[4]).toBe("Jay Juror");
  });
});

describe("applications and selection exports (Management)", () => {
  it("lists applications for the edition, and decisions separately", async () => {
    const startup = await t.startup("Decision Labs", "lead-dec@reports.test", 2026);
    const manager = (await t.sql<{ id: string }[]>`select id from user_accounts where email = ${MANAGER}`)[0]!.id;
    const [app_] = await t.sql<{ id: string }[]>`
      insert into applications (startup_id, edition_id, status, privacy_notice_version, submitted_by)
      values (${startup.id}, 2026, 'selected', 'v1', ${startup.leaderId}) returning id`;
    await t.sql`insert into selection_decisions (application_id, outcome, status_before_decision, decided_by, released_at, released_by)
                values (${app_!.id}, 'selected', 'submitted', ${manager}, now(), ${manager})`;

    const apps = parseCsv((await getCsv("/v1/manage/editions/2026/reports/applications.csv", MANAGER)).body);
    expect(apps[0]).toEqual(["application_id", "startup_name", "leader_name", "leader_email", "status", "flags", "submitted_at", "withdrawn_at"]);
    expect(apps.some((r) => r[1] === "Decision Labs" && r[4] === "selected")).toBe(true);

    const sel = parseCsv((await getCsv("/v1/manage/editions/2026/reports/selection.csv", MANAGER)).body);
    expect(sel[0]).toEqual(["application_id", "startup_name", "outcome", "ai_rank", "decided_by", "decided_at", "released_at", "is_override", "reason"]);
    const row = sel.find((r) => r[1] === "Decision Labs")!;
    expect(row[2]).toBe("selected");
  });
});

describe("jury evaluations export (Management)", () => {
  it("includes the server-computed total score, only for submitted evaluations", async () => {
    const juror = await t.participant("juror-rep@reports.test", "jury_member", 2026, { name: "Report Juror" });
    const startup = await t.startup("Jury Export Co", "lead-je@reports.test", 2026);
    const overview = (await t.call("GET", "/v1/manage/editions/2026/jury", { as: MANAGER })).json;
    const v1 = overview.rubrics.find((r: { version: number }) => r.version === 1);
    await t.call("POST", `/v1/manage/rubrics/${v1.id}/approve`, { as: MANAGER });
    await t.call("POST", "/v1/manage/editions/2026/jury-assignments", { as: MANAGER, body: { juryUserId: juror, startupId: startup.id } });
    const scores = { innovation: 8, feasibility: 7, scalability: 6, market_relevance: 9, impact: 10, pitch_delivery: 5 };
    await t.call("POST", `/v1/editions/2026/jury/startups/${startup.id}/evaluation/submit`, { as: "juror-rep@reports.test", body: { scores } });

    const rows = parseCsv((await getCsv("/v1/manage/editions/2026/reports/jury.csv", MANAGER)).body);
    expect(rows[0]).toEqual(["startup_name", "jury_name", "rubric_version", "state", "total_score", "comments", "submitted_at"]);
    const row = rows.find((r) => r[0] === "Jury Export Co")!;
    expect(row[1]).toBe("Report Juror");
    expect(row[3]).toBe("submitted");
    expect(Number(row[4])).toBeGreaterThan(0);
  });
});
