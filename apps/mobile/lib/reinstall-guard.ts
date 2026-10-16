// OD-02 (DECISIONS.md): on iOS, the Keychain — where the session lives, see storage.ts — survives an app uninstall
// by default. A reinstall could then silently resume a previous owner's session on a device that changed hands.
// We detect "first launch after install (or reinstall)" with a marker file in the app's sandboxed document
// directory: the OS deletes that directory along with the app on uninstall, on both iOS and Android, unlike the
// Keychain/Keystore — so the same check gives the same behaviour on both platforms (device protocol D8).
// No RN/Expo import at module scope (both are dynamically imported inside checkReinstallOnThisDevice only), so
// this file is unit-testable the same way as offline-cache.ts and emergency.ts.

/** Pure decision logic. */
export function shouldClearSessionOnStartup(markerExisted: boolean): boolean {
  return !markerExisted;
}

/** The slice of expo-file-system's `File` this needs, so the logic above can be tested without it. */
export type MarkerFile = {
  exists: boolean;
  create(options?: { overwrite?: boolean }): void;
  write(content: string): void;
};

/**
 * Call once at app start-up, before trusting any stored session. Returns true when the caller should sign out
 * (clear the keychain session) — the first launch after install, or any launch after a reinstall.
 */
export function checkReinstall(marker: MarkerFile): boolean {
  const clear = shouldClearSessionOnStartup(marker.exists);
  if (clear) {
    marker.create({ overwrite: true });
    marker.write(String(Date.now()));
  }
  return clear;
}

const MARKER_NAME = "sj-installed.marker";

/**
 * The real check, against the device's file system. Web has no sandboxed app-storage directory that the OS wipes
 * on "uninstall" — the browser clears localStorage per-origin on its own — so this is a no-op there: the reinstall
 * problem OD-02 guards against does not apply to web.
 */
export async function checkReinstallOnThisDevice(): Promise<boolean> {
  try {
    const { Platform } = await import("react-native");
    if (Platform.OS === "web") return false;
    const { File, Paths } = await import("expo-file-system");
    return checkReinstall(new File(Paths.document, MARKER_NAME));
  } catch {
    // Best-effort: this is a UX safeguard, not the security boundary (every request is still authorised server-
    // side), so a filesystem error here should not block sign-in or force an unwanted sign-out.
    return false;
  }
}
