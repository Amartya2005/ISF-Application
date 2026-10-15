// Role → permission mapping. Default deny: a route without a matching permission is not reachable.
// Grows milestone by milestone; mirrors the PRD role-permission matrix (§4.4). Every entry is test-covered.
import type { Role } from "@sj/contracts";

export type Permission =
  // any signed-in user (M1)
  | "registration.submit"
  | "application.read_own"
  | "notification.read_own"
  // management (M1)
  | "application.read_all"
  | "decision.draft"
  | "decision.release"
  | "selection_limit.configure"
  // admin (Phase 3)
  | "import.manage"
  | "user.read"
  | "user.manage"
  | "role.assign"
  | "activation.issue";

/** Granted to every authenticated principal regardless of role. */
export const AUTHENTICATED: ReadonlySet<Permission> = new Set(["registration.submit", "application.read_own", "notification.read_own"]);

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  // FR-IAM-06: Admin holds NO management permissions unless also granted the `management` role.
  admin: ["import.manage", "user.read", "user.manage", "role.assign", "activation.issue"],
  management: ["application.read_all", "decision.draft", "decision.release", "selection_limit.configure"],
  startup_team_leader: [],
  startup_team_member: [],
  jury_member: [],
  volunteer: [],
  delegate: [],
  customer_support: [],
};

/** Roles whose permissions require an MFA (aal2) session when REQUIRE_STAFF_MFA=true (FR-IAM-11). */
export const STAFF_ROLES: ReadonlySet<Role> = new Set(["admin", "management", "customer_support"]);
