"use client";
import { createSession } from "@sj/web-session";

// Staff MFA (aal2) for Supabase mode is added with role administration in M2 (backlog B-10).
export const { api, authMode, startSignIn, verifyCode, signOut, useSessionEmail } = createSession({
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
  authMode: process.env.NEXT_PUBLIC_AUTH_MODE === "supabase" ? "supabase" : "dev",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  storageKey: "sj.console.session",
});
