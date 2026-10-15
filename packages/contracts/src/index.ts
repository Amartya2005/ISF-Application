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
    /** false while the exact cut-off time is still provisional (PRD TBD-11 / TBD-05). */
    closesAtConfirmed: z.boolean(),
  }),
});
export type PublicEdition = z.infer<typeof PublicEdition>;

// ---------------------------------------------------------------- registration (PRD §6, FR-REG-*)
export const YearOption = z.enum(["2026", "2027", "both"]);
export type YearOption = z.infer<typeof YearOption>;

export function yearsFor(option: YearOption): EditionYear[] {
  return option === "both" ? [2026, 2027] : [Number(option) as EditionYear];
}

/** The privacy notice version shown at registration. Text is pending legal review (PRD TBD-32). */
export const PRIVACY_NOTICE_VERSION = "draft-2026-10-15";

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);

/**
 * Minimal registration form. The final field list depends on the evaluation criteria (PRD TBD-39);
 * additional fields travel in `formAnswers` so they can be added without a schema migration.
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
  formAnswers: z.record(z.string().max(64), z.union([z.string().max(5000), z.number(), z.boolean()])).optional(),
  privacyNoticeAccepted: z.literal(true, { message: "You must accept the privacy notice" }),
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
});
export type ManageApplication = z.infer<typeof ManageApplication>;

export const ManageApplicationList = z.object({
  edition: z.number().int(),
  counts: z.record(z.string(), z.number()),
  selectionLimit: z.number().int().nullable(),
  /** Selected (released) plus drafted-as-selected; compared with the limit for a warning only (TBD-19). */
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
});
export type MeResponse = z.infer<typeof MeResponse>;

export const ActivationRequest = z.object({ token: z.string().trim().min(20).max(200) });
export type ActivationRequest = z.infer<typeof ActivationRequest>;

// ---------------------------------------------------------------- bulk import (PRD §5, FR-IMP-*)
export const IMPORT_CATEGORIES = ["startups", "jury", "volunteers", "delegates"] as const;
export type ImportCategory = (typeof IMPORT_CATEGORIES)[number];

/**
 * PROVISIONAL CSV columns until the organising team's data format is agreed (TBD-41).
 * Every row: full_name, plus email and/or mobile (sign-in identifier is TBD-12). Startups add startup_name and
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
  /** Delivery channel is TBD-13: until then the Admin hands this to the participant. */
  delivery: z.literal("manual"),
});
export type ActivationIssued = z.infer<typeof ActivationIssued>;
