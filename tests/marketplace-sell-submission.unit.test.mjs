import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { unicodeIntakeFixture, hasControlCharacter } from "./fixtures/marketplace-unicode.mjs";

import {
  SELL_SUBMISSION_SOURCE_PAGE,
  SELL_SUBMISSION_SUBMIT_PATH,
  SELL_SUBMISSION_VERIFY_API_PATH,
  SELL_SUBMISSION_VERIFY_FRAGMENT_KEY,
  SELL_SUBMISSION_VERIFY_PATH,
  sellSubmissionConditionCodes,
  sellSubmissionReservedUploadFields,
} from "../lib/marketplace/sell-contract.ts";
import { validateSellSubmission } from "../lib/marketplace/sell-validation.ts";
import { isMarketplaceEnabled, isSellSubmissionEnabled } from "../lib/marketplace/feature.ts";
import {
  deriveSellVerificationToken,
  deriveVerificationToken,
  hashVerificationToken,
  sellSubmissionVerificationUrl,
} from "../lib/marketplace/verification.ts";
import { sellSubmissionIdempotencyHash, submitSellSubmission } from "../lib/marketplace/sell-submission-service.ts";
import { buyRequestIdempotencyHash } from "../lib/marketplace/submission-service.ts";
import { verifySellSubmissionContact } from "../lib/marketplace/sell-verification-service.ts";
import {
  sellSubmissionInternalEmail,
  sellSubmissionVerifyEmail,
} from "../lib/marketplace/email/sell-submission-templates.ts";
import { defaultMarketplaceEmailFrom } from "../lib/marketplace/config.ts";
import { sellSubmissionAdminUrl } from "../lib/marketplace/verification.ts";
import {
  sellSubmissionInternalNotificationHandler,
  sellSubmissionVerifyNotificationHandler,
} from "../lib/marketplace/email/sell-submission-handlers.ts";
import {
  civilonNotificationHandlers,
  registeredNotificationTypes,
} from "../lib/notifications/registry.ts";

const TOKEN_KEY = "civilon-marketplace-verify-token-key-for-tests";
const IDEMPOTENCY_KEY = "3f1a2b4c-5d6e-4f70-8123-456789abcdef";

function singlePart(overrides = {}) {
  return {
    idempotencyKey: IDEMPOTENCY_KEY,
    submissionKind: "single_part",
    partNumber: "101-384025-5",
    firstName: "Sam",
    lastName: "Okafor",
    companyName: "Example Component Supply",
    businessEmail: "Sam.Okafor@Example.com",
    serviceAcknowledged: true,
    legalAcknowledged: true,
    sourcePage: SELL_SUBMISSION_SOURCE_PAGE,
    ...overrides,
  };
}

function bulk(overrides = {}) {
  return {
    idempotencyKey: IDEMPOTENCY_KEY,
    submissionKind: "bulk_inventory",
    description: "Mixed rotable inventory, two warehouses.",
    estimatedLineItemCount: 1400,
    firstName: "Sam",
    lastName: "Okafor",
    companyName: "Example Component Supply",
    businessEmail: "sam.okafor@example.com",
    serviceAcknowledged: true,
    legalAcknowledged: true,
    sourcePage: SELL_SUBMISSION_SOURCE_PAGE,
    ...overrides,
  };
}

function accepted(payload) {
  const result = validateSellSubmission(payload);
  assert.equal(result.success, true, JSON.stringify(result.fieldErrors));
  return result.data;
}

function rejected(payload, field) {
  const result = validateSellSubmission(payload);
  assert.equal(result.success, false, `expected ${field} to be rejected`);
  assert.ok(result.fieldErrors[field], `expected a ${field} error, got ${JSON.stringify(result.fieldErrors)}`);
  return result.fieldErrors;
}

/* ---------------------------------------------------------------- contract */

test("the Sell contract points at its own routes and never at a listing surface", () => {
  assert.equal(SELL_SUBMISSION_SOURCE_PAGE, "/buy-sell-aircraft-parts/sell");
  assert.equal(SELL_SUBMISSION_SUBMIT_PATH, "/api/marketplace/sell-submissions");
  assert.equal(SELL_SUBMISSION_VERIFY_PATH, "/buy-sell-aircraft-parts/sell/verify");
  assert.equal(SELL_SUBMISSION_VERIFY_API_PATH, "/api/marketplace/sell-submissions/verify");
  assert.equal(SELL_SUBMISSION_VERIFY_FRAGMENT_KEY, "token");

  // "ANY" is a buyer's statement of tolerance. A seller asserting it about
  // their own stock would record a condition claim that means nothing.
  assert.equal(sellSubmissionConditionCodes.includes("ANY"), false);
  assert.equal(sellSubmissionConditionCodes[0], "NOT_SURE");
});

