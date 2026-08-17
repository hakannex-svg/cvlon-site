"use client";

import { useRef, useState } from "react";

const roles = ["ADMIN", "REVIEWER", "ANALYST", "AUDITOR"] as const;
type Role = typeof roles[number];
type User = {
  id: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: Date | string;
  lastLoginAt: Date | string | null;
};
type Invitation = {
  id: string;
  email: string;
  role: Role;
  status: "PENDING" | "REVOKED" | "ACCEPTED";
  createdAt: Date | string;
};

function date(value: Date | string | null) {
  return value ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
}

async function request(url: string, method: "POST" | "PATCH", body: Record<string, unknown>) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(typeof payload.error === "string" ? payload.error : "The staff update could not be completed.");
}

function RoleSelect({ value, onChange, id }: { value: Role; onChange: (value: Role) => void; id: string }) {
  return <select id={id} aria-label="Staff role" value={value} onChange={(event) => onChange(event.target.value as Role)}>{roles.map((role) => <option key={role}>{role}</option>)}</select>;
}

export function AdminStaffWorkspace({ users, invitations }: { users: User[]; invitations: Invitation[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("ANALYST");
  const formRef = useRef<HTMLFormElement>(null);

  const run = async (key: string, operation: () => Promise<void>, success: string) => {
    setBusy(key); setError(""); setMessage("");
    try { await operation(); setMessage(success); window.setTimeout(() => window.location.reload(), 350); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The staff update could not be completed."); }
    finally { setBusy(null); }
  };

  const copyInstructions = async (email: string) => {
    const instructions = `Go to https://cvlon.com/admin/login and sign in with ${email} using Google.`;
    try { await navigator.clipboard.writeText(instructions); setMessage("Login instructions copied."); }
    catch { setError("Copy is unavailable in this browser. Copy the login instruction shown below."); }
  };

  return <>
    <section className="admin-page admin-staff-page">
      <div className="admin-page-heading"><div><p className="admin-eyebrow">Administration</p><h1>Staff</h1><p>Manage Civilon Price Check administrators, reviewers, analysts and auditors.</p></div></div>
      {(error || message) && <p className={error ? "admin-error" : "admin-success"} role={error ? "alert" : "status"}>{error || message}</p>}

      <section className="admin-panel admin-staff-invite" aria-labelledby="add-staff-title">
        <div className="admin-panel-heading"><div><p className="admin-eyebrow">New authorization</p><h2 id="add-staff-title">Add staff member</h2></div></div>
        <form ref={formRef} className="admin-staff-invite-form" onSubmit={(event) => { event.preventDefault(); const email = new FormData(event.currentTarget).get("email"); run("invite", async () => { await request("/api/admin/staff", "POST", { email, role: inviteRole }); formRef.current?.reset(); }, "Staff invitation created."); }}>
          <label><span>Email</span><input name="email" type="email" required maxLength={320} autoComplete="email" placeholder="name@company.com" /></label>
          <label htmlFor="staff-invite-role"><span>Role</span><RoleSelect id="staff-invite-role" value={inviteRole} onChange={setInviteRole} /></label>
          <button type="submit" disabled={busy !== null}>{busy === "invite" ? "Adding…" : "Add staff member"}</button>
        </form>
        <p className="admin-muted">The selected role is granted only after the invited person completes verified Google sign-in. No invitation email is sent in this version.</p>
      </section>

      <section className="admin-panel admin-staff-directory" aria-labelledby="staff-directory-title">
        <div className="admin-panel-heading"><div><p className="admin-eyebrow">Authorized identities</p><h2 id="staff-directory-title">Bound staff</h2></div></div>
        <div className="admin-table-wrap"><table className="admin-staff-table"><caption className="sr-only">Bound Civilon staff accounts</caption><thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Google identity</th><th>Last login</th><th>Created</th><th>Actions</th></tr></thead><tbody>{users.map((user) => <BoundStaffRow key={user.id} user={user} busy={busy} run={run} />)}</tbody></table>{!users.length && <p className="admin-empty">No staff identities are bound yet.</p>}</div>
      </section>

      <section className="admin-panel admin-staff-directory" aria-labelledby="staff-invitations-title">
        <div className="admin-panel-heading"><div><p className="admin-eyebrow">Pending authorization</p><h2 id="staff-invitations-title">Invitations</h2></div></div>
        <div className="admin-table-wrap"><table className="admin-staff-table"><caption className="sr-only">Civilon staff invitations</caption><thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Google identity</th><th>Last login</th><th>Invited</th><th>Actions</th></tr></thead><tbody>{invitations.map((invitation) => <InvitationRow key={invitation.id} invitation={invitation} busy={busy} run={run} copyInstructions={copyInstructions} />)}</tbody></table>{!invitations.length && <p className="admin-empty">No pending or revoked invitations.</p>}</div>
      </section>
    </section>
  </>;
}

function BoundStaffRow({ user, busy, run }: { user: User; busy: string | null; run: (key: string, operation: () => Promise<void>, success: string) => Promise<void> }) {
  const [role, setRole] = useState<Role>(user.role);
  const key = `user:${user.id}`;
  return <tr><td data-label="Email"><strong>{user.email}</strong></td><td data-label="Role"><RoleSelect id={`staff-role-${user.id}`} value={role} onChange={setRole} /></td><td data-label="Status"><span className={`admin-staff-status ${user.active ? "active" : "disabled"}`}>{user.active ? "Active" : "Disabled"}</span></td><td data-label="Google identity"><span className="admin-staff-status bound">Bound</span></td><td data-label="Last login">{date(user.lastLoginAt)}</td><td data-label="Created">{date(user.createdAt)}</td><td data-label="Actions"><div className="admin-staff-actions"><button type="button" className="secondary" disabled={busy !== null || role === user.role} onClick={() => run(key, () => request(`/api/admin/staff/users/${user.id}`, "PATCH", { action: "change_role", role }), "Staff role updated. Existing sessions were revoked.")}>Save role</button><button type="button" className="secondary" disabled={busy !== null} onClick={() => run(key, () => request(`/api/admin/staff/users/${user.id}`, "PATCH", { action: user.active ? "disable" : "enable" }), user.active ? "Staff account disabled and sessions revoked." : "Staff account re-enabled. A new Google login is required.")}>{user.active ? "Disable" : "Re-enable"}</button><button type="button" className="secondary" disabled={busy !== null || !user.active} onClick={() => run(key, () => request(`/api/admin/staff/users/${user.id}`, "PATCH", { action: "revoke_sessions" }), "Active sessions revoked.")}>Revoke sessions</button></div></td></tr>;
}

function InvitationRow({ invitation, busy, run, copyInstructions }: { invitation: Invitation; busy: string | null; run: (key: string, operation: () => Promise<void>, success: string) => Promise<void>; copyInstructions: (email: string) => Promise<void> }) {
  const [role, setRole] = useState<Role>(invitation.role);
  const key = `invitation:${invitation.id}`;
  const pending = invitation.status === "PENDING";
  return <tr><td data-label="Email"><strong>{invitation.email}</strong>{pending && <small className="admin-staff-instruction">Go to https://cvlon.com/admin/login and sign in with {invitation.email} using Google.</small>}</td><td data-label="Role">{pending ? <RoleSelect id={`invitation-role-${invitation.id}`} value={role} onChange={setRole} /> : invitation.role}</td><td data-label="Status"><span className={`admin-staff-status ${pending ? "pending" : "revoked"}`}>{pending ? "Invitation pending" : "Invitation revoked"}</span></td><td data-label="Google identity"><span className="admin-staff-status awaiting">Awaiting first login</span></td><td data-label="Last login">—</td><td data-label="Invited">{date(invitation.createdAt)}</td><td data-label="Actions">{pending && <div className="admin-staff-actions"><button type="button" className="secondary" disabled={busy !== null || role === invitation.role} onClick={() => run(key, () => request(`/api/admin/staff/invitations/${invitation.id}`, "PATCH", { action: "change_role", role }), "Invitation role updated.")}>Save role</button><button type="button" className="secondary" disabled={busy !== null} onClick={() => copyInstructions(invitation.email)}>Copy login instructions</button><button type="button" className="secondary danger" disabled={busy !== null} onClick={() => run(key, () => request(`/api/admin/staff/invitations/${invitation.id}`, "PATCH", { action: "revoke" }), "Invitation revoked.")}>Revoke invitation</button></div>}</td></tr>;
}
