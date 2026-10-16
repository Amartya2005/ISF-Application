// Phase 10 load test (TBD-33, NFR-01/04, AT-35): the registration-close and event-morning journeys, at the
// design load (3,000 accounts / 600 concurrent) and at the required load-test multiple (2x: 1,200 VUs for 15
// minutes). Thresholds mirror TBD-33: p95 < 500ms on authenticated reads, error rate < 1%.
//
// THIS SCRIPT IS PREPARED, NOT EXECUTED AGAINST REAL INFRASTRUCTURE. Running it against a real staging or
// production deployment is Phase 10 work that still needs: an ISF-owned staging/production environment sized per
// TBD-33 (TBD-36, TBD-46), and either a pool of pre-minted staging bearer tokens (BEARER_TOKENS_FILE below) or a
// disposable dev-mode target. It has only been run as a local mechanical smoke test against the dev stack at a
// small scale (see the README section this script is documented under) to prove the script itself works; that
// smoke run is NOT the TBD-33 load test and proves nothing about real infrastructure's capacity.
//
// Usage (install k6: https://k6.io/docs/get-started/installation/):
//   BASE_URL=https://staging-api.example.org BEARER_TOKENS_FILE=./tokens.txt \
//     k6 run scripts/load_test.js
//
//   # Local mechanical smoke test only (never against staging/production: DEV_AUTH mints sessions with no OTP,
//   # which only a dev-mode target accepts; staging and production run AUTH_MODE=supabase and refuse it):
//   BASE_URL=http://localhost:4000 DEV_AUTH=true VUS=10 DURATION=20s RAMP=5s k6 run scripts/load_test.js
//
// Env vars:
//   BASE_URL           API base URL (required).
//   EVENT_YEAR          Edition year to read event info for (default 2026).
//   SCENARIO            "registration_close" | "event_morning" | "both" (default "both").
//   VUS                 Peak virtual users for the held stage (default 1200, the TBD-33 load-test target).
//   DURATION            How long to hold the peak (default "15m", the TBD-33 target).
//   RAMP                Ramp-up and ramp-down duration either side of the peak (default "2m"; shorten for a quick
//                       local smoke test — the TBD-33 target itself does not specify a ramp time).
//   BEARER_TOKENS_FILE  Path to a newline-delimited file of pre-minted bearer tokens (one per participant
//                       account). Required against any real (non-dev-mode) environment.
//   DEV_AUTH            "true" to mint sessions via POST /v1/dev/session instead (dev-mode targets only).
import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";

const BASE_URL = __ENV.BASE_URL || "";
if (!BASE_URL) throw new Error("Set BASE_URL to the target API.");
const YEAR = Number(__ENV.EVENT_YEAR || 2026);
const SCENARIO = __ENV.SCENARIO || "both";
const PEAK_VUS = Number(__ENV.VUS || 1200);
const PEAK_DURATION = __ENV.DURATION || "15m";
const RAMP = __ENV.RAMP || "2m";
const DEV_AUTH = (__ENV.DEV_AUTH || "false") === "true";
const TOKENS_FILE = __ENV.BEARER_TOKENS_FILE || "";

const tokenPool = TOKENS_FILE
  ? new SharedArray("bearer-tokens", () => open(TOKENS_FILE).split("\n").map((s) => s.trim()).filter(Boolean))
  : null;

const wantRegistration = SCENARIO === "both" || SCENARIO === "registration_close";
const wantEventMorning = SCENARIO === "both" || SCENARIO === "event_morning";

// Ramp up, hold at the TBD-33 target, ramp down — rather than a flat step, which would understate connection and
// cold-start cost at the actual registration-close and event-morning spikes.
const stages = [
  { duration: RAMP, target: PEAK_VUS },
  { duration: PEAK_DURATION, target: PEAK_VUS },
  { duration: RAMP, target: 0 },
];

export const options = {
  scenarios: {
    ...(wantRegistration ? { registration_close: { executor: "ramping-vus", exec: "registrationClose", startVUs: 0, stages, gracefulRampDown: "30s" } } : {}),
    ...(wantEventMorning ? { event_morning: { executor: "ramping-vus", exec: "eventMorning", startVUs: 0, stages, gracefulRampDown: "30s" } } : {}),
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],          // TBD-33: errors below 1%
    "http_req_duration{journey:read}": ["p(95)<500"],   // TBD-33: p95 below 500ms for authenticated reads
  },
};

