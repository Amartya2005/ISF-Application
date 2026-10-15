import type { PublicEdition } from "@sj/contracts";
import type { Db } from "../../db/client.js";
import { AppError } from "../../platform/errors.js";

export type EditionRow = {
  id: number;
  name: string;
  preEventOn: string | null;
  eventStartsOn: string | null;
  eventEndsOn: string | null;
  registrationOpensAt: Date | null;
  registrationClosesAt: Date | null;
  closesAtConfirmed: boolean;
  selectionLimit: number | null;
};

export async function listEditions(db: Db): Promise<EditionRow[]> {
  return db<EditionRow[]>`
    select id, name,
           to_char(pre_event_on, 'YYYY-MM-DD') as "preEventOn",
           to_char(event_starts_on, 'YYYY-MM-DD') as "eventStartsOn",
           to_char(event_ends_on, 'YYYY-MM-DD') as "eventEndsOn",
           registration_opens_at as "registrationOpensAt",
           registration_closes_at as "registrationClosesAt",
           closes_at_confirmed as "closesAtConfirmed",
           selection_limit as "selectionLimit"
    from event_editions order by id`;
}

export async function getEdition(db: Db, year: number): Promise<EditionRow> {
  const e = (await listEditions(db)).find((x) => x.id === year);
  if (!e) throw new AppError(404, "edition_not_found", "Not found", `There is no ${year} edition`);
  return e;
}

/** Server-side source of truth for whether an edition accepts applications (FR-REG-03/04, AT-08). */
export function registrationOpen(e: EditionRow, now: Date): boolean {
  if (e.registrationOpensAt && now < e.registrationOpensAt) return false;
  if (e.registrationClosesAt && now > e.registrationClosesAt) return false;
  return true;
}

export function toPublic(e: EditionRow, now: Date): PublicEdition {
  return {
    year: e.id,
    name: e.name,
    preEventOn: e.preEventOn,
    eventStartsOn: e.eventStartsOn,
    eventEndsOn: e.eventEndsOn,
    registration: {
      open: registrationOpen(e, now),
      closesAt: e.registrationClosesAt?.toISOString() ?? null,
      closesAtConfirmed: e.closesAtConfirmed,
    },
  };
}
