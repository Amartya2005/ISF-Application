"use client";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiError, formatIst } from "@sj/client";
import { INTERNAL_STATUSES, type InternalStatus, type ManageApplicationList } from "@sj/contracts";
import { api, useSessionEmail } from "@/lib/session";
import { MfaPrompt } from "../mfa-prompt";

const YEARS = [2026, 2027];

function Applications() {
  const email = useSessionEmail();
  const router = useRouter();
  const params = useSearchParams();
  const year = Number(params.get("edition") ?? 2026);
  const status = (params.get("status") ?? "") as InternalStatus | "";
  const [data, setData] = useState<ManageApplicationList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const d = await api.manage.list(year, status || undefined);
      setData(d);
      setLimit(d.selectionLimit?.toString() ?? "");
    } catch (e) {
      setData(null);
      setError(e instanceof ApiError && e.code === "mfa_required" ? "mfa_required"
        : e instanceof ApiError && e.status === 403 ? "Your account does not have Management permissions." : (e as Error).message);
    }
  }, [year, status]);

  useEffect(() => { if (email) void load(); }, [email, load]);

  const go = (q: Record<string, string>) => {
    const p = new URLSearchParams({ edition: String(year), ...(status ? { status } : {}), ...q });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    router.push(`/applications?${p}`);
  };

  async function act(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      if (ok) setMessage(ok);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (email === undefined) return null;
  if (!email) return <p>Please <Link href="/signin?next=/applications">sign in</Link>.</p>;

  const drafts = data?.items.filter((i) => i.decision && !i.decision.releasedAt) ?? [];
  return (
    <>
      <h1>Applications</h1>
      <div className="tabs" role="tablist">
        {YEARS.map((y) => (
          <button key={y} className="tab" aria-current={y === year} onClick={() => go({ edition: String(y), status: "" })}>{y}</button>
        ))}
      </div>

      {error === "mfa_required" ? <MfaPrompt next="/applications" /> : error && <p className="notice notice-error" role="alert">{error}</p>}
      {message && <p className="notice notice-ok">{message}</p>}

      {data && (
        <>
          <div className="release-bar">
            <div>
              <strong>{drafts.length}</strong> draft decision{drafts.length === 1 ? "" : "s"} not yet visible to applicants ·{" "}
              <strong>{data.selectedTotal}</strong> selected (incl. drafts)
              {data.selectionLimit !== null && <> of a limit of <strong>{data.selectionLimit}</strong></>}
            </div>
            <button className="btn btn-primary" disabled={busy || drafts.length === 0}
              onClick={() => {
                if (confirm(`Release ${drafts.length} decision(s) for ${year}? Applicants will be notified and this cannot be undone.`)) {
                  void act(async () => {
                    const r = await api.manage.release(year);
                    setMessage(`Released ${r.released} (${r.selected} selected, ${r.notSelected} not selected).${r.warnings.length ? " " + r.warnings.join(" ") : ""}`);
                  });
                }
              }}>
              Release decisions
            </button>
          </div>

          <div className="toolbar">
            <label>Status
              <select value={status} onChange={(e) => go({ status: e.target.value })}>
                <option value="">All ({Object.values(data.counts).reduce((a, b) => a + b, 0)})</option>
                {INTERNAL_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")} ({data.counts[s] ?? 0})</option>)}
              </select>
            </label>
            <form className="toolbar" style={{ margin: 0 }} onSubmit={(e) => {
              e.preventDefault();
              void act(() => api.manage.setLimit(year, limit ? Number(limit) : null), "Selection limit saved.");
            }}>
              <label>Selection limit (warning only)
                <input type="text" inputMode="numeric" placeholder="none" value={limit} onChange={(e) => setLimit(e.target.value.replace(/\D/g, ""))} />
              </label>
              <button className="btn btn-sm" disabled={busy}>Save</button>
            </form>
          </div>

          {data.items.length === 0 ? <p className="muted">No applications match.</p> : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Startup</th><th>Leader</th><th>Submitted (IST)</th><th>Other year</th><th>Status</th><th>Decision</th></tr>
                </thead>
                <tbody>
                  {data.items.map((a) => {
                    const released = !!a.decision?.releasedAt;
                    return (
                      <tr key={a.id}>
                        <td>
                          <Link href={`/applications/${a.id}`}><strong>{a.startup.name}</strong></Link>
                          {a.flags.map((f) => <div key={f}><span className="flag">{f.replace(/_/g, " ")}</span></div>)}
                        </td>
                        <td>{a.leader.fullName}<div className="muted small">{a.leader.email}<br />{a.leader.mobile}</div></td>
                        <td>{formatIst(a.submittedAt)}</td>
                        <td className="small">{a.otherEditions.map((o) => `${o.edition}: ${o.status.replace(/_/g, " ")}`).join(", ") || "—"}</td>
                        <td><span className="status">{a.status}</span></td>
                        <td>
                          {released ? (
                            <span className="muted small">Released {formatIst(a.decision!.releasedAt!)}</span>
                          ) : (
                            <div className="actions" style={{ marginTop: 0 }}>
                              <button className="btn btn-sm" disabled={busy || a.decision?.outcome === "selected"}
                                onClick={() => void act(() => api.manage.decide(a.id, { outcome: "selected" }))}>Select</button>
                              <button className="btn btn-sm" disabled={busy || a.decision?.outcome === "not_selected"}
                                onClick={() => void act(() => api.manage.decide(a.id, { outcome: "not_selected" }))}>Not select</button>
                              {a.decision && (
                                <button className="btn btn-sm" disabled={busy} onClick={() => void act(() => api.manage.withdraw(a.id))}>Withdraw draft</button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted small" style={{ marginTop: 12 }}>
            Decisions stay as drafts until released. Releasing notifies applicants and grants selected teams access to the {year} event.
            AI ranking is added in milestone M3; every decision remains a human decision.
          </p>
        </>
      )}
    </>
  );
}

export default function Page() {
  return <Suspense><Applications /></Suspense>;
}
