// Phase 9: data-retention purge (TBD-32). Off by default; a dry run only counts; a live run deletes exactly the
// categories this phase built — see modules/retention/purge.ts for what is deliberately not built and why.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sweepRetention } from "../src/modules/retention/purge.js";
import { createTestApp, type TestApp } from "./helpers.js";

let t: TestApp;
const ADMIN = "admin@retention.test", MANAGER = "manager@retention.test";
const NOW = new Date("2026-10-16T12:00:00+05:30");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 3600_000);

beforeAll(async () => {
  t = await createTestApp({ now: NOW });
  await t.staff(ADMIN, ["admin"]);
  await t.staff(MANAGER, ["management"]);
});
afterAll(async () => { await t.close(); });

describe("disabled by default", () => {
  it("runs nothing and writes nothing when not enabled", async () => {
    const results = await sweepRetention(t.sql, { enabled: false, dryRun: true }, NOW);
    expect(results).toEqual([]);
  });
});

describe("import rows (30 days after commit; the batch summary is kept)", () => {
  async function batch(committedAt: Date | null, state: "committed" | "previewed") {
    const uploader = await t.staff(`u-${randomUUID()}@retention.test`, ["admin"]);
    const [b] = await t.sql<{ id: string }[]>`
      insert into import_batches (category, file_name, file_sha256, state, uploaded_by, edition_id, committed_at, row_count)
      values ('startups', 'f.csv', ${"0".repeat(64)}, ${state}, ${uploader}, 2026, ${committedAt}, 2) returning id`;
    for (const n of [1, 2]) await t.sql`insert into import_rows (batch_id, row_number, data, outcome) values (${b!.id}, ${n}, '{}', 'created')`;
    return b!.id;
  }

  it("dry run counts an old committed batch's rows without deleting them; a recent batch is untouched", async () => {
    const old = await batch(daysAgo(31), "committed");
    const recent = await batch(daysAgo(10), "committed");
    const r = (await sweepRetention(t.sql, { enabled: true, dryRun: true }, NOW)).find((s) => s.category === "import_rows")!;
    expect(r.deletedCount).toBe(2);
    expect((await t.sql`select count(*)::int as n from import_rows where batch_id = ${old}`)[0]!.n).toBe(2);
    expect((await t.sql`select count(*)::int as n from import_rows where batch_id = ${recent}`)[0]!.n).toBe(2);
    const sweep = (await t.sql`select * from retention_sweeps where category = 'import_rows' order by id desc limit 1`)[0]!;
    expect(sweep.dry_run).toBe(true);
    expect(sweep.deleted_count).toBe(2);
  });

  it("a live run deletes only the old committed batch's rows, keeping the batch and its summary", async () => {
    const old = await batch(daysAgo(45), "committed");
    const recent = await batch(daysAgo(5), "committed");
    const unCommitted = await batch(null, "previewed");
    await sweepRetention(t.sql, { enabled: true, dryRun: false }, NOW);
    expect((await t.sql`select count(*)::int as n from import_rows where batch_id = ${old}`)[0]!.n).toBe(0);
    expect((await t.sql`select count(*)::int as n from import_rows where batch_id = ${recent}`)[0]!.n).toBe(2);
    expect((await t.sql`select count(*)::int as n from import_rows where batch_id = ${unCommitted}`)[0]!.n).toBe(2);
    expect((await t.sql`select row_count from import_batches where id = ${old}`)[0]!.row_count).toBe(2);   // summary kept
    const audited = await t.sql`select * from audit_events where action = 'retention.purged' and entity_id = 'import_rows' order by id desc limit 1`;
    expect(audited).toHaveLength(1);
  });
});

describe("activation code hashes (90 days after use, revocation or expiry)", () => {
  async function token(o: { usedAt?: Date | null; revokedAt?: Date | null; expiresAt: Date }) {
    const user = await t.staff(`t-${randomUUID()}@retention.test`, ["admin"]);
    const [row] = await t.sql<{ id: string }[]>`
      insert into activation_tokens (user_id, token_sha256, issued_by, issued_at, expires_at, used_at, revoked_at)
      values (${user}, ${randomUUID().replace(/-/g, "").padEnd(64, "0")}, ${user}, ${daysAgo(100)}, ${o.expiresAt}, ${o.usedAt ?? null}, ${o.revokedAt ?? null})
      returning id`;
    return row!.id;
  }

  it("purges tokens used, revoked or expired 90+ days ago; keeps recent and still-outstanding ones", async () => {
    const usedLongAgo = await token({ usedAt: daysAgo(91), expiresAt: daysAgo(95) });
    const usedRecently = await token({ usedAt: daysAgo(10), expiresAt: daysAgo(12) });
    const revokedLongAgo = await token({ revokedAt: daysAgo(95), expiresAt: daysAgo(80) });
    const expiredUnusedLongAgo = await token({ expiresAt: daysAgo(91) });
    const stillOutstanding = await token({ expiresAt: daysAgo(-10) });   // expires in the future
    await sweepRetention(t.sql, { enabled: true, dryRun: false }, NOW);
    const remaining = new Set((await t.sql<{ id: string }[]>`select id from activation_tokens`).map((r) => r.id));
    expect(remaining.has(usedLongAgo)).toBe(false);
    expect(remaining.has(revokedLongAgo)).toBe(false);
    expect(remaining.has(expiredUnusedLongAgo)).toBe(false);
    expect(remaining.has(usedRecently)).toBe(true);
    expect(remaining.has(stillOutstanding)).toBe(true);
  });
});

describe("Help Desk transcripts (90 days of inactivity; kept while a support ticket references them)", () => {
  async function conversation(lastMessageAgeDays: number, userId: string) {
    const [c] = await t.sql<{ id: string }[]>`insert into helpdesk_conversations (channel, user_id, started_at) values ('app', ${userId}, ${daysAgo(lastMessageAgeDays + 1)}) returning id`;
    await t.sql`insert into helpdesk_messages (conversation_id, role, content, at) values (${c!.id}, 'user', 'hi', ${daysAgo(lastMessageAgeDays)})`;
    return c!.id;
  }

  it("purges an old conversation with no ticket, keeps a recent one and one a ticket still references", async () => {
    const requester = await t.staff(`r-${randomUUID()}@retention.test`, ["admin"]);
    const old = await conversation(91, requester);
    const recent = await conversation(5, requester);
    const withTicket = await conversation(91, requester);
    await t.sql`insert into support_tickets (edition_id, requester_id, conversation_id, status, priority) values (2026, ${requester}, ${withTicket}, 'Open', 'normal')`;
    await sweepRetention(t.sql, { enabled: true, dryRun: false }, NOW);
    const remaining = new Set((await t.sql<{ id: string }[]>`select id from helpdesk_conversations`).map((r) => r.id));
    expect(remaining.has(old)).toBe(false);
    expect(remaining.has(recent)).toBe(true);
    expect(remaining.has(withTicket)).toBe(true);
    expect((await t.sql`select count(*)::int as n from helpdesk_messages where conversation_id = ${old}`)[0]!.n).toBe(0);
  });
});

describe("the admin retention status endpoint", () => {
  it("is Admin-only and reports configuration and recent sweeps", async () => {
    await sweepRetention(t.sql, { enabled: true, dryRun: true }, NOW);
    const asManager = await t.call("GET", "/v1/admin/retention", { as: MANAGER });
    expect(asManager.status).toBe(403);
    const asAdmin = await t.call("GET", "/v1/admin/retention", { as: ADMIN });
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.json.recentSweeps.length).toBeGreaterThan(0);
  });
});