test("Sell intake is gated on its own switch, on top of the marketplace switch", () => {
  assert.equal(isSellSubmissionEnabled({}), false);
  assert.equal(isSellSubmissionEnabled({ NEXT_PUBLIC_SELL_SUBMISSIONS_ENABLED: "true" }), false);
  assert.equal(isSellSubmissionEnabled({ NEXT_PUBLIC_MARKETPLACE_ENABLED: "true" }), false);
  assert.equal(
    isSellSubmissionEnabled({
      NEXT_PUBLIC_MARKETPLACE_ENABLED: "true",
      NEXT_PUBLIC_SELL_SUBMISSIONS_ENABLED: "true",
    }),
    true,
  );
  // Anything other than the exact string leaves it closed.
  for (const value of ["TRUE", "1", "yes", " true"]) {
    assert.equal(
      isSellSubmissionEnabled({
        NEXT_PUBLIC_MARKETPLACE_ENABLED: "true",
        NEXT_PUBLIC_SELL_SUBMISSIONS_ENABLED: value,
      }),
      false,
      value,
    );
  }
  // Neither flag can be reached from a Price Check variable.
  assert.equal(isSellSubmissionEnabled({ NEXT_PUBLIC_PRICE_CHECK_ENABLED: "true" }), false);
  assert.equal(isMarketplaceEnabled({ NEXT_PUBLIC_SELL_SUBMISSIONS_ENABLED: "true" }), false);
});

/* -------------------------------------------------------------- validation */

test("a minimal single-part submission is accepted with the documented defaults", () => {
  const data = accepted(singlePart());
  assert.equal(data.submissionKind, "single_part");
  assert.equal(data.partNumber, "101-384025-5");
  assert.equal(data.quantity, null, "quantity is optional for a seller");
  assert.equal(data.conditionCode, "NOT_SURE", "condition defaults to not sure");
  assert.equal(data.quoteOnRequest, true, "quote on request is the default");
  assert.equal(data.askingUnitPrice, null);
  assert.equal(data.currencyCode, null);
  assert.equal(data.canShipToNewJersey, null, "New Jersey shipping may stay unknown");
  assert.equal(data.phone, null, "a supplier is never forced to give a phone number");
  assert.equal(data.estimatedLineItemCount, null);
  assert.equal(data.sourcePage, SELL_SUBMISSION_SOURCE_PAGE);
});

test("a single part may be described instead of numbered, but not neither", () => {
  const described = accepted(singlePart({ partNumber: undefined, description: "Bleed air valve, CFM56." }));
  assert.equal(described.partNumber, null);
  assert.equal(described.description, "Bleed air valve, CFM56.");

  rejected(singlePart({ partNumber: undefined }), "partNumber");
  rejected(singlePart({ partNumber: "  " }), "partNumber");
  rejected(singlePart({ partNumber: "<script>" }), "partNumber");
});

test("optional single-part quantity and condition are bounded and enum-checked", () => {
  assert.equal(accepted(singlePart({ quantity: "12.500" })).quantity, "12.500");
  for (const bad of ["0", "-1", "1.2345", "abc", "1e3", "1000000000"]) {
    rejected(singlePart({ quantity: bad }), "quantity");
  }
  assert.equal(accepted(singlePart({ conditionCode: "OH" })).conditionCode, "OH");
  rejected(singlePart({ conditionCode: "ANY" }), "conditionCode");
  rejected(singlePart({ conditionCode: "SCRAP" }), "conditionCode");
});

