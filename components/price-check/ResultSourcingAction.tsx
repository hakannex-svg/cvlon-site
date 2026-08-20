"use client";

import { useState, type FormEvent } from "react";
import {
  PRICE_CHECK_BUY_REQUEST_SUBMIT_PATH,
  buyRequestConditionCodes,
  buyRequestFulfillmentPreferences,
  buyRequestUrgencies,
  type PriceCheckBuyRequestResponse,
} from "@/lib/marketplace/price-check-conversion-contract";
import { isPhoneRequiredUrgency } from "@/lib/marketplace/contract";
import { PUBLIC_CTA } from "@/lib/public-cta";

const conditionLabels = {
  NOT_SURE: "Not sure",
  ANY: "Any condition",
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

type Props = {
  partNumber: string;
  initialQuantity: string;
  initialCondition: (typeof buyRequestConditionCodes)[number];
  initialUrgency: (typeof buyRequestUrgencies)[number];
  initialCountry: string;
  hasPhoneOnFile: boolean;
  legacySourcingRequested?: boolean;
  existingRequest?: { reference: string; status: string } | null;
};

type FormValues = {
  quantity: string;
  acceptableCondition: (typeof buyRequestConditionCodes)[number];
  urgency: (typeof buyRequestUrgencies)[number];
  neededByDate: string;
  deliveryCountry: string;
  deliveryPostalCode: string;
  deliveryCity: string;
  fulfillmentPreference: (typeof buyRequestFulfillmentPreferences)[number];
  applicationNotes: string;
  phone: string;
  serviceAcknowledged: boolean;
  legalAcknowledged: boolean;
  website: string;
};

export function ResultSourcingAction({
  partNumber,
  initialQuantity,
  initialCondition,
  initialUrgency,
  initialCountry,
  hasPhoneOnFile,
  legacySourcingRequested = false,
  existingRequest = null,
}: Props) {
  const [values, setValues] = useState<FormValues>({
    quantity: initialQuantity,
    acceptableCondition: initialCondition,
    urgency: initialUrgency,
    neededByDate: "",
    deliveryCountry: initialCountry,
    deliveryPostalCode: "",
    deliveryCity: "",
    fulfillmentPreference: "not_sure",
    applicationNotes: "",
    phone: "",
    serviceAcknowledged: false,
    legalAcknowledged: false,
    website: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [reference, setReference] = useState(existingRequest?.reference ?? "");
  const phoneRequired = isPhoneRequiredUrgency(values.urgency) && !hasPhoneOnFile;

  function update<K extends keyof FormValues>(field: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "", _form: "" }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clientErrors: Record<string, string> = {};
    if (!values.quantity.trim() || Number(values.quantity) <= 0) clientErrors.quantity = "Enter a quantity greater than zero.";
    if (phoneRequired && !values.phone.trim()) clientErrors.phone = "Enter a phone number for an urgent request.";
    if (!values.serviceAcknowledged) clientErrors.serviceAcknowledged = "Acknowledge how Civilon will process this request.";
    if (!values.legalAcknowledged) clientErrors.legalAcknowledged = "Acknowledge the Privacy Policy and Terms of Use.";
    if (Object.keys(clientErrors).length) {
      setErrors(clientErrors);
      return;
    }

    setBusy(true);
    setErrors({});
    try {
      const response = await fetch(PRICE_CHECK_BUY_REQUEST_SUBMIT_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...values,
          neededByDate: values.neededByDate || null,
          deliveryCountry: values.deliveryCountry || null,
          deliveryPostalCode: values.deliveryPostalCode || null,
          deliveryCity: values.deliveryCity || null,
          applicationNotes: values.applicationNotes || null,
          phone: values.phone || null,
        }),
      });
      const result = await response.json() as PriceCheckBuyRequestResponse;
      if (!result.ok) {
        setErrors(result.fieldErrors ?? { _form: result.error });
        return;
      }
      setReference(result.reference);
    } catch {
      setErrors({ _form: "The part request could not be sent. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  if (reference) {
    return <section className="result-sourcing result-buy-request-complete" aria-live="polite" data-result-region="sourcing-cta">
      <div>
        <p>Part request received</p>
        <h2>Reference {reference}</h2>
        <span data-result-region="sourcing-confirmation">Civilon will review the requirement and contact you. Availability, documentation, condition, delivery and price remain subject to confirmation.</span>
      </div>
    </section>;
  }

  return <section className="result-sourcing result-buy-request" aria-labelledby="result-buy-request-title" data-result-region="sourcing-cta">
    <header>
      <p>{legacySourcingRequested ? "Complete your earlier sourcing request" : "Need Civilon to source this part?"}</p>
      <h2 id="result-buy-request-title">Request the part from Civilon</h2>
      <span>Your company and part details come from this secure Price Check. Confirm only what Civilon needs to start.</span>
    </header>
    <form onSubmit={submit} noValidate>
      {errors._form && <div className="result-buy-request-error" role="alert">{errors._form}</div>}
      <div className="result-buy-request-part"><span>Part number</span><strong>{partNumber}</strong></div>
      <div className="result-buy-request-grid">
        <label>Quantity
          <input inputMode="decimal" value={values.quantity} onChange={(event) => update("quantity", event.target.value)} maxLength={16} aria-invalid={Boolean(errors.quantity)} />
          {errors.quantity && <small>{errors.quantity}</small>}
        </label>
        <label>Acceptable condition
          <select value={values.acceptableCondition} onChange={(event) => update("acceptableCondition", event.target.value as FormValues["acceptableCondition"])}>
            {buyRequestConditionCodes.map((code) => <option key={code} value={code}>{conditionLabels[code]}</option>)}
          </select>
        </label>
        <label>Urgency
          <select value={values.urgency} onChange={(event) => update("urgency", event.target.value as FormValues["urgency"])}>
            {buyRequestUrgencies.map((code) => <option key={code} value={code}>{urgencyLabels[code]}</option>)}
          </select>
        </label>
        <label>Needed by <small>Optional</small>
          <input type="date" value={values.neededByDate} onChange={(event) => update("neededByDate", event.target.value)} aria-invalid={Boolean(errors.neededByDate)} />
          {errors.neededByDate && <small>{errors.neededByDate}</small>}
        </label>
        <label>Delivery country <small>Two-letter code</small>
          <input value={values.deliveryCountry} onChange={(event) => update("deliveryCountry", event.target.value.toUpperCase())} maxLength={2} placeholder="US" aria-invalid={Boolean(errors.deliveryCountry)} />
          {errors.deliveryCountry && <small>{errors.deliveryCountry}</small>}
        </label>
        <label>Postal code <small>Optional</small>
          <input value={values.deliveryPostalCode} onChange={(event) => update("deliveryPostalCode", event.target.value)} maxLength={24} aria-invalid={Boolean(errors.deliveryPostalCode)} />
          {errors.deliveryPostalCode && <small>{errors.deliveryPostalCode}</small>}
        </label>
        <label>Delivery preference
          <select value={values.fulfillmentPreference} onChange={(event) => update("fulfillmentPreference", event.target.value as FormValues["fulfillmentPreference"])}>
            {buyRequestFulfillmentPreferences.map((code) => <option key={code} value={code}>{fulfillmentLabels[code]}</option>)}
          </select>
        </label>
        <label>Delivery city <small>Optional</small>
          <input value={values.deliveryCity} onChange={(event) => update("deliveryCity", event.target.value)} maxLength={160} aria-invalid={Boolean(errors.deliveryCity)} />
          {errors.deliveryCity && <small>{errors.deliveryCity}</small>}
        </label>
      </div>
      {(phoneRequired || values.phone) && <label className="result-buy-request-wide">Phone {hasPhoneOnFile ? <small>Optional update</small> : null}
        <input type="tel" autoComplete="tel" value={values.phone} onChange={(event) => update("phone", event.target.value)} maxLength={80} placeholder="+1 909 555 0123" aria-invalid={Boolean(errors.phone)} />
        {errors.phone && <small>{errors.phone}</small>}
      </label>}
      {isPhoneRequiredUrgency(values.urgency) && hasPhoneOnFile && !values.phone && <p className="result-buy-request-phone-note">Civilon will use the phone number already provided with this Price Check.</p>}
      <label className="result-buy-request-wide">Additional requirement notes <small>Optional</small>
        <textarea value={values.applicationNotes} onChange={(event) => update("applicationNotes", event.target.value)} maxLength={2000} rows={3} placeholder="Documentation needs, acceptable alternates or delivery constraints" aria-invalid={Boolean(errors.applicationNotes)} />
        {errors.applicationNotes && <small>{errors.applicationNotes}</small>}
      </label>
      <div className="result-buy-request-ack">
        <input id="result-service-ack" type="checkbox" checked={values.serviceAcknowledged} onChange={(event) => update("serviceAcknowledged", event.target.checked)} aria-invalid={Boolean(errors.serviceAcknowledged)} />
        <label htmlFor="result-service-ack">Civilon may use my Price Check contact and requirement details to review and source this part.</label>
        {errors.serviceAcknowledged && <small>{errors.serviceAcknowledged}</small>}
      </div>
      <div className="result-buy-request-ack">
        <input id="result-legal-ack" type="checkbox" checked={values.legalAcknowledged} onChange={(event) => update("legalAcknowledged", event.target.checked)} aria-invalid={Boolean(errors.legalAcknowledged)} />
        <label htmlFor="result-legal-ack">I acknowledge the <a href="/privacy-policy" target="_blank" rel="noreferrer">Privacy Policy</a> and <a href="/terms-of-use" target="_blank" rel="noreferrer">Terms of Use</a>.</label>
        {errors.legalAcknowledged && <small>{errors.legalAcknowledged}</small>}
      </div>
      <div className="pc-honeypot" aria-hidden="true"><label>Website<input tabIndex={-1} autoComplete="off" value={values.website} onChange={(event) => update("website", event.target.value)} /></label></div>
      <div className="result-buy-request-submit">
        <button type="submit" disabled={busy}>{busy ? "Sending…" : PUBLIC_CTA.buy}</button>
        <span>Submitting does not place an order. Civilon will review the request and contact you with an offer if a suitable option is confirmed.</span>
      </div>
    </form>
  </section>;
}