function authHeaders(vuToken) {
  return { headers: { authorization: `Bearer ${vuToken}`, "content-type": "application/json" } };
}

/** One bearer token per VU, minted or looked up once and reused for the VU's whole run (mirrors a real session). */
function tokenForThisVu() {
  if (tokenPool && tokenPool.length > 0) return tokenPool[(__VU - 1) % tokenPool.length];
  if (DEV_AUTH) {
    const email = `loadtest-vu${__VU}@loadtest.local`;
    const res = http.post(`${BASE_URL}/v1/dev/session`, JSON.stringify({ email }), { headers: { "content-type": "application/json" } });
    check(res, { "dev session issued": (r) => r.status === 200 });
    return res.json("token");
  }
  throw new Error("No token source: set BEARER_TOKENS_FILE (real environments) or DEV_AUTH=true (dev-mode targets only).");
}

let cachedToken = null;
function token() {
  if (!cachedToken) cachedToken = tokenForThisVu();
  return cachedToken;
}

/** Registration-close journey: a participant account checking editions, their own applications, then submitting. */
export function registrationClose() {
  const t = token();
  const pub = http.get(`${BASE_URL}/v1/public/editions`, { tags: { journey: "read" } });
  check(pub, { "editions 200": (r) => r.status === 200 });

  const mine = http.get(`${BASE_URL}/v1/me/applications`, { ...authHeaders(t), tags: { journey: "read" } });
  check(mine, { "my applications 200": (r) => r.status === 200 });
  sleep(1);

  // A submission attempt: most VUs already have an application (seeded or from an earlier iteration), so a
  // duplicate/validation 4xx here is an expected, not a failed, outcome under load — only 5xx and timeouts count
  // against the error-rate threshold below.
  const body = JSON.stringify({
    yearOption: String(YEAR) === "2027" ? "2027" : "2026",
    startup: { name: `Load Test Co ${__VU}-${__ITER}`, description: "Synthetic startup created by the Phase 10 load-test script (TBD-33).", city: "Load", state: "Test" },
    leader: { fullName: `Load Test Leader ${__VU}`, mobile: `+9199${String(10000000 + __VU).padStart(8, "0")}` },
    privacyNoticeAccepted: true,
    adultDeclaration: true,
  });
  // Any non-5xx is an acceptable business outcome here (most VUs already have an application after their first
  // iteration, so a validation 4xx is expected, not a service failure) — only a 5xx counts against http_req_failed.
  const reg = http.post(`${BASE_URL}/v1/me/registrations`, body, {
    ...authHeaders(t), tags: { journey: "write" }, responseCallback: http.expectedStatuses({ min: 200, max: 499 }),
  });
  check(reg, { "registration 2xx or an expected validation 4xx": (r) => r.status < 500 });
  sleep(2);
}

/** Event-morning journey: a signed-in participant reading event info, notices and their own tickets. */
export function eventMorning() {
  const t = token();
  // 403 is expected, not a failure, for a token with no edition access (e.g. a synthetic DEV_AUTH account in the
  // local smoke test, which has no registration/role grants) — expectedStatuses keeps it out of http_req_failed.
  const event = http.get(`${BASE_URL}/v1/editions/${YEAR}/event`, {
    ...authHeaders(t), tags: { journey: "read" }, responseCallback: http.expectedStatuses(200, 403, 404),
  });
  check(event, { "event info 200, 403 (no edition access) or 404 (pre-publish)": (r) => [200, 403, 404].includes(r.status) });

  const notifications = http.get(`${BASE_URL}/v1/me/notifications`, { ...authHeaders(t), tags: { journey: "read" } });
  check(notifications, { "notifications 200": (r) => r.status === 200 });
  sleep(1);

  const me = http.get(`${BASE_URL}/v1/me`, { ...authHeaders(t), tags: { journey: "read" } });
  check(me, { "me 200": (r) => r.status === 200 });

  const tickets = http.get(`${BASE_URL}/v1/me/tickets`, { ...authHeaders(t), tags: { journey: "read" } });
  check(tickets, { "my tickets 200": (r) => r.status === 200 });
  sleep(2);
}
