import { formatDateTime, marketplaceStatusLabels, staffDisplayName, unifiedStatusLabel } from "@/lib/price-check/admin/display";
import { isMarketplaceTerminalStatus, marketplaceExceptionalTargets } from "@/db/price-check/domain/marketplace-status-policy";
import { latestBuyerDecision } from "@/db/price-check/domain/buyer-decision";
import type { BuyRequestAdminDetail, BuyerOfferRecord } from "@/db/price-check/repositories/marketplace-admin-repository";
import { MarketplaceDetailActions } from "./MarketplaceDetailActions";
import { SupplierResponseActions } from "./SupplierResponseActions";
import { BuyerOfferActions } from "./BuyerOfferActions";
import type { MarketplaceActionContext } from "@/lib/price-check/admin/marketplace-access";
import {
  AssignmentPanel,
  AttributionPanel,
  Field,
  InternalOnlyBadge,
  MarketplaceAuditTimeline,
  MarketplaceContactPanel,
  MarketplaceNotesPanel,
  value,
} from "./MarketplaceShared";

const conditionLabels: Record<string, string> = {
  NE: "New", NS: "New surplus", OH: "Overhauled", SV: "Serviceable",
  AR: "As removed", ANY: "Any condition", NOT_SURE: "Not sure",
};

const urgencyLabels: Record<string, string> = {
  aog: "AOG", critical: "Critical", standard: "Standard",
  planned: "Planned", not_sure: "Not sure",
};

const fulfillmentLabels: Record<string, string> = {
  door_delivery: "Delivery to door",
  port_of_entry: "Port of entry",
  nj_pickup: "Pickup from Civilon New Jersey",
  not_sure: "Not sure",
};

const deliveryOptionLabels: Record<string, string> = {
  door_delivery: "Delivery to door",
  port_of_entry: "Port of entry",
  nj_pickup: "Pickup from Civilon New Jersey",
  not_determined: "Not determined",
};

const availabilityLabels: Record<string, string> = {
  subject_to_confirmation: "Subject to confirmation",
  claimed_available: "Supplier claims available",
  claimed_lead_time: "Supplier claims lead time",
  unavailable: "Unavailable",
  unknown: "Unknown",
};

function money(amount: string | null, currency: string | null) {
  if (!amount) return "Quote on request";
  return `${amount} ${currency ?? ""}`.trim();
}

/**
 * The internal note a staff member would otherwise retype for every accepted
 * deal, offered as a starting point they still have to fill in.
 *
 * Every line below is a prompt, never an assertion. The template records that
 * somebody was asked a question, not that anything was done: the three-way
 * choices are left unresolved so the saved note carries a staff decision rather
 * than a default, and no line claims a reconfirmation, a payment, a shipment or
 * a delivery has happened. It asks for no payment credential, no banking
 * detail, no card number and no token, because a staff note is not the place
 * for any of them.
 *
 * Returned as plain text. Filling the box is all it does; the existing audited
 * note route remains the only way anything is stored.
 */
function acceptedDealNoteTemplate(offer: BuyerOfferRecord) {
  return [
    `Accepted deal handoff — Civilon offer version ${offer.version}`,
    "",
    `Accepted offer version: ${offer.version} (buyer responded ${offer.respondedAt ? formatDateTime(offer.respondedAt) : "time not recorded"})`,
    "Owner / next action:",
    "Supplier reconfirmation (supplier claim only, never a Civilon confirmation of availability):",
    "Customer terms handled externally (no payment credentials, no banking data, no card details):",
    "Internal route: not determined / supplier direct / Civilon New Jersey",
    "Documentation operational review: not reviewed / reviewed / concern (not certification, not an airworthiness approval)",
    "Shipping / export coordination:",
    "Delivery / cancellation outcome:",
  ].join("\n");
}

/**
 * The two economic sides are rendered as two separate panels and are never
 * combined. The supplier panel carries the internal banner; the buyer-offer
 * panel contains no supplier field, because `BuyerOfferRecord` has none.
 */
