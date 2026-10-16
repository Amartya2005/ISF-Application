"use client";
// Reports and controlled exports (FR-RPT-*; TBD-31): export is a permission separate from viewing, and each role
// exports only the data it administers or reviews. Every export is audited on the server.
import { useState } from "react";
import { REPORT_KINDS, REPORT_LABEL, REPORT_PER_EDITION, type ReportKind } from "@sj/contracts";
import { api } from "@/lib/session";
import { can, useMe } from "@/lib/me";
import { MfaPrompt } from "../mfa-prompt";

const VIEW_PERMISSION: Record<ReportKind, string> = {
  accounts: "user.read", imports: "import.manage", volunteers: "volunteer.read",
  applications: "application.read_all", selection: "application.read_all", jury: "jury.review",
};
const FETCH: Record<ReportKind, (year: number) => Promise<{ fileName: string; csv: string }>> = {
  accounts: () => api.reports.accounts(), imports: () => api.reports.imports(),
  volunteers: (year) => api.reports.volunteers(year), applications: (year) => api.reports.applications(year),
  selection: (year) => api.reports.selection(year), jury: (year) => api.reports.jury(year),
};

function triggerDownload(fileName: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: fileName });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function ReportRow({ kind, year }: { kind: ReportKind; year: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <tr>
      <td>{REPORT_LABEL[kind]}</td>
      <td className="small muted">{REPORT_PER_EDITION[kind] ? `Edition ${year}` : "All editions"}</td>
      <td>
        <button className="btn btn-sm" disabled={busy} onClick={async () => {
          setBusy(true); setError(null);
          try { const r = await FETCH[kind](year); triggerDownload(r.fileName, r.csv); } catch (x) { setError((x as Error).message); } finally { setBusy(false); }
        }}>
          {busy ? "Preparing…" : "Download CSV"}
        </button>
        {error && <span className="notice notice-error small" style={{ marginLeft: 8 }} role="alert">{error}</span>}
      </td>
    </tr>
  );
}

export default function Page() {
  const { me, email } = useMe();
  const [year, setYear] = useState(2026);
  const allowed = can(me, "report.export");

  if (email === undefined) return null;
  if (!email) return <p>Please sign in.</p>;
  if (me?.mfaRequired) return <MfaPrompt next="/reports" />;
  if (me && !allowed) return <p className="notice notice-error">Your account does not have export permission.</p>;

  const kinds = REPORT_KINDS.filter((k) => can(me, VIEW_PERMISSION[k]));

  return (
    <>
      <h1>Reports</h1>
      <p className="muted small">
        Export is a permission separate from viewing (TBD-31). Every export is recorded in the audit log with who, when and how many rows —
        never the row data itself.
      </p>
      <label>Edition (for reports scoped to one edition)
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}><option>2026</option><option>2027</option></select>
      </label>
      {kinds.length === 0 ? <p className="muted">No reports available to your account.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Report</th><th>Scope</th><th></th></tr></thead>
            <tbody>{kinds.map((k) => <ReportRow key={k} kind={k} year={year} />)}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
