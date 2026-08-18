"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { FieldLabel } from "../FieldLabel";
import { SellSubmissionUploads, type UploadItem } from "./SellSubmissionUploads";
import { trackCivilonEvent } from "@/lib/analytics";
import {
  SELL_SUBMISSION_SOURCE_PAGE,
  SELL_SUBMISSION_SUBMIT_PATH,
  sellSubmissionConditionCodes,
  sellSubmissionCurrencyCodes,
  type SellSubmissionSubmitResponse,
} from "@/lib/marketplace/sell-contract";

const conditionLabels = {
  NOT_SURE: "Not sure",
  NE: "NE — New",
  NS: "NS — New Surplus",
  OH: "OH — Overhauled",
  SV: "SV — Serviceable",
  AR: "AR — As Removed",
} as const;

type ShipAnswer = "unknown" | "yes" | "no";

type FormValues = {
  submissionKind: "single_part" | "bulk_inventory";
  partNumber: string;
  description: string;
  quantity: string;
  conditionCode: (typeof sellSubmissionConditionCodes)[number];
  estimatedLineItemCount: string;
  quoteOnRequest: boolean;
  askingUnitPrice: string;
  currencyCode: (typeof sellSubmissionCurrencyCodes)[number] | "";
  canShipToNewJersey: ShipAnswer;
  locationCountry: string;
  locationStateRegion: string;
  locationCity: string;
  locationPostalCode: string;
  firstName: string;
  lastName: string;
  companyName: string;
  businessEmail: string;
  phone: string;
  serviceAcknowledged: boolean;
  legalAcknowledged: boolean;
  website: string;
};

const initialValues: FormValues = {
  submissionKind: "single_part", partNumber: "", description: "", quantity: "",
  conditionCode: "NOT_SURE", estimatedLineItemCount: "", quoteOnRequest: true,
  askingUnitPrice: "", currencyCode: "", canShipToNewJersey: "unknown",
  locationCountry: "", locationStateRegion: "", locationCity: "", locationPostalCode: "",
  firstName: "", lastName: "", companyName: "", businessEmail: "", phone: "",
  serviceAcknowledged: false, legalAcknowledged: false, website: "",
};

/** Fields behind the optional disclosure, so an error can reveal its own field. */
const disclosureFields = new Set([
  "locationStateRegion", "locationCity", "locationPostalCode", "phone",
]);

/**
 * Sell Parts to Civilon — public intake.
 *
 * Progressive disclosure, not a wizard: everything required is on one page and
 * visible, and the optional detail sits behind two toggles the seller opens if
 * it helps them. There is no account, no sign-in and no step counter.
 *
 * The form knows nothing about storage. Uploads produce opaque handles, and only
 * those handles travel in the submission body — never a filename, a key, or the
 * session, which lives in a cookie this code cannot read.
 */
