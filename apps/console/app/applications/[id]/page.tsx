"use client";
import Link from "next/link";
import { Fragment, use, useEffect, useState } from "react";
import { formatIst } from "@sj/client";
import type { ManageApplication } from "@sj/contracts";
import { api, useSessionEmail } from "@/lib/session";

export default function ApplicationDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const email = useSessionEmail();
  const [a, setA] = useState<ManageApplication | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!email) return;
    api.manage.get(id).then((x) => { setA(x); setReason(x.decision?.reason ?? ""); }).catch((e: Error) => setError(e.message));
  }, [email, id]);

  async function decide(outcome: "selected" | "not_selected") {
    setBusy(true);
    setError(null);
    try {
      setA(await api.manage.decide(id, { outcome, reason: reason || undefined }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (email === undefined) return null;
  if (!email) return <p>Please <Link href={`/signin?next=/applications/${id}`}>sign in</Link>.</p>;
  if (error && !a) return <p className="notice notice-error">{error}</p>;
  if (!a) return <p className="muted">Loading…</p>;
  const released = !!a.decision?.releasedAt;

  return (
    <>
      <p className="small"><Link href={`/applications?edition=${a.edition}`}>← {a.edition} applications</Link></p>
      <h1>{a.startup.name}</h1>
      <p className="muted">Startup Jathara {a.edition} · <span className="status">{a.status}</span>{a.flags.map((f) => <span key={f}> · <span className="flag">{f.replace(/_/g, " ")}</span></span>)}</p>
      <div className="grid">
        <section className="card">
          <h2>Startup</h2>
          <p style={{ whiteSpace: "pre-wrap" }}>{a.startup.description}</p>
          <dl>
            <dt>Website</dt><dd>{a.startup.website ? <a href={a.startup.website} target="_blank" rel="noreferrer">{a.startup.website}</a> : "—"}</dd>
            <dt>Location</dt><dd>{[a.startup.city, a.startup.state].filter(Boolean).join(", ") || "—"}</dd>
            <dt>Submitted</dt><dd>{formatIst(a.submittedAt)} IST</dd>
            <dt>Other year</dt><dd>{a.otherEditions.map((o) => `${o.edition}: ${o.status}`).join(", ") || "—"}</dd>
            {Object.entries(a.formAnswers).map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{String(v)}</dd></Fragment>)}
          </dl>
        </section>
        <section className="card">
          <h2>Team leader</h2>
          <dl>
            <dt>Name</dt><dd>{a.leader.fullName}</dd>
            <dt>Email</dt><dd>{a.leader.email ?? "—"}</dd>
            <dt>Mobile</dt><dd>{a.leader.mobile ?? "—"}</dd>
          </dl>
        </section>
        <section className="card">
          <h2>Decision</h2>
          {a.decision && (
            <p>
              {released ? "Released" : "Draft"}: <strong>{a.decision.outcome.replace("_", " ")}</strong>
              {released && <> on {formatIst(a.decision.releasedAt!)} IST</>}
            </p>
          )}
          {released ? (
            <p className="muted small">Released decisions cannot be changed until a reversal policy is agreed (TBD-37).</p>
          ) : (
            <>
              <label>Reason (optional, internal)<textarea value={reason} onChange={(e) => setReason(e.target.value)} /></label>
              {error && <p className="field-error">{error}</p>}
              <div className="actions">
                <button className="btn btn-primary" disabled={busy} onClick={() => void decide("selected")}>Draft: select</button>
                <button className="btn" disabled={busy} onClick={() => void decide("not_selected")}>Draft: not select</button>
              </div>
              <p className="muted small">Drafts are released together from the applications list.</p>
            </>
          )}
        </section>
      </div>
    </>
  );
}
