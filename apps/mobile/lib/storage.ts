// Session storage: the device keychain/keystore on Android and iOS (expo-secure-store); localStorage on web builds.
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

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
