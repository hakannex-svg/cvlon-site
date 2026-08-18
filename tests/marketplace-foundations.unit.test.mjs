import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  GENERIC_FAILURE_CODE,
  NOTIFICATION_MAX_ATTEMPTS,
  processNextNotification,
  retryDelayMs,
  sanitizeFailureCode,
} from "../lib/notifications/outbox-worker.ts";
import { civilonNotificationHandlers, registeredNotificationTypes } from "../lib/notifications/registry.ts";
import { resultReadyNotificationHandler } from "../lib/price-check/email/result-ready-handler.ts";
import { isMarketplaceEnabled } from "../lib/marketplace/feature.ts";
import {
  defaultMarketplaceInternalRecipients,
  getMarketplaceInternalRecipients,
} from "../lib/marketplace/config.ts";
import {
  generatePublicReference,
  isPublicReferencePrefix,
  publicReferencePrefixes,
} from "../db/price-check/domain/identifiers.ts";

const NOW = new Date("2026-08-17T12:00:00Z");

function outboxRow(overrides = {}) {
  return {
    id: "message-1",
    messageType: "RESULT_READY",
    aggregateType: "price_check_result",
    aggregateId: "aggregate-1",
    state: "pending",
    attemptCount: 0,
    leaseOwner: null,
    leaseExpiresAt: null,
    nextAttemptAt: new Date("2026-08-17T11:00:00Z"),
    sanitizedFailureCode: null,
    ...overrides,
  };
}

/** Mirrors the real lease predicate, including the allowlist and denylist filters. */
function fakeOutbox(rows) {
  const leaseCalls = [];
  const failCalls = [];
  return {
    rows,
    leaseCalls,
    failCalls,
    operations: {
      async lease(_db, input) {
        leaseCalls.push(input);
        if (input.messageTypes && input.messageTypes.length === 0) return null;
        const candidate = rows.find((row) =>
          ["pending", "failed"].includes(row.state)
          && row.nextAttemptAt <= input.now
          && (!input.messageTypes || input.messageTypes.includes(row.messageType))
          && (!input.excludeMessageTypes || !input.excludeMessageTypes.includes(row.messageType)));
        if (!candidate) return null;
        candidate.state = "running";
        candidate.leaseOwner = input.leaseOwner;
        candidate.attemptCount += 1;
        return candidate;
      },
      async fail(_db, input) {
        failCalls.push(input);
        const row = rows.find((entry) => entry.id === input.id);
        row.state = input.deadLetter ? "dead_letter" : "failed";
        row.sanitizedFailureCode = input.sanitizedFailureCode;
        row.nextAttemptAt = input.nextAttemptAt;
        row.leaseOwner = null;
        return row;
      },
    },
  };
}

function stubHandler(overrides = {}) {
  const invocations = [];
  return {
    invocations,
    handler: {
      workflow: "test",
      messageType: "TEST_MESSAGE",
      aggregateType: "test_aggregate",
      async deliver(_db, message) {
        invocations.push(message.id);
        return { providerMessageId: "provider-1" };
      },
      ...overrides,
    },
  };
}

test("a marketplace message is delivered by its own handler, never poisoned by the shared drain", async () => {
  const priceCheck = stubHandler({ messageType: "RESULT_READY", aggregateType: "price_check_result", workflow: "price-check" });
  const marketplace = stubHandler({ messageType: "BUY_REQUEST_RECEIVED", aggregateType: "buy_request", workflow: "marketplace" });
  const row = outboxRow({ id: "buy-1", messageType: "BUY_REQUEST_RECEIVED", aggregateType: "buy_request" });
  const outbox = fakeOutbox([row]);

  const result = await processNextNotification({}, {
    handlers: [priceCheck.handler, marketplace.handler],
    now: NOW,
    leaseOwner: "drain-1",
    outbox: outbox.operations,
  });

  assert.equal(result.status, "succeeded");
  assert.equal(result.notificationId, "buy-1");
  assert.deepEqual(marketplace.invocations, ["buy-1"]);
  assert.deepEqual(priceCheck.invocations, []);
  assert.equal(outbox.failCalls.length, 0);
  assert.notEqual(row.state, "dead_letter");
});