test("bulk inventory refuses forged single-part number, quantity and price fields", () => {
  assert.equal(accepted(bulk()).estimatedLineItemCount, 1400);

  rejected(bulk({ partNumber: "101-384025-5" }), "partNumber");
  rejected(bulk({ quantity: "5" }), "quantity");
  rejected(bulk({ askingUnitPrice: "1200.00" }), "askingUnitPrice");
  rejected(bulk({ currencyCode: "USD" }), "currencyCode");
  rejected(bulk({ conditionCode: "OH" }), "conditionCode");
  // Switching quote-on-request off in bulk mode would demand a unit price the
  // mode cannot carry.
  rejected(bulk({ quoteOnRequest: false }), "quoteOnRequest");

  // And a line-item count is meaningless for a single part.
  rejected(singlePart({ estimatedLineItemCount: 12 }), "estimatedLineItemCount");
});

test("a bulk list needs a description or a count; a count is a bounded whole number", () => {
  rejected(bulk({ description: undefined, estimatedLineItemCount: undefined }), "description");
  assert.equal(accepted(bulk({ estimatedLineItemCount: undefined })).estimatedLineItemCount, null);
  assert.equal(accepted(bulk({ estimatedLineItemCount: "250" })).estimatedLineItemCount, 250);
  for (const bad of [-1, 1.5, "12.5", "-3", 2_000_000, true, {}]) {
    rejected(bulk({ estimatedLineItemCount: bad }), "estimatedLineItemCount");
  }
});

test("a seller price is optional, and stating one requires an approved currency", () => {
  const priced = accepted(singlePart({
    quoteOnRequest: false,
    askingUnitPrice: "1200.5",
    currencyCode: "eur",
  }));
  assert.equal(priced.quoteOnRequest, false);
  assert.equal(priced.askingUnitPrice, "1200.50");
  assert.equal(priced.currencyCode, "EUR");

  rejected(singlePart({ quoteOnRequest: false }), "askingUnitPrice");
  rejected(singlePart({ quoteOnRequest: false, askingUnitPrice: "1200.00" }), "currencyCode");
  rejected(singlePart({ quoteOnRequest: false, askingUnitPrice: "1200.00", currencyCode: "XBT" }), "currencyCode");
  rejected(singlePart({ quoteOnRequest: false, askingUnitPrice: "-5", currencyCode: "USD" }), "askingUnitPrice");
  rejected(singlePart({ quoteOnRequest: false, askingUnitPrice: "1.234", currencyCode: "USD" }), "askingUnitPrice");
  // A price alongside quote-on-request is contradictory input, not a preference.
  rejected(singlePart({ askingUnitPrice: "1200.00", currencyCode: "USD" }), "askingUnitPrice");
  rejected(singlePart({ quoteOnRequest: "false" }), "quoteOnRequest");
});

test("New Jersey shipping is a tri-state answer and never invented", () => {
  assert.equal(accepted(singlePart()).canShipToNewJersey, null);
  assert.equal(accepted(singlePart({ canShipToNewJersey: null })).canShipToNewJersey, null);
  assert.equal(accepted(singlePart({ canShipToNewJersey: true })).canShipToNewJersey, true);
  assert.equal(accepted(singlePart({ canShipToNewJersey: false })).canShipToNewJersey, false);
  rejected(singlePart({ canShipToNewJersey: "yes" }), "canShipToNewJersey");
});

test("contact, acknowledgement, source page and idempotency rules are enforced", () => {
  for (const field of ["firstName", "lastName", "companyName"]) {
    rejected(singlePart({ [field]: "" }), field);
    rejected(singlePart({ [field]: "x".repeat(400) }), field);
  }
  rejected(singlePart({ businessEmail: "not-an-email" }), "businessEmail");
  rejected(singlePart({ phone: "12" }), "phone");
  assert.equal(accepted(singlePart({ phone: "+1 909 555 0123" })).phone, "+1 909 555 0123");

  rejected(singlePart({ serviceAcknowledged: false }), "serviceAcknowledged");
  rejected(singlePart({ serviceAcknowledged: "true" }), "serviceAcknowledged");
  rejected(singlePart({ legalAcknowledged: undefined }), "legalAcknowledged");
  rejected(singlePart({ sourcePage: "/buy-sell-aircraft-parts/buy" }), "sourcePage");
  rejected(singlePart({ idempotencyKey: "not-a-uuid" }), "_form");
  rejected(singlePart({ submissionKind: "auction" }), "submissionKind");
  rejected(singlePart({ submissionKind: undefined }), "submissionKind");
  assert.equal(validateSellSubmission(null).success, false);
  assert.equal(validateSellSubmission([]).success, false);
});

