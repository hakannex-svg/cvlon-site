import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { CustomerResultView } from "@/components/price-check/CustomerResultView";
import { CleanResultUrl } from "@/components/price-check/CleanResultUrl";
import { ResultSourcingAction } from "@/components/price-check/ResultSourcingAction";
import { formatDateTime, formatMoney } from "@/lib/price-check/admin/display";
import { RESULT_SESSION_COOKIE, resultTokenKey, verifyResultSession } from "@/lib/price-check/result-session";

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
  const { result, analysis, priceCheck } = customer;
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
  return <main className="private-result-page" data-result-page="private"><CleanResultUrl /><CustomerResultView model={model} action={<ResultSourcingAction alreadyRequested={customer.sourcingRequested} />} /></main>;
}
