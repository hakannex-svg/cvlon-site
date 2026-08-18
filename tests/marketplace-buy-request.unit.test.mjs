import assert from "node:assert/strict";
import test from "node:test";

import { validateBuyRequestSubmission } from "../lib/marketplace/validation.ts";
import { hasControlCharacter, unicodeIntakeFixture } from "./fixtures/marketplace-unicode.mjs";
import {
  BUY_REQUEST_SOURCE_PAGE,
  BUY_REQUEST_VERIFY_PATH,
  buyRequestConditionCodes,
  buyRequestFulfillmentPreferences,
  buyRequestUrgencies,
  isPhoneRequiredUrgency,
} from "../lib/marketplace/contract.ts";
import {
  BUY_REQUEST_VERIFY_TOKEN_TTL_MS,
  buyRequestVerificationUrl,
  deriveVerificationToken,
  hashVerificationToken,
  isVerificationToken,
  buyRequestAdminUrl,
  marketplaceOrigin,
  marketplaceVerifyTokenKey,
  newVerificationNonce,
  secureEqualHex,
} from "../lib/marketplace/verification.ts";
import {
  buyRequestIdempotencyHash,
  submitBuyRequest,
} from "../lib/marketplace/submission-service.ts";
import { verifyBuyRequestContact } from "../lib/marketplace/verification-service.ts";
import {
  buyRequestInternalEmail,
  buyRequestVerifyEmail,
} from "../lib/marketplace/email/buy-request-templates.ts";
import {
  buyRequestInternalNotificationHandler,
  buyRequestVerifyNotificationHandler,
} from "../lib/marketplace/email/buy-request-handlers.ts";
import {
  civilonNotificationHandlers,
  registeredNotificationTypes,
} from "../lib/notifications/registry.ts";
import { processNextNotification } from "../lib/notifications/outbox-worker.ts";
import {
  defaultMarketplaceEmailFrom,
  getMarketplaceEmailFrom,
} from "../lib/marketplace/config.ts";
import {
  consumeMarketplaceAttempt,
  marketplaceRateLimitKey,
  resetMarketplaceRateLimitForTests,
} from "../lib/marketplace/rate-limit.ts";

const TOKEN_KEY = "civilon-marketplace-verify-token-key-for-tests";
const NOW = new Date("2026-08-17T12:00:00Z");