test("optional location fields are bounded and the country is a two-letter code", () => {
  const located = accepted(singlePart({
    locationCountry: "de",
    locationStateRegion: "Hessen",
    locationCity: "Frankfurt",
    locationPostalCode: "60311",
  }));
  assert.equal(located.locationCountry, "DE");
  assert.equal(located.locationStateRegion, "Hessen");
  rejected(singlePart({ locationCountry: "DEU" }), "locationCountry");
  rejected(singlePart({ locationCity: "x".repeat(200) }), "locationCity");
  rejected(singlePart({ locationPostalCode: "x".repeat(40) }), "locationPostalCode");
});

test("unknown fields are refused, and reserved upload fields are refused by name", () => {
  rejected(singlePart({ status: "verified" }), "_form");
  rejected(singlePart({ assignedAdminUserId: "01ABC" }), "_form");
  rejected(singlePart({ notes: "staff note" }), "_form");
  rejected(singlePart({ publicReference: "SS-ABCDEFGHJK" }), "_form");

  // Every reserved upload name is rejected with its own message, so a seller is
  // never told an attachment was accepted when no upload slice exists.
  for (const field of sellSubmissionReservedUploadFields) {
    const errors = rejected(singlePart({ [field]: "handle" }), "uploads");
    assert.match(errors.uploads, /Attachments cannot be submitted yet/);
  }
});

test("hostile Unicode is normalized or refused before it reaches the database", () => {
  const data = accepted(singlePart({
    firstName: unicodeIntakeFixture.firstName,
    companyName: unicodeIntakeFixture.companyName,
    description: unicodeIntakeFixture.description,
  }));
  assert.equal(data.firstName, "Dana");
  assert.equal(data.companyName, "Example Aviation");
  assert.equal(data.description, "Bleedvalve");
  for (const value of [data.firstName, data.companyName, data.description]) {
    assert.equal(hasControlCharacter(value), false, value);
  }
  // A zero-width space inside a part number is a spoofing hazard, and the
  // stripped value must still satisfy the part-number shape.
  assert.equal(accepted(singlePart({ partNumber: "101-​384025-5" })).partNumber, "101-384025-5");
});

/* ------------------------------------------------------------- credentials */

test("Sell credentials are aggregate-scoped and never equal a Buy credential", () => {
  const nonce = "a".repeat(64);
  const sell = deriveSellVerificationToken(TOKEN_KEY, nonce);
  const buy = deriveVerificationToken(TOKEN_KEY, nonce);
  assert.notEqual(sell, buy, "the same nonce must not yield the same credential twice");
  assert.match(sell, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(
    hashVerificationToken(TOKEN_KEY, sell),
    hashVerificationToken(TOKEN_KEY, buy),
  );
  assert.throws(() => deriveSellVerificationToken(TOKEN_KEY, "nope"), /VERIFICATION_NONCE_INVALID/);
  assert.throws(() => deriveSellVerificationToken("short", nonce), /MARKETPLACE_VERIFY_TOKEN_KEY_UNAVAILABLE/);
});

test("the verification link carries the credential in the fragment, never the query", () => {
  const url = sellSubmissionVerificationUrl("https://cvlon.com/", "token-value");
  assert.equal(url, "https://cvlon.com/buy-sell-aircraft-parts/sell/verify#token=token-value");
  assert.equal(url.includes("?"), false);
});

test("a malformed credential is refused before any query runs", async () => {
  let redeemCalls = 0;
  const dependencies = {
    redeem: async () => {
      redeemCalls += 1;
      return { outcome: "unavailable" };
    },
    tokenKey: () => TOKEN_KEY,
  };
  for (const token of [undefined, null, 42, "", "short", "a".repeat(44), "!".repeat(43)]) {
    const result = await verifySellSubmissionContact({}, { token }, dependencies);
    assert.deepEqual(result, { outcome: "unavailable" });
  }
  assert.equal(redeemCalls, 0, "no database work may happen for a wrong-shaped credential");

  const wellFormed = deriveSellVerificationToken(TOKEN_KEY, "b".repeat(64));
  await verifySellSubmissionContact({}, { token: wellFormed }, dependencies);
  assert.equal(redeemCalls, 1);
});

/* --------------------------------------------------------------- idempotency */

test("the idempotency key is hashed under a Sell-specific label", () => {
  const hash = sellSubmissionIdempotencyHash(IDEMPOTENCY_KEY);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hash.includes(IDEMPOTENCY_KEY), false);
  assert.equal(sellSubmissionIdempotencyHash(IDEMPOTENCY_KEY), hash, "stable for the same key");
  // The same browser key on the two intakes must not collide across workflows.
  assert.notEqual(hash, buyRequestIdempotencyHash(IDEMPOTENCY_KEY));
});

