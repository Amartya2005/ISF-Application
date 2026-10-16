// Session storage: the device keychain/keystore on Android and iOS (expo-secure-store); localStorage on web builds.
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { chunkedStore } from "./chunked-store";

export const secureStorage = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === "web") { try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; } }
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === "web") { try { globalThis.localStorage?.setItem(key, value); } catch { /* storage unavailable */ } return; }
    await SecureStore.setItemAsync(key, value);
  },
  async remove(key: string): Promise<void> {
    if (Platform.OS === "web") { try { globalThis.localStorage?.removeItem(key); } catch { /* storage unavailable */ } return; }
    await SecureStore.deleteItemAsync(key);
  },
};

/**
 * Storage adapter for the Supabase client. Native: chunked keychain/keystore entries (see chunked-store.ts).
 * Web builds: localStorage (browsers have no keychain; web is for development and testing only).
 */
const nativeChunked = chunkedStore(SecureStore);
export const supabaseAuthStorage = {
  getItem: (key: string) => (Platform.OS === "web" ? secureStorage.get(key) : nativeChunked.getItem(key)),
  setItem: (key: string, value: string) => (Platform.OS === "web" ? secureStorage.set(key, value) : nativeChunked.setItem(key, value)),
  removeItem: (key: string) => (Platform.OS === "web" ? secureStorage.remove(key) : nativeChunked.removeItem(key)),
};

/**
 * Generic cache for values too large for a single secure-store entry (web: localStorage, no size limit; native: the
 * same chunked keychain/keystore store used for the session). Used for offline caches such as event information
 * (FR-25, apps/mobile/lib/offline-cache.ts) that are bigger than the ~2 KB emergency-contacts cache.
 */
export const largeCache = {
  get: (key: string) => (Platform.OS === "web" ? secureStorage.get(key) : nativeChunked.getItem(key)),
  set: (key: string, value: string) => (Platform.OS === "web" ? secureStorage.set(key, value) : nativeChunked.setItem(key, value)),
};
