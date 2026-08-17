"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { excludeReasonCodes, includeReasonCodes } from "@/lib/price-check/admin/analysis-options";

type Candidate = {
  id: string;
  originalPartNumber: string;
  normalizedPartNumber: string;
  relationshipType: string;
  conditionCode: string;
  transactionType: string;
  quantity: string;
  unitPrice: string;
  currencyCode: string;
  coreCharge: string | null;
  coreDisposition: string | null;
  exchangeFee: string | null;
  freight: string | null;
  observationDate: string;
  warrantyValue: string | null;
  warrantyUnit: string | null;
  warrantyText: string | null;
  documentationCodes: string[];
  aog: boolean;
  aircraftApplication: string | null;
  sourceReliability: string;
  verificationState: string;
  permittedUseState: string;
  provenanceType: string;
  eligible: boolean;
};

type Relationship = {
  id: string;
  fromNormalizedPartNumber: string;
  toNormalizedPartNumber: string;
  relationshipType: string;
  sourceProvenance: string;
  verificationState: string;
  reviewerEmail: string | null;
  notes: string | null;
};

type AnalysisHistory = {
  id: string;
  version: number;
  evidenceCount: number;
  confidence: string;
  classification: string | null;
  marketLow: string | null;
  marketMedian: string | null;
  marketHigh: string | null;
  currencyCode: string | null;
  factorCodes: string[];
  insufficiencyReasons: string[] | null;
  deterministicCalculation: Record<string, unknown>;
  deterministicCalculationDigest: string;
  reviewState: string;
  analystEmail: string | null;
  createdAt: string;
};

type Transaction = {
  originalPartNumber: string;
  normalizedPartNumber: string;
  conditionCode: string;
  transactionType: string;
  quantity: string;
  unitPrice: string;
  currencyCode: string;
  coreCharge: string | null;
  coreDisposition: string | null;
  exchangeFee: string | null;
  freight: string | null;
  warrantyValue: string | null;
  warrantyUnit: string | null;
  warrantyText: string | null;
  documentationCodes: string[];
  aog: boolean;
  transactionDate: string | null;
  aircraftModel: string | null;
};

type Decision = { included: boolean; reasonCode: string; analystNote: string };

async function post(path: string, body: unknown) {
  const response = await fetch(path, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({ ok: false, error: "The server response could not be read." }));
  if (!response.ok) throw new Error(payload.error ?? "The operation could not be completed.");
  return payload;
}

function money(value: string | null, currency: string) {
  if (!value) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(value));
}

function initialDecision(candidate: Candidate): Decision {
  if (candidate.verificationState !== "VERIFIED") return { included: false, reasonCode: "UNVERIFIED_PART_RELATIONSHIP", analystNote: "" };
  if (candidate.permittedUseState !== "INTERNAL_ANALYSIS") return { included: false, reasonCode: "PERMITTED_USE_RESTRICTION", analystNote: "" };
  return { included: false, reasonCode: "OTHER_REVIEWED_REASON", analystNote: "" };
}