test("a Price-Check-only drain leaves a reserved marketplace message untouched", async () => {
  const priceCheck = stubHandler({ messageType: "RESULT_READY", aggregateType: "price_check_result" });
  const row = outboxRow({ id: "buy-2", messageType: "BUY_REQUEST_RECEIVED", aggregateType: "buy_request" });
  const outbox = fakeOutbox([row]);

  const result = await processNextNotification({}, {
    handlers: [priceCheck.handler],
    reservedMessageTypes: ["RESULT_READY", "BUY_REQUEST_RECEIVED"],
    now: NOW,
    leaseOwner: "drain-2",
    outbox: outbox.operations,
  });

  assert.equal(result.status, "idle");
  assert.equal(row.state, "pending", "the message must remain runnable for its own handler");
  assert.equal(row.attemptCount, 0, "a foreign message must not burn a retry attempt");
  assert.equal(outbox.failCalls.length, 0);
  assert.deepEqual(priceCheck.invocations, []);
});

test("the drain never asks the outbox for a type it cannot handle", async () => {
  const priceCheck = stubHandler({ messageType: "RESULT_READY", aggregateType: "price_check_result" });
  const outbox = fakeOutbox([]);

  await processNextNotification({}, {
    handlers: [priceCheck.handler],
    reservedMessageTypes: ["RESULT_READY", "BUY_REQUEST_RECEIVED"],
    now: NOW,
    leaseOwner: "drain-3",
    outbox: outbox.operations,
  });

  assert.equal(outbox.leaseCalls.length, 2);
  assert.deepEqual(outbox.leaseCalls[0].messageTypes, ["RESULT_READY"]);
  assert.equal(outbox.leaseCalls[0].excludeMessageTypes, undefined);
  assert.equal(outbox.leaseCalls[1].messageTypes, undefined);
  for (const reserved of ["RESULT_READY", "BUY_REQUEST_RECEIVED"]) {
    assert.ok(outbox.leaseCalls[1].excludeMessageTypes.includes(reserved), reserved);
  }
});

test("RESULT_READY delivery, fencing and success reporting are unchanged", async () => {
  const priceCheck = stubHandler({ messageType: "RESULT_READY", aggregateType: "price_check_result" });
  const row = outboxRow({ id: "result-1" });
  const outbox = fakeOutbox([row]);

  const result = await processNextNotification({}, {
    handlers: [priceCheck.handler],
    now: NOW,
    leaseOwner: "result-worker",
    outbox: outbox.operations,
  });

  assert.equal(result.status, "succeeded");
  assert.equal(result.notificationId, "result-1");
  assert.equal(result.providerMessageId, "provider-1");
  assert.deepEqual(priceCheck.invocations, ["result-1"]);
  assert.equal(row.leaseOwner, "result-worker");
  assert.equal(outbox.failCalls.length, 0);
});

test("delivery failure retries with sanitized codes and dead-letters at the attempt ceiling", async () => {
  const failures = [];
  const failing = {
    workflow: "price-check",
    messageType: "RESULT_READY",
    aggregateType: "price_check_result",
    async deliver() { throw new Error("POSTMARK 503 casey@example.com"); },
    async recordFailure(_db, message, failure) { failures.push({ id: message.id, ...failure }); },
  };

  const retryRow = outboxRow({ id: "retry-1", attemptCount: 1 });
  const retryOutbox = fakeOutbox([retryRow]);
  const retry = await processNextNotification({}, {
    handlers: [failing], now: NOW, leaseOwner: "w1", outbox: retryOutbox.operations,
  });
  assert.equal(retry.status, "retry");
  assert.equal(retry.code, "DELIVERY_FAILED", "provider text must not reach the persisted code");
  assert.equal(retryRow.state, "failed");
  // attemptCount is 2 after leasing, so the backoff is 2^2 minutes.
  assert.equal(retryOutbox.failCalls[0].nextAttemptAt.valueOf(), NOW.valueOf() + retryDelayMs(2));
  assert.equal(failures[0].deadLetter, false);

  const deadRow = outboxRow({ id: "dead-1", attemptCount: NOTIFICATION_MAX_ATTEMPTS });
  const deadOutbox = fakeOutbox([deadRow]);
  const dead = await processNextNotification({}, {
    handlers: [failing], now: NOW, leaseOwner: "w2", outbox: deadOutbox.operations,
  });
  assert.equal(dead.status, "dead_letter");
  assert.equal(deadRow.state, "dead_letter");
  assert.equal(failures[1].deadLetter, true);
});

