// Shared API contracts (Zod schemas + types) for the API, website, console and mobile app.
// Keep this a single file with no relative imports so every consumer (Node, Next.js, Expo) can load it as source.
import { z } from "zod";

// ---------------------------------------------------------------- common
export const EDITION_YEARS = [2026, 2027] as const;
export type EditionYear = (typeof EDITION_YEARS)[number];

export const ROLES = [
  "admin",
  "management",
  "startup_team_leader",
  "startup_team_member",
  "jury_member",
  "volunteer",
  "delegate",
  "customer_support",
] as const;
export type Role = (typeof ROLES)[number];

/** RFC 9457 problem details returned for every error. `code` is stable and safe to switch on. */
export type Problem = {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  errors?: { path: string; message: string }[];
  [k: string]: unknown;
};

/** Normalise an Indian 10-digit mobile or an international number to E.164; returns null if invalid. */
export function normaliseMobile(input: string): string | null {
  const s = input.replace(/[\s\-().]/g, "");
  if (/^[6-9]\d{9}$/.test(s)) return `+91${s}`;
  if (/^0[6-9]\d{9}$/.test(s)) return `+91${s.slice(1)}`;
  if (/^91[6-9]\d{9}$/.test(s)) return `+${s}`;
  if (/^\+[1-9]\d{7,14}$/.test(s)) return s;
  return null;
}

// ---------------------------------------------------------------- application form (edition configuration, TBD-39)
/** One question on the application form. Stored per edition in the database (migration 0007), never in client code. */
export const FormQuestion = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  label: z.string().min(1).max(300),
  help: z.string().max(300).optional(),
  minLength: z.number().int().min(0).max(5000),
  maxLength: z.number().int().min(1).max(5000),
});
export type FormQuestion = z.infer<typeof FormQuestion>;

export const ApplicationForm = z.object({ version: z.string().min(1).max(40), questions: z.array(FormQuestion).max(30) });
export type ApplicationForm = z.infer<typeof ApplicationForm>;

/**
 * The questions an applicant must answer for the chosen editions: the union by key. A key asked by several editions is
 * answered once and must satisfy every edition's limits.
 */
export function mergeQuestions(forms: ApplicationForm[]): FormQuestion[] {
  const byKey = new Map<string, FormQuestion>();
  for (const q of forms.flatMap((f) => f.questions)) {
    const prev = byKey.get(q.key);
    byKey.set(q.key, prev
      ? { ...prev, minLength: Math.max(prev.minLength, q.minLength), maxLength: Math.min(prev.maxLength, q.maxLength) }
      : q);
  }
  return [...byKey.values()];
}

/** Field errors (paths `formAnswers.<key>`) for answers checked against the questions; unknown keys are rejected. */
export function checkFormAnswers(questions: FormQuestion[], answers: Record<string, string>): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  const known = new Set(questions.map((q) => q.key));
  for (const k of Object.keys(answers)) if (!known.has(k)) issues.push({ path: `formAnswers.${k}`, message: "This question is not on the form" });
  for (const q of questions) {
    const v = (answers[q.key] ?? "").trim();
    if (v.length < Math.max(q.minLength, 1)) issues.push({ path: `formAnswers.${q.key}`, message: `Answer this question (at least ${Math.max(q.minLength, 1)} characters)` });
    else if (v.length > q.maxLength) issues.push({ path: `formAnswers.${q.key}`, message: `Use at most ${q.maxLength} characters` });
  }
  return issues;
}

// ---------------------------------------------------------------- public editions
export const PublicEdition = z.object({
  year: z.number().int(),
  name: z.string(),
  preEventOn: z.string().nullable(),
  eventStartsOn: z.string().nullable(),
  eventEndsOn: z.string().nullable(),
  registration: z.object({
    open: z.boolean(),
    closesAt: z.string().nullable(),
    /** false until the organisers confirm the cut-off in writing (TBD-11: 23:59:59 IST recommended, docs/DECISIONS.md). */
    closesAtConfirmed: z.boolean(),
  }),
  applicationForm: ApplicationForm,
});
export type PublicEdition = z.infer<typeof PublicEdition>;

// ---------------------------------------------------------------- registration (PRD §6, FR-REG-*)
export const YearOption = z.enum(["2026", "2027", "both"]);
export type YearOption = z.infer<typeof YearOption>;

export function yearsFor(option: YearOption): EditionYear[] {
  return option === "both" ? [2026, 2027] : [Number(option) as EditionYear];
}

/** The privacy notice version shown at registration. Draft text (docs/PRIVACY_NOTICE_DRAFT.md) awaits legal approval (TBD-32). */
export const PRIVACY_NOTICE_VERSION = "draft-2026-10-15";

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);

