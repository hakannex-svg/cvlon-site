import { formatDateTime, marketplaceStatusLabels, staffDisplayName, unifiedStatusLabel } from "@/lib/price-check/admin/display";
import { marketplaceExceptionalTargets } from "@/db/price-check/domain/marketplace-status-policy";
import type { BuyRequestAdminDetail } from "@/db/price-check/repositories/marketplace-admin-repository";
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

        <section className="admin-panel" aria-label="Supplier responses">
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

        <section className="admin-panel" aria-label="Civilon buyer offers">
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
              ? <a href={`/admin/price-checks/${request.sourcePriceCheckId}`}>Originating Price Check</a>
              : "—"}</Field>
          </dl>
        </section>
        <AttributionPanel attribution={request} />
      </div>
    </div>
  </section>;
}
