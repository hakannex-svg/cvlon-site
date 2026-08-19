import { buyerDecisions, type BuyerDecision } from "@/db/price-check/domain/buyer-decision";
import { buyerDecisionLabels } from "@/lib/price-check/admin/display";
import type { BuyerDecisionCounts } from "@/db/price-check/repositories/marketplace-admin-repository";

/**
 * What buyers have said about Civilon's current offers, as two numbers on the
 * All Work page.
 *
 * A buyer answers an offer and then nothing visibly happens: the answer lives on
 * the Buy Request, and finding it means opening every Buy Request one at a time.
 * These two numbers are that answer surfaced, and each of them opens the Buy
 * Request list narrowed to exactly the requests it counted — the same reading,
 * restated once in `marketplace-admin-repository.ts` and held against the pure
 * rule in `buyer-decision.ts` by the tests.
 *
 * Both counters count Buy Requests and only Buy Requests, so the two numbers are
 * comparable with each other and no request is counted twice however many offers
 * it has carried.
 *
 * Nothing here is a Civilon position on the part or on the deal. An accepted
 * offer is a thing a buyer said, and the copy below says so rather than leaving a
 * reader to infer it.
 */

/** What each counter means, in a sentence a staff member can act on. */
const decisionDetails: Record<BuyerDecision, string> = {
  accepted: "Civilon follow-up is required.",
  declined: "Review, revise or close the request.",
};

/** The one list these counters drill into. Buy Requests and nowhere else. */
const BUY_REQUEST_LIST_PATH = "/admin/buy-requests";

export function BuyerDecisionAlert({ counts }: { counts: BuyerDecisionCounts }) {
  // Only the counter that means somebody has to do something now colours the
  // section. A declined offer is follow-up work rather than an alarm.
  const needsAttention = counts.accepted > 0;

  return <aside
    className={`admin-buyer-decisions${needsAttention ? " needs-attention" : ""}`}
    aria-labelledby="buyer-decisions-heading"
  >
    <div className="admin-buyer-decisions-intro">
      <span>Buyer response</span>
      <h2 id="buyer-decisions-heading">Buyer decisions</h2>
      <p>
        Latest buyer answer on each open Buy Request. Only the newest Civilon
        offer counts.
      </p>
      <p>
        Acceptance needs Civilon follow-up. It is not proof of payment,
        procurement, shipment or documentation acceptance; it is not
        certification, airworthiness approval, or a guarantee of authenticity or
        fitness. Availability remains subject to confirmation.
      </p>
    </div>

    <dl aria-label="Buyer decision counters">
      {buyerDecisions.map(decision => <div key={decision} className={`counter-${decision}`}>
        <dt>{buyerDecisionLabels[decision]}</dt>
        <dd><a
          href={`${BUY_REQUEST_LIST_PATH}?decision=${decision}`}
          aria-label={`${buyerDecisionLabels[decision]}: open ${counts[decision]} in Buy Requests`}
        ><strong>{counts[decision]}</strong></a><span>{decisionDetails[decision]}</span></dd>
      </div>)}
    </dl>

    <p className="admin-buyer-decisions-scope">
      Converted, closed, spam and withdrawn requests are excluded. Draft, sent,
      expired, superseded and withdrawn offers appear in neither count.
    </p>
  </aside>;
}
