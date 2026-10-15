import { router } from "expo-router";
import { useState } from "react";
import { Button, Field, H1, Notice, P, Screen } from "../components/ui";
import { messageOf, useSession } from "../lib/session";

export default function SignIn() {
  const { startSignIn, verifyCode, authMode } = useSession();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = /^\S+@\S+\.\S+$/.test(email.trim());

  async function go(fn: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  }

  return (
    <Screen>
      <H1>Startup Jathara</H1>
      <P muted>@ Dandakaranya · 18–20 December 2026 · GIET University, Gunupur</P>
      <P>Sign in with your email. If the event team registered you, use the email they hold for you.</P>
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address"
        textContentType="emailAddress" editable={!sent} returnKeyType="go" />
      {sent && (
        <Field label="Code from your email" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" />
      )}
      {error && <Notice kind="error">{error}</Notice>}
      {!sent ? (
        <Button title="Continue" busy={busy} disabled={!valid}
          onPress={() => void go(async () => {
            const r = await startSignIn(email);
            if (r === "code_sent") setSent(true); else router.replace("/");
          })} />
      ) : (
        <Button title="Sign in" busy={busy} disabled={code.trim().length < 6}
          onPress={() => void go(async () => { await verifyCode(email, code); router.replace("/"); })} />
      )}
      {authMode === "dev" && <P muted small>Development sign-in: no code is needed. Use test data only.</P>}
    </Screen>
  );
}
