"use client";
// Admin audit log viewer (FR-AUD-*, AT-16; TBD-59): read-only, Admin-only. audit_events is append-only at the
// database level (DC-13); this page cannot change or delete anything.
import { Suspense, useCallback, useEffect, useState } from "react";
import type { AuditPage, RetentionStatus } from "@sj/contracts";
import { formatIst } from "@sj/client";
import { api } from "@/lib/session";
import { can, useMe } from "@/lib/me";
import { MfaPrompt } from "../mfa-prompt";

const PAGE_SIZE = 50;

function Filters({ f, setF }: { f: Record<string, string>; setF: (f: Record<string, string>) => void }) {
  const field = (k: string, label: string, type = "text") => (
    <label>{label}<input type={type} value={f[k] ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value, offset: "0" })} /></label>
  );
  return (
    <div className="toolbar">
      {field("action", "Action")}
      {field("entityType", "Entity type")}
      {field("actorUserId", "Actor (account id)")}
      <label>Edition<select value={f.edition ?? ""} onChange={(e) => setF({ ...f, edition: e.target.value, offset: "0" })}>
        <option value="">Any</option><option value="2026">2026</option><option value="2027">2027</option>
      </select></label>
      {field("from", "From", "datetime-local")}
      {field("to", "To", "datetime-local")}
    </div>
  );
}

function Retention() {
  const [s, setS] = useState<RetentionStatus | null>(null);
  useEffect(() => { void api.retention.status().then(setS, () => {}); }, []);
  if (!s) return null;
  return (
    <section className="card" style={{ marginTop: 24 }}>
      <h2>Data-retention sweep (TBD-32)</h2>
      <p className="muted small">
        {s.enabled ? (s.dryRun ? "Enabled, dry run: counts candidates but deletes nothing." : "Enabled: deletes the categories below on schedule.")
          : "Disabled — the sweep does not run. Pending Legal approval of the retention schedule."}
      </p>
      {s.recentSweeps.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Category</th><th>Ran at (IST)</th><th>Mode</th><th>Rows</th></tr></thead>
            <tbody>
              {s.recentSweeps.map((r) => (
                <tr key={r.id}><td>{r.category}</td><td className="small">{formatIst(r.ranAt)}</td><td>{r.dryRun ? "Dry run" : "Purged"}</td><td>{r.deletedCount}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Audit() {
  const { me, email } = useMe();
  const [f, setF] = useState<Record<string, string>>({ offset: "0" });
  const [page, setPage] = useState<AuditPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const allowed = can(me, "audit.read");

  const load = useCallback(async () => {
    try {
      const q: Record<string, string | number> = { limit: PAGE_SIZE, offset: Number(f.offset ?? "0") };
      for (const k of ["action", "entityType", "actorUserId", "edition"]) if (f[k]) q[k] = k === "edition" ? Number(f[k]) : f[k]!;
      for (const k of ["from", "to"]) if (f[k]) q[k] = new Date(f[k]!).toISOString();
      setPage(await api.audit.list(q));
      setError(null);
    } catch (x) { setError((x as Error).message); }
  }, [f]);
  useEffect(() => { if (allowed) void load(); }, [allowed, load]);

  if (email === undefined) return null;
  if (!email) return <p>Please sign in.</p>;
  if (me?.mfaRequired) return <MfaPrompt next="/audit" />;
  if (me && !allowed) return <p className="notice notice-error">The audit view is Admin-only.</p>;

  const offset = Number(f.offset ?? "0");
  return (
    <>
      <h1>Audit</h1>
      <p className="muted small">Every recorded action: who, when, what, and on what. Append-only — nothing here can be changed.</p>
      <Filters f={f} setF={setF} />
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {page && (
        <>
          <p className="muted small">{page.total} event(s)</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>At (IST)</th><th>Actor</th><th>Action</th><th>Entity</th><th>Edition</th><th>Details</th></tr></thead>
              <tbody>
                {page.events.map((e) => (
                  <tr key={e.id}>
                    <td className="small">{formatIst(e.at)}</td>
                    <td className="small">{e.actorName ?? (e.actorType === "system" ? "System" : e.actorType === "service" ? "Service" : "—")}</td>
                    <td>{e.action}</td>
                    <td className="small">{e.entityType}{e.entityId ? ` · ${e.entityId}` : ""}</td>
                    <td>{e.editionId ?? "—"}</td>
                    <td className="small"><code>{JSON.stringify(e.data)}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="toolbar">
            <button className="btn btn-sm" disabled={offset === 0} onClick={() => setF({ ...f, offset: String(Math.max(0, offset - PAGE_SIZE)) })}>Previous</button>
            <button className="btn btn-sm" disabled={offset + PAGE_SIZE >= page.total} onClick={() => setF({ ...f, offset: String(offset + PAGE_SIZE) })}>Next</button>
          </div>
        </>
      )}
      <Retention />
    </>
  );
}

export default function Page() {
  return <Suspense><Audit /></Suspense>;
}
