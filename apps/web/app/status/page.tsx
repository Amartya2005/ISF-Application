"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatIst } from "@sj/client";
import type { MyApplicationsResponse, NotificationItem } from "@sj/contracts";
import { api, useSessionEmail } from "@/lib/session";

const LABEL = { under_review: "Under review", selected: "Selected", not_selected: "Not selected" } as const;

export default function StatusPage() {
  const email = useSessionEmail();
  const [data, setData] = useState<MyApplicationsResponse | null>(null);
  const [notes, setNotes] = useState<NotificationItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!email) return;
    Promise.all([api.myApplications(), api.myNotifications()])
      .then(([a, n]) => { setData(a); setNotes(n); })
      .catch((e: Error) => setError(e.message));
  }, [email]);

  if (email === undefined) return null;
  if (!email) {
    return (
      <div className="card" style={{ maxWidth: 560 }}>
        <h1>Application status</h1>
        <p>Sign in with the email you used to register.</p>
        <Link className="btn btn-primary" href="/signin?next=/status">Sign in</Link>
      </div>
    );
  }
  if (error) return <p className="notice notice-error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  if (!data.startup) {
    return (
      <div className="card" style={{ maxWidth: 560 }}>
        <h1>Application status</h1>
        <p>No application is linked to {email} yet.</p>
        <Link className="btn btn-primary" href="/register">Register your startup</Link>
      </div>
    );
  }
  return (
    <>
      <h1>{data.startup.name}</h1>
      <p className="muted">Each year has its own application and its own result.</p>
      <div className="list">
        {data.applications.map((a) => (
          <div className="card row" key={a.id}>
            <div>
              <h3>Startup Jathara {a.edition}</h3>
              <span className="muted small">Submitted {formatIst(a.submittedAt)} IST{a.decidedAt ? ` · Decision released ${formatIst(a.decidedAt)} IST` : ""}</span>
            </div>
            <span className={`badge badge-${a.status}`}>{LABEL[a.status]}</span>
          </div>
        ))}
      </div>
      {data.applications.length < 2 && (
        <p className="small" style={{ marginTop: 12 }}><Link href="/register">Apply for another year</Link></p>
      )}
      <h2 style={{ marginTop: 32 }}>Messages</h2>
      {notes.length === 0 ? <p className="muted">No messages yet.</p> : (
        <div className="list">
          {notes.map((n) => (
            <div className="card" key={n.id}>
              <h3>{n.title}</h3>
              <p>{n.body}</p>
              <span className="muted small">{formatIst(n.createdAt)} IST</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
