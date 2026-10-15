# Device test protocol: mobile sessions and sign-in on real phones (launch checklist §B)

The keychain session store is unit-tested (`apps/mobile/lib/chunked-store.test.ts`). Unit tests cannot prove what happens on real devices: OS keychain behaviour, background token refresh, app kills and reinstalls. Run this protocol against **staging** on at least one iPhone and one Android phone, and record the results in the table at the end.

## Setup

- A staging build of the app with `EXPO_PUBLIC_AUTH_MODE=supabase`, `EXPO_PUBLIC_API_URL` set to the staging API, and the staging Supabase URL and anon key. Use an EAS development or preview build. Expo Go is acceptable for a first pass.
- On staging Supabase, shorten the **JWT expiry to 300 seconds** for the test run, so that refresh happens within minutes. Restore it afterwards.
- Run `pnpm --filter @sj/api staging:verify` first. It covers the server side: OTP sessions, refresh, sign-out revocation, linking refusal and TOTP MFA. See [docs/STAGING.md](/docs/STAGING.md) for its settings.

## Cases

| # | Steps | Expected |
|---|---|---|
| D1 | Sign in with **email OTP** using a real inbox (Gmail, Outlook and an institutional address). | The code email arrives within a minute and not in spam, from the configured sender. The home screen shows your roles. *(`staging:verify` does not prove delivery: it issues codes via the Admin API.)* |
| D2 | Sign in with **SMS OTP** on real SIMs (Jio, Airtel, Vi, BSNL). | The SMS arrives from the DLT-approved sender with the approved template. Home loads. Registering stores the verified number; no email is stored. *(A Supabase test number does not prove carrier delivery or DLT setup.)* |
| D3 | Force-quit the app and reopen it. | Still signed in, no code requested. The session is read from the keychain. |
| D4 | Leave the app in the background past the JWT expiry (more than 5 minutes), then reopen it and open Messages. | Loads without signing in again (automatic refresh). |
| D5 | Turn on airplane mode, reopen the app, wait past expiry, then turn airplane mode off and pull to refresh or reopen. | Recovers without a crash. If the refresh token was rejected, a clean sign-out, never a stuck screen. |
| D6 | Restart the phone, then open the app. | Still signed in. On Android, the keystore entries survive the reboot. |
| D7 | **Sign out**, then force-quit and reopen. | Signed out. On staging Supabase the session is revoked (check Auth → Users → sessions). |
| D8 | Sign in, then **uninstall and reinstall** the app. | Android: signed out (keystore removed with the app). **iOS: the keychain can survive reinstall**, so the app may come back signed in. Record what happens and decide (see the note below). |
| D9 | An imported participant signs in with the email or mobile the organisers hold, then enters the activation code. | The account becomes active, and the role and 2026 event card appear. Re-entering the code is refused. |
| D10 | A staff-only account (Admin, Management or Support) signs in to the app. | The home screen says staff work is done in the web console. No privileged data appears. |
| D11 | Staff MFA on a phone browser: open the **console** in Safari (iOS) and Chrome (Android), sign in as staff, then enrol and verify an authenticator code. | Privileged sections appear only after verifying. Signing out and back in asks for the code again. |
| D12 | Revoke the account's role in the console while the app is open, then refresh the app. | Role-based content disappears on the next request. |

**Note on D8 (iOS keychain persistence).** If the organisers want a reinstall to always sign the person out, add a first-launch check: keep a marker in app storage, which iOS deletes on uninstall, and clear the keychain session when the marker is missing. The current build does **not** do this; decide before launch.

## Results

| Case | iPhone (model, iOS) | Android (model, version) | Tester | Date | Notes |
|---|---|---|---|---|---|
| D1–D12 | | | | | |
