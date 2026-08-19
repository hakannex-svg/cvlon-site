import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { CustomerResultView } from "@/components/price-check/CustomerResultView";
import { CleanResultUrl } from "@/components/price-check/CleanResultUrl";
import { ResultSourcingAction } from "@/components/price-check/ResultSourcingAction";
import { formatDateTime, formatMoney } from "@/lib/price-check/admin/display";
import { RESULT_SESSION_COOKIE, resultTokenKey, verifyResultSession } from "@/lib/price-check/result-session";
import { isSellSubmissionEnabled } from "@/lib/marketplace/feature";
import { SELL_SUBMISSION_PAGE } from "@/lib/marketplace/contract";

/**
 * The seller path off the private result.
 *
 * A plain link and nothing else. No query string, so no part number, price,
 * company, contact detail or secure reference ever leaves this page in a URL;
 * no conversion endpoint, because there is nothing to convert — the visitor
 * states what they hold on the Sell intake; and no analytics event, because
 * this page is private and stays out of the analytics stream entirely.
 */
function ResultSellPath() {
  return <section className="result-sell-path" data-result-region="sell-path">
    <p>Holding this part instead?</p>
    <h2>Sell this part to Civilon</h2>
    <span>
      Civilon buys parts and inventory on its own account. Nothing from this
      Price Check is carried over—you tell Civilon what you hold, and the team
      reviews it internally. Nothing you send is published or listed, Civilon is
      not obliged to buy, and interest, stated condition, documentation and
      price remain subject to confirmation.
    </span>
    <a className="result-sell-path-action" href={SELL_SUBMISSION_PAGE}>Sell this part to Civilon <span aria-hidden="true">→</span></a>
  </section>;
}

export const metadata: Metadata = { title: "Private Price Check Result | Civilon", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function CustomerResultPage() {
  let customer = null;
  try {
    const session = verifyResultSession(resultTokenKey(), (await cookies()).get(RESULT_SESSION_COOKIE)?.value);
    if (session) {
      const [{ priceCheckDb }, { getCustomerResult }] = await Promise.all([import("@/db/price-check"), import("@/db/price-check/repositories/result-delivery-repository")]);
      customer = await getCustomerResult(priceCheckDb, session);
    }
  } catch { customer = null; }
  if (!customer) return <main className="private-result-page" data-result-page="private"><CleanResultUrl /><section className="result-unavailable" data-result-region="unavailable-state"><p>Civilon Price Check</p><h1>This Price Check result link is no longer available.</h1><p>For privacy, Civilon cannot provide additional information about this link.</p><Link href="/contact-us">Contact Civilon</Link></section></main>;
  const { result, analysis, priceCheck, requester } = customer;
  const currency = analysis.currencyCode ?? priceCheck.currencyCode;
  const model = {
    reference: priceCheck.publicReference,
    reviewed: formatDateTime(result.approvedAt ?? result.createdAt),
    classification: result.approvedClassification,
    submittedPrice: formatMoney(priceCheck.unitPrice, priceCheck.currencyCode),
    confidence: analysis.confidence,
    displayRange: result.displayRange,
    displayEvidenceCount: result.displayEvidenceCount,
    evidenceCount: analysis.evidenceCount,
    low: analysis.marketLow ? formatMoney(analysis.marketLow, currency) : null,
    median: analysis.marketMedian ? formatMoney(analysis.marketMedian, currency) : null,
    high: analysis.marketHigh ? formatMoney(analysis.marketHigh, currency) : null,
    factorCodes: result.approvedFactorList,
    explanation: result.approvedExplanation,
    limitation: result.limitedEvidenceStatement,
  };
  const initialCondition = ["NE", "NS", "OH", "SV", "AR"].includes(priceCheck.conditionCode)
    ? priceCheck.conditionCode as "NE" | "NS" | "OH" | "SV" | "AR"
    : "NOT_SURE";
  return <main className="private-result-page" data-result-page="private"><CleanResultUrl /><CustomerResultView model={model} action={<><ResultSourcingAction
    partNumber={priceCheck.originalPartNumber}
    initialQuantity={priceCheck.quantity}
    initialCondition={initialCondition}
    initialUrgency={priceCheck.aog ? "aog" : "not_sure"}
    initialCountry={requester.country ?? ""}
    hasPhoneOnFile={Boolean(requester.phone)}
    legacySourcingRequested={customer.sourcingRequested}
    existingRequest={customer.linkedBuyRequest ? { reference: customer.linkedBuyRequest.publicReference, status: customer.linkedBuyRequest.status } : null}
  />{isSellSubmissionEnabled() && <ResultSellPath />}</>} /></main>;
}