test("truly unregistered and malformed messages dead-letter deterministically", async () => {
  const priceCheck = stubHandler({ messageType: "RESULT_READY", aggregateType: "price_check_result" });

  const unknownRow = outboxRow({ id: "unknown-1", messageType: "LEGACY_UNKNOWN", aggregateType: "mystery" });
  const unknownOutbox = fakeOutbox([unknownRow]);
  const unknown = await processNextNotification({}, {
    handlers: [priceCheck.handler], reservedMessageTypes: ["RESULT_READY"], now: NOW, leaseOwner: "w3", outbox: unknownOutbox.operations,
  });
  assert.equal(unknown.status, "dead_letter");
  assert.equal(unknown.code, "UNSUPPORTED_MESSAGE");
  assert.equal(unknownRow.state, "dead_letter");

  const malformedRow = outboxRow({ id: "malformed-1", messageType: "RESULT_READY", aggregateType: "price_check" });
  const malformedOutbox = fakeOutbox([malformedRow]);
  const malformed = await processNextNotification({}, {
    handlers: [priceCheck.handler], now: NOW, leaseOwner: "w4", outbox: malformedOutbox.operations,
  });
  assert.equal(malformed.status, "dead_letter");
  assert.equal(malformed.code, "UNSUPPORTED_MESSAGE");
  assert.deepEqual(priceCheck.invocations, []);
});

test("the shipped registry owns every notification type and exposes its reserved types", () => {
  // Buy Request, Sell Submission and buyer-offer delivery ship with their handlers
  // registered, so every marketplace message type is reserved before any
  // producer can enqueue it. Price Check's own claim on the shared outbox is
  // unchanged by either addition.
  assert.deepEqual(registeredNotificationTypes(), [
    "RESULT_READY",
    "BUY_REQUEST_VERIFY_EMAIL",
    "BUY_REQUEST_INTERNAL_RECEIVED",
    "SELL_SUBMISSION_VERIFY_EMAIL",
    "SELL_SUBMISSION_INTERNAL_RECEIVED",
    "SELL_SUBMISSION_EVIDENCE_REQUEST",
    "SELL_SUBMISSION_INVENTORY_FRESHNESS_CHECK",
    "BUYER_OFFER_TO_BUYER",
    "BUYER_OFFER_RESPONSE_INTERNAL",
  ]);
  assert.equal(civilonNotificationHandlers.length, 9);
  assert.equal(
    civilonNotificationHandlers.filter((handler) => handler.workflow === "price-check").length,
    1,
  );
  assert.equal(resultReadyNotificationHandler.messageType, "RESULT_READY");
  assert.equal(resultReadyNotificationHandler.aggregateType, "price_check_result");
  assert.equal(resultReadyNotificationHandler.workflow, "price-check");
  assert.equal(NOTIFICATION_MAX_ATTEMPTS, 5);
  assert.equal(retryDelayMs(0), 60_000);
  assert.equal(retryDelayMs(30), 60 * 60_000, "backoff stays capped at one hour");
});

