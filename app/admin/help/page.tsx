import { redirect } from "next/navigation";
import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { AdminChrome } from "@/components/admin/AdminChrome";
import { getAdminAccess } from "@/lib/price-check/admin/auth";
import { priceCheckStatuses } from "@/db/price-check/domain/status-policy";
import { statusLabels } from "@/lib/price-check/admin/display";
import { getPriceCheckWorkflowGuidance } from "@/lib/price-check/admin/workflow-guidance";

/** General staff guidance, reachable whatever the public product flags say. */
export default async function AdminHelpPage() {
  const access = await getAdminAccess();
  if (access.status === "unauthenticated") redirect("/admin/login");
  if (access.status === "forbidden") redirect("/admin/access-denied");
  if (access.status !== "authorized") return <AdminAccessDenied unavailable />;

  return <AdminChrome user={access.user} active="help"><section className="admin-page admin-help-page">
    <header className="admin-help-hero"><p className="admin-eyebrow">Civilon operations guide</p><h1>Civilon operator help</h1><p>Quick guidance for the three workflows this console covers: Buy Requests, Sell Submissions, and Price Check. This page never changes record data.</p></header>
    <nav className="admin-help-jump" aria-label="Guide sections"><a href="#marketplace">Buy &amp; Sell</a><a href="#accepted-deal">Accepted deals</a><a href="#marketplace-limits">What Civilon never claims</a><a href="#workflow">Price Check workflow</a><a href="#page-map">Page map</a><a href="#roles">Roles</a><a href="#rules">Key rules</a><a href="#extraction">Extraction</a><a href="#comparables">Comparables</a><a href="#confidence">Confidence</a><a href="#result">Result</a><a href="#troubleshooting">Troubleshooting</a></nav>

    <div className="admin-help-grid">
      <section id="marketplace" className="admin-panel">
        <p className="admin-eyebrow">Buy &amp; Sell</p>
        <h2>Working a Buy Request or Sell Submission</h2>
        <ul className="admin-help-list">
          <li><b>Where to work</b> — <b>All Work</b> is every workflow in one queue; <b>Buy Requests</b> and <b>Sell Submissions</b> are the same records filtered to one side. Open a record by its BR- or SS- reference.</li>
          <li><b>Verification</b> — a record starts at <i>Pending verification</i> until the customer or supplier confirms their own email. An ADMIN may override that to <i>Verified</i>, which is audited under its own action and leaves the contact still marked unconfirmed. Do not read an override as a confirmed address.</li>
          <li><b>Internal business review</b> — keep this separate from email verification. Use <i>Reviewed</i> only after staff checked the business information available to Civilon; use <i>Concern</i> when follow-up is needed. It is not certification, supplier approval, or regulatory approval.</li>
          <li><b>Status, assignment, notes</b> — move status only along the offered options, assign an active staff owner, and keep working detail in internal notes. Notes are staff-only, append-only, and never reach a customer or a supplier.</li>
          <li><b>Supplier responses</b> — internal sourcing only. Record what a supplier told you, including a nonregistered supplier Civilon simply telephoned. Nothing here contacts anyone.</li>
          <li><b>Civilon offers</b> — a buyer offer is Civilon&apos;s own separate sale terms. It carries no supplier identity, no supplier cost and no internal routing. Send Civilon Offer emails the verified buyer a secure accept/decline link; staff cannot record the buyer&apos;s response.</li>
          <li><b>Seller evidence</b> — the category summary is derived from the files actually supplied. Missing means no live file in that category; supplied does not mean approved. A file can be reviewed or opened only while its malware scan is clean and your role permits it. Use <i>Concern</i> for follow-up, never as an authenticity or airworthiness decision.</li>
        </ul>
      </section>

      <section id="accepted-deal" className="admin-panel">
        <p className="admin-eyebrow">Accepted deals</p>
        <h2>When a buyer accepts a Civilon offer</h2>
        <p>The panel appears only for the newest accepted offer. An older acceptance underneath a newer draft or sent offer is history. The panel stays visible on a Converted request until staff closes it.</p>
        <ul className="admin-help-list">
          <li><b>Act</b> — assign an owner, reconfirm the supplier claim, handle customer terms outside the console, choose the internal route, coordinate shipping/export, Convert when execution begins, then note the outcome and Close.</li>
          <li><b>Keep boundaries</b> — acceptance is not payment, procurement, supplier reconfirmation, shipment, documentation acceptance, certification, airworthiness approval, or an authenticity/fitness guarantee. Availability remains subject to confirmation. Supplier direct versus Civilon New Jersey stays internal. Never enter payment credentials.</li>
          <li><b>Keep records</b> — the checklist is guidance: it stores nothing and proves nothing. The stored facts remain the request status, the assignment, the supplier responses, the Civilon offer, the internal notes and the audit trail. The template fills only an empty note box. It never saves, never submits, and is refused while the box already holds text.</li>
        </ul>
      </section>

      <section id="marketplace-limits" className="admin-panel">
        <p className="admin-eyebrow">Boundaries</p>
        <h2>What Civilon never claims, and who never meets whom</h2>
        <ul className="admin-help-list">
          <li>Nothing Civilon does here is a certification, an airworthiness approval, or a regulatory approval. Reviewing a record, sourcing a part, recording an internal note, or running a Price Check is none of those things.</li>
          <li>Nothing here guarantees authenticity, fitness for a purpose, quality, or conformity to a specification. Say what a source stated; do not restate it as a Civilon assurance.</li>
          <li>Documentation varies by part and source, and all availability is subject to confirmation. A supplier claim is a claim, not a confirmation.</li>
          <li>The buyer and the supplier never see each other. Supplier identity, cost, documents and routing stay internal; the buyer sees only Civilon&apos;s terms and a buyer-facing delivery option.</li>
          <li>Email is notification only. The record in this console is the system of record — never work from an inbox.</li>
        </ul>
      </section>
    </div>

    <div className="admin-help-grid">
      <section id="workflow" className="admin-panel"><p className="admin-eyebrow">Price Check workflow</p><h2>Work in five phases</h2><ol className="admin-help-steps"><li><b>Intake</b><span>Confirm the request, customer context, and owner.</span></li><li><b>Verify Transaction</b><span>Review clean documents, extraction proposals, and revisions.</span></li><li><b>Analyze Evidence</b><span>Select governed comparables and save deterministic analysis.</span></li><li><b>Prepare Result</b><span>Draft, review, and approve customer-facing content.</span></li><li><b>Delivery & Follow-up</b><span>Confirm secure delivery and follow sourcing opportunities.</span></li></ol></section>
      <section id="page-map" className="admin-panel"><p className="admin-eyebrow">Page map</p><h2>Where to work</h2><dl className="admin-help-map"><div><dt>All Work</dt><dd>Every Price Check, Buy Request and Sell Submission in one queue, capped at the first 200 — narrow it with the filters.</dd></div><div><dt>Buy Requests / Sell Submissions</dt><dd>The same records, one side at a time, with the detail pages that record supplier responses, Civilon offers and evidence.</dd></div><div><dt>Review Queue</dt><dd>Price Check only, and shown only while Price Check is enabled.</dd></div><div><dt>Request detail</dt><dd>Use the workflow map, section navigator, and recommended action.</dd></div><div><dt>Staff</dt><dd>ADMIN only: add exact emails, manage roles, and revoke access.</dd></div><div><dt>Operations Guide</dt><dd>Return here for quick help without leaving the admin workspace.</dd></div></dl></section>
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
