// Role → permission mapping. Default deny: a route without a matching permission is not reachable.
// Grows milestone by milestone; mirrors the PRD role-permission matrix (§4.4). Every entry is test-covered.
import type { Role } from "@sj/contracts";

export type Permission =
  // any signed-in user (M1)
  | "registration.submit"
  | "application.read_own"
  | "notification.read_own"
  | "application.withdraw_own"
  // management (M1)
  | "application.read_all"
  | "decision.draft"
  | "decision.release"
  | "selection_limit.configure"
  // management (Phase 5: AI ranking, corrections)
  | "criteria.manage"
  | "ranking.run"
  | "ranking.read"
  | "decision.correct"
  // Phase 6: jury evaluation (FR-JRY-*) — Management configures and reviews; jurors evaluate their own assignments
  | "jury.manage"
  | "jury.review"
  | "jury.evaluate"
  // Phase 6: volunteer assignment (FR-VOL-*, PRD §4.4 matrix)
  | "volunteer.read"
  | "volunteer.generate"
  | "volunteer.review"
  | "volunteer.reassign"
  | "volunteer.my_assignment"
  | "volunteer.my_volunteer"
  // admin (Phase 3)
  | "import.manage"
  | "user.read"
  | "user.manage"
  | "role.assign"
  | "activation.issue";

/** Granted to every authenticated principal regardless of role. */
export const AUTHENTICATED: ReadonlySet<Permission> = new Set(["registration.submit", "application.read_own", "notification.read_own", "application.withdraw_own"]);

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  // FR-IAM-06: Admin holds NO management permissions unless also granted the `management` role.
  // RQ §9: the Admin initiates or oversees volunteer assignment; saving (review) and reassignment are Management's.
  admin: ["import.manage", "user.read", "user.manage", "role.assign", "activation.issue", "volunteer.read", "volunteer.generate"],
  management: [
    "application.read_all", "decision.draft", "decision.release", "selection_limit.configure",
    "criteria.manage", "ranking.run", "ranking.read", "decision.correct",
    "jury.manage", "jury.review",
    "volunteer.read", "volunteer.generate", "volunteer.review", "volunteer.reassign",
  ],
  // Participant permissions are further limited to the caller's own startup, assignments and edition on the server.
  startup_team_leader: ["volunteer.my_volunteer"],
  startup_team_member: [],
  jury_member: ["jury.evaluate", "volunteer.my_volunteer"],
  volunteer: ["volunteer.my_assignment"],
  delegate: [],
  customer_support: [],
};

/** Roles whose permissions require an MFA (aal2) session when REQUIRE_STAFF_MFA=true (FR-IAM-11). */
export const STAFF_ROLES: ReadonlySet<Role> = new Set(["admin", "management", "customer_support"]);