/**
 * Registration form (TBD-39, docs/DECISIONS.md): fixed core fields plus `formAnswers`, the text answers to the edition's
 * configured questions (`PublicEdition.applicationForm`). The API checks answers against that configuration and rejects
 * unknown keys. No uploads and no links beyond the optional website.
 */
export const RegistrationRequest = z.object({
  yearOption: YearOption,
  startup: z.object({
    name: trimmed(2, 200),
    description: trimmed(20, 5000),
    website: z.string().trim().url().max(300).optional().or(z.literal("").transform(() => undefined)),
    city: trimmed(1, 100).optional(),
    state: trimmed(1, 100).optional(),
  }),
  leader: z.object({
    fullName: trimmed(1, 200),
    mobile: z
      .string()
      .trim()
      .transform((v, ctx) => {
        const n = normaliseMobile(v);
        if (!n) {
          ctx.addIssue({ code: "custom", message: "Enter a valid mobile number" });
          return z.NEVER;
        }
        return n;
      }),
  }),
  formAnswers: z.record(z.string().max(64), z.string().max(5000)).optional(),
  privacyNoticeAccepted: z.literal(true, { message: "You must accept the privacy notice" }),
  /** TBD-45: the platform is for adults; the registering leader confirms they are 18 or older. No date of birth is collected. */
  adultDeclaration: z.literal(true, { message: "You must confirm that you are 18 or older" }),
});
export type RegistrationRequest = z.input<typeof RegistrationRequest>;

/** What applicants may see. Internal states and unreleased drafts collapse to "under_review" (FR-SEL-09). */
export const ApplicantStatus = z.enum(["under_review", "selected", "not_selected"]);
export type ApplicantStatus = z.infer<typeof ApplicantStatus>;

export const INTERNAL_STATUSES = [
  "submitted",
  "under_ai_evaluation",
  "ranked",
  "flagged_manual_review",
  "decision_drafted",
  "selected",
  "not_selected",
] as const;
export type InternalStatus = (typeof INTERNAL_STATUSES)[number];

export function applicantStatus(s: InternalStatus): ApplicantStatus {
  return s === "selected" || s === "not_selected" ? s : "under_review";
}

export const MyApplication = z.object({
  id: z.string(),
  edition: z.number().int(),
  status: ApplicantStatus,
  submittedAt: z.string(),
  decidedAt: z.string().nullable(),
});
export type MyApplication = z.infer<typeof MyApplication>;

export const MyApplicationsResponse = z.object({
  startup: z.object({ id: z.string(), name: z.string() }).nullable(),
  applications: z.array(MyApplication),
});
export type MyApplicationsResponse = z.infer<typeof MyApplicationsResponse>;

export const RegistrationResponse = MyApplicationsResponse.extend({ startupReused: z.boolean() });
export type RegistrationResponse = z.infer<typeof RegistrationResponse>;

// ---------------------------------------------------------------- management (PRD §7, FR-SEL-*)
export const DecisionRequest = z.object({
  outcome: z.enum(["selected", "not_selected"]),
  reason: z.string().trim().max(2000).optional(),
});
export type DecisionRequest = z.infer<typeof DecisionRequest>;

export const ReleaseRequest = z.object({
  applicationIds: z.array(z.string().uuid()).min(1).max(500).optional(),
  /**
   * TBD-19: a release that would take the edition above its selection limit is refused (409 selection_limit_exceeded)
   * unless the manager explicitly confirms it with this flag. The confirmation is audited.
   */
  confirmOverLimit: z.boolean().optional(),
});
export type ReleaseRequest = z.infer<typeof ReleaseRequest>;

export const SelectionLimitRequest = z.object({ limit: z.number().int().positive().max(10000).nullable() });

export const ManageApplication = z.object({
  id: z.string(),
  edition: z.number().int(),
  status: z.enum(INTERNAL_STATUSES),
  flags: z.array(z.string()),
  submittedAt: z.string(),
  startup: z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    website: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
  }),
  leader: z.object({ id: z.string(), fullName: z.string(), email: z.string().nullable(), mobile: z.string().nullable() }),
  otherEditions: z.array(z.object({ edition: z.number().int(), status: z.enum(INTERNAL_STATUSES) })),
  decision: z
    .object({
      outcome: z.enum(["selected", "not_selected"]),
      reason: z.string().nullable(),
      decidedBy: z.string(),
      decidedAt: z.string(),
      releasedAt: z.string().nullable(),
    })
    .nullable(),
  formAnswers: z.record(z.string(), z.unknown()),
  /** Version of the edition's application form this application answered (null for applications made before 0007). */
  formVersion: z.string().nullable(),
});
export type ManageApplication = z.infer<typeof ManageApplication>;