export function AdminComparableWorkspace({
  priceCheckId,
  transaction,
  candidates,
  relationships,
  history,
  canAnalyze,
  canCreateObservation,
  canManageRelationships,
}: {
  priceCheckId: string;
  transaction: Transaction;
  candidates: Candidate[];
  relationships: Relationship[];
  history: AnalysisHistory[];
  canAnalyze: boolean;
  canCreateObservation: boolean;
  canManageRelationships: boolean;
}) {
  const router = useRouter();
  const [filters, setFilters] = useState({ scope: "all", condition: "", transaction: "", currency: "", documentation: "", aog: "", reliability: "", verification: "", permittedUse: "", dateFrom: "", dateTo: "", eligibility: "" });
  const [decisions, setDecisions] = useState<Record<string, Decision>>(() => Object.fromEntries(candidates.map((candidate) => [candidate.id, initialDecision(candidate)])));
  const [confidence, setConfidence] = useState("MEDIUM");
  const [confidenceReason, setConfidenceReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const visibleCandidates = useMemo(() => candidates.filter((candidate) => {
    if (filters.scope === "exact" && candidate.relationshipType !== "EXACT") return false;
    if (filters.scope === "related" && candidate.relationshipType === "EXACT") return false;
    if (filters.condition && candidate.conditionCode !== filters.condition) return false;
    if (filters.transaction && candidate.transactionType !== filters.transaction) return false;
    if (filters.currency && candidate.currencyCode !== filters.currency) return false;
    if (filters.documentation && !candidate.documentationCodes.includes(filters.documentation)) return false;
    if (filters.aog && candidate.aog !== (filters.aog === "yes")) return false;
    if (filters.reliability && candidate.sourceReliability !== filters.reliability) return false;
    if (filters.verification && candidate.verificationState !== filters.verification) return false;
    if (filters.permittedUse && candidate.permittedUseState !== filters.permittedUse) return false;
    if (filters.dateFrom && candidate.observationDate < filters.dateFrom) return false;
    if (filters.dateTo && candidate.observationDate > filters.dateTo) return false;
    if (filters.eligibility === "eligible" && !candidate.eligible) return false;
    if (filters.eligibility === "restricted" && candidate.eligible) return false;
    return true;
  }), [candidates, filters]);
  const selected = candidates.filter((candidate) => decisions[candidate.id]?.included);
  const latest = history[0];
  const latestPayload = latest?.deterministicCalculation ?? {};
  const persistedPosition = typeof latestPayload.pricePosition === "string" ? latestPayload.pricePosition : null;
  const positionClass = persistedPosition === "BELOW_OBSERVED_RANGE"
    ? "is-below"
    : persistedPosition === "ABOVE_OBSERVED_RANGE"
      ? "is-above"
      : "is-within";

  function updateDecision(id: string, patch: Partial<Decision>) {
    setDecisions((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  }

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true); setError(null); setMessage(null);
    try { await action(); setMessage(success); router.refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The operation could not be completed."); }
    finally { setBusy(false); }
  }

  return <section className="admin-analysis-workspace" aria-labelledby="analysis-workspace-title">
    <div className="admin-analysis-heading"><div><p className="admin-eyebrow">Analysis / comparables</p><h2 id="analysis-workspace-title">Observed comparable indications</h2><p>Governed evidence selection and deterministic descriptive calculations. No price adjustments or customer result are generated.</p></div><span className="admin-engine-label">Engine 1.0</span></div>

    {(message || error) && <div className={error ? "admin-error" : "admin-success"} role={error ? "alert" : "status"}>{error ?? message}</div>}

    {canManageRelationships && candidates.length === 0 && history.length === 0 && <section className="admin-preview-seed" aria-label="Synthetic preview evidence"><div><strong>Phase 5 preview evidence</strong><p>Create the approved fictional requests, observations, restrictions, and governed relationship scenarios in this isolated Deploy Preview only.</p></div><button type="button" disabled={busy} onClick={() => run(() => post("/api/admin/phase-5/seed", {}), "Synthetic Phase 5 preview evidence is ready.")}>Seed synthetic preview</button></section>}

    <div className="admin-analysis-layout">
      <section className="admin-panel admin-reviewed-transaction" aria-label="Reviewed transaction analysis input">
        <div className="admin-panel-heading"><div><p className="admin-eyebrow">Analysis input</p><h3 id="analysis-transaction-title">Reviewed transaction</h3></div></div>
        <dl className="admin-definition-grid compact">
          <div><dt>Part number</dt><dd><code>{transaction.originalPartNumber}</code></dd></div><div><dt>Condition</dt><dd>{transaction.conditionCode}</dd></div>
          <div><dt>Transaction</dt><dd>{transaction.transactionType}</dd></div><div><dt>Quantity</dt><dd>{transaction.quantity}</dd></div>
          <div><dt>Submitted price</dt><dd>{money(transaction.unitPrice, transaction.currencyCode)}</dd></div><div><dt>Currency</dt><dd>{transaction.currencyCode}</dd></div>
          <div><dt>Core</dt><dd>{transaction.coreDisposition ?? "—"} {transaction.coreCharge ? `· ${money(transaction.coreCharge, transaction.currencyCode)}` : ""}</dd></div><div><dt>Exchange fee</dt><dd>{money(transaction.exchangeFee, transaction.currencyCode)}</dd></div>
          <div><dt>Freight</dt><dd>{money(transaction.freight, transaction.currencyCode)}</dd></div><div><dt>AOG</dt><dd>{transaction.aog ? "Yes" : "No"}</dd></div>
          <div><dt>Warranty</dt><dd>{transaction.warrantyValue ? `${transaction.warrantyValue} ${transaction.warrantyUnit ?? ""}` : transaction.warrantyText ?? "—"}</dd></div><div><dt>Transaction date</dt><dd>{transaction.transactionDate ?? "—"}</dd></div>
          <div className="wide"><dt>Documentation</dt><dd>{transaction.documentationCodes.length ? transaction.documentationCodes.join(", ").replaceAll("_", " ") : "—"}</dd></div><div className="wide"><dt>Aircraft / model</dt><dd>{transaction.aircraftModel ?? "—"}</dd></div>
        </dl>
      </section>

      <section className="admin-panel admin-analysis-summary" aria-labelledby="analysis-summary-title">
        <div className="admin-panel-heading"><div><p className="admin-eyebrow">Selected evidence</p><h3 id="analysis-summary-title">Analysis summary</h3></div></div>
        <dl><div><dt>Selected</dt><dd>{selected.length || latest?.evidenceCount || 0}</dd></div><div><dt>Currency</dt><dd>{latest?.currencyCode ?? transaction.currencyCode}</dd></div><div><dt>Observed low</dt><dd>{latest?.marketLow ? money(latest.marketLow, latest.currencyCode!) : "—"}</dd></div><div><dt>Observed median</dt><dd>{latest?.marketMedian ? money(latest.marketMedian, latest.currencyCode!) : "—"}</dd></div><div><dt>Observed high</dt><dd>{latest?.marketHigh ? money(latest.marketHigh, latest.currencyCode!) : "—"}</dd></div><div><dt>Submitted</dt><dd>{money(transaction.unitPrice, transaction.currencyCode)}</dd></div><div><dt>Position</dt><dd>{String(persistedPosition ?? "Not calculated").replaceAll("_", " ")}</dd></div><div><dt>Confidence</dt><dd>{latest?.confidence ?? "Not selected"}</dd></div></dl>
        {latest?.marketLow && latest.marketMedian && latest.marketHigh && <div className={`admin-position-indicator ${positionClass}`} aria-label={`Observed range ${latest.marketLow} to ${latest.marketHigh}; median ${latest.marketMedian}; submitted ${transaction.unitPrice} ${transaction.currencyCode}; position ${String(persistedPosition).replaceAll("_", " ")}`}><span>LOW</span><span>MEDIAN</span><span>HIGH</span><i aria-hidden="true" /><small>Submitted price position is also stated textually above.</small></div>}
        <div className="admin-warning-summary"><strong>Warnings</strong>{latest?.factorCodes.length ? <ul>{latest.factorCodes.map((warning) => <li key={warning}>{warning.replaceAll("_", " ")}</li>)}</ul> : <p>No persisted warning set yet.</p>}</div>
      </section>
    </div>

    <section className="admin-panel admin-candidate-panel" aria-labelledby="candidate-title">
      <div className="admin-panel-heading"><div><p className="admin-eyebrow">Governed evidence</p><h3 id="candidate-title">Candidate observations</h3><p>{candidates.length} candidates · exact PN first · verified relationships only</p></div></div>
      <div className="admin-candidate-filters" role="group" aria-label="Candidate observation filters">
        <label><span>Part relationship</span><select value={filters.scope} onChange={(event) => setFilters({ ...filters, scope: event.target.value })}><option value="all">Exact + governed related</option><option value="exact">Exact PN only</option><option value="related">Governed related only</option></select></label>
        <label><span>Condition</span><select value={filters.condition} onChange={(event) => setFilters({ ...filters, condition: event.target.value })}><option value="">All conditions</option>{["NE","NS","OH","SV","AR","NOT_SURE"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>Transaction</span><select value={filters.transaction} onChange={(event) => setFilters({ ...filters, transaction: event.target.value })}><option value="">All types</option>{["outright","exchange","repair","not_sure"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>Currency</span><select value={filters.currency} onChange={(event) => setFilters({ ...filters, currency: event.target.value })}><option value="">All currencies</option>{["USD","EUR","GBP","CAD","AUD","CHF","JPY"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>Governance</span><select value={filters.eligibility} onChange={(event) => setFilters({ ...filters, eligibility: event.target.value })}><option value="">All states</option><option value="eligible">Selectable</option><option value="restricted">Restricted</option></select></label>
        <label><span>Documentation</span><select value={filters.documentation} onChange={(event) => setFilters({ ...filters, documentation: event.target.value })}><option value="">All documentation</option>{["FAA_8130_3","EASA_FORM_1","DUAL_RELEASE","OEM_MANUFACTURER_COC","MATERIAL_CERTIFICATION","REMOVAL_RECORDS","TEARDOWN_EVALUATION_REPORT","TEST_REPORT","NOT_SURE"].map((value) => <option key={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
        <label><span>AOG context</span><select value={filters.aog} onChange={(event) => setFilters({ ...filters, aog: event.target.value })}><option value="">All contexts</option><option value="yes">AOG only</option><option value="no">Routine only</option></select></label>
        <label><span>Reliability</span><select value={filters.reliability} onChange={(event) => setFilters({ ...filters, reliability: event.target.value })}><option value="">All reliability</option>{["HIGH","MEDIUM","LOW","UNKNOWN"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>Verification</span><select value={filters.verification} onChange={(event) => setFilters({ ...filters, verification: event.target.value })}><option value="">All verification</option>{["VERIFIED","PENDING","UNVERIFIED","REJECTED"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>Permitted use</span><select value={filters.permittedUse} onChange={(event) => setFilters({ ...filters, permittedUse: event.target.value })}><option value="">All use states</option>{["INTERNAL_ANALYSIS","AGGREGATE_ONLY","PENDING","PROHIBITED"].map((value) => <option key={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
        <label><span>Observed from</span><input type="date" value={filters.dateFrom} onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value })} /></label>
        <label><span>Observed through</span><input type="date" value={filters.dateTo} onChange={(event) => setFilters({ ...filters, dateTo: event.target.value })} /></label>
      </div>
      <div className="admin-candidate-list">
        {visibleCandidates.map((candidate) => {
          const decision = decisions[candidate.id];
          return <article key={candidate.id} className={`admin-candidate-card ${decision.included ? "is-included" : "is-excluded"}`}>
            <header><div><code>{candidate.originalPartNumber}</code><span>{candidate.relationshipType.replaceAll("_", " ")}</span></div><strong>{money(candidate.unitPrice, candidate.currencyCode)}</strong></header>
            <dl><div><dt>Date</dt><dd>{candidate.observationDate}</dd></div><div><dt>Condition</dt><dd>{candidate.conditionCode}</dd></div><div><dt>Transaction</dt><dd>{candidate.transactionType}</dd></div><div><dt>Quantity</dt><dd>{candidate.quantity}</dd></div><div><dt>Core</dt><dd>{candidate.coreDisposition ?? "—"}{candidate.coreCharge ? ` · ${money(candidate.coreCharge, candidate.currencyCode)}` : ""}</dd></div><div><dt>Exchange fee</dt><dd>{money(candidate.exchangeFee, candidate.currencyCode)}</dd></div><div><dt>Freight</dt><dd>{money(candidate.freight, candidate.currencyCode)}</dd></div><div><dt>Warranty</dt><dd>{candidate.warrantyValue ? `${candidate.warrantyValue} ${candidate.warrantyUnit ?? ""}` : candidate.warrantyText ?? "—"}</dd></div><div><dt>Documentation</dt><dd>{candidate.documentationCodes.length ? candidate.documentationCodes.join(", ").replaceAll("_", " ") : "—"}</dd></div><div><dt>AOG</dt><dd>{candidate.aog ? "Yes" : "No"}</dd></div><div><dt>Reliability</dt><dd>{candidate.sourceReliability}</dd></div><div><dt>Governance</dt><dd>{candidate.verificationState} · {candidate.permittedUseState.replaceAll("_", " ")}</dd></div><div className="wide"><dt>Provenance</dt><dd>{candidate.provenanceType.replaceAll("_", " ")}</dd></div></dl>
            {canAnalyze ? <div className="admin-candidate-decision"><div role="group" aria-label={`Decision for ${candidate.originalPartNumber}`}><button type="button" className={decision.included ? "active" : ""} disabled={!candidate.eligible || busy} onClick={() => updateDecision(candidate.id, { included: true, reasonCode: candidate.relationshipType === "EXACT" ? "EXACT_MATCH" : "GOVERNED_PART_RELATIONSHIP" })}>Include</button><button type="button" className={!decision.included ? "active" : ""} disabled={busy} onClick={() => updateDecision(candidate.id, { included: false, reasonCode: candidate.eligible ? "OTHER_REVIEWED_REASON" : initialDecision(candidate).reasonCode })}>Exclude</button></div><label><span>Controlled reason</span><select value={decision.reasonCode} onChange={(event) => updateDecision(candidate.id, { reasonCode: event.target.value })}>{(decision.included ? includeReasonCodes : excludeReasonCodes).map((reason) => <option key={reason} value={reason}>{reason.replaceAll("_", " ")}</option>)}</select></label><label><span>Analyst note <em>optional</em></span><input maxLength={1000} value={decision.analystNote} onChange={(event) => updateDecision(candidate.id, { analystNote: event.target.value })} /></label></div> : <p className="admin-muted">Read-only evidence decision.</p>}
          </article>;
        })}
        {!visibleCandidates.length && <div className="admin-empty-state"><strong>No candidates match these filters.</strong><p>Filters never create or infer part relationships.</p></div>}
      </div>
    </section>

    {canAnalyze && <section className="admin-panel admin-save-analysis" aria-labelledby="save-analysis-title"><div className="admin-panel-heading"><div><p className="admin-eyebrow">Immutable analysis version</p><h3 id="save-analysis-title">Save deterministic analysis</h3></div></div><div className="admin-analysis-save-grid"><label><span>Analyst confidence</span><select value={selected.length ? confidence : "INSUFFICIENT_DATA"} disabled={!selected.length || busy} onChange={(event) => setConfidence(event.target.value)}>{["HIGH","MEDIUM","LOW"].map((value) => <option key={value}>{value}</option>)}{!selected.length && <option>INSUFFICIENT_DATA</option>}</select></label><label className="wide"><span>Confidence reason {selected.length ? "" : "(optional for zero evidence)"}</span><textarea maxLength={1000} value={confidenceReason} onChange={(event) => setConfidenceReason(event.target.value)} placeholder="Explain the analyst confidence using the visible evidence dimensions." /></label><button disabled={busy || (selected.length > 0 && !confidenceReason.trim())} type="button" onClick={() => run(() => post(`/api/admin/price-checks/${priceCheckId}/analysis`, { decisions: candidates.map((candidate) => ({ observationId: candidate.id, ...decisions[candidate.id] })), confidence: selected.length ? confidence : "INSUFFICIENT_DATA", confidenceReason }), "A new immutable analysis version was saved.")}>Save analysis</button></div><p className="admin-muted">Low, median, high, warnings, and position are recomputed on the server. Browser-supplied calculation values are not accepted.</p></section>}

    <section className="admin-panel admin-analysis-history" aria-labelledby="analysis-history-title"><div className="admin-panel-heading"><div><p className="admin-eyebrow">Version history</p><h3 id="analysis-history-title">Analysis history</h3></div></div>{history.length ? <ol>{history.map((analysis) => <li key={analysis.id}><div><strong>Version {analysis.version}</strong><span>{analysis.reviewState.replaceAll("_", " ")}</span></div><dl><div><dt>Evidence</dt><dd>{analysis.evidenceCount}</dd></div><div><dt>Confidence</dt><dd>{analysis.confidence}</dd></div><div><dt>Position</dt><dd>{analysis.classification?.replaceAll("_", " ") ?? "—"}</dd></div><div><dt>Range</dt><dd>{analysis.marketLow && analysis.marketHigh ? `${money(analysis.marketLow, analysis.currencyCode!)} – ${money(analysis.marketHigh, analysis.currencyCode!)}` : "Not represented"}</dd></div><div><dt>Analyst</dt><dd>{analysis.analystEmail ?? "—"}</dd></div><div><dt>Created</dt><dd>{new Date(analysis.createdAt).toLocaleString()}</dd></div></dl><code className="admin-digest">Digest {analysis.deterministicCalculationDigest.slice(0, 16)}…</code></li>)}</ol> : <div className="admin-empty-state"><strong>No analysis version exists.</strong><p>Save a governed evidence decision set to create version 1.</p></div>}</section>

    <div className="admin-governance-grid">
      {canCreateObservation && <details className="admin-panel admin-details-action"><summary><span><b>Create governed observation</b><small>Manual or synthetic evidence; never created automatically from a customer submission.</small></span></summary><form className="admin-form-grid" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); run(() => post("/api/admin/observations", { provenanceType: data.get("provenanceType"), internalSourceReference: data.get("internalSourceReference"), originalPartNumber: data.get("originalPartNumber"), conditionCode: data.get("conditionCode"), transactionType: data.get("transactionType"), quantity: data.get("quantity"), unitPrice: data.get("unitPrice"), currencyCode: data.get("currencyCode"), coreCharge: data.get("coreCharge"), coreDisposition: data.get("coreDisposition"), exchangeFee: data.get("exchangeFee"), freight: data.get("freight"), observationDate: data.get("observationDate"), warrantyValue: data.get("warrantyValue"), warrantyUnit: data.get("warrantyUnit"), warrantyText: data.get("warrantyText"), aog: data.get("aog") === "true", aircraftApplication: data.get("aircraftApplication"), regionContext: data.get("regionContext"), sourceReliability: data.get("sourceReliability"), verificationState: data.get("verificationState"), permittedUseState: data.get("permittedUseState"), documentationCodes: data.getAll("documentationCodes") }), "Observation created under the selected governance state."); }}><label><span>Provenance</span><select name="provenanceType" required>{["ANALYST_OBSERVATION","CIVILON_SUPPLIER_QUOTE","CIVILON_PURCHASE","CIVILON_SALE","CUSTOMER_SUPPLIER_QUOTE","CUSTOMER_COMPLETED_PURCHASE","LICENSED_MARKET_DATA","OTHER_AUTHORIZED"].map((value) => <option key={value}>{value}</option>)}</select></label><label><span>Internal source reference</span><input name="internalSourceReference" maxLength={240} /></label><label><span>Part number</span><input name="originalPartNumber" required maxLength={160} defaultValue={transaction.originalPartNumber} /></label><label><span>Condition</span><select name="conditionCode" required defaultValue={transaction.conditionCode}>{["NE","NS","OH","SV","AR","NOT_SURE"].map((value) => <option key={value}>{value}</option>)}</select></label><label><span>Transaction</span><select name="transactionType" required defaultValue={transaction.transactionType}>{["outright","exchange","repair","not_sure"].map((value) => <option key={value}>{value}</option>)}</select></label><label><span>Quantity</span><input name="quantity" required inputMode="decimal" defaultValue="1" /></label><label><span>Unit price</span><input name="unitPrice" required inputMode="decimal" /></label><label><span>Currency</span><select name="currencyCode" defaultValue={transaction.currencyCode}>{["USD","EUR","GBP","CAD","AUD","CHF","JPY"].map((value) => <option key={value}>{value}</option>)}</select></label><label><span>Observation date</span><input type="date" name="observationDate" required /></label><label><span>Source reliability</span><select name="sourceReliability" defaultValue="MEDIUM">{["HIGH","MEDIUM","LOW","UNKNOWN"].map((value) => <option key={value}>{value}</option>)}</select></label><label><span>Verification</span><select name="verificationState" defaultValue="PENDING">{["PENDING","VERIFIED","UNVERIFIED","REJECTED"].map((value) => <option key={value}>{value}</option>)}</select></label><label><span>Permitted use</span><select name="permittedUseState" defaultValue="PENDING">{["PENDING","INTERNAL_ANALYSIS","AGGREGATE_ONLY","PROHIBITED"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label><label><span>Core charge</span><input name="coreCharge" inputMode="decimal" /></label><label><span>Core disposition</span><select name="coreDisposition"><option value="">Not specified</option>{["REFUNDABLE","FORFEITED","UNCLEAR","NOT_APPLICABLE"].map((value) => <option key={value}>{value}</option>)}</select></label><label><span>Exchange fee</span><input name="exchangeFee" inputMode="decimal" /></label><label><span>Freight</span><input name="freight" inputMode="decimal" /></label><label><span>Warranty value</span><input name="warrantyValue" inputMode="decimal" /></label><label><span>Warranty unit</span><select name="warrantyUnit"><option value="">Not specified</option>{["DAYS","MONTHS","YEARS","HOURS","CYCLES","OTHER"].map((value) => <option key={value}>{value}</option>)}</select></label><label><span>Warranty text</span><input name="warrantyText" maxLength={500} /></label><label><span>AOG context</span><select name="aog"><option value="false">No</option><option value="true">Yes</option></select></label><label><span>Aircraft application</span><input name="aircraftApplication" maxLength={240} /></label><label><span>Region context</span><input name="regionContext" maxLength={160} /></label><fieldset className="wide admin-document-options"><legend>Documentation context</legend>{["FAA_8130_3","EASA_FORM_1","DUAL_RELEASE","OEM_MANUFACTURER_COC","MATERIAL_CERTIFICATION","REMOVAL_RECORDS","TEARDOWN_EVALUATION_REPORT","TEST_REPORT","NOT_SURE"].map((value) => <label key={value}><input type="checkbox" name="documentationCodes" value={value} /> {value.replaceAll("_", " ")}</label>)}</fieldset><button disabled={busy} type="submit">Create observation</button></form></details>}

      {canManageRelationships && <details className="admin-panel admin-details-action"><summary><span><b>Create governed part relationship</b><small>No relationship is inferred from text similarity.</small></span></summary><form className="admin-form-grid" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); run(() => post("/api/admin/part-relationships", Object.fromEntries(data)), "Part relationship created under the selected verification state."); }}><label><span>From part number</span><input name="fromPartNumber" required defaultValue={transaction.originalPartNumber} maxLength={160} /></label><label><span>To part number</span><input name="toPartNumber" required maxLength={160} /></label><label><span>Relationship type</span><select name="relationshipType">{["SUPERSEDES","SUPERSEDED_BY","INTERCHANGEABLE","RELATED_APPLICATION","EXACT"].map((value) => <option key={value}>{value.replaceAll("_", " ")}</option>)}</select></label><label><span>Verification</span><select name="verificationState"><option>PENDING</option><option>VERIFIED</option><option>UNVERIFIED</option><option>REJECTED</option></select></label><label className="wide"><span>Source provenance</span><input name="sourceProvenance" required maxLength={240} placeholder="Controlled internal reference or authorized publication" /></label><label><span>Effective from</span><input type="date" name="effectiveFrom" /></label><label><span>Effective to</span><input type="date" name="effectiveTo" /></label><label className="wide"><span>Notes</span><textarea name="notes" maxLength={1000} /></label><button disabled={busy} type="submit">Create relationship</button></form></details>}
    </div>

    {relationships.length > 0 && <section className="admin-panel admin-relationship-list" aria-labelledby="relationship-list-title"><div className="admin-panel-heading"><div><p className="admin-eyebrow">Part governance</p><h3 id="relationship-list-title">Known relationships</h3></div></div><ul>{relationships.map((relationship) => <li key={relationship.id}><strong>{relationship.fromNormalizedPartNumber} → {relationship.toNormalizedPartNumber}</strong><span>{relationship.relationshipType.replaceAll("_", " ")}</span><span>{relationship.verificationState}</span><small>{relationship.sourceProvenance} · reviewer {relationship.reviewerEmail ?? "pending"}</small>{relationship.notes && <p>{relationship.notes}</p>}</li>)}</ul></section>}
  </section>;
}
