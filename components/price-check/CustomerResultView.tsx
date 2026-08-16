import { RESULT_DISCLAIMER, factorLabels } from "@/lib/price-check/result-copy";

export type CustomerResultViewModel = {
  reference: string;
  reviewed: string;
  classification: string;
  submittedPrice: string;
  confidence: string;
  displayRange: boolean;
  displayEvidenceCount: boolean;
  evidenceCount: number;
  low: string | null;
  median: string | null;
  high: string | null;
  factorCodes: string[];
  explanation: string;
  limitation: string | null;
};

const labels: Record<string, string> = {
  BELOW_OBSERVED_RANGE: "Below observed range",
  WITHIN_OBSERVED_RANGE: "Within observed comparable range",
  ABOVE_OBSERVED_RANGE: "Above observed range",
  INSUFFICIENT_COMPARABLE_EVIDENCE: "Insufficient comparable evidence",
};

export function CustomerResultView({ model, preview = false, action }: { model: CustomerResultViewModel; preview?: boolean; action?: React.ReactNode }) {
  return <article className="customer-result-card" aria-labelledby="customer-result-title" data-result-region="outer-container">
    <header data-result-region="result-header">{preview && <span className="result-preview-badge">Preview</span>}<p>Civilon Price Check</p><h1 id="customer-result-title" data-result-region="public-reference">{model.reference}</h1><time>{model.reviewed}</time></header>
    <section className="result-position" aria-labelledby="result-position-title" data-result-region="price-position"><p>Price position</p><h2 id="result-position-title">{labels[model.classification] ?? "Insufficient comparable evidence"}</h2></section>
    <section className="result-facts" data-result-region="summary-metrics"><div data-result-region="submitted-price"><span>Your submitted price</span><strong>{model.submittedPrice}</strong></div><div data-result-region="confidence"><span>Confidence</span><strong>{model.confidence.replaceAll("_", " ")}</strong></div>{model.displayEvidenceCount && <div data-result-region="observation-count"><span>Reviewed observations</span><strong>{model.evidenceCount}</strong></div>}</section>
    {model.displayRange && model.low && model.median && model.high && <section className="result-range" aria-labelledby="result-range-title" data-result-region="observed-range"><p>Observed comparable indications</p><h2 id="result-range-title" className="sr-only">Observed comparable range</h2><dl><div><dt>Low</dt><dd>{model.low}</dd></div><div><dt>Median</dt><dd>{model.median}</dd></div><div><dt>High</dt><dd>{model.high}</dd></div></dl>{model.limitation && <p className="result-limitation">{model.limitation}</p>}</section>}
    {model.factorCodes.length > 0 && <section className="result-influences" data-result-region="influences"><p>What influenced this review</p><ul>{model.factorCodes.map((code) => <li key={code}>{factorLabels[code]}</li>)}</ul></section>}
    <section className="result-explanation" data-result-region="explanation"><p>Explanation</p><div>{model.explanation}</div></section>
    <section className="result-disclaimer" data-result-region="disclaimer"><p>Important information</p><div>{RESULT_DISCLAIMER}</div></section>
    {action}
  </article>;
}
