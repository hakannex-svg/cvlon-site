import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validatePriceCheckSubmission } from "../lib/price-check/validation.ts";

const formPath = "components/PriceCheckForm.tsx";

async function form() {
  return readFile(formPath, "utf8");
}

// The payload the simplified form sends when the customer fills only the always-visible
// required fields and never opens an optional disclosure.
const minimalCustomerPayload = (overrides = {}) => ({
  idempotencyKey: "0f4b6d61-2c37-4a55-9f2e-6c0f5a1b7d84",
  partNumber: "TEST-SIMPLIFIED-001",
  quantity: "1",
  quoteOrPurchased: "quote",
  transactionType: "not_sure",
  conditionCode: "NOT_SURE",
  unitPrice: "4200.00",
  currencyCode: "USD",
  aog: false,
  description: "",
  aircraftModel: "",
  coreCharge: "",
  coreDisposition: "",
  exchangeFee: "",
  freight: "",
  transactionDate: "",
  warrantyValue: "",
  warrantyUnit: "MONTHS",
  warrantyText: "",
  documentationCodes: [],
  documentationOther: "",
  attachmentHandles: [],
  notes: "",
  firstName: "Casey",
  lastName: "Buyer",
  companyName: "Example Aviation Test",
  businessEmail: "casey@example.com",
  phone: "",
  role: "",
  country: "",
  serviceAcknowledged: true,
  legalAcknowledged: true,
  sourcePage: "/price-check",
  landingPage: "https://cvlon.com/price-check",
  referrer: "",
  utmSource: "",
  utmMedium: "",
  utmCampaign: "",
  utmContent: "",
  utmTerm: "",
  website: "",
  ...overrides,
});

test("public form is a single page with no stepper or Back/Continue navigation", async () => {
  const source = await form();
  assert.doesNotMatch(source, /useState<1 \| 2 \| 3>/);
  assert.doesNotMatch(source, /setStep|step === [123]/);
  assert.doesNotMatch(source, /price-check-progress|price-check-step-heading|pc-step-actions/);
  assert.doesNotMatch(source, /STEP 0[123]/);
  assert.doesNotMatch(source, /Continue to document|Continue without document/);
  assert.doesNotMatch(source, /className="pc-back"/);
  assert.doesNotMatch(source, /Price Check progress/);
  // Exactly one <form> and exactly one submit control.
  assert.equal(source.match(/<form\b/g)?.length, 1);
  assert.equal(source.match(/type="submit"/g)?.length, 1);
  assert.match(source, /onSubmit=\{submit\}/);
});

