import {
  SELL_INVENTORY_FRESHNESS_CADENCE_DAYS,
  SELL_INVENTORY_FRESHNESS_CADENCE_MAX_LAPSED_AUTOMATIC,
  SELL_INVENTORY_FRESHNESS_TTL_DAYS,
  type SellInventoryFreshnessFilter,
} from "@/db/price-check/domain/sell-inventory-freshness";
import type { SellInventoryFreshnessHealthCounts } from "@/db/price-check/repositories/marketplace-admin-repository";

/**
 * The bulk-inventory freshness workflow, as five numbers on the All Work page.
 *
 * A summary that can be opened: it says how much of the workflow is waiting, how
 * much has stopped and why, and each of the four record counters links to the
 * Sell Submission list narrowed to exactly the records it counted. The link is
 * honest because the filter behind it is the same predicate the counter is — the
 * producer's own, restated once in `marketplace-admin-repository.ts` and held
 * against the pure cadence rule by the tests.
 *
 * Delivery concerns is deliberately not a link, and the section says so. It
 * counts queued e-mails rather than Sell Submissions, so there is no list of
 * records it could open without answering a different question from the one the
 * number asked.
 *
 * Two populations are counted, and the caption says which is which. Due, Live
 * links, Backoff and Seller changes count Sell Submissions; Delivery concerns
 * counts queued e-mails, because "how many messages did Civilon fail to send" is
 * a question about messages. Labelling both as though they counted the same
 * thing would make five numbers read as one total.
 *
 * Nothing here is a Civilon position on the parts. A seller's answer is that
 * seller's own statement about their own stock at one moment, and the copy below
 * says so rather than leaving a reader to infer it.
 */

/**
 * What each counter means, in a sentence a staff member can act on. Every line
 * describes stored state; none describes a conclusion Civilon has drawn.
 */
const counterDetails: Record<keyof SellInventoryFreshnessHealthCounts, string> = {
  dueNow: "Records the automatic check would ask about now. It works through them a batch at a time, so this is the backlog rather than the next run.",
  liveLinks: "Records where a seller is holding a link that still works. Nothing on a timer touches one of these.",
  backoff: "Records where two automatic asks in a row expired unanswered. Automation has stopped there until a staff member asks by hand.",
  sellerChanges: "Records where the seller's latest answer was that some or all of the inventory changed. Automation stops until someone asks again.",
  deliveryConcerns: "Freshness emails Civilon has not managed to send. The checks themselves are still recorded. It counts emails rather than records, so there is no record list to open.",
};

const counterLabels: Record<keyof SellInventoryFreshnessHealthCounts, string> = {
  dueNow: "Due now",
  liveLinks: "Live links",
  backoff: "Backoff",
  sellerChanges: "Seller changes",
  deliveryConcerns: "Delivery concerns",
};

/**
 * Which Sell Submission freshness filter each counter opens, or `null` for the
 * one that counts messages instead of records and therefore opens nothing.
 *
 * The values are the repository's own allowlist, so a counter cannot link to a
 * filter that does not exist, and the four links are the only navigation this
 * section has.
 */
const counterFilters: Record<
  keyof SellInventoryFreshnessHealthCounts,
  SellInventoryFreshnessFilter | null
> = {
  dueNow: "due",
  liveLinks: "live",
  backoff: "backoff",
  sellerChanges: "seller_changes",
  deliveryConcerns: null,
};

/** The one list these counters drill into. Sell Submissions and nowhere else. */
const SELL_SUBMISSION_LIST_PATH = "/admin/sell-submissions";

/** Fixed order, so the section reads the same way on every load. */
const counterOrder = [
  "dueNow",
  "liveLinks",
  "backoff",
  "sellerChanges",
  "deliveryConcerns",
] as const satisfies readonly (keyof SellInventoryFreshnessHealthCounts)[];

export function InventoryFreshnessHealth({ counts }: { counts: SellInventoryFreshnessHealthCounts }) {
  // Only the two counters that mean somebody has to do something colour the
  // section. A backlog and a live link are the workflow working.
  const needsAttention = counts.backoff > 0 || counts.sellerChanges > 0 || counts.deliveryConcerns > 0;

  return <aside
    className={`admin-freshness-health${needsAttention ? " needs-attention" : ""}`}
    aria-labelledby="inventory-freshness-health-heading"
  >
    <div className="admin-freshness-health-intro">
      <span>Bulk inventory</span>
      <h2 id="inventory-freshness-health-heading">Inventory freshness</h2>
      <p>
        Civilon asks bulk-inventory sellers whether what they offered is still
        available every {SELL_INVENTORY_FRESHNESS_CADENCE_DAYS} days. Each emailed
        link lasts {SELL_INVENTORY_FRESHNESS_TTL_DAYS} days, and the automatic
        check pauses for a record after{" "}
        {SELL_INVENTORY_FRESHNESS_CADENCE_MAX_LAPSED_AUTOMATIC} unanswered asks in
        a row until a staff member asks by hand.
      </p>
      <p>
        A seller&rsquo;s answer is that seller&rsquo;s own statement about their
        own stock at that moment. It is not Civilon certification, not an
        airworthiness approval, not an authenticity guarantee and not a guarantee
        of fitness for any use, and availability remains subject to confirmation.
      </p>
    </div>

    <dl aria-label="Inventory freshness counters">
      {counterOrder.map(key => {
        const filter = counterFilters[key];
        return <div key={key} className={`counter-${key}`}>
          <dt>{counterLabels[key]}</dt>
          <dd>{filter
            ? <a
              href={`${SELL_SUBMISSION_LIST_PATH}?freshness=${filter}`}
              aria-label={`${counterLabels[key]}: open ${counts[key]} in Sell Submissions`}
            ><strong>{counts[key]}</strong></a>
            : <strong>{counts[key]}</strong>
          }<span>{counterDetails[key]}</span></dd>
        </div>;
      })}
    </dl>

    <p className="admin-freshness-health-scope">
      Due now, Live links, Backoff and Seller changes each count bulk-inventory
      Sell Submissions Civilon may still ask about, and no record is counted twice.
      Each of those four opens the Sell Submissions list narrowed to exactly the
      records it counted. Delivery concerns counts queued emails instead, so it is not comparable with
      the other four and opens nothing. A record inside its{" "}
      {SELL_INVENTORY_FRESHNESS_CADENCE_DAYS} days appears in none of them.
    </p>
  </aside>;
}
