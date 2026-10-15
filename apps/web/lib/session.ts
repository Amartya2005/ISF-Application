"use client";
import { createSession } from "@sj/web-session";

export const { api, authMode, startSignIn, verifyCode, signOut, useSessionEmail } = createSession({
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
  authMode: process.env.NEXT_PUBLIC_AUTH_MODE === "supabase" ? "supabase" : "dev",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  storageKey: "sj.web.session",
});
