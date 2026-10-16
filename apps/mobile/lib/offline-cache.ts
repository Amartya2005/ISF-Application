// Offline cache for event information (FR-25: offline information). Encode/decode the last successfully fetched
// EventInfo per edition, with when it was fetched, so the event screen can show it without a network connection and
// say plainly that it is cached rather than live. Pure: no React Native imports, so it is unit-tested (same pattern
// as emergency.ts). There is no offline queue for transactions (FR-26): no QR check-in module ships for 2026
// (TBD-30), so nothing is written offline — only this read-only cache of already-published information.
import type { EventInfo } from "@sj/contracts";

export type CachedEventInfo = { info: EventInfo; cachedAt: string };

/** How long a cached copy is shown without being marked stale. Content can change daily in the run-up to the event. */
export const CACHE_FRESH_MS = 24 * 60 * 60 * 1000;

export function encodeEventCache(info: EventInfo, cachedAt: string): string {
  return JSON.stringify({ info, cachedAt });
}

/** Never throws: a corrupt or unexpected cache value is treated as no cache, never as a crash or stale data shown as fresh. */
export function decodeEventCache(raw: string | null): CachedEventInfo | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object") return null;
    const { info, cachedAt } = v as Record<string, unknown>;
    if (typeof cachedAt !== "string" || !info || typeof info !== "object") return null;
    return { info: info as EventInfo, cachedAt };
  } catch {
    return null;
  }
}

/** True once a cached copy is old enough that the screen must say so plainly, rather than passing it off as live. */
export function isStale(cachedAt: string, now: () => Date = () => new Date()): boolean {
  const at = new Date(cachedAt).getTime();
  return !Number.isFinite(at) || now().getTime() - at > CACHE_FRESH_MS;
}