test("a replay returns the original reference without deriving a second credential", async () => {
  let nonces = 0;
  const dependencies = {
    create: async () => {
      throw new Error("a replay must never reach the writer");
    },
    findByIdempotency: async () => ({ id: "existing", publicReference: "SS-ABCDEFGHJK" }),
    generateReference: () => "SS-NEWNEWNEWN",
    tokenKey: () => TOKEN_KEY,
    newNonce: () => {
      nonces += 1;
      return "c".repeat(64);
    },
  };
  const result = await submitSellSubmission({}, accepted(singlePart()), dependencies);
  assert.deepEqual(result, { reference: "SS-ABCDEFGHJK", created: false });
  assert.equal(nonces, 0, "no credential may be minted for a replay");
});

test("a reference collision retries with a fresh reference and the same token", async () => {
  const references = ["SS-COLLIDE001", "SS-COLLIDE002", "SS-FRESHREFR"];
  const seenTokens = new Set();
  let index = 0;
  const dependencies = {
    create: async (_db, input) => {
      seenTokens.add(input.verificationToken.keyedTokenHash);
      if (input.publicReference !== "SS-FRESHREFR") {
        throw Object.assign(new Error("duplicate"), {
          code: "23505",
          constraint: "sell_submissions_public_reference_uidx",
        });
      }
      return { publicReference: input.publicReference };
    },
    findByIdempotency: async () => null,
    generateReference: () => references[index++],
    tokenKey: () => TOKEN_KEY,
    newNonce: () => "d".repeat(64),
    prepareAttachments: async () => [],
  };
  const result = await submitSellSubmission({}, accepted(singlePart()), dependencies);
  assert.deepEqual(result, { reference: "SS-FRESHREFR", created: true });
  assert.equal(seenTokens.size, 1, "one submission issues exactly one credential");
});

test("a racing duplicate idempotency insert resolves to the winner's reference", async () => {
  let lookups = 0;
  const dependencies = {
    create: async () => {
      throw Object.assign(new Error("duplicate"), {
        code: "23505",
        constraint: "sell_submissions_idempotency_hash_uidx",
      });
    },
    findByIdempotency: async () => {
      lookups += 1;
      return lookups === 1 ? null : { id: "winner", publicReference: "SS-WINNERWIN" };
    },
    generateReference: () => "SS-LOSERLOSE",
    tokenKey: () => TOKEN_KEY,
    newNonce: () => "e".repeat(64),
    prepareAttachments: async () => [],
  };
  const result = await submitSellSubmission({}, accepted(singlePart()), dependencies);
  assert.deepEqual(result, { reference: "SS-WINNERWIN", created: false });
});

/* ----------------------------------------------------------------- templates */

const FORBIDDEN_IN_MAIL = [
  "101-384025-5", "101384025", "Sam", "Okafor", "Example Component Supply",
  "sam.okafor@example.com", "909 555 0123", "Frankfurt", "Hessen", "60311",
  "1200.50", "EUR", "rotable", "1400", "supplier cost", "warehouse",
];

function assertPrivacyMinimized(email) {
  const surface = [
    email.subject,
    email.textBody,
    email.htmlBody,
    email.tag,
    JSON.stringify(email.metadata),
  ].join("\n");
  for (const secret of FORBIDDEN_IN_MAIL) {
    assert.equal(surface.includes(secret), false, `${email.tag} must not contain ${secret}`);
  }
  // No guarantee, approval or acceptance language anywhere in either template.
  for (const claim of [/certif/i, /airworth/i, /guarantee/i, /warrant/i, /\bapproved\b/i, /\baccepted\b/i, /\bpurchase order\b/i]) {
    assert.equal(claim.test(surface), false, `${email.tag} must not state ${claim}`);
  }
}

