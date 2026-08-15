"use client";

import { useState, type FormEvent, type InvalidEvent } from "react";
import { trackCivilonEvent } from "@/lib/analytics";
import { validateRfq, type RfqValidationErrors } from "@/lib/rfq-logic";
import type { AogMessageData } from "@/lib/aog";
import { CallAogAction, WhatsAppAogAction } from "./AogActions";
import { FieldLabel } from "./FieldLabel";

type RfqFormProps = {
  defaultAog?: boolean;
  sourcePage?: string;
  aircraftBrand?: string;
  partCategory?: string;
  idPrefix?: string;
  actionLabel?: string;
};

type AogValues = {
  callbackNumber: string;
  aircraftLocation: string;
  requiredBy: string;
  aircraftTypeTail: string;
};

type SubmissionState = "idle" | "submitting" | "success" | "error" | "preview";

const emptyAogValues: AogValues = {
  callbackNumber: "",
  aircraftLocation: "",
  requiredBy: "",
  aircraftTypeTail: "",
};

export function RfqForm({
  defaultAog = false,
  sourcePage = "homepage",
  aircraftBrand = "",
  partCategory = "",
  idPrefix = "",
  actionLabel,
}: RfqFormProps) {
  const [isAog, setIsAog] = useState(defaultAog);
  const [aogValues, setAogValues] = useState<AogValues>(emptyAogValues);
  const [errors, setErrors] = useState<RfqValidationErrors>({});
  const [status, setStatus] = useState<SubmissionState>("idle");
  const [whatsAppData, setWhatsAppData] = useState<AogMessageData>({});
  const fieldId = (name: string) => idPrefix ? `${idPrefix}-${name}` : name;
  const analyticsContext = { source_page: sourcePage, aircraft_brand: aircraftBrand, part_category: partCategory };

  function setAogField(name: keyof AogValues, value: string) {
    setAogValues((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: undefined }));
  }

  function handleInvalid(event: InvalidEvent<HTMLInputElement>) {
    event.preventDefault();
    const name = event.currentTarget.name as keyof RfqValidationErrors;
    const messages: RfqValidationErrors = {
      partNumber: "Enter a part number.",
      email: "Enter a business email address.",
      callbackNumber: "Enter a callback or WhatsApp number for this AOG request.",
      aircraftLocation: "Enter the aircraft location for this AOG request.",
    };
    setErrors((current) => ({ ...current, [name]: messages[name] }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const validationErrors = validateRfq({
      partNumber: String(formData.get("partNumber") ?? ""),
      email: String(formData.get("email") ?? ""),
      callbackNumber: aogValues.callbackNumber,
      aircraftLocation: aogValues.aircraftLocation,
    }, isAog);

    if (Object.keys(validationErrors).length) {
      setErrors(validationErrors);
      const firstInvalid = form.querySelector<HTMLElement>("[aria-invalid='true'], :invalid");
      firstInvalid?.focus();
      return;
    }

    const messageData = {
      partNumber: String(formData.get("partNumber") ?? ""),
      quantity: String(formData.get("quantity") ?? ""),
      aircraftTypeTail: aogValues.aircraftTypeTail,
      aircraftLocation: aogValues.aircraftLocation,
      requiredBy: aogValues.requiredBy,
    };
    setWhatsAppData(messageData);
    setStatus("submitting");
    trackCivilonEvent(isAog ? "aog_rfq_submit" : "rfq_submit", analyticsContext);

    const isConfirmedEndpoint = window.location.hostname.endsWith(".netlify.app");
    if (!isConfirmedEndpoint) {
      setStatus("preview");
      return;
    }

    try {
      const response = await fetch("/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(Array.from(formData.entries()).map(([key, value]) => [key, String(value)])).toString(),
      });
      setStatus(response.ok ? "success" : "error");
    } catch {
      setStatus("error");
    }
  }

  return (
    <form className="quick-rfq" id={fieldId("rfq")} name="quick-rfq" method="POST" data-netlify="true" onSubmit={handleSubmit}>
      <input type="hidden" name="form-name" value="quick-rfq" />
      <input type="hidden" name="sourcePage" value={sourcePage} />
      <input type="hidden" name="aircraftBrand" value={aircraftBrand} />
      <input type="hidden" name="partCategory" value={partCategory} />
      <div className="form-kicker"><span>RFQ</span> {actionLabel ?? (({"/aog-services":"Start an AOG request","/repair-management":"Start a repair request","/quality-assurance":"Start a documentation request","/contact-us":"Send an RFQ"} as Record<string,string>)[sourcePage] || "Start a part search")}</div>
      <h2>What do you need?</h2>
      <p>Send the basics. Our sourcing desk will follow up directly.</p>

      <label htmlFor={fieldId("part-number")}>
        <FieldLabel htmlFor={fieldId("part-number")} required>Part number</FieldLabel>
        <input
          id={fieldId("part-number")}
          required
          aria-required="true"
          aria-invalid={Boolean(errors.partNumber)}
          aria-describedby={errors.partNumber ? fieldId("part-number-error") : undefined}
          name="partNumber"
          placeholder="e.g. 101-384025-5"
          onInvalid={handleInvalid}
          onInput={() => setErrors((current) => ({ ...current, partNumber: undefined }))}
        />
        {errors.partNumber && <small className="field-error" id={fieldId("part-number-error")}>{errors.partNumber}</small>}
      </label>

      <div className="field-row">
        <label htmlFor={fieldId("quantity")}>
          <FieldLabel htmlFor={fieldId("quantity")}>Quantity</FieldLabel>
          <input id={fieldId("quantity")} name="quantity" placeholder="1 EA" />
        </label>
        <label htmlFor={fieldId("condition")}>
          <FieldLabel htmlFor={fieldId("condition")}>Condition</FieldLabel>
          <select id={fieldId("condition")} name="condition" defaultValue="Any acceptable">
            <option>Any acceptable</option>
            <option>New (NE)</option>
            <option>New Surplus (NS)</option>
            <option>Overhauled (OH)</option>
            <option>Serviceable (SV)</option>
            <option>As Removed (AR)</option>
          </select>
        </label>
      </div>

      <label htmlFor={fieldId("email")}>
        <FieldLabel htmlFor={fieldId("email")} required>Email</FieldLabel>
        <input
          id={fieldId("email")}
          required
          aria-required="true"
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? fieldId("email-error") : undefined}
          type="email"
          name="email"
          placeholder="name@company.com"
          onInvalid={handleInvalid}
          onInput={() => setErrors((current) => ({ ...current, email: undefined }))}
        />
        {errors.email && <small className="field-error" id={fieldId("email-error")}>{errors.email}</small>}
      </label>

      <label className="aog-check" htmlFor={fieldId("aog")} aria-label="Mark this request as AOG">
        <input
          id={fieldId("aog")}
          type="checkbox"
          name="aog"
          checked={isAog}
          onChange={(event) => {
            setIsAog(event.target.checked);
            setStatus("idle");
            if (!event.target.checked) setErrors((current) => ({ ...current, callbackNumber: undefined, aircraftLocation: undefined }));
          }}
        />
        <span><strong>Aircraft on ground (AOG)</strong><small>Mark for the monitored urgent workflow.</small></span>
      </label>

      {isAog && (
        <fieldset className="aog-fields">
          <legend>Urgent AOG details</legend>
          <label htmlFor={fieldId("callback-number")}>
            <FieldLabel htmlFor={fieldId("callback-number")} required>Callback / WhatsApp number</FieldLabel>
            <input
              id={fieldId("callback-number")}
              type="tel"
              inputMode="tel"
              name="callbackNumber"
              value={aogValues.callbackNumber}
              required={isAog}
              aria-required={isAog}
              aria-invalid={Boolean(errors.callbackNumber)}
              aria-describedby={errors.callbackNumber ? fieldId("callback-number-error") : fieldId("callback-number-help")}
              placeholder="+1 909 555 0123"
              onChange={(event) => setAogField("callbackNumber", event.target.value)}
              onInvalid={handleInvalid}
            />
            <small className="field-help" id={fieldId("callback-number-help")}>Best number for the monitored AOG desk to use.</small>
            {errors.callbackNumber && <small className="field-error" id={fieldId("callback-number-error")}>{errors.callbackNumber}</small>}
          </label>
          <label htmlFor={fieldId("aircraft-location")}>
            <FieldLabel htmlFor={fieldId("aircraft-location")} required>Aircraft location</FieldLabel>
            <input
              id={fieldId("aircraft-location")}
              name="aircraftLocation"
              value={aogValues.aircraftLocation}
              required={isAog}
              aria-required={isAog}
              aria-invalid={Boolean(errors.aircraftLocation)}
              aria-describedby={errors.aircraftLocation ? fieldId("aircraft-location-error") : undefined}
              placeholder="Airport / city / country"
              onChange={(event) => setAogField("aircraftLocation", event.target.value)}
              onInvalid={handleInvalid}
            />
            {errors.aircraftLocation && <small className="field-error" id={fieldId("aircraft-location-error")}>{errors.aircraftLocation}</small>}
          </label>
          <div className="field-row">
            <label htmlFor={fieldId("required-by")}>
              <FieldLabel htmlFor={fieldId("required-by")}>Required by</FieldLabel>
              <input id={fieldId("required-by")} type="datetime-local" name="requiredBy" value={aogValues.requiredBy} onChange={(event) => setAogField("requiredBy", event.target.value)} />
            </label>
            <label htmlFor={fieldId("aircraft-type-tail")}>
              <FieldLabel htmlFor={fieldId("aircraft-type-tail")}>Aircraft type / tail number</FieldLabel>
              <input id={fieldId("aircraft-type-tail")} name="aircraftTypeTail" value={aogValues.aircraftTypeTail} placeholder="e.g. Challenger 605" onChange={(event) => setAogField("aircraftTypeTail", event.target.value)} />
            </label>
          </div>
        </fieldset>
      )}

      <button type="submit" disabled={status === "submitting"}>{status === "submitting" ? "Submitting…" : "Request availability"}<span>→</span></button>
      <small className="privacy">Your request goes directly to the Civilon sourcing desk.</small>

      {status === "success" && (
        <div className="submission-status submission-success" role="status">
          <strong>{isAog ? "Your urgent AOG request has been received." : "Your availability request has been received."}</strong>
          <p>{isAog ? "Call or WhatsApp the monitored AOG desk now." : "Our sourcing desk will review it and follow up directly."}</p>
          {isAog && <div className="submission-actions"><CallAogAction source_page={sourcePage}>Call AOG desk</CallAogAction><WhatsAppAogAction source_page={sourcePage} messageData={whatsAppData}>WhatsApp AOG</WhatsAppAogAction></div>}
        </div>
      )}
      {status === "preview" && (
        <div className="submission-status submission-preview" role="status">
          <strong>This preview cannot confirm form delivery.</strong>
          <p>{isAog ? "Call or WhatsApp the monitored AOG desk now." : "Please use the published Netlify form when it is approved, or contact the sourcing desk directly."}</p>
          {isAog && <div className="submission-actions"><CallAogAction source_page={sourcePage}>Call AOG desk</CallAogAction><WhatsAppAogAction source_page={sourcePage} messageData={whatsAppData}>WhatsApp AOG</WhatsAppAogAction></div>}
        </div>
      )}
      {status === "error" && <div className="submission-status submission-error" role="alert"><strong>We could not confirm delivery.</strong><p>Please retry, call, or WhatsApp the AOG desk.</p></div>}
    </form>
  );
}