test("only already-safe machine codes survive; arbitrary error text never persists", () => {
  // Known codes raised by Civilon code paths are preserved verbatim.
  for (const safe of ["POSTMARK_503", "POSTMARK_TIMEOUT", "RESULT_ORIGIN_INVALID", "UNSUPPORTED_MESSAGE", "DELIVERY_FAILED", "E42"]) {
    assert.equal(sanitizeFailureCode(new Error(safe)), safe, safe);
  }

  // Anything carrying identity, commercial values, punctuation or prose is discarded whole.
  const unsafe = [
    "POSTMARK 503 casey@example.com",
    "casey.buyer@example.com bounced",
    "Casey Buyer",
    "part number 101-384025-5 not found",
    "unit price 4200.00 USD rejected",
    "duplicate key value violates unique constraint \"price_checks_public_reference_uidx\"",
    "postmark_timeout",
    "POSTMARK-TIMEOUT",
    "POSTMARK TIMEOUT",
    "",
    " ",
    "A".repeat(65),
  ];
  for (const value of unsafe) {
    const code = sanitizeFailureCode(new Error(value));
    assert.equal(code, GENERIC_FAILURE_CODE, JSON.stringify(value));
    assert.match(code, /^[A-Z0-9_]{1,64}$/);
  }

  // Non-Error throwables carry no code at all.
  for (const thrown of ["not an error", 500, null, undefined, { message: "casey@example.com" }]) {
    assert.equal(sanitizeFailureCode(thrown), GENERIC_FAILURE_CODE);
  }
});