test("the supplier verification mail carries a reference, a link and an expiry only", () => {
  const email = sellSubmissionVerifyEmail({
    from: defaultMarketplaceEmailFrom,
    to: "Sam.Okafor@Example.com",
    reference: "SS-ABCDEFGHJK",
    verificationUrl: sellSubmissionVerificationUrl("https://cvlon.com", "credential-value"),
    expiresAt: new Date("2026-08-24T12:00:00Z"),
  });

  assertPrivacyMinimized(email);
  assert.equal(email.from, defaultMarketplaceEmailFrom);
  assert.equal(email.to, "Sam.Okafor@Example.com", "the supplier address is the destination only");
  assert.ok(email.textBody.includes("SS-ABCDEFGHJK"));
  assert.ok(email.textBody.includes("August 24, 2026"));
  assert.ok(email.textBody.includes("https://cvlon.com/buy-sell-aircraft-parts/sell/verify#token=credential-value"));
  assert.equal(email.tag, "civilon-sell-submission-verify");
  assert.deepEqual(email.metadata, { reference: "SS-ABCDEFGHJK" });
  // Neither the address nor the credential may leak into metadata or the tag.
  assert.equal(JSON.stringify(email.metadata).includes("credential-value"), false);
  assert.equal(JSON.stringify(email.metadata).toLowerCase().includes("example.com"), false);
  assert.ok(/not published or listed/i.test(email.textBody), "the mail states there is no listing");
});

test("the internal notice carries a reference, a pending status and a console link only", () => {
  const email = sellSubmissionInternalEmail({
    from: defaultMarketplaceEmailFrom,
    to: "sales@cvlon.com, hakan@shipnex.com, david@cvlon.com",
    reference: "SS-ABCDEFGHJK",
    status: "pending_verification",
    submittedAt: new Date("2026-08-17T12:00:00Z"),
    adminUrl: sellSubmissionAdminUrl("https://cvlon.com", "SS0000000000000000000000CD"),
  });

  assertPrivacyMinimized(email);
  assert.equal(email.to, "sales@cvlon.com, hakan@shipnex.com, david@cvlon.com");
  assert.ok(email.textBody.includes("SS-ABCDEFGHJK"));
  assert.ok(email.textBody.includes("pending_verification"));
  assert.ok(email.textBody.includes("https://cvlon.com/admin/sell-submissions/SS0000000000000000000000CD"));
  assert.equal(email.textBody.includes("/admin/price-checks"), false);
  assert.deepEqual(email.metadata, { reference: "SS-ABCDEFGHJK", status: "pending_verification" });
  // The supplier's own address never reaches the internal fan-out.
  assert.equal(/example\.com/i.test(`${email.textBody}${email.htmlBody}`), false);
});

test("template inputs are HTML-escaped, so no injected markup survives", () => {
  const email = sellSubmissionVerifyEmail({
    from: defaultMarketplaceEmailFrom,
    to: "sam@example.com",
    reference: '<img src=x onerror="alert(1)">',
    verificationUrl: 'https://cvlon.com/x#token="><script>',
    expiresAt: new Date("2026-08-24T12:00:00Z"),
  });
  assert.equal(email.htmlBody.includes("<img src=x"), false);
  assert.equal(email.htmlBody.includes("<script>"), false);
  assert.ok(email.htmlBody.includes("&lt;img"));
});

/* ------------------------------------------------------------- registration */

test("both Sell message types are registered before any producer can enqueue", () => {
  const types = registeredNotificationTypes();
  assert.ok(types.includes("SELL_SUBMISSION_VERIFY_EMAIL"));
  assert.ok(types.includes("SELL_SUBMISSION_INTERNAL_RECEIVED"));
  assert.ok(types.includes("BUY_REQUEST_VERIFY_EMAIL"), "Buy registration is unchanged");
  assert.ok(types.includes("RESULT_READY"), "Price Check registration is unchanged");
  assert.equal(new Set(types).size, types.length, "message types must be unique");

  for (const handler of [sellSubmissionVerifyNotificationHandler, sellSubmissionInternalNotificationHandler]) {
    assert.equal(handler.workflow, "marketplace");
    assert.equal(handler.aggregateType, "sell_submission");
    assert.ok(civilonNotificationHandlers.includes(handler));
    assert.equal(typeof handler.deliver, "function");
    assert.equal(typeof handler.recordFailure, "function");
  }
});

/* ------------------------------------------------------------- source scans */

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url).pathname.replace(/^\/(\w:)/, "$1"), "utf8");
}

