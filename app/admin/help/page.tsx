import { notFound, redirect } from "next/navigation";
import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { AdminChrome } from "@/components/admin/AdminChrome";
import { getPriceCheckAdminAccess } from "@/lib/price-check/admin/auth";
import { priceCheckStatuses } from "@/db/price-check/domain/status-policy";
import { statusLabels } from "@/lib/price-check/admin/display";
import { getPriceCheckWorkflowGuidance } from "@/lib/price-check/admin/workflow-guidance";

export default async function AdminHelpPage() {
  const access = await getPriceCheckAdminAccess();
  if (access.status === "disabled") notFound();
  if (access.status === "unauthenticated") redirect("/admin/login");
  if (access.status === "forbidden") redirect("/admin/access-denied");
  if (access.status === "unavailable") return <AdminAccessDenied unavailable />;

  return <AdminChrome user={access.user} active="help"><section className="admin-page admin-help-page">
    <header className="admin-help-hero"><p className="admin-eyebrow">Civilon operations guide</p><h1>Price Check operator help</h1><p>Quick guidance for reviewing, analyzing, approving, and following up on a Price Check. This page never changes request data.</p></header>
    <nav className="admin-help-jump" aria-label="Guide sections"><a href="#workflow">Workflow</a><a href="#page-map">Page map</a><a href="#roles">Roles</a><a href="#rules">Key rules</a><a href="#extraction">Extraction</a><a href="#comparables">Comparables</a><a href="#confidence">Confidence</a><a href="#result">Result</a><a href="#troubleshooting">Troubleshooting</a></nav>
    <div className="admin-help-grid">
      <section id="workflow" className="admin-panel"><p className="admin-eyebrow">Quick workflow</p><h2>Work in five phases</h2><ol className="admin-help-steps"><li><b>Intake</b><span>Confirm the request, customer context, and owner.</span></li><li><b>Verify Transaction</b><span>Review clean documents, extraction proposals, and revisions.</span></li><li><b>Analyze Evidence</b><span>Select governed comparables and save deterministic analysis.</span></li><li><b>Prepare Result</b><span>Draft, review, and approve customer-facing content.</span></li><li><b>Delivery & Follow-up</b><span>Confirm secure delivery and follow sourcing opportunities.</span></li></ol></section>
      <section id="page-map" className="admin-panel"><p className="admin-eyebrow">Page map</p><h2>Where to work</h2><dl className="admin-help-map"><div><dt>Review Queue</dt><dd>Find and open requests by the blue Price Check reference.</dd></div><div><dt>Request detail</dt><dd>Use the workflow map, section navigator, and recommended action.</dd></div><div><dt>Staff</dt><dd>ADMIN only: add exact emails, manage roles, and revoke access.</dd></div><div><dt>Operations Guide</dt><dd>Return here for quick help without leaving the admin workspace.</dd></div></dl></section>
      <section id="roles" className="admin-panel"><p className="admin-eyebrow">Role summary</p><h2>Authority remains server-enforced</h2><ul className="admin-help-list"><li><b>ADMIN</b> — full operations and staff management.</li><li><b>REVIEWER</b> — analyze, review, approve, and send.</li><li><b>ANALYST</b> — review, analyze, and draft; no final approval or send.</li><li><b>AUDITOR</b> — read-only access.</li></ul></section>
      <section id="rules" className="admin-panel"><p className="admin-eyebrow">Key rules</p><h2>Keep the workflow controlled</h2><ul className="admin-help-list"><li>Original submissions and history are immutable.</li><li>Only clean files may be opened or sent for extraction.</li><li>AI proposes fields and wording; staff decides what is correct.</li><li>The deterministic engine—not AI—calculates observed indicators.</li><li>Approval and sending are separate actions.</li><li>Never expose internal evidence, tokens, or supplier provenance.</li></ul></section>
    </div>
    <section className="admin-panel admin-help-status"><p className="admin-eyebrow">What do I do next?</p><h2>Status guidance</h2><div className="admin-help-table-wrap"><table><thead><tr><th>Status</th><th>Recommended next action</th></tr></thead><tbody>{priceCheckStatuses.map(status => <tr key={status}><td>{statusLabels[status]}</td><td>{getPriceCheckWorkflowGuidance(status, true).nextAction}</td></tr>)}</tbody></table></div></section>
    <div className="admin-help-grid">
      <section id="extraction" className="admin-panel"><p className="admin-eyebrow">AI extraction</p><h2>Proposal, not authority</h2><p>Compare every proposed field with the clean source document. Apply only fields you have confirmed; applying creates a reviewed revision, not market evidence.</p></section>
      <section id="comparables" className="admin-panel"><p className="admin-eyebrow">Comparable evidence</p><h2>Record each evidence decision</h2><p>Include only relevant governed observations and explain each include or exclude decision. Customer submissions never become comparables automatically.</p></section>
      <section id="confidence" className="admin-panel"><p className="admin-eyebrow">Confidence</p><h2>Human judgment</h2><p>Select confidence from the quality, relevance, and limitations of the evidence. It is not an automated score.</p></section>
      <section id="result" className="admin-panel"><p className="admin-eyebrow">Customer result</p><h2>Review before approval</h2><p>Confirm classification, displayed range or limitation, confidence, factors, explanation, and disclaimer. Approval does not send; sending queues secure delivery separately.</p></section>
      <section id="troubleshooting" className="admin-panel"><p className="admin-eyebrow">Troubleshooting</p><h2>Fail closed and preserve history</h2><ul className="admin-help-list"><li>If AI is unavailable, continue with the manual path.</li><li>If a job fails, record the safe code and retry only when the control allows it.</li><li>If a document is not Clean, do not open or extract it.</li><li>If access is wrong, ask an ADMIN to check role, status, and session revocation.</li></ul></section>
      <section id="offline-guide" className="admin-panel"><p className="admin-eyebrow">Full training guide</p><h2>Offline operations guide</h2><p>Use <b>Civilon-Price-Check-Admin-Guide.html</b> supplied by Civilon Operations for training, printing, PDF export, screenshots, detailed troubleshooting, and approved response examples.</p></section>
    </div>
  </section></AdminChrome>;
}