export function BuyRequestDetail({
  detail, actions, supplierContacts, canRecordSupplierResponse, supplierOptions, canManageBuyerOffer,
}: {
  detail: BuyRequestAdminDetail;
  actions: MarketplaceActionContext;
  supplierContacts: readonly { id: string; companyName: string; firstName: string; lastName: string; country: string | null }[];
  canRecordSupplierResponse: boolean;
  supplierOptions: readonly { id: string; label: string; status: string }[];
  canManageBuyerOffer: boolean;
}) {
  const request = detail.buyRequest;

  /*
   * The accepted deal, read straight off the records that already exist.
   *
   * `latestBuyerDecision` stays the single authority on which answer is
   * current, exactly as the All Work counter reads it: an older acceptance
   * underneath a newer draft or sent offer is history, not work. The offer this
   * panel then describes is the highest-version one, and both readings have to
   * agree before anything renders, so a disagreement hides the handoff instead
   * of describing the wrong offer.
   *
   * The status gate is `isMarketplaceTerminalStatus`, deliberately not the
   * counter's concluded set. That set treats `converted` as over, which is
   * right for a queue that must not chase finished work and wrong here:
   * `converted` means Civilon has begun carrying this deal out and still has to
   * close it, which is precisely when the checklist is being used.
   *
   * Nothing here is stored, and no record is touched.
   */
  const currentOffer = detail.buyerOffers.reduce<BuyerOfferRecord | null>(
    (highest, offer) => (!highest || offer.version > highest.version ? offer : highest),
    null,
  );
  const acceptedOffer = latestBuyerDecision(detail.buyerOffers) === "accepted"
    && currentOffer?.status === "accepted"
    && !isMarketplaceTerminalStatus(request.status)
    ? currentOffer
    : null;
  const selectedResponseCount = detail.supplierResponses.filter(response => response.status === "selected").length;

  return <section className="admin-page">
    {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- deliberate plain anchor for resilient admin navigation */}
    <a className="admin-back" href="/admin/buy-requests">← Buy Requests</a>

    <header className="admin-triage-header">
      <div>
        <p className="admin-eyebrow">Buy Request</p>
        <h1>{request.publicReference}</h1>
        <p>Civilon sources this part on its own account. The supplier and the buyer never see each other. All availability is subject to confirmation.</p>
      </div>
      <dl>
        <div><dt>Status</dt><dd>{unifiedStatusLabel("buy_request", request.status)}</dd></div>
        <div><dt>Priority</dt><dd>{urgencyLabels[request.urgency] ?? request.urgency}</dd></div>
        <div><dt>Received</dt><dd>{formatDateTime(request.submittedAt)}</dd></div>
        <div><dt>Assigned</dt><dd>{staffDisplayName(detail.assignee?.email ?? null)}</dd></div>
      </dl>
    </header>

    <div className="admin-detail-grid">
      <div className="admin-detail-main">
        <section className="admin-panel" aria-label="Requested part">
          <div className="admin-panel-heading"><h2>Requested part</h2><span>Customer intake</span></div>
          <dl className="admin-definition-grid">
            <Field label="Part number">{request.originalPartNumber ? <code>{request.originalPartNumber}</code> : "—"}</Field>
            <Field label="Normalized">{request.normalizedPartNumber ? <code>{request.normalizedPartNumber}</code> : "—"}</Field>
            <Field label="Quantity">{value(request.quantity)}</Field>
            <Field label="Acceptable condition">{conditionLabels[request.acceptableCondition] ?? request.acceptableCondition}</Field>
            <Field label="Urgency">{urgencyLabels[request.urgency] ?? request.urgency}</Field>
            <Field label="Needed by">{value(request.neededByDate)}</Field>
            <Field label="Aircraft model">{value(request.aircraftModel)}</Field>
            <Field label="Buyer fulfillment preference">{fulfillmentLabels[request.fulfillmentPreference] ?? request.fulfillmentPreference}</Field>
            <Field label="Description" wide>{value(request.description)}</Field>
            <Field label="Application notes" wide>{value(request.applicationNotes)}</Field>
            <Field label="Customer notes" wide>{value(request.customerNotes)}</Field>
          </dl>
        </section>

        <section className="admin-panel" aria-label="Buyer delivery destination">
          <div className="admin-panel-heading"><h2>Buyer destination</h2><span>Customer intake</span></div>
          <dl className="admin-definition-grid">
            <Field label="Country">{value(request.deliveryCountry)}</Field>
            <Field label="City">{value(request.deliveryCity)}</Field>
            <Field label="Postal code">{value(request.deliveryPostalCode)}</Field>
            <Field label="Preference">{fulfillmentLabels[request.fulfillmentPreference] ?? request.fulfillmentPreference}</Field>
          </dl>
        </section>

        <MarketplaceContactPanel contact={detail.contact} />

        <section className="admin-panel" id="supplier-responses" aria-label="Supplier responses">
          <div className="admin-panel-heading"><h2>Supplier responses</h2><InternalOnlyBadge /></div>
          <p className="admin-muted">Internal sourcing only. Supplier identity, supplier contact, supplier cost, supplier documents and routing must never reach the buyer, any buyer-facing payload, or any buyer e-mail. A supplier claim is not a Civilon confirmation of availability.</p>
          {detail.supplierResponses.length === 0
            ? <p className="admin-muted">{canRecordSupplierResponse
                ? "No supplier responses recorded yet. Use the panel below to record what a registered or nonregistered supplier told you."
                : "No supplier responses recorded yet. Your role cannot record one."}</p>
            : <div className="admin-table-wrap"><table className="admin-queue-table">
                <caption className="sr-only">Internal supplier responses</caption>
                <thead><tr><th>Supplier</th><th>Source</th><th>Country</th><th>Part offered</th><th>Condition</th><th>Qty</th><th>Supplier cost</th><th>Availability</th><th>Lead time</th><th>Status</th><th>Received</th></tr></thead>
                <tbody>{detail.supplierResponses.map(response => <tr key={response.id}>
                  <td data-label="Supplier">{value(response.supplierNameSnapshot)}</td>
                  <td data-label="Source">{response.supplierKind === "registered_contact" ? "Registered" : "Nonregistered"}</td>
                  <td data-label="Country">{value(response.supplierCountry)}</td>
                  <td data-label="Part offered">{response.offeredPartNumber ? <code>{response.offeredPartNumber}</code> : "—"}</td>
                  <td data-label="Condition">{value(response.statedCondition)}</td>
                  <td data-label="Qty">{value(response.quantityAvailable)}</td>
                  <td data-label="Supplier cost">{money(response.supplierUnitCost, response.currencyCode)}</td>
                  <td data-label="Availability">{availabilityLabels[response.availabilityState] ?? response.availabilityState}</td>
                  <td data-label="Lead time">{response.leadTimeDays === null ? "—" : `${response.leadTimeDays} d`}</td>
                  <td data-label="Status">{value(response.status)}</td>
                  <td data-label="Received">{formatDateTime(response.receivedAt)}</td>
                </tr>)}</tbody>
              </table></div>}
          {canRecordSupplierResponse ? <SupplierResponseActions
            buyRequestId={request.id}
            contacts={supplierContacts}
            responses={detail.supplierResponses.map(response => ({
              id: response.id,
              status: response.status,
              supplierNameSnapshot: response.supplierNameSnapshot,
            }))}
          /> : null}
        </section>

        <section className="admin-panel" id="civilon-offer" aria-label="Civilon buyer offers">
          <div className="admin-panel-heading"><h2>Civilon offer to buyer</h2><span>Buyer facing</span></div>
          <p className="admin-muted">Civilon&apos;s own separate offer: Civilon&apos;s sale price and the buyer-facing delivery option. This record carries no supplier identity, no supplier cost and no internal routing, and none may be added to it. Nothing here certifies a part, approves airworthiness, or guarantees authenticity, fitness or availability.</p>
          {detail.buyerOffers.length === 0
            ? <p className="admin-muted">{canManageBuyerOffer
                ? "No Civilon offer drafted yet. Use the panel below to draft Civilon's own sale terms for this buyer."
                : "No Civilon offer drafted yet. Your role cannot draft one."}</p>
            : <div className="admin-table-wrap"><table className="admin-queue-table">
                <caption className="sr-only">Civilon offers to the buyer</caption>
                <thead><tr><th>Version</th><th>Civilon sale price</th><th>Qty</th><th>Condition</th><th>Delivery option</th><th>Lead time</th><th>Status</th><th>Sent</th><th>Buyer responded</th><th>Expires</th><th>Drafted by</th></tr></thead>
                <tbody>{detail.buyerOffers.map(offer => <tr key={offer.id}>
                  <td data-label="Version">{offer.version}</td>
                  <td data-label="Civilon sale price">{money(offer.civilonSaleUnitPrice, offer.currencyCode)}</td>
                  <td data-label="Qty">{value(offer.quantity)}</td>
                  <td data-label="Condition">{value(offer.statedCondition)}</td>
                  <td data-label="Delivery option">{deliveryOptionLabels[offer.deliveryOption] ?? offer.deliveryOption}</td>
                  <td data-label="Lead time">{offer.leadTimeDays === null ? "—" : `${offer.leadTimeDays} d`}</td>
                  <td data-label="Status">{value(offer.status)}</td>
                  <td data-label="Sent">{value(offer.sentAt)}</td>
                  <td data-label="Buyer responded">{value(offer.respondedAt)}</td>
                  <td data-label="Expires">{value(offer.expiresAt)}</td>
                  <td data-label="Drafted by">{staffDisplayName(offer.createdByEmail)}</td>
                </tr>)}</tbody>
              </table></div>}
          {canManageBuyerOffer ? <BuyerOfferActions
            buyRequestId={request.id}
            supplierOptions={supplierOptions}
            offers={detail.buyerOffers.map(offer => ({
              id: offer.id,
              version: offer.version,
              status: offer.status,
            }))}
          /> : null}
        </section>

        {acceptedOffer ? <section className="admin-panel" id="accepted-deal" aria-label="Accepted deal handoff">
          <div className="admin-panel-heading"><h2>Accepted deal — what happens next</h2><InternalOnlyBadge /></div>
          <p className="admin-muted">The buyer accepted Civilon offer version {acceptedOffer.version}. That is the buyer&apos;s answer on commercial terms and nothing more: it is not payment, not a purchase order, not procurement, not supplier reconfirmation, not shipment, not delivery, and not acceptance of documentation. It is not certification, not an airworthiness approval, and no guarantee of authenticity or fitness. All availability is subject to confirmation. Nothing on this checklist has happened until a staff member records that it did.</p>
          <dl className="admin-definition-grid">
            <Field label="Accepted offer version">{acceptedOffer.version}</Field>
            <Field label="Buyer responded">{value(acceptedOffer.respondedAt)}</Field>
            <Field label="Owner">{staffDisplayName(detail.assignee?.email ?? null)}
              <br /><small className="admin-muted">{detail.assignee ? "Assigned." : "Nobody owns this accepted deal yet."} Set it in the Actions panel.</small>
            </Field>
            <Field label="Internal supplier selection">{selectedResponseCount === 0
              ? "No supplier response is marked selected"
              : `${selectedResponseCount} supplier response${selectedResponseCount === 1 ? "" : "s"} marked selected`}
              <br /><small className="admin-muted">Marking a response selected is an internal sourcing choice. It is not supplier reconfirmation, and it is not a Civilon confirmation that the part is available.</small>
            </Field>
            <Field label="Buyer-facing delivery option">{deliveryOptionLabels[acceptedOffer.deliveryOption] ?? acceptedOffer.deliveryOption}</Field>
            <Field label="Shipping and export scope" wide>{value(acceptedOffer.shippingAndExportScope)}
              <br /><small className="admin-muted">The delivery option and this scope are what the accepted offer promised the buyer. They are not proof that any of it was carried out. Whether Civilon routes this supplier-direct or through Civilon New Jersey is a separate internal decision that never appears on a buyer offer.</small>
            </Field>
          </dl>
          <ol className="admin-help-steps">
            <li><b>Assign an owner</b><span>One named staff member owns this deal end to end. Set the assignment in <a href="#record-actions">Actions</a>.</span></li>
            <li><b>Reconfirm with the supplier</b><span>Ask the supplier to restate the claim, terms, condition, quantity and documentation before Civilon commits, and record the answer under <a href="#supplier-responses">Supplier responses</a>. What comes back is still a supplier claim.</span></li>
            <li><b>Handle the customer&apos;s commercial and payment terms externally</b><span>Agree them on Civilon&apos;s normal commercial channel and record only the outcome in an internal note. Never type payment credentials, banking data, card details, tokens or secrets into this console.</span></li>
            <li><b>Choose and record the internal route</b><span>Supplier direct, or through Civilon New Jersey. It is an internal decision: keep it in the note and never add it to <a href="#civilon-offer">the Civilon offer</a> or to anything the buyer sees.</span></li>
            <li><b>Coordinate shipping and export</b><span>Work the accepted delivery option and export scope with the relevant shipping and export specialists. Documentation varies by part and source, so agree what is actually needed rather than assuming it.</span></li>
            <li><b>Convert, then close</b><span>Move the request to Converted in <a href="#record-actions">Actions</a> only once execution actually begins. After delivery or cancellation, add a final note and Close the record.</span></li>
          </ol>
          <p className="admin-muted">This checklist is guidance for staff, not a record of anything. The stored facts stay where they already are: the request status, the assignment, the supplier responses, the Civilon offer, the internal notes and the audit trail. <a href="/admin/help#accepted-deal">Operations guide →</a></p>
        </section> : null}

        <MarketplaceNotesPanel notes={detail.notes} />
        <MarketplaceAuditTimeline audit={detail.audit} />
      </div>

        <MarketplaceDetailActions
          basePath="/api/admin/marketplace/buy-requests"
          recordId={request.id}
          currentStatus={request.status}
          businessReviewState={detail.contact.businessReviewState}
          statusOptions={actions.statusOptions}
          statusLabels={marketplaceStatusLabels}
          assigneeId={detail.assignee?.id ?? null}
          staff={actions.staff}
          exceptionalStatuses={marketplaceExceptionalTargets}
          canAssign={actions.canAssign}
          canTransition={actions.canTransition}
          canWriteNote={actions.canWriteNote}
          canReview={actions.canReview}
          noteTemplate={acceptedOffer ? acceptedDealNoteTemplate(acceptedOffer) : undefined}
          noteTemplateLabel="Start an accepted-deal note"
        />
      <div className="admin-detail-aside">
        <AssignmentPanel
          assignee={detail.assignee}
          verificationState={request.verificationState}
          status={<span className={`admin-status status-${request.status}`}>{unifiedStatusLabel("buy_request", request.status)}</span>}
        />
        <section className="admin-panel" aria-label="Record timestamps">
          <div className="admin-panel-heading"><h2>Record</h2><span>System of record</span></div>
          <dl className="admin-definition-grid">
            <Field label="Reference"><code>{request.publicReference}</code></Field>
            <Field label="Received">{value(request.submittedAt)}</Field>
            <Field label="Verification requested">{value(request.verificationRequestedAt)}</Field>
            <Field label="Workflow verification gate cleared" wide>{value(request.verifiedAt)}
              <br /><small className="admin-muted">A technical workflow timestamp. It records that this record passed a verification gate, either by customer e-mail confirmation or by an audited staff override. It is not proof the customer confirmed their address — the contact panel is authoritative for that.</small>
            </Field>
            <Field label="Last updated">{value(request.updatedAt)}</Field>
            <Field label="Closed">{value(request.closedAt)}</Field>
            <Field label="From Price Check" wide>{request.sourcePriceCheckId
              ? <><a href={`/admin/price-checks/${request.sourcePriceCheckId}#result`}>Originating Price Check result</a>{request.sourceResultId ? <><br /><small className="admin-muted">Exact result record: <code>{request.sourceResultId}</code></small></> : null}</>
              : "—"}</Field>
          </dl>
        </section>
        <AttributionPanel attribution={request} />
      </div>
    </div>
  </section>;
}