test("no Sell code path deletes, expires or ages out a submission", () => {
  // Slow-moving inventory is a commercial reality, not a stale record. Nothing
  // in the Sell slice may quietly remove or close a submission on a timer.
  for (const path of [
    "db/price-check/repositories/sell-submission-repository.ts",
    "lib/marketplace/sell-submission-service.ts",
    "lib/marketplace/sell-verification-service.ts",
  ]) {
    const text = source(path);
    assert.equal(/\.delete\(/.test(text), false, `${path} must not delete rows`);
    assert.equal(/sellSubmissions\.closedAt|closedAt:/.test(text), false, `${path} must not close submissions`);
    assert.equal(/deletedAt:|deletionRequestedAt:/.test(text), false, `${path} must not mark deletion`);
  }
  // Only the credential carries an expiry, and only a credential is revoked.
  const repository = source("db/price-check/repositories/sell-submission-repository.ts");
  assert.ok(repository.includes("revokedAt: now"), "an expired credential is revoked");
  assert.equal(/status: "(closed|declined|spam|withdrawn)"/.test(repository), false);
});

test("the Sell slice exposes no listing, search or public inventory surface", () => {
  const submitRoute = source("app/api/marketplace/sell-submissions/route.ts");
  const verifyRoute = source("app/api/marketplace/sell-submissions/verify/route.ts");

  // The intake route answers POST only; a GET here would be a read surface over
  // supplier inventory.
  assert.equal(/export async function (GET|HEAD|PUT|PATCH|DELETE)/.test(submitRoute), false);
  assert.ok(submitRoute.includes("export async function POST"));
  // The verify route's only other method is an explicit, non-mutating 405.
  assert.ok(verifyRoute.includes("export async function GET"));
  assert.ok(verifyRoute.includes("status: 405"));
  assert.ok(verifyRoute.includes('Allow: "POST"'));

  for (const path of [
    "db/price-check/repositories/sell-submission-repository.ts",
    "lib/marketplace/sell-contract.ts",
  ]) {
    const text = source(path);
    for (const forbidden of [/listPublic/i, /publishedAt/, /searchInventory/i, /publicListing/i]) {
      assert.equal(forbidden.test(text), false, `${path} must not carry ${forbidden}`);
    }
  }
});

test("the Sell core stays free of storage SDKs and of any supplier-to-buyer path", () => {
  // Evidence uploads now exist, so the repository legitimately writes
  // marketplace attachment rows. What must stay out of the Sell core is the
  // storage SDK itself: every AWS call lives in lib/marketplace/uploads, behind
  // the injected preparation step, so the submission transaction cannot acquire
  // a network dependency by accident.
  for (const path of [
    "lib/marketplace/sell-validation.ts",
    "lib/marketplace/sell-submission-service.ts",
    "db/price-check/repositories/sell-submission-repository.ts",
  ]) {
    const text = source(path);
    for (const forbidden of [
      /@aws-sdk/,
      /presign/i,
      /S3Client/,
      /GetObject|HeadObject|PutObject/,
      /buyerOffers/,
      /supplierResponses/,
      /\bpendingUploads\b/,
      /\buploadSessions\b/,
    ]) {
      assert.equal(forbidden.test(text), false, `${path} must not reference ${forbidden}`);
    }
  }
  // The claim itself is inside the transaction; the verification that precedes
  // it is not, and reaches the service only through injected dependencies.
  const service = source("lib/marketplace/sell-submission-service.ts");
  assert.ok(service.includes("await dependencies.prepareAttachments(db, {"));
  assert.ok(
    service.indexOf("await dependencies.prepareAttachments(db, {") < service.indexOf("for (let attempt"),
    "preparation completes before the write loop opens a transaction",
  );
  const repository = source("db/price-check/repositories/sell-submission-repository.ts");
  assert.ok(repository.includes("marketplacePendingUploads"));
  assert.ok(repository.includes("marketplaceAttachments"));
  assert.match(repository, /db\.transaction\(async \(tx\) => \{[\s\S]*claimedSellSubmissionId: sellSubmissionId/);
});

test("attachments are optional at every layer of the Sell core", () => {
  // No attachment field is required, and an offer with none is fully valid.
  const bare = accepted(singlePart());
  assert.deepEqual(bare.attachmentHandles, []);
  assert.deepEqual(accepted(bulk()).attachmentHandles, []);
  assert.deepEqual(accepted(singlePart({ attachmentHandles: [] })).attachmentHandles, []);
  assert.deepEqual(accepted(singlePart({ attachmentHandles: null })).attachmentHandles, []);

  // And the writer treats an empty list as "no attachments", not as an error.
  const repository = source("db/price-check/repositories/sell-submission-repository.ts");
  assert.ok(repository.includes("const attachmentInput = input.attachments ?? [];"));
  assert.ok(repository.includes("if (attachmentInput.length > 0)"));
  // The service short-circuits before any storage work when nothing is attached.
  const binding = source("lib/marketplace/uploads/binding.ts");
  assert.ok(binding.includes("if (input.handles.length === 0) return [];"));
});

test("a zero-attachment submission never calls the preparation step's storage path", async () => {
  let prepared = 0;
  const dependencies = {
    create: async (_db, input) => {
      assert.deepEqual(input.attachments, [], "no attachments reach the writer");
      return { publicReference: input.publicReference };
    },
    findByIdempotency: async () => null,
    generateReference: () => "SS-NOATTACHME",
    tokenKey: () => TOKEN_KEY,
    newNonce: () => "f".repeat(64),
    prepareAttachments: async (_db, input) => {
      prepared += 1;
      assert.deepEqual(input.handles, []);
      assert.equal(input.uploadSessionToken, undefined, "no cookie is needed to submit");
      return [];
    },
  };
  const result = await submitSellSubmission({}, accepted(singlePart()), dependencies);
  assert.deepEqual(result, { reference: "SS-NOATTACHME", created: true });
  assert.equal(prepared, 1, "the step runs and returns nothing, rather than being skipped silently");
});

test("prepared attachments are handed to the writer verbatim and only once", async () => {
  const prepared = [{
    id: "01M06PHA5E7P10AD0000000001",
    pendingUploadId: "01M06PHA5E7P10AD0000000002",
    uploadSessionId: "01M06PHA5E7P10AD0000000003",
    displayFilename: "inventory.csv",
    objectKey: "marketplace/quarantine/sell_submission/abc",
    declaredMime: "text/csv",
    detectedMime: "text/csv",
    purpose: "INVENTORY_SPREADSHEET",
    byteSize: 2048,
  }];
  let prepareCalls = 0;
  const seen = [];
  const dependencies = {
    create: async (_db, input) => {
      seen.push(input.attachments);
      return { publicReference: input.publicReference };
    },
    findByIdempotency: async () => null,
    generateReference: () => "SS-WITHFILES1",
    tokenKey: () => TOKEN_KEY,
    newNonce: () => "a".repeat(64),
    prepareAttachments: async (_db, input) => {
      prepareCalls += 1;
      assert.deepEqual(input.handles, ["01M06PHA5E7P10AD0000000002"]);
      assert.equal(input.uploadSessionToken, "session-token-value");
      return prepared;
    },
  };
  const result = await submitSellSubmission(
    {},
    accepted(singlePart({ attachmentHandles: ["01M06PHA5E7P10AD0000000002"] })),
    dependencies,
    { uploadSessionToken: "session-token-value" },
  );
  assert.deepEqual(result, { reference: "SS-WITHFILES1", created: true });
  assert.equal(prepareCalls, 1, "verification happens once, outside the write loop");
  assert.deepEqual(seen, [prepared]);
});

test("a replay verifies nothing and can never re-claim already-bound evidence", async () => {
  let prepareCalls = 0;
  const dependencies = {
    create: async () => {
      throw new Error("a replay must never reach the writer");
    },
    findByIdempotency: async () => ({ id: "existing", publicReference: "SS-ABCDEFGHJK" }),
    generateReference: () => "SS-NEWNEWNEWN",
    tokenKey: () => TOKEN_KEY,
    newNonce: () => "b".repeat(64),
    prepareAttachments: async () => {
      prepareCalls += 1;
      return [];
    },
  };
  const result = await submitSellSubmission(
    {},
    accepted(singlePart({ attachmentHandles: ["01M06PHA5E7P10AD0000000002"] })),
    dependencies,
    { uploadSessionToken: "session-token-value" },
  );
  assert.deepEqual(result, { reference: "SS-ABCDEFGHJK", created: false });
  assert.equal(prepareCalls, 0, "a replay must not re-verify or re-claim a spent handle");
});