export function SellSubmissionForm() {
  const [values, setValues] = useState<FormValues>(initialValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reference, setReference] = useState("");
  const idempotencyKey = useRef("");
  const started = useRef(false);

  useEffect(() => {
    trackCivilonEvent("sell_submission_view", { source_page: SELL_SUBMISSION_SOURCE_PAGE });
  }, []);

  const isBulk = values.submissionKind === "bulk_inventory";
  /**
   * Files the seller has added that will not be attached if they send right now.
   * Only a "ready" handle reaches the submission, so anything still authorizing
   * or uploading — and anything that failed — is silently absent unless this is
   * said out loud.
   */
  const unfinishedUploads = uploads.filter((item) => item.status !== "ready").length;

  function update<K extends keyof FormValues>(field: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "", _form: "" }));
    if (!started.current) {
      started.current = true;
      trackCivilonEvent("sell_submission_start", { source_page: SELL_SUBMISSION_SOURCE_PAGE });
    }
  }

  function focusFirst(nextErrors: Record<string, string>) {
    const first = Object.keys(nextErrors).find((key) => key !== "_form" && nextErrors[key]);
    if (first && disclosureFields.has(first)) setDetailsOpen(true);
    if (first === "attachmentHandles") setFilesOpen(true);
    window.setTimeout(() => {
      const target = first
        ? document.getElementById(`sell-submission-${first}`)
        : document.querySelector<HTMLElement>(".price-check-errors");
      target?.focus();
    }, 0);
  }

  function presentErrors(nextErrors: Record<string, string>) {
    setErrors(nextErrors);
    focusFirst(nextErrors);
  }

  function validateAll() {
    const next: Record<string, string> = {};
    const partNumber = values.partNumber.trim();
    const description = values.description.trim();

    if (!isBulk) {
      if (!partNumber && !description) {
        next.partNumber = "Enter a part number or describe the part you are offering.";
      }
      if (partNumber && !/^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/.test(partNumber)) {
        next.partNumber = "Enter a valid aircraft part number, or describe the part instead.";
      }
      if (values.quantity && (!/^\d+(?:\.\d{1,3})?$/.test(values.quantity) || Number(values.quantity) <= 0)) {
        next.quantity = "Enter a quantity greater than zero, or leave it blank.";
      }
    } else if (!description && !values.estimatedLineItemCount.trim()) {
      next.description = "Describe the inventory, or estimate how many line items it contains.";
    }
    if (isBulk && values.estimatedLineItemCount && !/^\d{1,7}$/.test(values.estimatedLineItemCount.trim())) {
      next.estimatedLineItemCount = "Enter roughly how many line items the list contains.";
    }

    // Quote-on-request is the normal case. A price is only demanded once the
    // seller has explicitly chosen to state one.
    if (!values.quoteOnRequest) {
      if (!/^\d+(?:\.\d{1,2})?$/.test(values.askingUnitPrice)) {
        next.askingUnitPrice = "Enter an asking unit price, or leave pricing as quote on request.";
      }
      if (!values.currencyCode) next.currencyCode = "Select the currency of your asking price.";
    }

    if (!/^[A-Za-z]{2}$/.test(values.locationCountry)) {
      next.locationCountry = "Use a two-letter country code for where the parts are held.";
    }
    if (!values.firstName.trim()) next.firstName = "Enter your first name.";
    if (!values.lastName.trim()) next.lastName = "Enter your last name.";
    if (!values.companyName.trim()) next.companyName = "Enter your company name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.businessEmail)) {
      next.businessEmail = "Enter a valid business email address.";
    }
    if (!values.serviceAcknowledged) {
      next.serviceAcknowledged = "Acknowledge how Civilon will review this submission.";
    }
    if (!values.legalAcknowledged) {
      next.legalAcknowledged = "Acknowledge the Privacy Policy and Terms of Use.";
    }

    if (Object.keys(next).length) {
      presentErrors(next);
      return false;
    }
    setErrors({});
    return true;
  }

  /** Attribution only: page and campaign context, never a field value. */
  function attribution() {
    const params = new URLSearchParams(window.location.search);
    const value = (name: string) => params.get(name)?.slice(0, 160) || null;
    return {
      sourcePage: SELL_SUBMISSION_SOURCE_PAGE,
      landingPage: `${window.location.origin}${window.location.pathname}`,
      referrer: document.referrer || null,
      utmSource: value("utm_source"),
      utmMedium: value("utm_medium"),
      utmCampaign: value("utm_campaign"),
      utmContent: value("utm_content"),
      utmTerm: value("utm_term"),
    };
  }

  /**
   * Builds the request body.
   *
   * Mode is enforced on the way out as well as in validation: a bulk submission
   * physically cannot carry a part number, a quantity or a unit price, so a
   * seller who fills in single-part fields and then switches to bulk cannot send
   * stale values the server would have to reject.
   */
  function payload() {
    const attached = uploads.filter((item) => item.status === "ready").map((item) => item.handle);
    return {
      idempotencyKey: idempotencyKey.current,
      attachmentHandles: attached,
      submissionKind: values.submissionKind,
      partNumber: isBulk ? undefined : values.partNumber.trim() || undefined,
      description: values.description.trim() || undefined,
      quantity: isBulk ? undefined : values.quantity.trim() || undefined,
      conditionCode: isBulk ? undefined : values.conditionCode,
      estimatedLineItemCount: isBulk ? values.estimatedLineItemCount.trim() || undefined : undefined,
      quoteOnRequest: isBulk ? true : values.quoteOnRequest,
      askingUnitPrice: isBulk || values.quoteOnRequest ? undefined : values.askingUnitPrice.trim(),
      currencyCode: isBulk || values.quoteOnRequest ? undefined : values.currencyCode || undefined,
      canShipToNewJersey: values.canShipToNewJersey === "unknown"
        ? null
        : values.canShipToNewJersey === "yes",
      locationCountry: values.locationCountry.trim().toUpperCase(),
      locationStateRegion: values.locationStateRegion.trim() || undefined,
      locationCity: values.locationCity.trim() || undefined,
      locationPostalCode: values.locationPostalCode.trim() || undefined,
      firstName: values.firstName.trim(),
      lastName: values.lastName.trim(),
      companyName: values.companyName.trim(),
      businessEmail: values.businessEmail.trim(),
      phone: values.phone.trim() || undefined,
      serviceAcknowledged: values.serviceAcknowledged,
      legalAcknowledged: values.legalAcknowledged,
      website: values.website,
      ...attribution(),
    };
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validateAll()) return;
    if (!idempotencyKey.current) idempotencyKey.current = window.crypto.randomUUID();
    setSubmitting(true);
    setErrors({});
    try {
      const response = await fetch(SELL_SUBMISSION_SUBMIT_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload()),
      });
      const result = await response.json() as SellSubmissionSubmitResponse;
      if (result.ok) {
        setReference(result.reference);
        trackCivilonEvent("sell_submission_submit", { source_page: SELL_SUBMISSION_SOURCE_PAGE });
      } else {
        presentErrors({ ...(result.fieldErrors ?? {}), _form: result.error });
      }
    } catch {
      setErrors({ _form: "Submissions are temporarily unavailable. Please try again later." });
    } finally {
      setSubmitting(false);
    }
  }

  if (reference) {
    return (
      <section className="price-check-confirmation" aria-labelledby="sell-submission-received" role="status">
        <span className="section-label">SUBMISSION / RECEIVED</span>
        <h2 id="sell-submission-received">Submission received</h2>
        <p className="price-check-reference"><span>Reference</span><strong>{reference}</strong></p>
        <p>
          Check your email. Civilon has sent a confirmation link to the business
          email address you provided—please confirm it so Civilon can review your
          submission.
        </p>
        <p>
          Civilon will review what you have offered and a member of the team will
          contact you. Nothing here is published or listed, and interest,
          availability, condition, documentation and price all remain subject to
          confirmation. Documentation varies by part and source.
        </p>
        <button type="button" className="button button-primary" onClick={() => {
          setReference("");
          setValues(initialValues);
          setErrors({});
          setUploads([]);
          setDetailsOpen(false);
          setFilesOpen(false);
          idempotencyKey.current = "";
          started.current = false;
        }}>Send another submission</button>
      </section>
    );
  }

  const errorSummary = Object.values(errors).filter(Boolean);
  const errorProps = (field: string) => ({
    "aria-invalid": Boolean(errors[field]) as true | false,
    "aria-describedby": errors[field] ? `sell-submission-${field}-error` : undefined,
  });
  const fieldError = (field: string) => errors[field]
    ? <small className="field-error" id={`sell-submission-${field}-error`}>{errors[field]}</small>
    : null;

  return (
    <div className="price-check-form-shell" data-mobile-aog-suppress>
      <form className="price-check-form" noValidate onSubmit={submit}>
        <div className="price-check-form-heading">
          <span>SELL PARTS TO CIVILON</span>
          <h2 id="sell-submission-form-title">Tell Civilon what you have</h2>
          <p>
            No account and no sign-in. Civilon buys on its own account and
            reviews every submission internally—nothing you send here is
            published, listed or shown to a buyer.
          </p>
        </div>

        {errorSummary.length > 0 && (
          <div className="price-check-errors" role="alert" aria-labelledby="sell-submission-error-title" tabIndex={-1}>
            <strong id="sell-submission-error-title">Please review these details</strong>
            <ul>{[...new Set(errorSummary)].map((error) => <li key={error}>{error}</li>)}</ul>
          </div>
        )}

        <section aria-labelledby="sell-submission-kind-title">
          <h3 className="pc-section-title" id="sell-submission-kind-title">What are you offering?</h3>
          <div className="marketplace-choice-toggle" role="radiogroup" aria-labelledby="sell-submission-kind-title">
            <label htmlFor="sell-submission-kind-single">
              <input
                id="sell-submission-kind-single"
                type="radio"
                name="submissionKind"
                checked={!isBulk}
                onChange={() => update("submissionKind", "single_part")}
              />
              <strong>One part</strong>
              <small>A single part number or item</small>
            </label>
            <label htmlFor="sell-submission-kind-bulk">
              <input
                id="sell-submission-kind-bulk"
                type="radio"
                name="submissionKind"
                checked={isBulk}
                onChange={() => update("submissionKind", "bulk_inventory")}
              />
              <strong>Bulk inventory</strong>
              <small>A list or whole stock holding</small>
            </label>
          </div>

          {!isBulk ? (
            <>
              <label htmlFor="sell-submission-partNumber">
                <FieldLabel htmlFor="sell-submission-partNumber">Part number</FieldLabel>
                <input
                  id="sell-submission-partNumber"
                  value={values.partNumber}
                  onChange={(e) => update("partNumber", e.target.value)}
                  maxLength={160}
                  {...errorProps("partNumber")}
                  placeholder="e.g. 101-384025-5"
                />
                {fieldError("partNumber")}
                <small className="field-help">Enter the part number, or describe the part below.</small>
              </label>
              <label htmlFor="sell-submission-description">
                <FieldLabel htmlFor="sell-submission-description">Description</FieldLabel>
                <textarea
                  id="sell-submission-description"
                  value={values.description}
                  onChange={(e) => update("description", e.target.value)}
                  maxLength={2000}
                  rows={3}
                  {...errorProps("description")}
                  placeholder="e.g. Bleed air valve, removed serviceable, tagged"
                />
                {fieldError("description")}
              </label>
              <div className="pc-field-grid">
                <label htmlFor="sell-submission-quantity">
                  <FieldLabel htmlFor="sell-submission-quantity">Quantity (optional)</FieldLabel>
                  <input
                    id="sell-submission-quantity"
                    inputMode="decimal"
                    value={values.quantity}
                    onChange={(e) => update("quantity", e.target.value)}
                    maxLength={16}
                    {...errorProps("quantity")}
                    placeholder="1"
                  />
                  {fieldError("quantity")}
                </label>
                <label htmlFor="sell-submission-conditionCode">
                  <FieldLabel htmlFor="sell-submission-conditionCode">Condition (optional)</FieldLabel>
                  <select
                    id="sell-submission-conditionCode"
                    value={values.conditionCode}
                    onChange={(e) => update("conditionCode", e.target.value as FormValues["conditionCode"])}
                  >
                    {sellSubmissionConditionCodes.map((code) => (
                      <option key={code} value={code}>{conditionLabels[code]}</option>
                    ))}
                  </select>
                  <small className="field-help">Leave as Not sure if you would rather not state one.</small>
                </label>
              </div>
            </>
          ) : (
            <>
              <label htmlFor="sell-submission-description">
                <FieldLabel htmlFor="sell-submission-description">Describe the inventory</FieldLabel>
                <textarea
                  id="sell-submission-description"
                  value={values.description}
                  onChange={(e) => update("description", e.target.value)}
                  maxLength={2000}
                  rows={3}
                  {...errorProps("description")}
                  placeholder="e.g. Mixed rotable inventory across two warehouses, mostly Challenger and Global"
                />
                {fieldError("description")}
              </label>
              <label htmlFor="sell-submission-estimatedLineItemCount">
                <FieldLabel htmlFor="sell-submission-estimatedLineItemCount">
                  Approximate line items (optional)
                </FieldLabel>
                <input
                  id="sell-submission-estimatedLineItemCount"
                  inputMode="numeric"
                  value={values.estimatedLineItemCount}
                  onChange={(e) => update("estimatedLineItemCount", e.target.value)}
                  maxLength={7}
                  {...errorProps("estimatedLineItemCount")}
                  placeholder="e.g. 1400"
                />
                {fieldError("estimatedLineItemCount")}
                <small className="field-help">A rough number is fine. Attach the list below if you have one.</small>
              </label>
            </>
          )}
        </section>

        <section aria-labelledby="sell-submission-price-title">
          <h3 className="pc-section-title" id="sell-submission-price-title">Pricing</h3>
          <div className="pc-acknowledgment">
            <input
              id="sell-submission-quoteOnRequest"
              type="checkbox"
              checked={values.quoteOnRequest}
              onChange={(e) => update("quoteOnRequest", e.target.checked)}
            />
            <label htmlFor="sell-submission-quoteOnRequest">
              <strong>Price on request</strong>
              <small>
                The usual choice. Discuss price with Civilon directly. No price
                you give here is published or shown to a buyer.
              </small>
            </label>
          </div>
          {!values.quoteOnRequest && (
            <div className="pc-field-grid">
              <label htmlFor="sell-submission-askingUnitPrice">
                <FieldLabel htmlFor="sell-submission-askingUnitPrice" required>Asking unit price</FieldLabel>
                <input
                  id="sell-submission-askingUnitPrice"
                  inputMode="decimal"
                  value={values.askingUnitPrice}
                  onChange={(e) => update("askingUnitPrice", e.target.value)}
                  maxLength={24}
                  {...errorProps("askingUnitPrice")}
                  placeholder="1200.00"
                />
                {fieldError("askingUnitPrice")}
              </label>
              <label htmlFor="sell-submission-currencyCode">
                <FieldLabel htmlFor="sell-submission-currencyCode" required>Currency</FieldLabel>
                <select
                  id="sell-submission-currencyCode"
                  value={values.currencyCode}
                  onChange={(e) => update("currencyCode", e.target.value as FormValues["currencyCode"])}
                  {...errorProps("currencyCode")}
                >
                  <option value="">Select a currency</option>
                  {sellSubmissionCurrencyCodes.map((code) => (
                    <option key={code} value={code}>{code}</option>
                  ))}
                </select>
                {fieldError("currencyCode")}
              </label>
            </div>
          )}
        </section>

        <section aria-labelledby="sell-submission-location-title">
          <h3 className="pc-section-title" id="sell-submission-location-title">Where the parts are</h3>
          <label htmlFor="sell-submission-locationCountry">
            <FieldLabel htmlFor="sell-submission-locationCountry" required>Country</FieldLabel>
            <input
              id="sell-submission-locationCountry"
              autoComplete="country"
              value={values.locationCountry}
              onChange={(e) => update("locationCountry", e.target.value.toUpperCase())}
              maxLength={2}
              {...errorProps("locationCountry")}
              placeholder="US"
            />
            {fieldError("locationCountry")}
            <small className="field-help">Two-letter country code where the parts are held.</small>
          </label>

          <fieldset className="marketplace-tristate">
            <legend>Can you ship to our New Jersey facility?</legend>
            {([
              ["unknown", "Not sure yet"],
              ["yes", "Yes"],
              ["no", "No"],
            ] as const).map(([value, label]) => (
              <label key={value} htmlFor={`sell-submission-ship-${value}`}>
                <input
                  id={`sell-submission-ship-${value}`}
                  type="radio"
                  name="canShipToNewJersey"
                  checked={values.canShipToNewJersey === value}
                  onChange={() => update("canShipToNewJersey", value)}
                />
                <span>{label}</span>
              </label>
            ))}
            <small className="field-help">
              Not sure is fine. Civilon decides routing later and will discuss it with you.
            </small>
          </fieldset>
        </section>

        <section aria-labelledby="sell-submission-contact-title">
          <h3 className="pc-section-title" id="sell-submission-contact-title">How Civilon reaches you</h3>
          <div className="pc-field-grid">
            <label htmlFor="sell-submission-firstName">
              <FieldLabel htmlFor="sell-submission-firstName" required>First name</FieldLabel>
              <input
                id="sell-submission-firstName"
                autoComplete="given-name"
                value={values.firstName}
                onChange={(e) => update("firstName", e.target.value)}
                maxLength={120}
                {...errorProps("firstName")}
              />
              {fieldError("firstName")}
            </label>
            <label htmlFor="sell-submission-lastName">
              <FieldLabel htmlFor="sell-submission-lastName" required>Last name</FieldLabel>
              <input
                id="sell-submission-lastName"
                autoComplete="family-name"
                value={values.lastName}
                onChange={(e) => update("lastName", e.target.value)}
                maxLength={120}
                {...errorProps("lastName")}
              />
              {fieldError("lastName")}
            </label>
          </div>
          <label htmlFor="sell-submission-companyName">
            <FieldLabel htmlFor="sell-submission-companyName" required>Company</FieldLabel>
            <input
              id="sell-submission-companyName"
              autoComplete="organization"
              value={values.companyName}
              onChange={(e) => update("companyName", e.target.value)}
              maxLength={200}
              {...errorProps("companyName")}
            />
            {fieldError("companyName")}
          </label>
          <label htmlFor="sell-submission-businessEmail">
            <FieldLabel htmlFor="sell-submission-businessEmail" required>Business email</FieldLabel>
            <input
              id="sell-submission-businessEmail"
              type="email"
              autoComplete="email"
              value={values.businessEmail}
              onChange={(e) => update("businessEmail", e.target.value)}
              maxLength={320}
              {...errorProps("businessEmail")}
              placeholder="name@company.com"
            />
            {fieldError("businessEmail")}
            <small className="field-help">Civilon sends a confirmation link to this address.</small>
          </label>
        </section>

        <details
          className="pc-optional-details"
          open={detailsOpen}
          onToggle={(e) => setDetailsOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary>Add phone or location details (optional)</summary>
          <div className="pc-field-grid">
            <label htmlFor="sell-submission-phone">
              <FieldLabel htmlFor="sell-submission-phone">Phone (optional)</FieldLabel>
              <input
                id="sell-submission-phone"
                type="tel"
                autoComplete="tel"
                value={values.phone}
                onChange={(e) => update("phone", e.target.value)}
                maxLength={80}
                {...errorProps("phone")}
                placeholder="+1 909 555 0123"
              />
              {fieldError("phone")}
            </label>
            <label htmlFor="sell-submission-locationStateRegion">
              <FieldLabel htmlFor="sell-submission-locationStateRegion">State or region (optional)</FieldLabel>
              <input
                id="sell-submission-locationStateRegion"
                value={values.locationStateRegion}
                onChange={(e) => update("locationStateRegion", e.target.value)}
                maxLength={160}
                {...errorProps("locationStateRegion")}
              />
              {fieldError("locationStateRegion")}
            </label>
            <label htmlFor="sell-submission-locationCity">
              <FieldLabel htmlFor="sell-submission-locationCity">City (optional)</FieldLabel>
              <input
                id="sell-submission-locationCity"
                autoComplete="address-level2"
                value={values.locationCity}
                onChange={(e) => update("locationCity", e.target.value)}
                maxLength={160}
                {...errorProps("locationCity")}
              />
              {fieldError("locationCity")}
            </label>
            <label htmlFor="sell-submission-locationPostalCode">
              <FieldLabel htmlFor="sell-submission-locationPostalCode">Postal code (optional)</FieldLabel>
              <input
                id="sell-submission-locationPostalCode"
                autoComplete="postal-code"
                value={values.locationPostalCode}
                onChange={(e) => update("locationPostalCode", e.target.value)}
                maxLength={24}
                {...errorProps("locationPostalCode")}
              />
              {fieldError("locationPostalCode")}
            </label>
          </div>
          {!isBulk && (
            <small className="field-help">
              Anything else worth knowing belongs in the description above.
            </small>
          )}
        </details>

        <details
          className="pc-optional-details"
          open={filesOpen}
          onToggle={(e) => setFilesOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary>Attach files (optional)</summary>
          <div id="sell-submission-attachmentHandles" tabIndex={-1}>
            {fieldError("attachmentHandles")}
            <SellSubmissionUploads items={uploads} onChange={setUploads} />
          </div>
        </details>

        <div className="pc-honeypot" aria-hidden="true">
          <label htmlFor="sell-submission-website">Website</label>
          <input
            id="sell-submission-website"
            tabIndex={-1}
            autoComplete="off"
            value={values.website}
            onChange={(e) => update("website", e.target.value)}
          />
        </div>

        {/* TODO(legal): final counsel approval is required before production exposure. */}
        <div className="pc-acknowledgment">
          <input
            id="sell-submission-serviceAcknowledged"
            type="checkbox"
            checked={values.serviceAcknowledged}
            onChange={(e) => update("serviceAcknowledged", e.target.checked)}
            {...errorProps("serviceAcknowledged")}
          />
          <label htmlFor="sell-submission-serviceAcknowledged">
            <strong>I understand how this submission will be reviewed.</strong>
            <small>
              Civilon will use the submitted contact and offer information to
              review what I am offering and to contact me about it. Civilon is not
              obliged to buy, and nothing here is published or listed.
            </small>
          </label>
        </div>
        {errors.serviceAcknowledged && (
          <small className="field-error pc-ack-error" id="sell-submission-serviceAcknowledged-error">
            {errors.serviceAcknowledged}
          </small>
        )}

        <div className="pc-acknowledgment pc-legal-acknowledgment">
          <input
            id="sell-submission-legalAcknowledged"
            type="checkbox"
            checked={values.legalAcknowledged}
            onChange={(e) => update("legalAcknowledged", e.target.checked)}
            {...errorProps("legalAcknowledged")}
          />
          <label htmlFor="sell-submission-legalAcknowledged">
            <strong>I have read and agree to the Civilon terms.</strong>
            <small>
              By submitting, you acknowledge the{" "}
              <a href="/privacy-policy" target="_blank" rel="noreferrer">Privacy Policy</a> and{" "}
              <a href="/terms-of-use" target="_blank" rel="noreferrer">Terms of Use</a>.
            </small>
          </label>
        </div>
        {errors.legalAcknowledged && (
          <small className="field-error pc-ack-error" id="sell-submission-legalAcknowledged-error">
            {errors.legalAcknowledged}
          </small>
        )}

        <div className="pc-final-note" role="note">
          <strong>What happens next</strong>
          <p>
            Civilon reviews each submission internally and is not obliged to buy.
            Interest, availability, stated condition, documentation and price all
            remain subject to confirmation, and documentation varies by part and
            source. Civilon review and any evidence you upload are not
            certification, regulatory approval, airworthiness approval, or a
            guarantee of authenticity or fitness.
          </p>
        </div>

        <div className="pc-submit-actions">
          <button type="submit" className="pc-next" disabled={submitting}>
            {submitting ? "Sending…" : "Send submission"}
            <span aria-hidden="true">→</span>
          </button>
          {/*
            Sending is never blocked while a file is still going up — a seller
            in a hurry must not be held hostage to an upload. But only finished
            files are attached, so the consequence is stated here, next to the
            control that causes it, at the moment it is true. Live-announced, so
            a seller who cannot see the upload list still hears it.
          */}
          {unfinishedUploads > 0 && (
            <small className="field-warning" role="status" aria-live="polite">
              {unfinishedUploads === 1
                ? "1 file has not finished uploading."
                : `${unfinishedUploads} files have not finished uploading.`}{" "}
              Sending now submits without {unfinishedUploads === 1 ? "it" : "them"}.
              Wait for {unfinishedUploads === 1 ? "it" : "them"} to finish, or send
              and attach nothing—your offer is reviewed either way.
            </small>
          )}
          <small className="field-help">
            Files are optional—you can send this with none attached.
          </small>
        </div>
      </form>
    </div>
  );
}
