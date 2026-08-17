"use client";

import { useState } from "react";

type Staff = {
  id: string;
  displayEmail: string;
  role: "ADMIN" | "REVIEWER" | "ANALYST" | "AUDITOR";
  active: boolean;
  identityProviderIssuer: string;
  lastLoginAt: string | Date | null;
  createdAt: string | Date;
};

const roles = ["ADMIN", "REVIEWER", "ANALYST", "AUDITOR"] as const;
const pendingIssuer = "pending:civilon-google-oidc";

function date(value: string | Date | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

export function StaffManagement({ initialStaff }: { initialStaff: Staff[] }) {
  const [staff, setStaff] = useState(initialStaff);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof roles)[number]>("REVIEWER");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function request(method: "POST" | "PATCH", body: Record<string, unknown>) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/staff", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { ok?: boolean; error?: string; staff?: Staff | Staff[] };
      if (!response.ok || !result.ok) throw new Error(result.error || "The staff action failed.");
      if (method === "POST" && result.staff && !Array.isArray(result.staff)) setStaff(current => [...current, result.staff as Staff].sort((a, b) => a.displayEmail.localeCompare(b.displayEmail)));
      if (method === "PATCH" && result.staff && !Array.isArray(result.staff)) setStaff(current => current.map(item => item.id === result.staff!.id ? result.staff as Staff : item));
      setMessage("Saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The staff action failed."); }
    finally { setBusy(false); }
  }

  return <section className="admin-page">
    <div className="admin-page-heading"><div><p className="admin-eyebrow">Civilon access control</p><h1>Staff</h1><p>Manage approved Google identities and operational roles without editing deployment settings.</p></div></div>
    <form className="admin-panel" onSubmit={event => { event.preventDefault(); void request("POST", { email, role }); setEmail(""); }}>
      <div className="admin-panel-heading"><div><p className="admin-eyebrow">Add staff</p><h2>Approve a login email</h2></div></div>
      <div className="admin-form-grid"><label><span>Email</span><input type="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="person@cvlon.com" /></label><label><span>Role</span><select value={role} onChange={event => setRole(event.target.value as typeof role)}>{roles.map(item => <option key={item}>{item}</option>)}</select></label><button type="submit" disabled={busy}>Add staff</button></div>
      <p className="admin-muted">The employee must sign in with this exact verified Google email. No domain-wide access is granted.</p>
    </form>
    {message && <p className="admin-notice" role="status">{message}</p>}
    <div className="admin-table-wrap"><table className="admin-queue-table"><caption className="sr-only">Civilon staff</caption><thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Identity</th><th>Last login</th><th>Created</th><th>Actions</th></tr></thead><tbody>{staff.map(item => {
      const pending = item.identityProviderIssuer === pendingIssuer;
      return <tr key={item.id}><td data-label="Email">{item.displayEmail}</td><td data-label="Role"><select value={item.role} disabled={busy} onChange={event => void request("PATCH", { id: item.id, action: "role", role: event.target.value })}>{roles.map(value => <option key={value}>{value}</option>)}</select></td><td data-label="Status">{item.active ? "Active" : "Disabled"}</td><td data-label="Identity">{pending ? "Awaiting first login" : "Bound"}</td><td data-label="Last login">{date(item.lastLoginAt)}</td><td data-label="Created">{date(item.createdAt)}</td><td data-label="Actions" className="admin-action-stack">{pending && <button type="button" disabled={busy} onClick={() => void navigator.clipboard?.writeText(`Sign in at ${window.location.origin}/admin/login with ${item.displayEmail}`)}>Copy login instructions</button>}{item.active ? <button type="button" disabled={busy} onClick={() => void request("PATCH", { id: item.id, action: "disable" })}>Disable</button> : <button type="button" disabled={busy} onClick={() => void request("PATCH", { id: item.id, action: "enable" })}>Re-enable</button>}<button type="button" disabled={busy} onClick={() => void request("PATCH", { id: item.id, action: "revoke" })}>Revoke sessions</button></td></tr>;
    })}</tbody></table></div>
  </section>;
}