test("optional context is progressively disclosed rather than removed", async () => {
  const source = await form();
  const disclosures = source.match(/<details className="pc-disclosure/g) ?? [];
  assert.equal(disclosures.length, 3, "transaction, documents and contact disclosures");
  // Optional fields still exist somewhere in the single form.
  for (const field of [
    "price-check-quantity", "price-check-transactionType", "price-check-description",
    "price-check-freight", "price-check-transactionDate", "price-check-aircraftModel",
    "price-check-warrantyValue", "price-check-warrantyUnit", "price-check-warrantyText",
    "price-check-notes", "price-check-phone", "price-check-role", "price-check-country",
    "price-check-attachments", "price-check-documentationOther",
  ]) {
    assert.match(source, new RegExp(`id="${field}"`), field);
  }
  assert.match(source, /documentationCodes\.map/);
  // A collapsed disclosure must be expanded before an error inside it receives focus.
  assert.match(source, /revealFields\(Object\.keys\(nextErrors\)\)/);
  assert.match(source, /revealFields\(Object\.keys\(next\)\)/);
});

test("internal defaults stay complete without assuming transaction type or condition", async () => {
  const source = await form();
  assert.match(source, /quantity: "1"/);
  assert.match(source, /quoteOrPurchased: "quote", transactionType: "not_sure"/);
  assert.match(source, /conditionCode: "NOT_SURE"/);
  assert.match(source, /aog: false/);

  const result = validatePriceCheckSubmission(minimalCustomerPayload());
  assert.equal(result.success, true);
  assert.equal(result.data.quantity, "1");
  assert.equal(result.data.transactionType, "not_sure");
  assert.equal(result.data.aog, false);
  assert.equal(result.data.conditionCode, "NOT_SURE");
  assert.equal(result.data.coreCharge, null);
  assert.equal(result.data.coreDisposition, null);
  assert.equal(result.data.exchangeFee, null);
});

test("required customer fields and both acknowledgements remain always visible", async () => {
  const source = await form();
  for (const field of [
    "price-check-partNumber", "price-check-unitPrice", "price-check-currencyCode",
    "price-check-conditionCode", "price-check-firstName", "price-check-lastName",
    "price-check-companyName", "price-check-businessEmail",
    "price-check-serviceAcknowledged", "price-check-legalAcknowledged",
  ]) {
    assert.match(source, new RegExp(`id="${field}"`), field);
  }
  assert.match(source, /name="pc-quote"/);
  // The required block sits outside every <details> disclosure.
  const firstDisclosure = source.indexOf('<details className="pc-disclosure');
  const requiredBlock = source.indexOf('id="price-check-partNumber"');
  assert.ok(requiredBlock > 0 && requiredBlock < firstDisclosure, "part number is above the first disclosure");
  assert.match(source, /href="\/privacy-policy"/);
  assert.match(source, /href="\/terms-of-use"/);
});

test("exchange-only fields remain conditional in the client and on the server", async () => {
  const source = await form();
  assert.match(source, /values\.transactionType === "exchange" && <fieldset className="pc-conditional"/);
  assert.match(source, /coreCharge: values\.transactionType === "exchange" \? values\.coreCharge : ""/);
  assert.match(source, /coreDisposition: values\.transactionType === "exchange" \? values\.coreDisposition : ""/);
  assert.match(source, /exchangeFee: values\.transactionType === "exchange" \? values\.exchangeFee : ""/);

  const exchange = validatePriceCheckSubmission(minimalCustomerPayload({
    transactionType: "exchange",
    coreCharge: "2500",
    coreDisposition: "REFUNDABLE",
    exchangeFee: "350.25",
  }));
  assert.equal(exchange.success, true);
  assert.equal(exchange.data.coreCharge, "2500.00");
  assert.equal(exchange.data.exchangeFee, "350.25");
});

test("the authoritative submission contract was not relaxed for the shorter form", async () => {
  const [contract, validation] = await Promise.all([
    readFile("lib/price-check/contract.ts", "utf8"),
    readFile("lib/price-check/validation.ts", "utf8"),
  ]);
  // These stay required (non-optional) on the validated submission type.
  assert.match(contract, /\n {2}quantity: string;/);
  assert.match(contract, /\n {2}transactionType: TransactionType;/);
  assert.match(contract, /\n {2}aog: boolean;/);
  assert.doesNotMatch(contract, /quantity\?: |transactionType\?: |aog\?: /);
  // The server still rejects incomplete or tampered payloads regardless of UI shape.
  assert.match(validation, /allowedFields/);
  for (const [name, override, field] of [
    ["missing quantity", { quantity: "" }, "quantity"],
    ["missing transaction type", { transactionType: "" }, "transactionType"],
    ["missing AOG boolean", { aog: "no" }, "aog"],
    ["tampered enum", { transactionType: "lease" }, "transactionType"],
    ["unknown field", { databaseRole: "admin" }, "_form"],
    ["AOG without phone", { aog: true, phone: "" }, "phone"],
    ["missing service acknowledgement", { serviceAcknowledged: false }, "serviceAcknowledged"],
    ["missing legal acknowledgement", { legalAcknowledged: false }, "legalAcknowledged"],
  ]) {
    const result = validatePriceCheckSubmission(minimalCustomerPayload(override));
    assert.equal(result.success, false, name);
    assert.ok(result.fieldErrors[field], name);
  }
});

test("privacy, honeypot, idempotency and analytics behaviour is unchanged", async () => {
  const source = await form();
  assert.match(source, /id="price-check-website"/);
  assert.match(source, /className="pc-honeypot"/);
  assert.match(source, /idempotencyKey\.current = window\.crypto\.randomUUID\(\)/);
  for (const event of [
    "price_check_view", "price_check_start", "price_check_submit",
    "price_check_upload_started", "price_check_upload_completed",
  ]) {
    assert.match(source, new RegExp(`trackCivilonEvent\\("${event}"`), event);
  }
  // Analytics still carries only the source page — never field values.
  assert.doesNotMatch(source, /trackCivilonEvent\([^)]*(partNumber|unitPrice|businessEmail|companyName|phone)/);
  assert.match(source, /source_page: "\/price-check"/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
  // Upload contract and approved disclosure wording are untouched.
  assert.match(source, /Uploaded documents may be processed using automated tools to help Civilon identify transaction details\./);
  assert.match(source, /Extracted information is reviewed by Civilon before it is used in your Price Check\./);
  assert.match(source, /please upload only information necessary for the review\./);
  assert.match(source, /Maximum 3 files/);
  assert.match(source, /uploads\.length >= 3/);
  // AOG escalation survives and stays tied to an explicit AOG selection.
  assert.match(source, /values\.aog && <div className="pc-aog-notice"/);
  assert.match(source, /CallAogAction/);
  assert.match(source, /WhatsAppAogAction/);
  // Choosing AOG reveals the contact disclosure, because phone then becomes required.
  assert.match(source, /field === "aog" && value === true\) setDisclosure\("contact", true\)/);
  assert.match(source, /required=\{values\.aog\}/);
  assert.match(source, /values\.aog && values\.phone\.replace\(\/\\D\/g, ""\)\.length < 7/);
});
