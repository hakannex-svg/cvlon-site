"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { CallAogAction, WhatsAppAogAction } from "../AogActions";
import { FieldLabel } from "../FieldLabel";
import { trackCivilonEvent } from "@/lib/analytics";
import { usePublicFormFeedback } from "@/lib/use-public-form-feedback";
import {
  BUY_REQUEST_SOURCE_PAGE,
  BUY_REQUEST_SUBMIT_PATH,
  buyRequestConditionCodes,
  buyRequestFulfillmentPreferences,
  buyRequestUrgencies,
  isPhoneRequiredUrgency,
  type BuyRequestSubmitResponse,
} from "@/lib/marketplace/contract";

const conditionLabels = {
  NOT_SURE: "Not sure",
  ANY: "Any condition is acceptable",
  NE: "NE — New",
  NS: "NS — New Surplus",
  OH: "OH — Overhauled",
  SV: "SV — Serviceable",
  AR: "AR — As Removed",
} as const;

const urgencyLabels = {
  not_sure: "Not sure yet",
  aog: "AOG — grounded aircraft",
  critical: "Critical — grounding risk",
  standard: "Standard requirement",
  planned: "Planned maintenance",
} as const;

const fulfillmentLabels = {
  not_sure: "Not sure yet",
  door_delivery: "Delivery to our door",
  port_of_entry: "Port of entry",
  nj_pickup: "Pickup in New Jersey",
} as const;

type FormValues = {
  partNumber: string;
  description: string;
  quantity: string;
  acceptableCondition: (typeof buyRequestConditionCodes)[number];
  urgency: (typeof buyRequestUrgencies)[number];
  neededByDate: string;
  deliveryCountry: string;
  deliveryPostalCode: string;
  deliveryCity: string;
  fulfillmentPreference: (typeof buyRequestFulfillmentPreferences)[number];
  aircraftModel: string;
  applicationNotes: string;
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
  partNumber: "", description: "", quantity: "1", acceptableCondition: "NOT_SURE",
  urgency: "not_sure", neededByDate: "", deliveryCountry: "", deliveryPostalCode: "",
  deliveryCity: "", fulfillmentPreference: "not_sure", aircraftModel: "",
  applicationNotes: "", firstName: "", lastName: "", companyName: "",
  businessEmail: "", phone: "", serviceAcknowledged: false, legalAcknowledged: false,
  website: "",
};

/**
 * Fields that live inside the optional disclosure. A server or client error on
 * one of these must expand the disclosure before focus moves, or the message is
 * announced to a screen reader while its field is still hidden.
 */
const disclosureFields = new Set(["aircraftModel", "applicationNotes", "deliveryCity"]);

