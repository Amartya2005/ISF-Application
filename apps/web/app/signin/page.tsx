"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { authMode, startSignIn, verifyCode } from "@/lib/session";

function SignInForm() {
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/status";
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (stage === "email") {
        const r = await startSignIn(email.trim());
        if (r === "signed_in") router.push(next);
        else setStage("code");
      } else {
        await verifyCode(email.trim(), code.trim());
        router.push(next);
      }
    } catch (err) {
      setError((err as Error).message || "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ maxWidth: 420 }}>
      <h1>Sign in</h1>
      <p className="muted">
        {stage === "email"
          ? "Enter your email. We use it to identify your application and send you updates."
          : `Enter the code we sent to ${email}.`}
      </p>
      {authMode === "dev" && <p className="notice notice-warn small">Development sign-in: no code is sent. Never enabled in production.</p>}
      {stage === "email" ? (
        <label>Email<input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      ) : (
        <label>One-time code<input type="text" inputMode="numeric" required value={code} onChange={(e) => setCode(e.target.value)} /></label>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div><button className="btn btn-primary" disabled={busy}>{stage === "email" ? "Continue" : "Verify and sign in"}</button></div>
    </form>
  );
}

export default function SignInPage() {
  return <Suspense><SignInForm /></Suspense>;
}
