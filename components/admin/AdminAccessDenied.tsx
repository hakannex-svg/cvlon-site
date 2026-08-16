import Link from "next/link";

export function AdminAccessDenied({ unavailable = false }: { unavailable?: boolean }) {
  return <main className="admin-app admin-login-page"><section className="admin-login-card">
    <div className="admin-brand">CIVILON <span>OPERATIONS</span></div>
    <p className="admin-eyebrow">Restricted staff workspace</p>
    <h1>{unavailable ? "Administration unavailable" : "Access denied"}</h1>
    <p>{unavailable ? "The secure administration service is temporarily unavailable. The public Civilon website remains operational." : "This authenticated identity is not authorized for Civilon Price Check administration."}</p>
    <Link className="admin-secondary-button" href="/admin/login">Return to staff sign in</Link>
  </section></main>;
}
