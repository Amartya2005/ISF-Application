// Sign-in and "who am I" for the app. Same identity model as the web: dev tokens locally, Supabase Auth OTP in
// staging/production (B-06). Every permission is enforced by the API; the app only adapts what it shows.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError, createApi, type Api } from "@sj/client";
import type { MeResponse } from "@sj/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { API_URL, AUTH_MODE, SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
import { secureStorage } from "./storage";

const DEV_TOKEN_KEY = "sj.mobile.token";

type Session = {
  api: Api;
  authMode: "dev" | "supabase";
  /** undefined while restoring the saved session at start-up. */
  signedIn: boolean | undefined;
  me: MeResponse | null;
  meError: string | null;
  refreshMe: () => Promise<MeResponse | null>;
  startSignIn: (email: string) => Promise<"signed_in" | "code_sent">;
  verifyCode: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const supabase = useRef<SupabaseClient | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | undefined>(undefined);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [meError, setMeError] = useState<string | null>(null);

  const sb = useCallback(async () => {
    if (!supabase.current) {
      const [{ createClient }, AsyncStorage] = await Promise.all([
        import("@supabase/supabase-js"),
        import("@react-native-async-storage/async-storage").then((m) => m.default),
      ]);
      supabase.current = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
      });
    }
    return supabase.current;
  }, []);

  const getToken = useCallback(async () => {
    if (AUTH_MODE === "dev") return secureStorage.get(DEV_TOKEN_KEY);
    const { data } = await (await sb()).auth.getSession();
    return data.session?.access_token ?? null;
  }, [sb]);

  const api = useMemo(() => createApi({ baseUrl: API_URL, getToken }), [getToken]);

  const refreshMe = useCallback(async () => {
    setMeError(null);
    try {
      const m = await api.me();
      setMe(m);
      return m;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {   // expired or invalid session: sign out cleanly
        await secureStorage.remove(DEV_TOKEN_KEY);
        setSignedIn(false);
        setMe(null);
        return null;
      }
      setMeError(e instanceof ApiError ? (e.problem.detail ?? e.message) : (e as Error).message);
      return null;
    }
  }, [api]);

  useEffect(() => {
    void (async () => {
      const token = await getToken();
      setSignedIn(!!token);
      if (token) await refreshMe();
    })();
  }, [getToken, refreshMe]);

  const startSignIn = useCallback(async (email: string) => {
    if (AUTH_MODE === "dev") {
      const { token } = await api.devSession(email.trim().toLowerCase());
      await secureStorage.set(DEV_TOKEN_KEY, token);
      setSignedIn(true);
      await refreshMe();
      return "signed_in" as const;
    }
    const { error } = await (await sb()).auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
    if (error) throw error;
    return "code_sent" as const;
  }, [api, refreshMe, sb]);

  const verifyCode = useCallback(async (email: string, code: string) => {
    const { error } = await (await sb()).auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    if (error) throw error;
    setSignedIn(true);
    await refreshMe();
  }, [refreshMe, sb]);

  const signOut = useCallback(async () => {
    if (AUTH_MODE === "dev") await secureStorage.remove(DEV_TOKEN_KEY);
    else await (await sb()).auth.signOut();
    setMe(null);
    setSignedIn(false);
  }, [sb]);

  const value = useMemo<Session>(() => ({ api, authMode: AUTH_MODE, signedIn, me, meError, refreshMe, startSignIn, verifyCode, signOut }),
    [api, signedIn, me, meError, refreshMe, startSignIn, verifyCode, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession must be used inside SessionProvider");
  return s;
}

/** A user-facing message for any API or network failure. */
export function messageOf(e: unknown): string {
  if (e instanceof ApiError) return e.problem.detail ?? e.problem.title;
  return (e as Error)?.message ?? "Something went wrong";
}
