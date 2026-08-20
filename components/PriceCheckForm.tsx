"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { CallAogAction, WhatsAppAogAction } from "./AogActions";
import { FieldLabel } from "./FieldLabel";
import { trackCivilonEvent } from "@/lib/analytics";
import { usePublicFormFeedback } from "@/lib/use-public-form-feedback";
import {
  conditionCodes,
  coreDispositions,
  currencyCodes,
  documentationCodes,
  type PriceCheckSubmitResponse,
} from "@/lib/price-check/contract";

const conditionLabels = {
  NE: "NE — New",
  NS: "NS — New Surplus",
  OH: "OH — Overhauled",
  SV: "SV — Serviceable",
  AR: "AR — As Removed",
  NOT_SURE: "Not sure",
} as const;
const transactionLabels = {
  outright: "Outright",
  exchange: "Exchange",
  repair: "Repair",
  not_sure: "Not sure",
} as const;
const coreLabels = {
  NOT_APPLICABLE: "No core",
  REFUNDABLE: "Refundable core",
  FORFEITED: "Non-refundable / forfeited",
  UNCLEAR: "Core terms unclear",
} as const;
const documentLabels = {
  FAA_8130_3: "FAA 8130-3",
  EASA_FORM_1: "EASA Form 1",
  DUAL_RELEASE: "Dual release",
  OEM_MANUFACTURER_COC: "OEM/manufacturer C of C",
  MATERIAL_CERTIFICATION: "Material certification",
  REMOVAL_RECORDS: "Removal records",
  TEARDOWN_EVALUATION_REPORT: "Teardown/evaluation report",
  TEST_REPORT: "Test report",
  OTHER: "Other",
  NOT_SURE: "Not sure",
} as const;

type FormValues = {
  partNumber: string; quantity: string; quoteOrPurchased: "quote" | "purchased";
  transactionType: "outright" | "exchange" | "repair" | "not_sure";
  conditionCode: (typeof conditionCodes)[number]; unitPrice: string;
  currencyCode: (typeof currencyCodes)[number]; aog: boolean; description: string;
  aircraftModel: string; coreCharge: string; coreDisposition: (typeof coreDispositions)[number];
  exchangeFee: string; freight: string; transactionDate: string; warrantyValue: string;
  warrantyUnit: "DAYS" | "MONTHS" | "YEARS" | "HOURS" | "CYCLES" | "OTHER";
  warrantyText: string; documentationCodes: string[]; documentationOther: string;
  notes: string; firstName: string; lastName: string; companyName: string;
  businessEmail: string; phone: string; role: string; country: string;
  serviceAcknowledged: boolean; legalAcknowledged: boolean; website: string;
};

// Internal defaults keep the authoritative submission contract complete even when the
// customer never opens an optional disclosure. Transaction type stays "not_sure" so a
// shorter form never asserts an outright purchase the customer did not state.
const initialValues: FormValues = {
  partNumber: "", quantity: "1", quoteOrPurchased: "quote", transactionType: "not_sure",
  conditionCode: "NOT_SURE", unitPrice: "", currencyCode: "USD", aog: false,
  description: "", aircraftModel: "", coreCharge: "", coreDisposition: "NOT_APPLICABLE",
  exchangeFee: "", freight: "", transactionDate: "", warrantyValue: "",
  warrantyUnit: "MONTHS", warrantyText: "", documentationCodes: [],
  documentationOther: "", notes: "", firstName: "", lastName: "", companyName: "",
  businessEmail: "", phone: "", role: "", country: "", serviceAcknowledged: false, legalAcknowledged: false,
  website: "",
};

function moneyValid(value: string) { return /^\d+(?:\.\d{1,2})?$/.test(value); }
function quantityValid(value: string) { return /^\d+(?:\.\d{1,3})?$/.test(value) && Number(value) > 0; }

type DisclosureName = "transaction" | "documents" | "contact";
type DisclosureState = Record<DisclosureName, boolean>;

const closedDisclosures: DisclosureState = { transaction: false, documents: false, contact: false };