export function BuyRequestForm() {
  const [values, setValues] = useState<FormValues>(initialValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [describeInstead, setDescribeInstead] = useState(false);
  const [phoneShown, setPhoneShown] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reference, setReference] = useState("");
  const [errorFeedbackRevision, setErrorFeedbackRevision] = useState(0);
  const idempotencyKey = useRef("");
  const started = useRef(false);
  const confirmationHeadingRef = usePublicFormFeedback<HTMLHeadingElement>(reference);
  const errorFeedbackRef = usePublicFormFeedback<HTMLDivElement>(errorFeedbackRevision);

  useEffect(() => {
    trackCivilonEvent("buy_request_view", { source_page: BUY_REQUEST_SOURCE_PAGE });
  }, []);

  const phoneRequired = isPhoneRequiredUrgency(values.urgency);

  function update<K extends keyof FormValues>(field: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "", _form: "" }));
    if (!started.current) {
      started.current = true;
      trackCivilonEvent("buy_request_start", { source_page: BUY_REQUEST_SOURCE_PAGE });
    }
  }

  function presentErrors(nextErrors: Record<string, string>) {
    const first = Object.keys(nextErrors).find((key) => key !== "_form" && nextErrors[key]);
    if (first && disclosureFields.has(first)) setDetailsOpen(true);
    setErrors(nextErrors);
    setErrorFeedbackRevision((current) => current + 1);
  }

  function validateAll() {
    const next: Record<string, string> = {};
    const partNumber = values.partNumber.trim();
    const description = values.description.trim();
    if (!partNumber && !description) {
      next[describeInstead ? "description" : "partNumber"] = "Enter a part number or describe the part you need.";
    }
    if (partNumber && !/^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/.test(partNumber)) {
      next.partNumber = "Enter a valid aircraft part number, or describe the part instead.";
    }
    if (!/^\d+(?:\.\d{1,3})?$/.test(values.quantity) || Number(values.quantity) <= 0) {
      next.quantity = "Enter a quantity greater than zero.";
    }
    if (!values.firstName.trim()) next.firstName = "Enter your first name.";
    if (!values.lastName.trim()) next.lastName = "Enter your last name.";
    if (!values.companyName.trim()) next.companyName = "Enter your company name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.businessEmail)) {
      next.businessEmail = "Enter a valid business email address.";
    }
    if (phoneRequired && values.phone.replace(/\D/g, "").length < 7) {
      next.phone = "Enter a phone number for an AOG or critical requirement.";
    }
    if (values.deliveryCountry && !/^[A-Za-z]{2}$/.test(values.deliveryCountry)) {
      next.deliveryCountry = "Use a two-letter country code.";
    }
    if (!values.serviceAcknowledged) {
      next.serviceAcknowledged = "Acknowledge how Civilon will process this request.";
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
      sourcePage: BUY_REQUEST_SOURCE_PAGE,
      landingPage: `${window.location.origin}${window.location.pathname}`,
      referrer: document.referrer || null,
      utmSource: value("utm_source"),
      utmMedium: value("utm_medium"),
      utmCampaign: value("utm_campaign"),
      utmContent: value("utm_content"),
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
      idempotencyKey: idempotencyKey.current,
      ...attribution(),
    };
    try {
      const response = await fetch(BUY_REQUEST_SUBMIT_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as BuyRequestSubmitResponse;
      if (result.ok) {
        setReference(result.reference);
        trackCivilonEvent("buy_request_submit", { source_page: BUY_REQUEST_SOURCE_PAGE });
      } else {
        presentErrors({ ...(result.fieldErrors ?? {}), _form: result.error });
      }
    } catch {
      presentErrors({ _form: "Requests are temporarily unavailable. Please try again later." });
    } finally {
      setSubmitting(false);
    }
  }

  if (reference) {
    return (
      <section className="price-check-confirmation" aria-labelledby="buy-request-received" role="status">
        <span className="section-label">REQUEST / RECEIVED</span>
        <h2 id="buy-request-received" ref={confirmationHeadingRef} tabIndex={-1}>Request received</h2>
        <p className="price-check-reference"><span>Reference</span><strong>{reference}</strong></p>
        <p>
          Check your email. Civilon has sent a confirmation link to the business
          email address you provided—please confirm it so the request can proceed.
        </p>
        <p>
          Civilon will review and source this request. Availability, stated
          condition, documentation, delivery and price all remain subject to
          confirmation, and documentation varies by part and source.
        </p>
        <button type="button" className="button button-primary" onClick={() => {
          setReference("");
          setValues(initialValues);
          setErrors({});
          setDetailsOpen(false);
          setDescribeInstead(false);
          setPhoneShown(false);
          idempotencyKey.current = "";
          started.current = false;
        }}>Send another request</button>
      </section>
    );
  }

  const errorSummary = Object.values(errors).filter(Boolean);
  const errorProps = (field: string) => ({
    "aria-invalid": Boolean(errors[field]) as true | false,
    "aria-describedby": errors[field] ? `buy-request-${field}-error` : undefined,
  });
  const fieldError = (field: string) => errors[field]
    ? <small className="field-error" id={`buy-request-${field}-error`}>{errors[field]}</small>
    : null;

  return (
    <div className="price-check-form-shell" data-mobile-aog-suppress>
      <form className="price-check-form" noValidate onSubmit={submit}>
        <div className="price-check-form-heading">
          <span>REQUEST A PART</span>
          <h2 id="buy-request-form-title">Tell Civilon what you need</h2>
          <p>
            No account and no sign-in. Share what you know—Civilon reviews and
            sources the request, then comes back to you with what is actually
            available and on what terms.
          </p>
        </div>

        {errorSummary.length > 0 && (
          <div className="price-check-errors" ref={errorFeedbackRef} role="alert" aria-labelledby="buy-request-error-title" tabIndex={-1}>
            <strong id="buy-request-error-title">Please review these details</strong>
            <ul>{[...new Set(errorSummary)].map((error) => <li key={error}>{error}</li>)}</ul>
          </div>
        )}

        <section aria-labelledby="buy-request-part-title">
          <h3 className="pc-section-title" id="buy-request-part-title">The part</h3>
          {!describeInstead ? (
            <>
              <label htmlFor="buy-request-partNumber">
                <FieldLabel htmlFor="buy-request-partNumber" required>Part number</FieldLabel>
                <input
                  id="buy-request-partNumber"
                  value={values.partNumber}
                  onChange={(e) => update("partNumber", e.target.value)}
                  maxLength={160}
                  {...errorProps("partNumber")}
                  placeholder="e.g. 101-384025-5"
                />
                {fieldError("partNumber")}
              </label>
              <button
                type="button"
                className="marketplace-link-button"
                onClick={() => { setDescribeInstead(true); update("partNumber", ""); }}
              >
                I don&apos;t know the exact part number
              </button>
            </>
          ) : (
            <>
              <label htmlFor="buy-request-description">
                <FieldLabel htmlFor="buy-request-description" required>Describe the part</FieldLabel>
                <textarea
                  id="buy-request-description"
                  value={values.description}
                  onChange={(e) => update("description", e.target.value)}
                  maxLength={500}
                  rows={3}
                  {...errorProps("description")}
                  placeholder="e.g. Nose landing gear actuator for a Challenger 605"
                />
                {fieldError("description")}
                <small className="field-help">
                  Describe the component, where it sits on the aircraft, and anything printed on it.
                </small>
              </label>
              <button
                type="button"
                className="marketplace-link-button"
                onClick={() => { setDescribeInstead(false); update("description", ""); }}
              >
                I do have the part number
              </button>
            </>
          )}

          <div className="pc-field-grid">
            <label htmlFor="buy-request-quantity">
              <FieldLabel htmlFor="buy-request-quantity">Quantity</FieldLabel>
              <input
                id="buy-request-quantity"
                inputMode="decimal"
                value={values.quantity}
                onChange={(e) => update("quantity", e.target.value)}
                maxLength={16}
                {...errorProps("quantity")}
              />
              {fieldError("quantity")}
              <small className="field-help">Defaults to 1.</small>
            </label>
            <label htmlFor="buy-request-acceptableCondition">
              <FieldLabel htmlFor="buy-request-acceptableCondition">Acceptable condition</FieldLabel>
              <select
                id="buy-request-acceptableCondition"
                value={values.acceptableCondition}
                onChange={(e) => update("acceptableCondition", e.target.value as FormValues["acceptableCondition"])}
              >
                {buyRequestConditionCodes.map((code) => (
                  <option key={code} value={code}>{conditionLabels[code]}</option>
                ))}
              </select>
              <small className="field-help">Leave as &quot;Not sure&quot; if it does not matter yet.</small>
            </label>
          </div>
        </section>

        <section aria-labelledby="buy-request-timing-title">
          <h3 className="pc-section-title" id="buy-request-timing-title">Timing and delivery</h3>
          <div className="pc-field-grid">
            <label htmlFor="buy-request-urgency">
              <FieldLabel htmlFor="buy-request-urgency">How urgent is it?</FieldLabel>
              <select
                id="buy-request-urgency"
                value={values.urgency}
                onChange={(e) => update("urgency", e.target.value as FormValues["urgency"])}
              >
                {buyRequestUrgencies.map((code) => (
                  <option key={code} value={code}>{urgencyLabels[code]}</option>
                ))}
              </select>
            </label>
            <label htmlFor="buy-request-neededByDate">
              <FieldLabel htmlFor="buy-request-neededByDate">Needed by</FieldLabel>
              <input
                id="buy-request-neededByDate"
                type="date"
                value={values.neededByDate}
                onChange={(e) => update("neededByDate", e.target.value)}
                {...errorProps("neededByDate")}
              />
              {fieldError("neededByDate")}
            </label>
          </div>

          {phoneRequired && (
            <div className="pc-aog-notice" role="note">
              <strong>Urgent requirement</strong>
              <p>
                Civilon&apos;s AOG desk is monitored by a live person 24/7/365. Submit
                this request, and for an AOG situation call or message the
                desk directly as well. A phone number is required below.
              </p>
              <div>
                <CallAogAction className="button button-primary" source_page={BUY_REQUEST_SOURCE_PAGE}>Call AOG Desk</CallAogAction>
                <WhatsAppAogAction className="button button-whatsapp" source_page={BUY_REQUEST_SOURCE_PAGE}>WhatsApp AOG</WhatsAppAogAction>
              </div>
            </div>
          )}

          <div className="pc-field-grid">
            <label htmlFor="buy-request-deliveryCountry">
              <FieldLabel htmlFor="buy-request-deliveryCountry">Delivery country</FieldLabel>
              <input
                id="buy-request-deliveryCountry"
                autoComplete="country"
                value={values.deliveryCountry}
                onChange={(e) => update("deliveryCountry", e.target.value.toUpperCase())}
                maxLength={2}
                {...errorProps("deliveryCountry")}
                placeholder="US"
              />
              {fieldError("deliveryCountry")}
            </label>
            <label htmlFor="buy-request-deliveryPostalCode">
              <FieldLabel htmlFor="buy-request-deliveryPostalCode">Delivery postal code</FieldLabel>
              <input
                id="buy-request-deliveryPostalCode"
                autoComplete="postal-code"
                value={values.deliveryPostalCode}
                onChange={(e) => update("deliveryPostalCode", e.target.value)}
                maxLength={24}
                {...errorProps("deliveryPostalCode")}
              />
              {fieldError("deliveryPostalCode")}
            </label>
          </div>
          <label htmlFor="buy-request-fulfillmentPreference">
            <FieldLabel htmlFor="buy-request-fulfillmentPreference">Delivery preference</FieldLabel>
            <select
              id="buy-request-fulfillmentPreference"
              value={values.fulfillmentPreference}
              onChange={(e) => update("fulfillmentPreference", e.target.value as FormValues["fulfillmentPreference"])}
            >
              {buyRequestFulfillmentPreferences.map((code) => (
                <option key={code} value={code}>{fulfillmentLabels[code]}</option>
              ))}
            </select>
          </label>
        </section>

        <details
          className="pc-disclosure"
          open={detailsOpen}
          onToggle={(e) => setDetailsOpen(e.currentTarget.open)}
        >
          <summary>
            <b>Aircraft, application and notes</b>
            <small>Optional — the aircraft it is for, the city for delivery, and anything else worth knowing.</small>
          </summary>
          <div className="pc-disclosure-body">
            <div className="pc-field-grid">
              <label htmlFor="buy-request-aircraftModel">
                <FieldLabel htmlFor="buy-request-aircraftModel">Aircraft / model</FieldLabel>
                <input
                  id="buy-request-aircraftModel"
                  value={values.aircraftModel}
                  onChange={(e) => update("aircraftModel", e.target.value)}
                  maxLength={160}
                  {...errorProps("aircraftModel")}
                  placeholder="e.g. Challenger 605"
                />
                {fieldError("aircraftModel")}
              </label>
              <label htmlFor="buy-request-deliveryCity">
                <FieldLabel htmlFor="buy-request-deliveryCity">Delivery city</FieldLabel>
                <input
                  id="buy-request-deliveryCity"
                  autoComplete="address-level2"
                  value={values.deliveryCity}
                  onChange={(e) => update("deliveryCity", e.target.value)}
                  maxLength={160}
                  {...errorProps("deliveryCity")}
                />
                {fieldError("deliveryCity")}
              </label>
            </div>
            <label htmlFor="buy-request-applicationNotes">
              <FieldLabel htmlFor="buy-request-applicationNotes">Notes</FieldLabel>
              <textarea
                id="buy-request-applicationNotes"
                value={values.applicationNotes}
                onChange={(e) => update("applicationNotes", e.target.value)}
                maxLength={2000}
                rows={4}
                {...errorProps("applicationNotes")}
                placeholder="Documentation you need, alternates you would accept, delivery constraints"
              />
              {fieldError("applicationNotes")}
              <small className="field-help">
                Up to 2,000 characters. Do not include payment-card or account credentials.
              </small>
            </label>
          </div>
        </details>

        <section aria-labelledby="buy-request-contact-title">
          <h3 className="pc-section-title" id="buy-request-contact-title">Your details</h3>
          <div className="pc-field-grid">
            <label htmlFor="buy-request-firstName">
              <FieldLabel htmlFor="buy-request-firstName" required>First name</FieldLabel>
              <input
                id="buy-request-firstName"
                autoComplete="given-name"
                value={values.firstName}
                onChange={(e) => update("firstName", e.target.value)}
                maxLength={120}
                {...errorProps("firstName")}
              />
              {fieldError("firstName")}
            </label>
            <label htmlFor="buy-request-lastName">
              <FieldLabel htmlFor="buy-request-lastName" required>Last name</FieldLabel>
              <input
                id="buy-request-lastName"
                autoComplete="family-name"
                value={values.lastName}
                onChange={(e) => update("lastName", e.target.value)}
                maxLength={120}
                {...errorProps("lastName")}
              />
              {fieldError("lastName")}
            </label>
          </div>
          <label htmlFor="buy-request-companyName">
            <FieldLabel htmlFor="buy-request-companyName" required>Company</FieldLabel>
            <input
              id="buy-request-companyName"
              autoComplete="organization"
              value={values.companyName}
              onChange={(e) => update("companyName", e.target.value)}
              maxLength={200}
              {...errorProps("companyName")}
            />
            {fieldError("companyName")}
          </label>
          <label htmlFor="buy-request-businessEmail">
            <FieldLabel htmlFor="buy-request-businessEmail" required>Business email</FieldLabel>
            <input
              id="buy-request-businessEmail"
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
          {(phoneRequired || phoneShown) && (
            <label htmlFor="buy-request-phone">
              <FieldLabel htmlFor="buy-request-phone" required={phoneRequired}>
                Phone {phoneRequired ? "" : "(optional)"}
              </FieldLabel>
              <input
                id="buy-request-phone"
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
          )}
          {!phoneRequired && !phoneShown && (
            <button type="button" className="marketplace-link-button" onClick={() => setPhoneShown(true)}>
              Add a phone number (optional)
            </button>
          )}
        </section>

        <div className="pc-honeypot" aria-hidden="true">
          <label htmlFor="buy-request-website">Website</label>
          <input
            id="buy-request-website"
            tabIndex={-1}
            autoComplete="off"
            value={values.website}
            onChange={(e) => update("website", e.target.value)}
          />
        </div>

        {/* TODO(legal): final counsel approval is required before production exposure. */}
        <div className="pc-acknowledgment">
          <input
            id="buy-request-serviceAcknowledged"
            type="checkbox"
            checked={values.serviceAcknowledged}
            onChange={(e) => update("serviceAcknowledged", e.target.checked)}
            {...errorProps("serviceAcknowledged")}
          />
          <label htmlFor="buy-request-serviceAcknowledged">
            <strong>I understand how this request will be processed.</strong>
            <small>
              Civilon will use the submitted contact and request information to
              review and source the part, and will contact me about it.
            </small>
          </label>
        </div>
        {errors.serviceAcknowledged && (
          <small className="field-error pc-ack-error" id="buy-request-serviceAcknowledged-error">
            {errors.serviceAcknowledged}
          </small>
        )}

        <div className="pc-acknowledgment pc-legal-acknowledgment">
          <input
            id="buy-request-legalAcknowledged"
            type="checkbox"
            checked={values.legalAcknowledged}
            onChange={(e) => update("legalAcknowledged", e.target.checked)}
            {...errorProps("legalAcknowledged")}
          />
          <label htmlFor="buy-request-legalAcknowledged">
            <strong>I have read and agree to the Civilon terms.</strong>
            <small>
              By submitting, you acknowledge the{" "}
              <a href="/privacy-policy" target="_blank" rel="noreferrer">Privacy Policy</a> and{" "}
              <a href="/terms-of-use" target="_blank" rel="noreferrer">Terms of Use</a>.
            </small>
          </label>
        </div>
        {errors.legalAcknowledged && (
          <small className="field-error pc-ack-error" id="buy-request-legalAcknowledged-error">
            {errors.legalAcknowledged}
          </small>
        )}

        <div className="pc-final-note" role="note">
          <strong>What happens next</strong>
          <p>
            Civilon reviews and sources the request. Availability, stated
            condition, documentation, delivery and price all remain subject to
            confirmation, and documentation varies by part and source. Submitting
            this request does not place an order.
          </p>
        </div>

        <div className="pc-submit-actions">
          <button type="submit" className="pc-next" disabled={submitting}>
            {submitting ? "Sending…" : "Send request"}
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </form>
    </div>
  );
}
