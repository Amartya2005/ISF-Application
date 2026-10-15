// In-app notifications (FR-NOT-*). Push, email, SMS and WhatsApp channels plug in later behind the same outbox
// (results: in-app plus the verified sign-in contact, TBD-14 in docs/DECISIONS.md). Idempotency keys make re-sends harmless (FR-NOT-04).
import type { NotificationItem } from "@sj/contracts";
import type { Db } from "../../db/client.js";

export async function notifyInApp(
  db: Db,
  n: { userId: string; editionId: number | null; kind: string; title: string; body: string; idempotencyKey: string },
): Promise<boolean> {
  const rows = await db`
    insert into notifications (user_id, edition_id, kind, channel, title, body, status, sent_at, idempotency_key)
    values (${n.userId}, ${n.editionId}, ${n.kind}, 'in_app', ${n.title}, ${n.body}, 'sent', now(), ${n.idempotencyKey})
    on conflict (idempotency_key) do nothing
    returning id`;
  return rows.length === 1;
}

export async function myNotifications(db: Db, userId: string): Promise<NotificationItem[]> {
  const rows = await db<{ id: string; edition: number | null; kind: string; title: string; body: string; createdAt: Date; readAt: Date | null }[]>`
    select id, edition_id as edition, kind, title, body, created_at as "createdAt", read_at as "readAt"
    from notifications where user_id = ${userId} and channel = 'in_app' order by created_at desc limit 100`;
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), readAt: r.readAt?.toISOString() ?? null }));
}

/**
 * Result notification wording (FR-SEL-05/06). DRAFT COPY — must be approved by the Management Team before
 * the first production release (TBD-14, docs/DECISIONS.md). Kept here so the text is reviewable in one place.
 */
export function resultMessage(o: { outcome: "selected" | "not_selected"; year: number; startupName: string; hasLaterApplication: boolean }) {
  if (o.outcome === "selected") {
    return {
      kind: "selection_result",
      title: `Congratulations — ${o.startupName} is selected for Startup Jathara ${o.year}`,
      body:
        `We are delighted to tell you that ${o.startupName} has been selected for Startup Jathara ${o.year}. ` +
        `Your ${o.year} event features are now available when you sign in. Further details will follow.`,
    };
  }
  const next = o.year + 1;
  return {
    kind: "selection_result",
    title: `Update on your Startup Jathara ${o.year} application`,
    body:
      `Thank you for applying to Startup Jathara ${o.year}. After careful review, ${o.startupName} has not been selected for the ${o.year} event. ` +
      (o.hasLaterApplication
        ? `Your ${next} application is separate, is not affected by this decision, and remains under review.`
        : `We encourage you to consider registering for Startup Jathara ${next}.`),
  };
}
