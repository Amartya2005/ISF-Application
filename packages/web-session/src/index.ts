// Browser sign-in shared by the website and the console.
// AUTH_MODE=dev: API-issued development tokens (local only; the API refuses this mode in production).
// AUTH_MODE=supabase: Supabase Auth email one-time codes (backlog B-06; needs project keys, TBD-36).
import { useSyncExternalStore } from "react";
import { createApi } from "@sj/client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SessionConfig = {
  apiUrl: string;
  authMode: "dev" | "supabase";
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  /** Separate keys keep website and console sessions apart on the same browser. */
  storageKey: string;
};

export function createSession(cfg: SessionConfig) {
  let supabase: SupabaseClient | null = null;
  const sb = () => (supabase ??= createClient(cfg.supabaseUrl!, cfg.supabaseAnonKey!, { auth: { storageKey: cfg.storageKey } }));

  let cachedToken: string | null = null;
  const listeners = new Set<() => void>();
  const changed = (token: string | null) => { cachedToken = token; listeners.forEach((l) => l()); };

  async function getToken(): Promise<string | null> {
    if (typeof window === "undefined") return null;
    if (cfg.authMode === "dev") return sessionStorage.getItem(cfg.storageKey);
    const { data } = await sb().auth.getSession();
    return data.session?.access_token ?? null;
  }

  const api = createApi({ baseUrl: cfg.apiUrl, getToken });

  /** Dev: signs in immediately. Supabase: emails a one-time code and returns "code_sent". */
  async function startSignIn(email: string, opts: { mfa?: boolean } = {}): Promise<"signed_in" | "code_sent"> {
    if (cfg.authMode === "dev") {
      const { token } = await api.devSession(email, opts.mfa);
      sessionStorage.setItem(cfg.storageKey, token);
      changed(token);
      return "signed_in";
    }
    const { error } = await sb().auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (error) throw error;
    return "code_sent";
  }

  async function verifyCode(email: string, code: string): Promise<void> {
    const { data, error } = await sb().auth.verifyOtp({ email, token: code, type: "email" });
    if (error) throw error;
    changed(data.session?.access_token ?? null);
  }

  async function signOut(): Promise<void> {
    if (cfg.authMode === "dev") sessionStorage.removeItem(cfg.storageKey);
    else await sb().auth.signOut();
    changed(null);
  }

  function emailFrom(token: string | null): string | null {
    if (!token) return null;
    try {
      const payload = JSON.parse(atob(token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")));
      return typeof payload.email === "string" ? payload.email : null;
    } catch {
      return null;
    }
  }

  /** Signed-in email; null when signed out; undefined during server rendering. */
  function useSessionEmail(): string | null | undefined {
    return useSyncExternalStore(
      (cb) => {
        listeners.add(cb);
        if (cachedToken === null) void getToken().then((t) => t !== cachedToken && changed(t));
        return () => listeners.delete(cb);
      },
      () => emailFrom(cachedToken ?? (cfg.authMode === "dev" ? sessionStorage.getItem(cfg.storageKey) : null)),
      () => undefined,
    );
  }

  return { api, authMode: cfg.authMode, getToken, startSignIn, verifyCode, signOut, useSessionEmail };
}