function submission(overrides = {}) {
  return {
    idempotencyKey: "3f1a2b4c-5d6e-4f70-8123-456789abcdef",
    partNumber: "101-384025-5",
    quantity: "1",
    acceptableCondition: "NOT_SURE",
    urgency: "not_sure",
    fulfillmentPreference: "not_sure",
    firstName: "Dana",
    lastName: "Ruiz",
    companyName: "Example Aviation Group",
    businessEmail: "dana.ruiz@example.com",
    serviceAcknowledged: true,
    legalAcknowledged: true,
    sourcePage: BUY_REQUEST_SOURCE_PAGE,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------
 * Validation
 * ---------------------------------------------------------------------- */

test("a minimal Buy Request is accepted with the documented defaults", () => {
  const result = validateBuyRequestSubmission(submission());
  assert.equal(result.success, true, JSON.stringify(result.fieldErrors));
  assert.equal(result.data.quantity, "1");
  assert.equal(result.data.acceptableCondition, "NOT_SURE");
  assert.equal(result.data.urgency, "not_sure");
  assert.equal(result.data.fulfillmentPreference, "not_sure");
  assert.equal(result.data.phone, null);
  assert.equal(result.data.description, null);
  assert.equal(result.data.neededByDate, null);
  assert.equal(result.data.deliveryCountry, null);
  assert.equal(result.data.sourcePage, BUY_REQUEST_SOURCE_PAGE);
});

test("a description alone is enough when the buyer has no part number", () => {
  const result = validateBuyRequestSubmission(
    submission({ partNumber: "", description: "Nose landing gear actuator, Challenger 605" }),
  );
  assert.equal(result.success, true, JSON.stringify(result.fieldErrors));
  assert.equal(result.data.partNumber, null);
  assert.match(result.data.description, /actuator/);
});

test("a request with neither a part number nor a description is refused", () => {
  const result = validateBuyRequestSubmission(submission({ partNumber: "", description: "" }));
  assert.equal(result.success, false);
  assert.match(result.fieldErrors.partNumber, /part number or describe/i);
});

test("an unnormalizable part number is refused rather than silently stored", () => {
  for (const partNumber of ["-leading-dash", "!!!", "a".repeat(161)]) {
    const result = validateBuyRequestSubmission(submission({ partNumber }));
    assert.equal(result.success, false, partNumber);
    assert.ok(result.fieldErrors.partNumber, partNumber);
  }
});

test("phone becomes required exactly at AOG and critical urgency", () => {
  for (const urgency of ["aog", "critical"]) {
    assert.equal(isPhoneRequiredUrgency(urgency), true, urgency);
    const missing = validateBuyRequestSubmission(submission({ urgency }));
    assert.equal(missing.success, false, urgency);
    assert.match(missing.fieldErrors.phone, /AOG or critical/i);

    const supplied = validateBuyRequestSubmission(submission({ urgency, phone: "+1 909 555 0123" }));
    assert.equal(supplied.success, true, JSON.stringify(supplied.fieldErrors));
    assert.equal(supplied.data.phone, "+1 909 555 0123");
  }
  for (const urgency of ["standard", "planned", "not_sure"]) {
    assert.equal(isPhoneRequiredUrgency(urgency), false, urgency);
    const result = validateBuyRequestSubmission(submission({ urgency }));
    assert.equal(result.success, true, urgency);
  }
});

test("an unsupported field is rejected, never silently dropped", () => {
  const result = validateBuyRequestSubmission(submission({ supplierCost: "1200.00" }));
  assert.equal(result.success, false);
  assert.match(result.fieldErrors._form, /unsupported field/i);
});

test("every enum is closed to its approved values", () => {
  const cases = [
    ["acceptableCondition", buyRequestConditionCodes, "SUPPLIER_ONLY"],
    ["urgency", buyRequestUrgencies, "whenever"],
    ["fulfillmentPreference", buyRequestFulfillmentPreferences, "supplier_direct"],
  ];
  for (const [field, allowed, rejected] of cases) {
    for (const value of allowed) {
      const ok = validateBuyRequestSubmission(
        submission({ [field]: value, phone: "+1 909 555 0123" }),
      );
      assert.equal(ok.success, true, `${field}=${value}: ${JSON.stringify(ok.fieldErrors)}`);
    }
    const bad = validateBuyRequestSubmission(submission({ [field]: rejected }));
    assert.equal(bad.success, false, `${field}=${rejected}`);
    assert.ok(bad.fieldErrors[field]);
  }
});

test("acknowledgements, source page and idempotency key are all mandatory", () => {
  assert.equal(validateBuyRequestSubmission(submission({ serviceAcknowledged: false })).success, false);
  assert.equal(validateBuyRequestSubmission(submission({ legalAcknowledged: "yes" })).success, false);
  assert.equal(validateBuyRequestSubmission(submission({ sourcePage: "/price-check" })).success, false);
  assert.equal(validateBuyRequestSubmission(submission({ idempotencyKey: "not-a-uuid" })).success, false);
  assert.equal(validateBuyRequestSubmission(submission({ businessEmail: "dana@" })).success, false);
  assert.equal(validateBuyRequestSubmission(submission({ firstName: "  " })).success, false);
});

test("Unicode and control characters are normalized away before persistence", () => {
  const result = validateBuyRequestSubmission(submission(unicodeIntakeFixture));
  assert.equal(result.success, true, JSON.stringify(result.fieldErrors));
  assert.equal(result.data.firstName, "Dana");
  assert.equal(result.data.companyName, "Example Aviation");
  assert.equal(result.data.description, "Bleedvalve");
  assert.equal(hasControlCharacter(JSON.stringify(result.data)), false);
});

test("bounded lengths and quantity limits are enforced", () => {
  assert.equal(validateBuyRequestSubmission(submission({ description: "x".repeat(501) })).success, false);
  assert.equal(validateBuyRequestSubmission(submission({ applicationNotes: "x".repeat(2001) })).success, false);
  assert.equal(validateBuyRequestSubmission(submission({ companyName: "x".repeat(201) })).success, false);
  assert.equal(validateBuyRequestSubmission(submission({ deliveryPostalCode: "x".repeat(25) })).success, false);
  for (const quantity of ["0", "-1", "1.0001", "1000000000", "many"]) {
    assert.equal(validateBuyRequestSubmission(submission({ quantity })).success, false, quantity);
  }
});

test("optional delivery, date and application context are accepted and bounded", () => {
  const result = validateBuyRequestSubmission(submission({
    quantity: "2.5",
    acceptableCondition: "ANY",
    urgency: "planned",
    neededByDate: "2026-09-30",
    deliveryCountry: "us",
    deliveryPostalCode: "07632",
    deliveryCity: "Englewood Cliffs",
    fulfillmentPreference: "door_delivery",
    aircraftModel: "Challenger 605",
    applicationNotes: "Scheduled maintenance visit.",
  }));
  assert.equal(result.success, true, JSON.stringify(result.fieldErrors));
  assert.equal(result.data.deliveryCountry, "US");
  assert.equal(result.data.neededByDate, "2026-09-30");
  assert.equal(validateBuyRequestSubmission(submission({ neededByDate: "2026-02-30" })).success, false);
  assert.equal(validateBuyRequestSubmission(submission({ deliveryCountry: "USA" })).success, false);
});

test("attribution is reduced to a referrer origin and sanitized campaign values", () => {
  const result = validateBuyRequestSubmission(submission({
    landingPage: "https://cvlon.com/buy-sell-aircraft-parts/buy?utm_source=x",
    referrer: "https://search.example.com/results?q=secret+query",
    utmSource: "news<letter>",
  }));
  assert.equal(result.success, true, JSON.stringify(result.fieldErrors));
  assert.equal(result.data.referrer, "https://search.example.com");
  assert.equal(result.data.landingPage, "https://cvlon.com/buy-sell-aircraft-parts/buy");
  assert.ok(!result.data.utmSource.includes("<"));
});

/* -------------------------------------------------------------------------
 * Verification token domain
 * ---------------------------------------------------------------------- */

test("the verification credential is HMAC-derived and never equals what is stored", () => {
  const nonce = newVerificationNonce();
  assert.match(nonce, /^[a-f0-9]{64}$/);
  const token = deriveVerificationToken(TOKEN_KEY, nonce);
  assert.equal(isVerificationToken(token), true);
  const stored = hashVerificationToken(TOKEN_KEY, token);
  assert.match(stored, /^[a-f0-9]{64}$/);
  assert.notEqual(stored, token);
  assert.equal(stored.includes(token), false);
  assert.equal(token.includes(nonce), false);
  // Derivation is deterministic for the same key and nonce, which is what lets
  // the email handler rebuild the link without ever storing plaintext.
  assert.equal(deriveVerificationToken(TOKEN_KEY, nonce), token);
  assert.notEqual(deriveVerificationToken(`${TOKEN_KEY}-other`, nonce), token);
  assert.notEqual(deriveVerificationToken(TOKEN_KEY, newVerificationNonce()), token);
});

test("weak keys, malformed nonces and malformed credentials are refused", () => {
  assert.throws(() => deriveVerificationToken("short-key", newVerificationNonce()), /MARKETPLACE_VERIFY_TOKEN_KEY_UNAVAILABLE/);
  assert.throws(() => deriveVerificationToken(TOKEN_KEY, "nope"), /VERIFICATION_NONCE_INVALID/);
  assert.throws(() => marketplaceVerifyTokenKey({}), /MARKETPLACE_VERIFY_TOKEN_KEY_UNAVAILABLE/);
  assert.equal(marketplaceVerifyTokenKey({ MARKETPLACE_VERIFY_TOKEN_KEY: TOKEN_KEY }), TOKEN_KEY);
  for (const value of ["", "short", `${"a".repeat(44)}`, "has spaces in it", null, 5]) {
    assert.equal(isVerificationToken(value), false, String(value));
  }
});

test("constant-time hex comparison rejects non-hex and mismatched values", () => {
  const left = hashVerificationToken(TOKEN_KEY, deriveVerificationToken(TOKEN_KEY, newVerificationNonce()));
  assert.equal(secureEqualHex(left, left), true);
  // The replacement character must be guaranteed to differ from the current
  // one: a fixed "0" silently produces an identical string whenever the hash
  // already ends in "0", which is one run in sixteen.
  const flipped = left.slice(0, -1) + (left.endsWith("0") ? "1" : "0");
  assert.notEqual(flipped, left);
  assert.equal(secureEqualHex(left, flipped), false);
  assert.equal(secureEqualHex(left, "not-hex"), false);
  assert.equal(secureEqualHex("", ""), false);
});

test("the token lifetime is a fixed, stable window", () => {
  assert.equal(BUY_REQUEST_VERIFY_TOKEN_TTL_MS, 7 * 24 * 60 * 60 * 1000);
});

test("verification links are only ever built against approved Civilon origins", () => {
  for (const url of ["https://cvlon.com", "https://cvlon.netlify.app", "https://deploy-preview-19--cvlon.netlify.app"]) {
    assert.equal(marketplaceOrigin({ URL: url }), url);
  }
  for (const url of ["http://cvlon.com", "https://cvlon.com.evil.test", "https://evil.test", "https://--cvlon.netlify.app", "", "not-a-url"]) {
    assert.throws(() => marketplaceOrigin({ URL: url }), /MARKETPLACE_ORIGIN_INVALID/, url);
  }
  // The Netlify deploy URL wins over the configured site URL, so a preview never
  // emails a link that lands on production.
  assert.equal(
    marketplaceOrigin({ DEPLOY_PRIME_URL: "https://x--cvlon.netlify.app", NEXT_PUBLIC_SITE_URL: "https://cvlon.com" }),
    "https://x--cvlon.netlify.app",
  );

  // MARKETPLACE_PREVIEW_ORIGIN outranks all three. Netlify does not expose
  // DEPLOY_PRIME_URL to a function, and URL is the production address even
  // inside a preview, so without this a preview would email production links.
  assert.equal(
    marketplaceOrigin({
      MARKETPLACE_PREVIEW_ORIGIN: "https://deploy-preview-20--cvlon.netlify.app",
      DEPLOY_PRIME_URL: "https://x--cvlon.netlify.app",
      URL: "https://cvlon.com",
      NEXT_PUBLIC_SITE_URL: "https://cvlon.com",
    }),
    "https://deploy-preview-20--cvlon.netlify.app",
  );
  // The runtime shape: URL alone would resolve to production.
  assert.equal(marketplaceOrigin({ URL: "https://cvlon.com" }), "https://cvlon.com");

  // It is a preference, not an escape hatch: the same https + approved-host
  // validation applies, and an unusable value throws rather than silently
  // falling back to a production link.
  for (const origin of [
    "http://deploy-preview-20--cvlon.netlify.app",
    "https://deploy-preview-20--attacker.netlify.app",
    "https://cvlon.com.evil.test",
    "https://--cvlon.netlify.app",
    "not-a-url",
  ]) {
    assert.throws(
      () => marketplaceOrigin({ MARKETPLACE_PREVIEW_ORIGIN: origin, URL: "https://cvlon.com" }),
      /MARKETPLACE_ORIGIN_INVALID/,
      origin,
    );
  }
  // Blank or unset is simply absent, so the existing precedence still applies.
  for (const origin of [undefined, ""]) {
    assert.equal(
      marketplaceOrigin({ MARKETPLACE_PREVIEW_ORIGIN: origin, URL: "https://cvlon.com" }),
      "https://cvlon.com",
    );
  }

  const token = deriveVerificationToken(TOKEN_KEY, newVerificationNonce());
  assert.equal(
    buyRequestVerificationUrl("https://cvlon.com/", token),
    `https://cvlon.com${BUY_REQUEST_VERIFY_PATH}#token=${encodeURIComponent(token)}`,
  );
  // The internal console link is record bound, so a notice opens the exact
  // Buy Request rather than a shared queue.
  assert.equal(
    buyRequestAdminUrl("https://cvlon.com", "BR0000000000000000000000AB"),
    "https://cvlon.com/admin/buy-requests/BR0000000000000000000000AB",
  );
  assert.equal(
    buyRequestAdminUrl("https://cvlon.com/", "BR0000000000000000000000AB"),
    "https://cvlon.com/admin/buy-requests/BR0000000000000000000000AB",
  );
  assert.equal(
    buyRequestAdminUrl("https://cvlon.com", "a/b?c=d"),
    "https://cvlon.com/admin/buy-requests/a%2Fb%3Fc%3Dd",
  );
});

test("a malformed credential is rejected before any database call", async () => {
  let queried = false;
  const dependencies = {
    redeem: async () => { queried = true; return { outcome: "verified", reference: "BR-0000000001" }; },
    tokenKey: () => TOKEN_KEY,
  };
  for (const token of [undefined, "", "../../etc/passwd", "a".repeat(500)]) {
    const result = await verifyBuyRequestContact({}, { token }, dependencies);
    assert.deepEqual(result, { outcome: "unavailable" });
  }
  assert.equal(queried, false);

  const valid = deriveVerificationToken(TOKEN_KEY, newVerificationNonce());
  const passed = [];
  await verifyBuyRequestContact({}, { token: valid }, {
    tokenKey: () => TOKEN_KEY,
    redeem: async (_db, input) => { passed.push(input); return { outcome: "unavailable" }; },
  });
  assert.equal(passed.length, 1);
  assert.equal(passed[0].keyedTokenHash, hashVerificationToken(TOKEN_KEY, valid));
  assert.equal(JSON.stringify(passed[0]).includes(valid), false, "the plaintext credential must not reach the repository");
});

/* -------------------------------------------------------------------------
 * Submission service
 * ---------------------------------------------------------------------- */

function serviceDependencies(overrides = {}) {
  const created = [];
  const stored = new Map();
  return {
    created,
    stored,
    dependencies: {
      findByIdempotency: async (_db, hash) => stored.get(hash) ?? null,
      create: async (_db, input) => {
        created.push(input);
        stored.set(input.idempotencyHash, { id: "BR-id", publicReference: input.publicReference });
        return { publicReference: input.publicReference };
      },
      generateReference: () => `BR-${String(created.length).padStart(10, "0")}`,
      tokenKey: () => TOKEN_KEY,
      newNonce: newVerificationNonce,
      ...overrides,
    },
  };
}

test("the idempotency key is hashed, never persisted raw", () => {
  const hash = buyRequestIdempotencyHash("3f1a2b4c-5d6e-4f70-8123-456789abcdef");
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hash.includes("3f1a2b4c"), false);
  assert.equal(hash, buyRequestIdempotencyHash("3f1a2b4c-5d6e-4f70-8123-456789abcdef"));
  assert.notEqual(hash, buyRequestIdempotencyHash("3f1a2b4c-5d6e-4f70-8123-456789abcdee"));
});

test("submission persists only a keyed hash and nonce, never the credential", async () => {
  const valid = validateBuyRequestSubmission(submission());
  const { created, dependencies } = serviceDependencies();
  const result = await submitBuyRequest({}, valid.data, dependencies, { now: NOW });

  assert.equal(result.created, true);
  assert.match(result.reference, /^BR-/);
  assert.equal(created.length, 1);
  const token = created[0].verificationToken;
  assert.match(token.tokenDerivationNonce, /^[a-f0-9]{64}$/);
  assert.match(token.keyedTokenHash, /^[a-f0-9]{64}$/);
  assert.equal(token.expiresAt.valueOf(), NOW.valueOf() + BUY_REQUEST_VERIFY_TOKEN_TTL_MS);

  const credential = deriveVerificationToken(TOKEN_KEY, token.tokenDerivationNonce);
  assert.equal(hashVerificationToken(TOKEN_KEY, credential), token.keyedTokenHash);
  assert.equal(JSON.stringify(created[0]).includes(credential), false);
});

test("a repeated submission returns the same reference and creates nothing new", async () => {
  const valid = validateBuyRequestSubmission(submission());
  const { created, dependencies } = serviceDependencies();
  const first = await submitBuyRequest({}, valid.data, dependencies, { now: NOW });
  const repeat = await submitBuyRequest({}, valid.data, dependencies, { now: NOW });

  assert.equal(repeat.created, false);
  assert.equal(repeat.reference, first.reference);
  assert.equal(created.length, 1, "a replay must not write a second Buy Request or its notifications");
});

test("a public-reference collision retries, and a racing duplicate resolves to the winner", async () => {
  const valid = validateBuyRequestSubmission(submission());
  const base = serviceDependencies();
  let attempts = 0;
  const collide = {
    ...base.dependencies,
    create: async (db, input) => {
      attempts += 1;
      if (attempts === 1) {
        throw Object.assign(new Error("duplicate key"), {
          code: "23505",
          constraint: "buy_requests_public_reference_uidx",
        });
      }
      return base.dependencies.create(db, input);
    },
  };
  const result = await submitBuyRequest({}, valid.data, collide, { now: NOW });
  assert.equal(attempts, 2);
  assert.equal(result.created, true);

  const raced = serviceDependencies();
  const winner = { id: "BR-id", publicReference: "BR-WINNER0001" };
  let lookups = 0;
  const result2 = await submitBuyRequest({}, valid.data, {
    ...raced.dependencies,
    findByIdempotency: async () => (lookups++ === 0 ? null : winner),
    create: async () => {
      throw Object.assign(new Error("duplicate key"), {
        code: "23505",
        constraint: "buy_requests_idempotency_hash_uidx",
      });
    },
  }, { now: NOW });
  assert.deepEqual(result2, { reference: "BR-WINNER0001", created: false });
});

/* -------------------------------------------------------------------------
 * Email templates and notification registration
 * ---------------------------------------------------------------------- */

const FORBIDDEN_IN_MAIL = [
  "101-384025-5",
  "101384025",
  "Dana",
  "Ruiz",
  "Example Aviation Group",
  "+1 909 555 0123",
  "1200.00",
  "USD",
  "Supplier",
  "supplier",
  "cost",
];

function assertPrivacyMinimized(email, { allow = [] } = {}) {
  const surface = [email.subject, email.textBody, email.htmlBody, email.tag, JSON.stringify(email.metadata)].join("\n");
  for (const secret of FORBIDDEN_IN_MAIL) {
    if (allow.includes(secret)) continue;
    assert.equal(surface.includes(secret), false, `mail must not contain ${secret}`);
  }
}

test("the customer verification email carries only a reference, a link and an expiry", () => {
  const token = deriveVerificationToken(TOKEN_KEY, newVerificationNonce());
  const email = buyRequestVerifyEmail({
    from: defaultMarketplaceEmailFrom,
    to: "dana.ruiz@example.com",
    reference: "BR-ABCDEFGHJK",
    verificationUrl: buyRequestVerificationUrl("https://cvlon.com", token),
    expiresAt: new Date("2026-08-24T12:00:00Z"),
  });

  assert.equal(email.to, "dana.ruiz@example.com", "the customer's own address is the destination");
  assertPrivacyMinimized(email);
  assert.ok(email.textBody.includes("BR-ABCDEFGHJK"));
  assert.ok(email.textBody.includes(token));
  assert.ok(email.textBody.includes("August 24, 2026"));
  assert.equal(email.subject.includes("dana.ruiz@example.com"), false);
  assert.equal(JSON.stringify(email.metadata), JSON.stringify({ reference: "BR-ABCDEFGHJK" }));
  // Compliance copy: no certification, approval, guarantee or confirmed availability.
  const body = `${email.subject}\n${email.textBody}\n${email.htmlBody}`;
  for (const claim of [/certif/i, /airworth/i, /guarantee/i, /approved for installation/i, /in stock/i, /distribut/i, /supplier network/i]) {
    assert.equal(claim.test(body), false, `prohibited claim ${claim}`);
  }
  assert.match(body, /subject to confirmation/i);
  assert.match(body, /Documentation varies by part and source/i);
});

test("the internal notice carries a reference, a status and a console link only", () => {
  const email = buyRequestInternalEmail({
    from: defaultMarketplaceEmailFrom,
    to: "sales@cvlon.com, hakan@shipnex.com, david@cvlon.com",
    reference: "BR-ABCDEFGHJK",
    status: "pending_verification",
    submittedAt: new Date("2026-08-17T12:00:00Z"),
    adminUrl: buyRequestAdminUrl("https://cvlon.com", "BR0000000000000000000000AB"),
  });

  assertPrivacyMinimized(email);
  assert.equal(email.textBody.includes("dana.ruiz@example.com"), false);
  assert.ok(email.textBody.includes("BR-ABCDEFGHJK"));
  assert.ok(email.textBody.includes("pending_verification"));
  assert.ok(email.textBody.includes("https://cvlon.com/admin/buy-requests/BR0000000000000000000000AB"));
  assert.equal(email.textBody.includes("/admin/price-checks"), false);
  assert.deepEqual(email.metadata, { reference: "BR-ABCDEFGHJK", status: "pending_verification" });
});

test("both marketplace message types are registered before any producer can enqueue", () => {
  const types = registeredNotificationTypes();
  assert.ok(types.includes("BUY_REQUEST_VERIFY_EMAIL"));
  assert.ok(types.includes("BUY_REQUEST_INTERNAL_RECEIVED"));
  assert.ok(types.includes("RESULT_READY"), "Price Check registration is unchanged");

  for (const handler of [buyRequestVerifyNotificationHandler, buyRequestInternalNotificationHandler]) {
    assert.equal(handler.workflow, "marketplace");
    assert.equal(handler.aggregateType, "buy_request");
    assert.ok(civilonNotificationHandlers.includes(handler));
    assert.equal(typeof handler.deliver, "function");
    assert.equal(typeof handler.recordFailure, "function");
  }
  assert.equal(new Set(types).size, types.length, "message types must be unique");
});

/** Mirrors the real lease predicate, including allowlist and denylist filters. */
function fakeOutbox(rows) {
  const failCalls = [];
  return {
    failCalls,
    operations: {
      async lease(_db, input) {
        if (input.messageTypes && input.messageTypes.length === 0) return null;
        const candidate = rows.find((row) =>
          ["pending", "failed"].includes(row.state)
          && row.nextAttemptAt <= input.now
          && (!input.messageTypes || input.messageTypes.includes(row.messageType))
          && (!input.excludeMessageTypes || !input.excludeMessageTypes.includes(row.messageType)));
        if (!candidate) return null;
        candidate.state = "running";
        candidate.attemptCount += 1;
        candidate.leaseOwner = input.leaseOwner;
        return candidate;
      },
      async fail(_db, input) {
        failCalls.push(input);
        const row = rows.find((entry) => entry.id === input.id);
        row.state = input.deadLetter ? "dead_letter" : "failed";
        return row;
      },
    },
  };
}

function outboxRow(messageType, id) {
  return {
    id,
    messageType,
    aggregateType: "buy_request",
    aggregateId: "01BUYREQUEST00000000000000",
    state: "pending",
    attemptCount: 0,
    leaseOwner: null,
    leaseExpiresAt: null,
    nextAttemptAt: new Date("2026-08-17T11:00:00Z"),
    sanitizedFailureCode: null,
  };
}

test("a Price-Check-only drain never dead-letters either marketplace message", async () => {
  const rows = [
    outboxRow("BUY_REQUEST_VERIFY_EMAIL", "verify-1"),
    outboxRow("BUY_REQUEST_INTERNAL_RECEIVED", "internal-1"),
  ];
  const outbox = fakeOutbox(rows);
  const priceCheckOnly = {
    workflow: "price-check",
    messageType: "RESULT_READY",
    aggregateType: "price_check_result",
    async deliver() { throw new Error("the Price Check handler must never see a Buy Request message"); },
  };

  const result = await processNextNotification({}, {
    handlers: [priceCheckOnly],
    now: NOW,
    leaseOwner: "price-check-drain",
    outbox: outbox.operations,
  });

  assert.equal(result.status, "idle");
  assert.equal(outbox.failCalls.length, 0);
  for (const row of rows) {
    assert.equal(row.state, "pending", `${row.messageType} must stay runnable for its own handler`);
    assert.equal(row.attemptCount, 0, `${row.messageType} must not burn a retry attempt`);
  }
});

test("an unregistered message type is still reaped without touching marketplace rows", async () => {
  const rows = [
    outboxRow("BUY_REQUEST_VERIFY_EMAIL", "verify-2"),
    { ...outboxRow("ABANDONED_TYPE", "orphan-1"), aggregateType: "unknown" },
  ];
  const outbox = fakeOutbox(rows);
  const result = await processNextNotification({}, {
    handlers: [{
      workflow: "price-check",
      messageType: "RESULT_READY",
      aggregateType: "price_check_result",
      async deliver() { throw new Error("unreachable"); },
    }],
    now: NOW,
    leaseOwner: "reaper",
    outbox: outbox.operations,
  });

  assert.equal(result.status, "dead_letter");
  assert.equal(result.notificationId, "orphan-1");
  assert.equal(rows[0].state, "pending");
  assert.equal(rows[1].state, "dead_letter");
});

/* -------------------------------------------------------------------------
 * Configuration and rate limiting
 * ---------------------------------------------------------------------- */

test("the marketplace sender falls back to the approved default and fails closed otherwise", () => {
  assert.equal(getMarketplaceEmailFrom({}), defaultMarketplaceEmailFrom);
  assert.equal(getMarketplaceEmailFrom({ MARKETPLACE_EMAIL_FROM: "  " }), defaultMarketplaceEmailFrom);
  assert.equal(defaultMarketplaceEmailFrom, "Civilon Parts <parts@cvlon.com>");
  assert.equal(getMarketplaceEmailFrom({ MARKETPLACE_EMAIL_FROM: "parts@cvlon.com" }), "parts@cvlon.com");
  assert.equal(
    getMarketplaceEmailFrom({ MARKETPLACE_EMAIL_FROM: "Civilon <parts@cvlon.com>" }),
    "Civilon <parts@cvlon.com>",
  );
  for (const value of ["not-an-address", "Civilon <parts@cvlon.com", "a@b.com\nBcc: leak@evil.test", "<>"]) {
    assert.throws(() => getMarketplaceEmailFrom({ MARKETPLACE_EMAIL_FROM: value }), /MARKETPLACE_EMAIL_FROM_INVALID/, value);
  }
});

test("marketplace rate limiting is bounded and keyed separately from Price Check", async () => {
  resetMarketplaceRateLimitForTests();
  const key = marketplaceRateLimitKey("203.0.113.10");
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.equal(key.includes("203.0.113.10"), false);

  const start = Date.parse("2026-08-17T12:00:00Z");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal(consumeMarketplaceAttempt(key, start).allowed, true, `attempt ${attempt}`);
  }
  const blocked = consumeMarketplaceAttempt(key, start);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);
  // A different client is unaffected, and the window eventually reopens.
  assert.equal(consumeMarketplaceAttempt(marketplaceRateLimitKey("203.0.113.11"), start).allowed, true);
  assert.equal(consumeMarketplaceAttempt(key, start + 10 * 60 * 1000 + 1).allowed, true);

  const { consumePriceCheckAttempt, rateLimitKey } = await import("../lib/price-check/rate-limit.ts");
  assert.notEqual(rateLimitKey("203.0.113.10"), key, "the two workflows must not share a counter namespace");
  assert.equal(consumePriceCheckAttempt(rateLimitKey("203.0.113.10"), start).allowed, true);
  resetMarketplaceRateLimitForTests();
});