test("the outbox lease accepts explicit type filters and refuses an empty allowlist", async () => {
  const source = await readFile("db/price-check/repositories/outbox-repository.ts", "utf8");
  assert.match(source, /messageTypes\?: readonly string\[\]/);
  assert.match(source, /excludeMessageTypes\?: readonly string\[\]/);
  assert.match(source, /inArray\(notificationOutbox\.messageType/);
  assert.match(source, /notInArray\(notificationOutbox\.messageType/);
  assert.match(source, /if \(input\.messageTypes && input\.messageTypes\.length === 0\) return null;/);
});

test("general staff access is independent of the Price Check flag while Price Check stays gated", async () => {
  const source = await readFile("lib/price-check/admin/auth.ts", "utf8");
  const generalStart = source.indexOf("export async function getAdminAccess");
  const gatedStart = source.indexOf("export async function getPriceCheckAdminAccess");
  const requireStart = source.indexOf("export async function requireAdminApi");
  assert.ok(generalStart > 0 && gatedStart > generalStart && requireStart > gatedStart);

  const generalBody = source.slice(generalStart, gatedStart);
  const gatedBody = source.slice(gatedStart, requireStart);

  assert.doesNotMatch(generalBody, /isPriceCheckEnabled/, "general staff auth must not consult the Price Check flag");
  assert.match(generalBody, /ADMIN_SESSION_COOKIE/);
  assert.match(generalBody, /resolveAdminSession/);
  assert.match(generalBody, /status: "unavailable"/);

  assert.match(gatedBody, /if \(!isPriceCheckEnabled\(\)\) return \{ status: "disabled" \};/);
  assert.match(gatedBody, /return getAdminAccess\(\);/);
  // Existing Price Check API guards keep using the gated helper.
  assert.match(source.slice(requireStart), /await getPriceCheckAdminAccess\(\)/);
});

test("marketplace enablement fails closed and is independent of Price Check", () => {
  assert.equal(isMarketplaceEnabled({}), false);
  assert.equal(isMarketplaceEnabled({ NEXT_PUBLIC_MARKETPLACE_ENABLED: "false" }), false);
  assert.equal(isMarketplaceEnabled({ NEXT_PUBLIC_MARKETPLACE_ENABLED: "TRUE" }), false);
  assert.equal(isMarketplaceEnabled({ NEXT_PUBLIC_MARKETPLACE_ENABLED: " true " }), false);
  assert.equal(isMarketplaceEnabled({ NEXT_PUBLIC_MARKETPLACE_ENABLED: "true" }), true);
  assert.equal(isMarketplaceEnabled({ NEXT_PUBLIC_PRICE_CHECK_ENABLED: "true" }), false);
});

test("internal recipients default correctly, normalize, de-duplicate and fail closed", () => {
  const expectedDefaults = ["sales@cvlon.com", "hakan@shipnex.com", "david@cvlon.com"];
  assert.deepEqual(getMarketplaceInternalRecipients({}), expectedDefaults);
  assert.deepEqual([...defaultMarketplaceInternalRecipients], expectedDefaults);
  assert.deepEqual(getMarketplaceInternalRecipients({ MARKETPLACE_INTERNAL_RECIPIENTS: "   " }), expectedDefaults);
  assert.deepEqual(
    getMarketplaceInternalRecipients({ MARKETPLACE_INTERNAL_RECIPIENTS: " Ops@CVLON.com , ops@cvlon.com;desk@cvlon.com " }),
    ["ops@cvlon.com", "desk@cvlon.com"],
  );
  for (const invalid of ["not-an-email", "a@b", "a@b.com, broken", "@cvlon.com", "ops@cvlon.com extra", ","]) {
    assert.throws(
      () => getMarketplaceInternalRecipients({ MARKETPLACE_INTERNAL_RECIPIENTS: invalid }),
      /MARKETPLACE_INTERNAL_RECIPIENTS_INVALID/,
      invalid,
    );
  }
});

test("public references keep the PC format and add only approved BR and SS prefixes", () => {
  const entropy = new Uint8Array(7).fill(11);
  // Legacy Price Check call shapes are unchanged.
  assert.match(generatePublicReference(), /^PC-[0-9A-HJKMNP-TV-Z]{10}$/);
  assert.match(generatePublicReference(entropy), /^PC-[0-9A-HJKMNP-TV-Z]{10}$/);
  assert.equal(generatePublicReference(entropy), generatePublicReference("PC", entropy));
  // Prefix-first shapes for the future Buy and Sell references.
  assert.match(generatePublicReference("BR"), /^BR-[0-9A-HJKMNP-TV-Z]{10}$/);
  assert.match(generatePublicReference("SS"), /^SS-[0-9A-HJKMNP-TV-Z]{10}$/);
  assert.match(generatePublicReference("BR", entropy), /^BR-[0-9A-HJKMNP-TV-Z]{10}$/);
  assert.match(generatePublicReference("SS", entropy), /^SS-[0-9A-HJKMNP-TV-Z]{10}$/);
  // The random suffix must not vary with the prefix.
  const suffix = generatePublicReference(entropy).slice(3);
  assert.equal(generatePublicReference("BR", entropy).slice(3), suffix);
  assert.equal(generatePublicReference("SS", entropy).slice(3), suffix);
  assert.deepEqual([...publicReferencePrefixes], ["PC", "BR", "SS"]);

  for (const rejected of ["XX", "pc", "", "PC-", "DROP TABLE", 7, null, {}]) {
    assert.equal(isPublicReferencePrefix(rejected), false, String(rejected));
    assert.throws(() => generatePublicReference(rejected), /approved Civilon prefix/, String(rejected));
    assert.throws(() => generatePublicReference(rejected, entropy), /approved Civilon prefix/, String(rejected));
  }
  // Ambiguous or malformed argument shapes are rejected rather than guessed.
  assert.throws(() => generatePublicReference(entropy, entropy), /supplied twice/);
  assert.throws(() => generatePublicReference("BR", "not-entropy"), /must be a Uint8Array/);
  assert.throws(() => generatePublicReference("BR", new Uint8Array(6)), /at least 7 bytes/);
  assert.throws(() => generatePublicReference(new Uint8Array(6)), /at least 7 bytes/);
});

test("the scheduled drain may run for either workflow without enabling the other", async () => {
  const fn = await readFile("netlify/functions/process-price-check-notifications.ts", "utf8");
  assert.match(fn, /CONTEXT !== "production"/);
  assert.match(fn, /NEXT_PUBLIC_PRICE_CHECK_ENABLED !== "true"/);
  assert.match(fn, /isMarketplaceEnabled\(\)/);
  assert.match(fn, /priceCheckDisabled && marketplaceDisabled/);
  assert.match(fn, /processOneResultNotification/);
  assert.match(fn, /schedule: "\* \* \* \* \*"/);
});
