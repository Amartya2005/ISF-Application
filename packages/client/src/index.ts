// Typed HTTP client for the Startup Jathara API, shared by the website, console and mobile app.
import type {
  AccountStatus,
  ActivationIssued,
  AdminUser,
  AdminUserList,
  DecisionRequest,
  ImportBatch,
  ImportBatchDetail,
  ImportCategory,
  MeResponse,
  Role,
  InternalStatus,
  ManageApplication,
  ManageApplicationList,
  MyApplicationsResponse,
  NotificationItem,
  Problem,
  PublicEdition,
  RegistrationRequest,
  RegistrationResponse,
  ReleaseResponse,
} from "@sj/contracts";

export class ApiError extends Error {
  constructor(readonly problem: Problem) {
    super(problem.detail ?? problem.title);
  }
  get status() { return this.problem.status; }
  get code() { return this.problem.code; }
  /** Field errors keyed by dotted path, e.g. "startup.name". */
  fieldErrors(): Record<string, string> {
    return Object.fromEntries((this.problem.errors ?? []).map((e) => [e.path, e.message]));
  }
}

export type ApiOptions = { baseUrl: string; getToken: () => string | null | Promise<string | null> };

export function createApi({ baseUrl, getToken }: ApiOptions) {
  async function req<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
    const token = await getToken();
    let res: Response;
    try {
      res = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
        method,
        headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError({ type: "about:blank", title: "Cannot reach the server", status: 0, code: "network_error", detail: "Check your connection and try again." });
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new ApiError(data ?? { type: "about:blank", title: res.statusText, status: res.status, code: "http_error" });
    return data as T;
  }

  return {
    editions: () => req<PublicEdition[]>("GET", "/v1/public/editions"),
    devSession: (email: string, mfa = false) => req<{ token: string }>("POST", "/v1/dev/session", { email, mfa }),
    register: (body: RegistrationRequest) => req<RegistrationResponse>("POST", "/v1/me/registrations", body),
    myApplications: () => req<MyApplicationsResponse>("GET", "/v1/me/applications"),
    myNotifications: () => req<NotificationItem[]>("GET", "/v1/me/notifications"),
    me: () => req<MeResponse>("GET", "/v1/me"),
    activate: (token: string) => req<MeResponse>("POST", "/v1/me/activation", { token }),
    admin: {
      users: (f: { q?: string; role?: Role; status?: AccountStatus; limit?: number; offset?: number } = {}) => {
        const p = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]));
        return req<AdminUserList>("GET", `/v1/admin/users${p.size ? `?${p}` : ""}`);
      },
      user: (id: string) => req<AdminUser>("GET", `/v1/admin/users/${id}`),
      grantRole: (id: string, role: Role, edition: number | null = null) => req<AdminUser>("POST", `/v1/admin/users/${id}/roles`, { role, edition }),
      revokeRole: (id: string, grantId: string) => req<AdminUser>("DELETE", `/v1/admin/users/${id}/roles/${grantId}`),
      deactivate: (id: string) => req<AdminUser>("POST", `/v1/admin/users/${id}/deactivate`),
      reactivate: (id: string) => req<AdminUser>("POST", `/v1/admin/users/${id}/reactivate`),
      issueActivation: (id: string) => req<ActivationIssued>("POST", `/v1/admin/users/${id}/activation`),
      imports: () => req<ImportBatch[]>("GET", "/v1/admin/imports"),
      importBatch: (id: string) => req<ImportBatchDetail>("GET", `/v1/admin/imports/${id}`),
      previewImport: (body: { category: ImportCategory; edition: number; fileName: string; csv: string }) =>
        req<ImportBatchDetail>("POST", "/v1/admin/imports", body),
      commitImport: (id: string, excludeRows: number[] = []) => req<ImportBatchDetail>("POST", `/v1/admin/imports/${id}/commit`, { excludeRows }),
      discardImport: (id: string) => req<ImportBatch>("POST", `/v1/admin/imports/${id}/discard`),
    },
    manage: {
      list: (year: number, status?: InternalStatus) =>
        req<ManageApplicationList>("GET", `/v1/manage/editions/${year}/applications${status ? `?status=${status}` : ""}`),
      get: (id: string) => req<ManageApplication>("GET", `/v1/manage/applications/${id}`),
      decide: (id: string, body: DecisionRequest) => req<ManageApplication>("PUT", `/v1/manage/applications/${id}/decision`, body),
      withdraw: (id: string) => req<ManageApplication>("DELETE", `/v1/manage/applications/${id}/decision`),
      release: (year: number, applicationIds?: string[]) =>
        req<ReleaseResponse>("POST", `/v1/manage/editions/${year}/decisions/release`, applicationIds ? { applicationIds } : {}),
      setLimit: (year: number, limit: number | null) =>
        req<{ edition: number; selectionLimit: number | null }>("PUT", `/v1/manage/editions/${year}/selection-limit`, { limit }),
    },
  };
}
export type Api = ReturnType<typeof createApi>;

const IST = "Asia/Kolkata";
/** All times are shown in IST (PRD NFR-12). */
export function formatIst(iso: string, withTime = true): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: IST, dateStyle: "medium", ...(withTime ? { timeStyle: "short" } : {}) }).format(new Date(iso));
}

/** "18–20 December 2026" from ISO dates (same month and year assumed when they match). */
export function formatDateRange(start: string, end: string): string {
  const s = new Date(`${start}T00:00:00+05:30`), e = new Date(`${end}T00:00:00+05:30`);
  const day = (d: Date) => new Intl.DateTimeFormat("en-IN", { timeZone: IST, day: "numeric" }).format(d);
  const monthYear = new Intl.DateTimeFormat("en-IN", { timeZone: IST, month: "long", year: "numeric" }).format(e);
  return `${day(s)}–${day(e)} ${monthYear}`;
}
