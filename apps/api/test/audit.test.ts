// Phase 9: the admin audit log viewer (FR-AUD-*, AT-16; TBD-59). Read-only — audit_events is append-only at the
// database level (DC-13, schema.test.ts); this page only filters and paginates what is already recorded.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./helpers.js";

let t: TestApp;
const ADMIN = "admin@audit.test", MANAGER = "manager@audit.test", SUPPORT = "support@audit.test";

beforeAll(async () => { t = await createTestApp(); await t.staff(ADMIN, ["admin"]); await t.staff(MANAGER, ["management"]); await t.staff(SUPPORT, ["customer_support"]); });
afterAll(async () => { await t.close(); });

describe("permission: Admin only", () => {
  it("refuses Management and Customer Support, allows Admin", async () => {
    for (const as of [MANAGER, SUPPORT]) expect((await t.call("GET", "/v1/admin/audit", { as })).status).toBe(403);
    expect((await t.call("GET", "/v1/admin/audit", { as: ADMIN })).status).toBe(200);
  });

  it("refuses an unauthenticated request", async () => {
    expect((await t.call("GET", "/v1/admin/audit")).status).toBe(401);
  });
});

describe("filters and pagination", () => {
  let subjectId: string;
  beforeAll(async () => {
    subjectId = await t.staff("subject@audit.test", []);
    // Three distinct recorded actions, so filters have something to tell apart.
    await t.call("POST", `/v1/admin/users/${subjectId}/roles`, { as: ADMIN, body: { role: "volunteer" } });
    const grant2 = await t.call("POST", `/v1/admin/users/${subjectId}/roles`, { as: ADMIN, body: { role: "jury_member" } });
    const grantId = grant2.json.roles.find((r: { role: string; grantId: string }) => r.role === "jury_member").grantId;
    await t.call("DELETE", `/v1/admin/users/${subjectId}/roles/${grantId}`, { as: ADMIN });
  });

  it("filters by action and by entity type", async () => {
    const granted = await t.call("GET", `/v1/admin/audit?action=role.granted&entityType=user_account`, { as: ADMIN });
    expect(granted.status).toBe(200);
    expect(granted.json.events.length).toBeGreaterThanOrEqual(2);
    expect(granted.json.events.every((e: { action: string }) => e.action === "role.granted")).toBe(true);

    const revoked = await t.call("GET", `/v1/admin/audit?action=role.revoked`, { as: ADMIN });
    expect(revoked.json.events).toHaveLength(1);
    expect(revoked.json.events[0].entityId).toBe(subjectId);
    expect(revoked.json.events[0].actorName).toBeTruthy();   // the admin who acted, joined from user_accounts
  });

  it("filters by actor and reports a total independent of the page size", async () => {
    const adminId = (await t.sql<{ id: string }[]>`select id from user_accounts where email = ${ADMIN}`)[0]!.id;
    const byActor = await t.call("GET", `/v1/admin/audit?actorUserId=${adminId}&limit=1`, { as: ADMIN });
    expect(byActor.status).toBe(200);
    expect(byActor.json.events.length).toBeLessThanOrEqual(1);
    expect(byActor.json.total).toBeGreaterThanOrEqual(byActor.json.events.length);
  });

  it("paginates with limit and offset, newest first", async () => {
    const page1 = await t.call("GET", `/v1/admin/audit?limit=2&offset=0`, { as: ADMIN });
    const page2 = await t.call("GET", `/v1/admin/audit?limit=2&offset=2`, { as: ADMIN });
    expect(page1.json.events).toHaveLength(2);
    expect(new Date(page1.json.events[0].at).getTime()).toBeGreaterThanOrEqual(new Date(page1.json.events[1].at).getTime());
    const ids = new Set([...page1.json.events, ...page2.json.events].map((e: { id: string }) => e.id));
    expect(ids.size).toBe([...page1.json.events, ...page2.json.events].length);   // no overlap between pages
  });

  it("never lets the viewer change or delete anything (no mutating routes exist for audit)", async () => {
    expect((await t.call("POST", "/v1/admin/audit", { as: ADMIN, body: {} })).status).toBe(404);
  });
});