export const ManageApplicationList = z.object({
  edition: z.number().int(),
  counts: z.record(z.string(), z.number()),
  selectionLimit: z.number().int().nullable(),
  /** Selected (released) plus drafted-as-selected. Releasing above the limit needs explicit confirmation (TBD-19). */
  selectedTotal: z.number().int(),
  items: z.array(ManageApplication),
});
export type ManageApplicationList = z.infer<typeof ManageApplicationList>;

export const ReleaseResponse = z.object({
  released: z.number().int(),
  selected: z.number().int(),
  notSelected: z.number().int(),
  warnings: z.array(z.string()),
});
export type ReleaseResponse = z.infer<typeof ReleaseResponse>;

export const NotificationItem = z.object({
  id: z.string(),
  edition: z.number().int().nullable(),
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  createdAt: z.string(),
  readAt: z.string().nullable(),
});
export type NotificationItem = z.infer<typeof NotificationItem>;

// ---------------------------------------------------------------- my account (all interfaces)
export const ACCOUNT_STATUSES = ["pending_activation", "active", "deactivated"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** Who the caller is. Pending accounts get `status` only: no roles or access until activated. */
export const MeResponse = z.object({
  account: z
    .object({ id: z.string(), email: z.string().nullable(), fullName: z.string(), mobile: z.string().nullable(), status: z.enum(ACCOUNT_STATUSES) })
    .nullable(),
  roles: z.array(z.enum(ROLES)),
  editionAccess: z.array(z.number().int()),
  permissions: z.array(z.string()),
  /** True when some of the caller's roles are withheld until they complete multi-factor authentication (aal2). */
  mfaRequired: z.boolean(),
});
export type MeResponse = z.infer<typeof MeResponse>;

export const ActivationRequest = z.object({ token: z.string().trim().min(20).max(200) });
export type ActivationRequest = z.infer<typeof ActivationRequest>;

// ---------------------------------------------------------------- bulk import (PRD §5, FR-IMP-*)
export const IMPORT_CATEGORIES = ["startups", "jury", "volunteers", "delegates"] as const;
export type ImportCategory = (typeof IMPORT_CATEGORIES)[number];

/**
 * CSV column set v1 (TBD-41, docs/DECISIONS.md): recommended format, awaiting the organisers' sign-off on a real sample.
 * Every row: full_name, plus email and/or mobile (both recommended; TBD-12). Startups add startup_name and
 * position (leader | member), plus optional startup details. No password column is ever accepted (FR-IMP-07).
 */
export const IMPORT_COLUMNS: Record<ImportCategory, { required: string[]; optional: string[] }> = {
  startups: { required: ["startup_name", "position", "full_name"], optional: ["email", "mobile", "description", "website", "city", "state"] },
  jury: { required: ["full_name"], optional: ["email", "mobile"] },
  volunteers: { required: ["full_name"], optional: ["email", "mobile"] },
  delegates: { required: ["full_name"], optional: ["email", "mobile"] },
};

export const ImportPreviewRequest = z.object({
  category: z.enum(IMPORT_CATEGORIES),
  edition: z.number().int().min(2026).max(2100),
  fileName: z.string().trim().min(1).max(200),
  /** UTF-8 CSV text with a header row. */
  csv: z.string().min(1).max(2_000_000),
});
export type ImportPreviewRequest = z.infer<typeof ImportPreviewRequest>;

export const ImportIssue = z.object({ field: z.string(), reason: z.string() });
export type ImportIssue = z.infer<typeof ImportIssue>;

export const ImportRow = z.object({
  rowNumber: z.number().int(),
  data: z.record(z.string(), z.string()),
  outcome: z.enum(["valid", "invalid", "duplicate", "created", "linked", "excluded"]),
  action: z.enum(["create", "link"]).nullable(),
  errors: z.array(ImportIssue),
  warnings: z.array(ImportIssue),
});
export type ImportRow = z.infer<typeof ImportRow>;

export const ImportBatch = z.object({
  id: z.string(),
  category: z.enum(IMPORT_CATEGORIES),
  edition: z.number().int(),
  fileName: z.string(),
  fileSha256: z.string(),
  state: z.enum(["previewed", "committed", "discarded"]),
  uploadedBy: z.string(),
  uploadedAt: z.string(),
  committedAt: z.string().nullable(),
  rowCount: z.number().int(),
  errorCount: z.number().int(),
  summary: z.record(z.string(), z.number()),
});
export type ImportBatch = z.infer<typeof ImportBatch>;

export const ImportBatchDetail = ImportBatch.extend({ rows: z.array(ImportRow) });
export type ImportBatchDetail = z.infer<typeof ImportBatchDetail>;

export const ImportCommitRequest = z.object({
  /** Row numbers the Admin chose to leave out of this commit. */
  excludeRows: z.array(z.number().int().positive()).max(10000).optional(),
});
export type ImportCommitRequest = z.infer<typeof ImportCommitRequest>;

// ---------------------------------------------------------------- account administration (FR-IAM-05, -06, -09)
export const AdminUser = z.object({
  id: z.string(),
  email: z.string().nullable(),
  fullName: z.string(),
  mobile: z.string().nullable(),
  status: z.enum(ACCOUNT_STATUSES),
  signInLinked: z.boolean(),
  createdAt: z.string(),
  activatedAt: z.string().nullable(),
  roles: z.array(z.object({ grantId: z.string(), role: z.enum(ROLES), edition: z.number().int().nullable(), grantedAt: z.string() })),
  editionAccess: z.array(z.object({ edition: z.number().int(), source: z.enum(["predefined", "selected"]) })),
  activation: z.object({ issuedAt: z.string(), expiresAt: z.string() }).nullable(),
});
export type AdminUser = z.infer<typeof AdminUser>;

export const AdminUserList = z.object({ total: z.number().int(), items: z.array(AdminUser) });
export type AdminUserList = z.infer<typeof AdminUserList>;

export const RoleGrantRequest = z.object({ role: z.enum(ROLES), edition: z.number().int().min(2026).max(2100).nullable().optional() });
export type RoleGrantRequest = z.infer<typeof RoleGrantRequest>;

export const ActivationIssued = z.object({
  /** Shown once. Only its hash is stored. */
  token: z.string(),
  expiresAt: z.string(),
  /** TBD-13: automated delivery to the participant's own email or mobile follows once providers are contracted; until then the Admin hands it over. */
  delivery: z.literal("manual"),
});
export type ActivationIssued = z.infer<typeof ActivationIssued>;

// ---------------------------------------------------------------- sign-in identifier (TBD-12: both; SMS once DLT is approved)
export const SIGN_IN_METHODS = ["email", "phone"] as const;
export type SignInMethod = (typeof SIGN_IN_METHODS)[number];
export type SignInIdentifier = { email: string } | { phone: string };

/**
 * Which one-time-code channels an environment offers, from a comma list such as "email,phone".
 * TBD-12 (docs/DECISIONS.md): email and mobile. Deployed environments set the list explicitly: `email` until the
 * DLT-registered SMS sender is live, then `email,phone`. Unset (local development) allows both.
 * Unknown values are ignored; an empty or invalid list falls back to email only.
 */
export function parseSignInMethods(value: string | undefined | null): SignInMethod[] {
  if (value === undefined || value === null || value.trim() === "") return ["email", "phone"];
  const picked = SIGN_IN_METHODS.filter((m) => value.split(",").map((s) => s.trim().toLowerCase()).includes(m));
  return picked.length ? picked : ["email"];
}

export const DevSessionRequest = z
  .object({
    email: z.string().trim().toLowerCase().email().optional(),
    phone: z.string().trim().optional(),
    mfa: z.boolean().optional(),
  })
  .refine((b) => !!b.email !== !!b.phone, { message: "Provide either an email or a mobile number" });
export type DevSessionRequest = z.input<typeof DevSessionRequest>;

// ---------------------------------------------------------------- post-sign-in redirects (open-redirect protection)
/** Internal destinations each web interface may return to after sign-in or MFA. Anything else falls back. */
export const WEB_RETURN_PATHS = ["/", "/register", "/status", "/activate", "/privacy"] as const;
export const CONSOLE_RETURN_PATHS = ["/", "/applications", "/users", "/imports"] as const;

const REDIRECT_BASE = "https://internal.invalid";

/**
 * Returns `next` only if it is a same-origin path on the allow-list (exact path or a sub-path of an entry);
 * otherwise `fallback`. Rejects absolute and scheme URLs, protocol-relative `//host`, backslashes, control
 * characters and anything that resolves to another origin, so a crafted sign-in or MFA link cannot send a
 * freshly authenticated user to an external site.
 */
export function safeReturnPath(next: string | null | undefined, allowed: readonly string[], fallback: string): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 512) return fallback;
  // eslint-disable-next-line no-control-regex
  if (!next.startsWith("/") || next.startsWith("//") || /[\\\u0000-\u001F\u007F]/.test(next)) return fallback;
  let url: URL;
  try {
    url = new URL(next, REDIRECT_BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== REDIRECT_BASE) return fallback;
  const path = url.pathname;
  const permitted = allowed.some((p) => (p === "/" ? path === "/" : path === p || path.startsWith(`${p}/`)));
  return permitted ? `${path}${url.search}${url.hash}` : fallback;
}