// Field-to-disclosure map: a server or client error inside a collapsed disclosure must
// expand that disclosure before focus moves, otherwise the message is unreachable.
const disclosureFields: Record<DisclosureName, Set<string>> = {
  transaction: new Set([
    "quantity", "transactionType", "description", "coreCharge", "coreDisposition",
    "exchangeFee", "freight", "transactionDate", "aircraftModel", "warrantyValue",
    "warrantyUnit", "warrantyText", "notes", "aog",
  ]),
  documents: new Set(["documentationCodes", "documentationOther", "attachmentHandles"]),
  contact: new Set(["phone", "role", "country"]),
};

type UploadItem = {
  id: string;
  file: File;
  status: "authorizing" | "uploading" | "pending" | "error";
  progress: number;
  handle?: string;
  error?: string;
};

function readableBytes(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function PriceCheckForm() {
  const [values, setValues] = useState<FormValues>(initialValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [disclosures, setDisclosures] = useState<DisclosureState>(closedDisclosures);
  const [submitting, setSubmitting] = useState(false);
  const [reference, setReference] = useState("");
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [errorFeedbackRevision, setErrorFeedbackRevision] = useState(0);
  const idempotencyKey = useRef("");
  const started = useRef(false);
  const activeUploads = useRef(new Map<string, XMLHttpRequest>());
  const confirmationHeadingRef = usePublicFormFeedback<HTMLHeadingElement>(reference);
  const errorFeedbackRef = usePublicFormFeedback<HTMLDivElement>(errorFeedbackRevision);

  useEffect(() => { trackCivilonEvent("price_check_view", { source_page: "/price-check" }); }, []);

  function updateUpload(id: string, update: Partial<UploadItem>) {
    setUploads((current) => current.map((item) => item.id === id ? { ...item, ...update } : item));
  }

  async function uploadFile(item: UploadItem) {
    try {
      trackCivilonEvent("price_check_upload_started", { source_page: "/price-check" });
      const authorization = await fetch("/api/price-check/uploads/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: item.file.name, mime: item.file.type, size: item.file.size }),
      });
      const result = await authorization.json() as {
        ok: boolean;
        error?: string;
        handle?: string;
        upload?: { url: string; fields: Record<string, string> };
      };
      if (!authorization.ok || !result.ok || !result.handle || !result.upload) {
        throw new Error(result.error || "The document could not be authorized.");
      }
      updateUpload(item.id, { status: "uploading", progress: 0, handle: result.handle });
      await new Promise<void>((resolve, reject) => {
        const request = new XMLHttpRequest();
        activeUploads.current.set(item.id, request);
        request.open("POST", result.upload!.url);
        request.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable) updateUpload(item.id, { progress: Math.min(99, Math.round(event.loaded / event.total * 100)) });
        });
        request.addEventListener("load", () => {
          activeUploads.current.delete(item.id);
          if (request.status >= 200 && request.status < 300) resolve();
          else reject(new Error("The private storage service rejected the upload."));
        });
        request.addEventListener("error", () => reject(new Error("The upload was interrupted.")));
        request.addEventListener("abort", () => reject(new Error("Upload removed.")));
        const body = new FormData();
        for (const [name, value] of Object.entries(result.upload!.fields)) body.append(name, value);
        body.append("file", item.file);
        request.send(body);
      });
      updateUpload(item.id, { status: "pending", progress: 100 });
      trackCivilonEvent("price_check_upload_completed", { source_page: "/price-check" });
    } catch (error) {
      activeUploads.current.delete(item.id);
      updateUpload(item.id, {
        status: "error",
        progress: 0,
        error: error instanceof Error ? error.message : "The upload failed.",
      });
    }
  }

  function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";
    const available = Math.max(0, 3 - uploads.length);
    const accepted = selected.slice(0, available).map((file) => ({
      id: window.crypto.randomUUID(), file, status: "authorizing" as const, progress: 0,
    }));
    if (selected.length > available) {
      setErrors((current) => ({ ...current, attachmentHandles: "A maximum of 3 documents may be added." }));
    } else {
      setErrors((current) => ({ ...current, attachmentHandles: "" }));
    }
    setUploads((current) => [...current, ...accepted]);
    for (const item of accepted) void uploadFile(item);
  }

  function removeUpload(id: string) {
    activeUploads.current.get(id)?.abort();
    activeUploads.current.delete(id);
    setUploads((current) => current.filter((item) => item.id !== id));
    setErrors((current) => ({ ...current, attachmentHandles: "" }));
  }

  function update<K extends keyof FormValues>(field: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "", _form: "" }));
    // Selecting AOG makes the phone number mandatory, so reveal the contact disclosure once.
    if (field === "aog" && value === true) setDisclosure("contact", true);
    if (!started.current) {
      started.current = true;
      trackCivilonEvent("price_check_start", { source_page: "/price-check" });
    }
  }

  function setDisclosure(name: DisclosureName, open: boolean) {
    setDisclosures((current) => current[name] === open ? current : { ...current, [name]: open });
  }

  function revealFields(fields: string[]) {
    setDisclosures((current) => ({
      transaction: current.transaction || fields.some((field) => disclosureFields.transaction.has(field)),
      documents: current.documents || fields.some((field) => disclosureFields.documents.has(field)),
      contact: current.contact || fields.some((field) => disclosureFields.contact.has(field)),
    }));
  }

  function presentServerErrors(nextErrors: Record<string, string>) {
    revealFields(Object.keys(nextErrors));
    setErrors(nextErrors);
    setErrorFeedbackRevision((current) => current + 1);
  }

  function validateAll() {
    const next: Record<string, string> = {};
    if (!/^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/.test(values.partNumber.trim())) next.partNumber = "Enter a valid aircraft part number.";
    if (!moneyValid(values.unitPrice)) next.unitPrice = "Enter a non-negative amount with up to two decimals.";
    if (!quantityValid(values.quantity) || Number(values.quantity) > 999_999_999.999) next.quantity = "Enter a quantity greater than zero.";
    if (values.transactionType === "exchange") {
      for (const field of ["coreCharge", "exchangeFee"] as const) {
        if (values[field] && !moneyValid(values[field])) next[field] = "Enter a non-negative amount with up to two decimals.";
      }
    }
    if (values.freight && !moneyValid(values.freight)) next.freight = "Enter a non-negative amount with up to two decimals.";
    if (values.warrantyValue && !moneyValid(values.warrantyValue)) next.warrantyValue = "Enter a valid warranty value.";
    if (values.documentationCodes.includes("OTHER") && !values.documentationOther.trim()) next.documentationOther = "Describe the other documentation requirement.";
    if (!values.firstName.trim()) next.firstName = "Enter your first name.";
    if (!values.lastName.trim()) next.lastName = "Enter your last name.";
    if (!values.companyName.trim()) next.companyName = "Enter your company name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.businessEmail)) next.businessEmail = "Enter a valid business email address.";
    if (values.aog && values.phone.replace(/\D/g, "").length < 7) next.phone = "Enter a phone number for this AOG Price Check.";
    if (values.country && !/^[A-Za-z]{2}$/.test(values.country)) next.country = "Use a two-letter country code.";
    if (!values.serviceAcknowledged) next.serviceAcknowledged = "Acknowledge how Civilon will use the submitted information.";
    if (!values.legalAcknowledged) next.legalAcknowledged = "Acknowledge the Privacy Policy and Terms of Use.";
    if (Object.keys(next).length) { presentServerErrors(next); return false; }
    setErrors({});
    return true;
  }

  function attribution() {
    const params = new URLSearchParams(window.location.search);
    const value = (name: string) => params.get(name)?.slice(0, 160) || null;
    return {
      sourcePage: "/price-check",
      landingPage: `${window.location.origin}${window.location.pathname}`,
      referrer: document.referrer || null,
      utmSource: value("utm_source"), utmMedium: value("utm_medium"),
      utmCampaign: value("utm_campaign"), utmContent: value("utm_content"),
      utmTerm: value("utm_term"),
    };
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validateAll()) return;
    if (!idempotencyKey.current) idempotencyKey.current = window.crypto.randomUUID();
    setSubmitting(true);
    setErrors({});
    const payload = {
      ...values,
      coreCharge: values.transactionType === "exchange" ? values.coreCharge : "",
      coreDisposition: values.transactionType === "exchange" ? values.coreDisposition : "",
      exchangeFee: values.transactionType === "exchange" ? values.exchangeFee : "",
      attachmentHandles: uploads.filter((item) => item.status === "pending" && item.handle).map((item) => item.handle!),
      idempotencyKey: idempotencyKey.current,
      ...attribution(),
    };
    try {
      const response = await fetch("/api/price-check/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as PriceCheckSubmitResponse;
      if (result.ok) {
        setReference(result.reference);
        trackCivilonEvent("price_check_submit", { source_page: "/price-check" });
      } else {
        presentServerErrors({ ...(result.fieldErrors ?? {}), _form: result.error });
      }
    } catch {
      presentServerErrors({ _form: "Price Check submission is temporarily unavailable. Please try again later." });
    } finally {
      setSubmitting(false);
    }
  }

  if (reference) {
    return <section className="price-check-confirmation" aria-labelledby="price-check-received" role="status">
      <span className="section-label">SUBMISSION / RECEIVED</span>
      <h2 id="price-check-received" ref={confirmationHeadingRef} tabIndex={-1}>Price Check received</h2>
      <p className="price-check-reference"><span>Reference</span><strong>{reference}</strong></p>
      <p>Civilon will review the transaction context. Some requests require additional information, and the current service uses human review before any result is prepared.</p>
      <p>Keep this reference for your records. If Civilon completes and approves a reviewed result, access instructions will be sent separately to the business email provided.</p>
      <button type="button" className="button button-primary" onClick={() => {
        setReference(""); setValues(initialValues); setErrors({}); setUploads([]);
        setDisclosures(closedDisclosures);
        idempotencyKey.current = ""; started.current = false;
      }}>Start another Price Check</button>
    </section>;
  }

  const errorSummary = Object.values(errors).filter(Boolean);
  const errorProps = (field: string) => ({
    "aria-invalid": Boolean(errors[field]) as true | false,
    "aria-describedby": errors[field] ? `price-check-${field}-error` : undefined,
  });
  const fieldError = (field: string) => errors[field]
    ? <small className="field-error" id={`price-check-${field}-error`}>{errors[field]}</small>
    : null;
  const uploadsBusy = uploads.some((item) => item.status === "authorizing" || item.status === "uploading");
  const attachedCount = uploads.filter((item) => item.status === "pending").length;

  return <div className="price-check-form-shell" data-mobile-aog-suppress>
    <form className="price-check-form" noValidate onSubmit={submit} onChange={() => {
      if (!started.current) { started.current = true; trackCivilonEvent("price_check_start", { source_page: "/price-check" }); }
    }}>
      <div className="price-check-form-heading">
        <span>PRICE CHECK REQUEST</span>
        <h2 id="price-check-form-title">Describe the transaction</h2>
        <p>Share the quoted or purchased transaction as it was presented. Only the fields marked required are needed—everything else is optional context that helps the review. No market conclusion is calculated at submission.</p>
      </div>

      {errorSummary.length > 0 && <div className="price-check-errors" ref={errorFeedbackRef} role="alert" aria-labelledby="price-check-error-title" tabIndex={-1}>
        <strong id="price-check-error-title">Please review these details</strong>
        <ul>{[...new Set(errorSummary)].map((error) => <li key={error}>{error}</li>)}</ul>
      </div>}

      <section aria-labelledby="price-check-transaction-title">
        <h3 className="pc-section-title" id="price-check-transaction-title">Part and price</h3>
        <label htmlFor="price-check-partNumber"><FieldLabel htmlFor="price-check-partNumber" required>Part number</FieldLabel><input id="price-check-partNumber" value={values.partNumber} onChange={(e) => update("partNumber", e.target.value)} maxLength={160} {...errorProps("partNumber")} placeholder="e.g. 101-384025-5" />{fieldError("partNumber")}</label>
        <fieldset className="pc-choice-group"><legend>Quote status <span aria-hidden="true">*</span></legend><div>{[{value:"quote",label:"I have a quote"},{value:"purchased",label:"I already purchased the part"}].map((option) => <label key={option.value}><input type="radio" name="pc-quote" checked={values.quoteOrPurchased === option.value} onChange={() => update("quoteOrPurchased", option.value as FormValues["quoteOrPurchased"])} /><span>{option.label}</span></label>)}</div></fieldset>
        <div className="pc-money-grid">
          <label htmlFor="price-check-unitPrice"><FieldLabel htmlFor="price-check-unitPrice" required>Unit price</FieldLabel><input id="price-check-unitPrice" inputMode="decimal" value={values.unitPrice} onChange={(e) => update("unitPrice", e.target.value)} maxLength={21} {...errorProps("unitPrice")} placeholder="0.00" />{fieldError("unitPrice")}</label>
          <label htmlFor="price-check-currencyCode"><FieldLabel htmlFor="price-check-currencyCode" required>Currency</FieldLabel><select id="price-check-currencyCode" value={values.currencyCode} onChange={(e) => update("currencyCode", e.target.value as FormValues["currencyCode"])}>{currencyCodes.map((code) => <option key={code}>{code}</option>)}</select></label>
        </div>
        <label htmlFor="price-check-conditionCode"><FieldLabel htmlFor="price-check-conditionCode" required>Condition</FieldLabel><select id="price-check-conditionCode" value={values.conditionCode} onChange={(e) => update("conditionCode", e.target.value as FormValues["conditionCode"])}>{conditionCodes.map((value) => <option key={value} value={value}>{conditionLabels[value]}</option>)}</select><small className="field-help">Choose &quot;Not sure&quot; if the condition was not stated.</small></label>
      </section>

      <details className="pc-disclosure" open={disclosures.transaction} onToggle={(e) => setDisclosure("transaction", e.currentTarget.open)}>
        <summary><b>Transaction details, AOG and notes</b><small>Optional — quantity, outright/exchange/repair, freight, date, aircraft, warranty, AOG escalation and notes.</small></summary>
        <div className="pc-disclosure-body">
          <div className="pc-field-grid">
            <label htmlFor="price-check-quantity"><FieldLabel htmlFor="price-check-quantity">Quantity</FieldLabel><input id="price-check-quantity" inputMode="decimal" value={values.quantity} onChange={(e) => update("quantity", e.target.value)} maxLength={16} {...errorProps("quantity")} />{fieldError("quantity")}<small className="field-help">Defaults to 1.</small></label>
            <label htmlFor="price-check-transactionType"><FieldLabel htmlFor="price-check-transactionType">Transaction type</FieldLabel><select id="price-check-transactionType" value={values.transactionType} onChange={(e) => update("transactionType", e.target.value as FormValues["transactionType"])}>{Object.entries(transactionLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select><small className="field-help">Left as &quot;Not sure&quot; unless you choose otherwise.</small></label>
          </div>
          <label htmlFor="price-check-description"><FieldLabel htmlFor="price-check-description">Description</FieldLabel><input id="price-check-description" value={values.description} onChange={(e) => update("description", e.target.value)} maxLength={500} placeholder="Optional component description" /></label>
          {values.transactionType === "exchange" && <fieldset className="pc-conditional"><legend>Exchange and core details</legend>
            <p>A refundable core is tracked separately and is not treated as purchase cost.</p>
            <div className="pc-field-grid"><label htmlFor="price-check-coreDisposition"><FieldLabel htmlFor="price-check-coreDisposition">Core terms</FieldLabel><select id="price-check-coreDisposition" value={values.coreDisposition} onChange={(e) => update("coreDisposition", e.target.value as FormValues["coreDisposition"])}>{coreDispositions.map((value) => <option key={value} value={value}>{coreLabels[value]}</option>)}</select></label><label htmlFor="price-check-coreCharge"><FieldLabel htmlFor="price-check-coreCharge">Core charge</FieldLabel><input id="price-check-coreCharge" inputMode="decimal" value={values.coreCharge} onChange={(e) => update("coreCharge", e.target.value)} maxLength={21} {...errorProps("coreCharge")} placeholder="0.00" />{fieldError("coreCharge")}</label></div>
            <label htmlFor="price-check-exchangeFee"><FieldLabel htmlFor="price-check-exchangeFee">Exchange fee</FieldLabel><input id="price-check-exchangeFee" inputMode="decimal" value={values.exchangeFee} onChange={(e) => update("exchangeFee", e.target.value)} maxLength={21} {...errorProps("exchangeFee")} placeholder="0.00" />{fieldError("exchangeFee")}</label>
          </fieldset>}
          <div className="pc-field-grid"><label htmlFor="price-check-freight"><FieldLabel htmlFor="price-check-freight">Freight / delivery cost</FieldLabel><input id="price-check-freight" inputMode="decimal" value={values.freight} onChange={(e) => update("freight", e.target.value)} maxLength={21} {...errorProps("freight")} placeholder="0.00" />{fieldError("freight")}</label><label htmlFor="price-check-transactionDate"><FieldLabel htmlFor="price-check-transactionDate">Quote / purchase date</FieldLabel><input id="price-check-transactionDate" type="date" value={values.transactionDate} onChange={(e) => update("transactionDate", e.target.value)} /></label></div>
          <label htmlFor="price-check-aircraftModel"><FieldLabel htmlFor="price-check-aircraftModel">Aircraft / model</FieldLabel><input id="price-check-aircraftModel" value={values.aircraftModel} onChange={(e) => update("aircraftModel", e.target.value)} placeholder="e.g. Challenger 605" /></label>
          <fieldset className="pc-warranty"><legend>Warranty, if stated</legend><div className="pc-warranty-grid"><label htmlFor="price-check-warrantyValue"><span className="field-label">Value</span><input id="price-check-warrantyValue" inputMode="decimal" value={values.warrantyValue} onChange={(e) => update("warrantyValue", e.target.value)} maxLength={16} {...errorProps("warrantyValue")} placeholder="e.g. 12" />{fieldError("warrantyValue")}</label><label htmlFor="price-check-warrantyUnit"><span className="field-label">Unit</span><select id="price-check-warrantyUnit" value={values.warrantyUnit} onChange={(e) => update("warrantyUnit", e.target.value as FormValues["warrantyUnit"])}>{["DAYS","MONTHS","YEARS","HOURS","CYCLES","OTHER"].map((unit) => <option key={unit} value={unit}>{unit.toLowerCase()}</option>)}</select></label></div><label htmlFor="price-check-warrantyText"><span className="field-label">Warranty notes</span><input id="price-check-warrantyText" value={values.warrantyText} onChange={(e) => update("warrantyText", e.target.value)} maxLength={500} placeholder="Optional stated coverage or exclusions" /></label></fieldset>
          <fieldset className="pc-choice-group"><legend>AOG situation</legend><div>{[{value:false,label:"No"},{value:true,label:"Yes — active AOG"}].map((option) => <label key={String(option.value)}><input type="radio" name="pc-aog" checked={values.aog === option.value} onChange={() => update("aog", option.value)} /><span>{option.label}</span></label>)}</div></fieldset>
          {values.aog && <div className="pc-aog-notice" role="note"><strong>Active AOG requirement</strong><p>Submit the Price Check if useful, but call or WhatsApp Civilon&apos;s monitored AOG desk for immediate sourcing coordination. Price Check itself is not an immediate-result service. A phone number is required below for an AOG request.</p><div><CallAogAction className="button button-primary" source_page="/price-check">Call AOG Desk</CallAogAction><WhatsAppAogAction className="button button-whatsapp" source_page="/price-check">WhatsApp AOG</WhatsAppAogAction></div></div>}
          <label htmlFor="price-check-notes"><FieldLabel htmlFor="price-check-notes">Notes</FieldLabel><textarea id="price-check-notes" value={values.notes} onChange={(e) => update("notes", e.target.value)} maxLength={2000} rows={4} placeholder="Relevant quote terms, availability, delivery, or context" /><small className="field-help">Up to 2,000 characters. Do not include payment-card or account credentials.</small></label>
        </div>
      </details>

      <details className="pc-disclosure pc-disclosure-documents" open={disclosures.documents} onToggle={(e) => setDisclosure("documents", e.currentTarget.open)}>
        <summary><b>Attach a quote, invoice or supporting document</b><small>Optional — private upload, PDF/JPG/PNG/WebP, up to 10 MB each, maximum 3 files. You can also list the documentation you need.{attachedCount > 0 ? ` ${attachedCount} attached.` : ""}</small></summary>
        <div className="pc-disclosure-body">
          <div className="pc-upload-panel">
            <div className="pc-upload-intro"><div><strong>Private document upload</strong><p>PDF, JPG, PNG or WebP · Up to 10 MB each · Maximum 3 files</p></div><label className="pc-file-button" htmlFor="price-check-attachments">Choose files</label><input id="price-check-attachments" className="pc-file-input" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" onChange={chooseFiles} disabled={uploads.length >= 3} /></div>
            {uploads.length > 0 && <ul className="pc-upload-list" aria-live="polite">{uploads.map((item) => <li key={item.id} className={`is-${item.status}`}>
              <div className="pc-upload-row"><div><strong>{item.file.name}</strong><span>{readableBytes(item.file.size)}</span></div><button type="button" onClick={() => removeUpload(item.id)} aria-label={`Remove ${item.file.name}`}>Remove</button></div>
              {item.status === "authorizing" && <p role="status">Preparing private upload…</p>}
              {item.status === "uploading" && <div><progress max="100" value={item.progress}>{item.progress}%</progress><p role="status">Uploading — {item.progress}%</p></div>}
              {item.status === "pending" && <p role="status"><span aria-hidden="true">◷</span> Uploaded — security scan pending</p>}
              {item.status === "error" && <p className="field-error" role="alert">{item.error}</p>}
            </li>)}</ul>}
            {errors.attachmentHandles && <small className="field-error" id="price-check-attachmentHandles-error">{errors.attachmentHandles}</small>}
          </div>
          {/* TODO(legal): final counsel approval is required before production exposure. */}
          <div className="pc-document-notice" role="note"><strong>Commercially sensitive information</strong><p>Uploaded documents may be processed using automated tools to help Civilon identify transaction details. Extracted information is reviewed by Civilon before it is used in your Price Check. Documents may contain commercially sensitive information; please upload only information necessary for the review.</p></div>
          <fieldset className="pc-document-grid"><legend>Documentation requirements</legend><p>Select only what matters to this request. Not every record applies to every part or condition.</p><div>{documentationCodes.map((code) => <label key={code}><input type="checkbox" checked={values.documentationCodes.includes(code)} onChange={(e) => update("documentationCodes", e.target.checked ? [...values.documentationCodes, code] : values.documentationCodes.filter((current) => current !== code))} /><span>{documentLabels[code]}</span></label>)}</div></fieldset>
          {values.documentationCodes.includes("OTHER") && <label htmlFor="price-check-documentationOther"><FieldLabel htmlFor="price-check-documentationOther" required>Other documentation</FieldLabel><input id="price-check-documentationOther" value={values.documentationOther} onChange={(e) => update("documentationOther", e.target.value)} maxLength={240} {...errorProps("documentationOther")} placeholder="Describe the requested record" />{fieldError("documentationOther")}</label>}
        </div>
      </details>

      <section aria-labelledby="price-check-requester-title">
        <h3 className="pc-section-title" id="price-check-requester-title">Your details</h3>
        <div className="pc-field-grid"><label htmlFor="price-check-firstName"><FieldLabel htmlFor="price-check-firstName" required>First name</FieldLabel><input id="price-check-firstName" autoComplete="given-name" value={values.firstName} onChange={(e) => update("firstName", e.target.value)} maxLength={120} {...errorProps("firstName")} />{fieldError("firstName")}</label><label htmlFor="price-check-lastName"><FieldLabel htmlFor="price-check-lastName" required>Last name</FieldLabel><input id="price-check-lastName" autoComplete="family-name" value={values.lastName} onChange={(e) => update("lastName", e.target.value)} maxLength={120} {...errorProps("lastName")} />{fieldError("lastName")}</label></div>
        <label htmlFor="price-check-companyName"><FieldLabel htmlFor="price-check-companyName" required>Company</FieldLabel><input id="price-check-companyName" autoComplete="organization" value={values.companyName} onChange={(e) => update("companyName", e.target.value)} maxLength={200} {...errorProps("companyName")} />{fieldError("companyName")}</label>
        <label htmlFor="price-check-businessEmail"><FieldLabel htmlFor="price-check-businessEmail" required>Business email</FieldLabel><input id="price-check-businessEmail" type="email" autoComplete="email" value={values.businessEmail} onChange={(e) => update("businessEmail", e.target.value)} maxLength={320} {...errorProps("businessEmail")} placeholder="name@company.com" />{fieldError("businessEmail")}</label>
      </section>

      <details className="pc-disclosure" open={disclosures.contact} onToggle={(e) => setDisclosure("contact", e.currentTarget.open)}>
        <summary><b>Phone, role and country</b><small>{values.aog ? "A phone number is required for an active AOG request." : "Optional — helpful if Civilon needs to confirm details."}</small></summary>
        <div className="pc-disclosure-body">
          <label htmlFor="price-check-phone"><FieldLabel htmlFor="price-check-phone" required={values.aog}>Phone {values.aog ? "" : "(optional)"}</FieldLabel><input id="price-check-phone" type="tel" autoComplete="tel" value={values.phone} onChange={(e) => update("phone", e.target.value)} maxLength={80} {...errorProps("phone")} placeholder="+1 909 555 0123" />{fieldError("phone")}</label>
          <div className="pc-field-grid"><label htmlFor="price-check-role"><FieldLabel htmlFor="price-check-role">Role</FieldLabel><input id="price-check-role" autoComplete="organization-title" value={values.role} onChange={(e) => update("role", e.target.value)} maxLength={120} placeholder="e.g. Buyer" /></label><label htmlFor="price-check-country"><FieldLabel htmlFor="price-check-country">Country</FieldLabel><input id="price-check-country" autoComplete="country" value={values.country} onChange={(e) => update("country", e.target.value.toUpperCase())} maxLength={2} {...errorProps("country")} placeholder="US" />{fieldError("country")}</label></div>
        </div>
      </details>

      <div className="pc-honeypot" aria-hidden="true"><label htmlFor="price-check-website">Website</label><input id="price-check-website" tabIndex={-1} autoComplete="off" value={values.website} onChange={(e) => update("website", e.target.value)} /></div>
      {/* TODO(legal): final counsel approval is required before production exposure. */}
      <div className="pc-acknowledgment"><input id="price-check-serviceAcknowledged" type="checkbox" checked={values.serviceAcknowledged} onChange={(e) => update("serviceAcknowledged", e.target.checked)} {...errorProps("serviceAcknowledged")} /><label htmlFor="price-check-serviceAcknowledged"><strong>I understand how this request will be processed.</strong><small>Civilon will use the submitted contact and transaction information to provide the requested Price Check and communicate with me about it.</small></label></div>
      {errors.serviceAcknowledged && <small className="field-error pc-ack-error" id="price-check-serviceAcknowledged-error">{errors.serviceAcknowledged}</small>}
      <div className="pc-acknowledgment pc-legal-acknowledgment"><input id="price-check-legalAcknowledged" type="checkbox" checked={values.legalAcknowledged} onChange={(e) => update("legalAcknowledged", e.target.checked)} {...errorProps("legalAcknowledged")} /><label htmlFor="price-check-legalAcknowledged"><strong>I have read and agree to the Price Check terms.</strong><small>By submitting, you acknowledge the <a href="/privacy-policy" target="_blank" rel="noreferrer">Privacy Policy</a> and <a href="/terms-of-use" target="_blank" rel="noreferrer">Terms of Use</a>, including the informational nature of the service and the review a Civilon analyst performs.</small></label></div>
      {errors.legalAcknowledged && <small className="field-error pc-ack-error" id="price-check-legalAcknowledged-error">{errors.legalAcknowledged}</small>}
      <div className="pc-final-note" role="note"><strong>Informational, human-reviewed service</strong><p>A Price Check is not an appraisal and does not determine supplier cost or margin. Actual transaction context matters, and some requests require additional review.</p></div>
      <div className="pc-submit-actions"><button type="submit" className="pc-next" disabled={submitting || uploadsBusy}>{submitting ? "Submitting…" : "Submit Price Check"}<span aria-hidden="true">→</span></button>{uploadsBusy && <small className="field-help" role="status">Waiting for the document upload to finish…</small>}</div>
    </form>
  </div>;
}