/* -------------------------------------------------------------------------
 * Route wiring
 *
 * Source-level assertions in the style of tests/site-routes.test.mjs: the API
 * routes are server modules behind a path alias, so these guard the wiring that
 * the lib-level tests above cannot reach.
 * ---------------------------------------------------------------------- */

test("the submit route keeps its gate, honeypot, bounds and privacy headers", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../app/api/marketplace/buy-requests/route.ts", import.meta.url), "utf8");

  assert.match(source, /isMarketplaceEnabled\(\)/, "feature gated");
  assert.doesNotMatch(source, /isPriceCheckEnabled/, "the Price Check flag must not gate marketplace intake");
  assert.match(source, /BUY_REQUEST_MAX_BODY_BYTES/, "body size is bounded");
  assert.match(source, /consumeMarketplaceAttempt/, "rate limited");
  assert.match(source, /honeypot/, "honeypot enforced");
  assert.match(source, /validateBuyRequestSubmission/, "validated before persistence");
  assert.match(source, /isApprovedSubmissionHost/, "origin boundary enforced");
  assert.match(source, /"X-Robots-Tag": "noindex, nofollow"/);
  assert.match(source, /"Cache-Control": "no-store"/);
  // No account, session or cookie is introduced by intake.
  assert.doesNotMatch(source, /cookies?\.set|Set-Cookie|session/i);
});

test("the verify route is uniform, gated, rate limited and session-free", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../app/api/marketplace/buy-requests/verify/route.ts", import.meta.url), "utf8");

  assert.match(source, /isMarketplaceEnabled\(\)/);
  assert.match(source, /consumeMarketplaceAttempt/);
  assert.match(source, /verifyBuyRequestContact/);
  assert.match(source, /"private, no-store, max-age=0"/);
  assert.match(source, /export async function POST/);
  assert.match(source, /noindex, nofollow, noarchive/);
  assert.match(source, /"Referrer-Policy": "no-referrer"/);
  assert.doesNotMatch(source, /cookies?\.set|Set-Cookie/i);
  // Exactly one success shape and one failure shape, both HTTP 200, so the
  // endpoint cannot be used to enumerate references.
  assert.doesNotMatch(source, /already_verified/, "a repeat must not be reported differently to the caller");
});
