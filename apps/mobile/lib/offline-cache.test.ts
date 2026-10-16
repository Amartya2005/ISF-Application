import { describe, expect, it } from "vitest";
import type { EventInfo } from "@sj/contracts";
import { CACHE_FRESH_MS, decodeEventCache, encodeEventCache, isStale } from "./offline-cache";

const sample = { edition: { year: 2026, name: "Startup Jathara 2026" }, schedule: [], venues: [], accommodation: [],
  travel: [], safety: [], pages: [], emergency: [], documents: [], lastUpdated: null } as unknown as EventInfo;

describe("offline event cache", () => {
  it("round-trips the cached event info and its timestamp", () => {
    const raw = encodeEventCache(sample, "2026-10-16T00:00:00.000Z");
    expect(decodeEventCache(raw)).toEqual({ info: sample, cachedAt: "2026-10-16T00:00:00.000Z" });
  });

  it("treats corrupt, missing or malformed values as no cache, never a crash", () => {
    expect(decodeEventCache(null)).toBeNull();
    expect(decodeEventCache("not json")).toBeNull();
    expect(decodeEventCache("{}")).toBeNull();
    expect(decodeEventCache(JSON.stringify({ info: sample }))).toBeNull();          // missing cachedAt
    expect(decodeEventCache(JSON.stringify({ cachedAt: "x" }))).toBeNull();         // missing info
    expect(decodeEventCache("[1,2,3]")).toBeNull();
  });

  it("is stale once older than the freshness window, fresh just inside it", () => {
    const now = () => new Date("2026-10-16T12:00:00.000Z");
    const justInside = new Date(now().getTime() - CACHE_FRESH_MS + 1000).toISOString();
    const justOutside = new Date(now().getTime() - CACHE_FRESH_MS - 1000).toISOString();
    expect(isStale(justInside, now)).toBe(false);
    expect(isStale(justOutside, now)).toBe(true);
  });

  it("treats an unparseable timestamp as stale, never as fresh", () => {
    expect(isStale("not a date")).toBe(true);
  });
});
