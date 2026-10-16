// OD-02: first launch after install (or reinstall) is detected by a missing marker file; the marker is then
// (re-)written so the next ordinary launch is left alone.
import { describe, expect, it } from "vitest";
import { checkReinstall, shouldClearSessionOnStartup, type MarkerFile } from "./reinstall-guard.js";

function fakeMarker(exists: boolean): MarkerFile & { created: boolean; written: string | null } {
  const m = {
    exists,
    created: false,
    written: null as string | null,
    create(_options?: { overwrite?: boolean }) { m.created = true; },
    write(content: string) { m.written = content; },
  };
  return m;
}

describe("shouldClearSessionOnStartup", () => {
  it("clears when no marker existed (first launch after install, or after a reinstall)", () => {
    expect(shouldClearSessionOnStartup(false)).toBe(true);
  });
  it("does not clear when the marker survived (an ordinary launch)", () => {
    expect(shouldClearSessionOnStartup(true)).toBe(false);
  });
});

describe("checkReinstall", () => {
  it("writes the marker and reports a reinstall when it was missing", () => {
    const marker = fakeMarker(false);
    expect(checkReinstall(marker)).toBe(true);
    expect(marker.created).toBe(true);
    expect(marker.written).not.toBeNull();
  });

  it("leaves the marker alone and reports no reinstall when it already existed", () => {
    const marker = fakeMarker(true);
    expect(checkReinstall(marker)).toBe(false);
    expect(marker.created).toBe(false);
    expect(marker.written).toBeNull();
  });
});
