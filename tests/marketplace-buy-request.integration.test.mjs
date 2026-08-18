import assert from "node:assert/strict";
import test from "node:test";

import { NetlifyDB } from "@netlify/database-dev";

import { expectedMigrationCount, migrationsDirectory } from "./helpers/migration-archive.mjs";

const TOKEN_KEY = "civilon-marketplace-verify-token-key-for-tests";
const APPROVED_ORIGIN = "https://deploy-preview-1--cvlon.netlify.app";

/**
 * A real disposable Postgres from `@netlify/database-dev`, migrated from empty,
 * exactly as every Price Check integration suite does. Nothing here reaches a
 * preview or production database, and no mail leaves the process: every drain
 * is handed an in-memory provider.
 */
async function withDatabase(run) {
  const server = new NetlifyDB({ logger: () => undefined });
  const connectionString = await server.start();
  process.env.NETLIFY_DB_URL = connectionString;
  process.env.NETLIFY_DB_DRIVER = "server";
  process.env.MARKETPLACE_VERIFY_TOKEN_KEY = TOKEN_KEY;
  process.env.URL = APPROVED_ORIGIN;
  delete process.env.DEPLOY_PRIME_URL;
  delete process.env.MARKETPLACE_EMAIL_FROM;
  delete process.env.MARKETPLACE_INTERNAL_RECIPIENTS;
  try {
    const applied = await server.applyMigrations(migrationsDirectory);
    const schema = await import("../db/price-check/schema.ts");
    const { drizzle } = await import("drizzle-orm/netlify-db");
    const db = drizzle({ schema });
    await run({ db, schema, applied });
    await db.$client.end();
  } finally {
    delete process.env.NETLIFY_DB_URL;
    delete process.env.NETLIFY_DB_DRIVER;
    delete process.env.MARKETPLACE_VERIFY_TOKEN_KEY;
    delete process.env.URL;
    await server.stop();
  }
}

function submissionPayload(overrides = {}) {
  return {
    idempotencyKey: "3f1a2b4c-5d6e-4f70-8123-456789abcdef",
    partNumber: "101-384025-5",
    quantity: "2",
    acceptableCondition: "ANY",
    urgency: "aog",
    phone: "+1 909 555 0123",
    fulfillmentPreference: "door_delivery",
    deliveryCountry: "US",
    deliveryPostalCode: "07632",
    firstName: "Dana",
    lastName: "Ruiz",
    companyName: "Example Aviation Group",
    businessEmail: "Dana.Ruiz@Example.com",
    serviceAcknowledged: true,
    legalAcknowledged: true,
    sourcePage: "/buy-sell-aircraft-parts/buy",
    ...overrides,
  };
}

async function submit(db, overrides = {}) {
  const { validateBuyRequestSubmission } = await import("../lib/marketplace/validation.ts");
  const { submitBuyRequest } = await import("../lib/marketplace/submission-service.ts");
  const validation = validateBuyRequestSubmission(submissionPayload(overrides));
  assert.equal(validation.success, true, JSON.stringify(validation.fieldErrors));
  return submitBuyRequest(db, validation.data);
}

/** Records what would have been sent. No network, no Postmark token, no mail. */
function recordingProvider(behaviour = () => undefined) {
  const sent = [];
  let calls = 0;
  return {
    sent,
    provider: {
      async send(message) {
        calls += 1;
        const failure = behaviour(calls, message);
        if (failure) throw failure;
        sent.push(message);
        return { providerMessageId: `test-message-${calls}`, submittedAt: new Date().toISOString() };
      },
    },
  };
}

async function drain(db, provider, now) {
  const { processNextNotification } = await import("../lib/notifications/outbox-worker.ts");
  const { civilonNotificationHandlers } = await import("../lib/notifications/registry.ts");
  return processNextNotification(db, {
    handlers: civilonNotificationHandlers,
    provider,
    now,
    leaseOwner: `marketplace-test-worker-${now.valueOf()}`,
  });
}

test("a Buy Request persists contact, request, token, audit and both notifications atomically", async () => {
  await withDatabase(async ({ db, schema, applied }) => {
    const { eq } = await import("drizzle-orm");
    assert.equal(applied.length, expectedMigrationCount());

    const result = await submit(db);
    assert.equal(result.created, true);
    assert.match(result.reference, /^BR-[0-9A-HJKMNP-TV-Z]{10}$/);

    const [request] = await db.select().from(schema.buyRequests);
    assert.equal(request.publicReference, result.reference);
    assert.equal(request.status, "pending_verification");
    assert.equal(request.verifiedAt, null);
    assert.ok(request.verificationRequestedAt);
    assert.equal(request.originalPartNumber, "101-384025-5");
    assert.equal(request.normalizedPartNumber, "101384025 5".replace(" ", ""));
    assert.equal(request.quantity, "2.000");
    assert.equal(request.acceptableCondition, "ANY");
    assert.equal(request.urgency, "aog");
    assert.equal(request.sourcePage, "/buy-sell-aircraft-parts/buy");
    assert.equal(request.idempotencyHash.length, 64);

    const [contact] = await db.select().from(schema.marketplaceContacts);
    assert.equal(contact.id, request.contactId);
    assert.equal(contact.businessEmail, "Dana.Ruiz@Example.com");
    assert.equal(contact.normalizedEmail, "dana.ruiz@example.com");
    assert.equal(contact.verificationState, "PENDING");
    assert.equal(contact.verifiedAt, null);
    assert.equal(contact.actsAsBuyer, true);
    assert.equal(contact.actsAsSeller, false);
    assert.ok(contact.serviceProcessingAcknowledgedAt);

    const tokens = await db.select().from(schema.emailVerificationTokens);
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].aggregateType, "buy_request");
    assert.equal(tokens[0].aggregateId, request.id);
    assert.equal(tokens[0].buyRequestId, request.id);
    assert.equal(tokens[0].sellSubmissionId, null);
    assert.equal(tokens[0].contactId, contact.id);
    assert.equal(tokens[0].purpose, "BUY_REQUEST_CONTACT");
    assert.equal(tokens[0].consumedAt, null);
    assert.equal(tokens[0].revokedAt, null);
    assert.equal(tokens[0].attemptCount, 0);
    assert.match(tokens[0].keyedTokenHash, /^[a-f0-9]{64}$/);
    assert.match(tokens[0].tokenDerivationNonce, /^[a-f0-9]{64}$/);

    // No column may hold anything replayable: the credential derived from the
    // stored nonce must appear nowhere in the persisted row.
    const { deriveVerificationToken } = await import("../lib/marketplace/verification.ts");
    const credential = deriveVerificationToken(TOKEN_KEY, tokens[0].tokenDerivationNonce);
    assert.equal(JSON.stringify(tokens[0]).includes(credential), false);

    const audits = await db.select().from(schema.auditEvents)
      .where(eq(schema.auditEvents.aggregateId, request.id));
    const actions = audits.map((event) => event.action).sort();
    assert.deepEqual(actions, [
      "BUY_REQUEST_LEGAL_ACKNOWLEDGED",
      "BUY_REQUEST_SUBMITTED",
      "BUY_REQUEST_VERIFICATION_TOKEN_ISSUED",
    ]);
    assert.ok(audits.every((event) => event.aggregateType === "buy_request"));
    const auditText = JSON.stringify(audits);
    for (const secret of ["101-384025-5", "Dana", "dana.ruiz@example.com", "909 555"]) {
      assert.equal(auditText.includes(secret), false, `audit metadata must not contain ${secret}`);
    }

    const messages = await db.select().from(schema.notificationOutbox);
    assert.equal(messages.length, 2);
    assert.deepEqual(messages.map((message) => message.messageType).sort(), [
      "BUY_REQUEST_INTERNAL_RECEIVED",
      "BUY_REQUEST_VERIFY_EMAIL",
    ]);
    assert.ok(messages.every((message) => message.aggregateType === "buy_request"));
    assert.ok(messages.every((message) => message.aggregateId === request.id));
    assert.ok(messages.every((message) => message.state === "pending"));
    const verify = messages.find((message) => message.messageType === "BUY_REQUEST_VERIFY_EMAIL");
    const internal = messages.find((message) => message.messageType === "BUY_REQUEST_INTERNAL_RECEIVED");
    assert.equal(verify.recipientReference, contact.id, "the customer message routes by contact id, not address");
    assert.equal(internal.recipientReference, "civilon-marketplace-internal");
  });
});

test("a rolled-back Buy Request leaves no partial contact, token or notification", async () => {
  await withDatabase(async ({ db, schema }) => {
    const { createBuyRequest } = await import("../db/price-check/repositories/buy-request-repository.ts");
    await assert.rejects(createBuyRequest(db, {
      contact: {
        firstName: "Dana",
        lastName: "Ruiz",
        companyName: "Example Aviation Group",
        businessEmail: "dana.ruiz@example.com",
        serviceProcessingAcknowledgedAt: new Date(),
      },
      request: {
        originalPartNumber: "101-384025-5",
        quantity: "1",
        acceptableCondition: "NOT_SURE",
        urgency: "not_sure",
        fulfillmentPreference: "not_sure",
      },
      attribution: { sourcePage: "/buy-sell-aircraft-parts/buy" },
      legalAcknowledgment: { acknowledgedAt: new Date(), privacyVersion: "p", termsVersion: "t" },
      verificationToken: {
        keyedTokenHash: "a".repeat(64),
        tokenDerivationNonce: "b".repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
      },
      idempotencyHash: "c".repeat(64),
      correlationId: "correlation",
      // Refused by buy_requests_public_reference_chk, so the whole write aborts.
      publicReference: "NOT-A-REFERENCE",
    }));

    assert.equal((await db.select().from(schema.marketplaceContacts)).length, 0);
    assert.equal((await db.select().from(schema.buyRequests)).length, 0);
    assert.equal((await db.select().from(schema.emailVerificationTokens)).length, 0);
    assert.equal((await db.select().from(schema.notificationOutbox)).length, 0);
    assert.equal((await db.select().from(schema.auditEvents)).length, 0);
  });
});

test("a repeated submission returns the same reference and enqueues no second email", async () => {
  await withDatabase(async ({ db, schema }) => {
    const first = await submit(db);
    const repeat = await submit(db);

    assert.equal(first.created, true);
    assert.equal(repeat.created, false);
    assert.equal(repeat.reference, first.reference);
    assert.equal((await db.select().from(schema.buyRequests)).length, 1);
    assert.equal((await db.select().from(schema.marketplaceContacts)).length, 1);
    assert.equal((await db.select().from(schema.emailVerificationTokens)).length, 1);
    assert.equal((await db.select().from(schema.notificationOutbox)).length, 2);

    // A genuinely different request still gets its own reference and its own pair.
    const other = await submit(db, { idempotencyKey: "4f1a2b4c-5d6e-4f70-8123-456789abcdef" });
    assert.equal(other.created, true);
    assert.notEqual(other.reference, first.reference);
    assert.equal((await db.select().from(schema.notificationOutbox)).length, 4);
  });
});

test("both message types drain through the shared registry, privacy-minimized", async () => {
  await withDatabase(async ({ db, schema }) => {
    const submitted = await submit(db);
    const recorder = recordingProvider();
    const now = new Date();

    const first = await drain(db, recorder.provider, now);
    const second = await drain(db, recorder.provider, now);
    const third = await drain(db, recorder.provider, now);

    assert.equal(first.status, "succeeded");
    assert.equal(second.status, "succeeded");
    assert.equal(third.status, "idle", "the outbox must be empty once both messages are sent");

    const messages = await db.select().from(schema.notificationOutbox);
    assert.ok(messages.every((message) => message.state === "succeeded"), JSON.stringify(messages));
    assert.ok(messages.every((message) => message.sentAt));
    assert.ok(messages.every((message) => message.sanitizedFailureCode === null));

    assert.equal(recorder.sent.length, 2);
    const verify = recorder.sent.find((mail) => mail.tag === "civilon-buy-request-verify");
    const internal = recorder.sent.find((mail) => mail.tag === "civilon-buy-request-internal");
    assert.ok(verify && internal);

    assert.equal(verify.from, "Civilon Parts <parts@cvlon.com>");
    assert.equal(verify.to, "Dana.Ruiz@Example.com");
    assert.ok(verify.textBody.includes(submitted.reference));
    // The credential travels in the fragment, so it never reaches the server,
    // an access log, or a Referer header.
    assert.ok(verify.textBody.includes(`${APPROVED_ORIGIN}/buy-sell-aircraft-parts/verify#token=`));
    assert.equal(/verify?token=/.test(verify.textBody), false);
    assert.equal(/verify?token=/.test(verify.htmlBody), false);

    assert.equal(internal.to, "sales@cvlon.com, hakan@shipnex.com, david@cvlon.com");
    assert.ok(internal.textBody.includes(submitted.reference));
    assert.ok(internal.textBody.includes("pending_verification"));
    // The console link is bound to the stored record, so the notice opens the
    // exact Buy Request rather than a shared queue.
    const [storedRequest] = await db.select().from(schema.buyRequests);
    assert.ok(internal.textBody.includes(`${APPROVED_ORIGIN}/admin/buy-requests/${storedRequest.id}`));
    assert.equal(internal.textBody.includes("/admin/price-checks"), false);

    const [token] = await db.select().from(schema.emailVerificationTokens);
    const { deriveVerificationToken } = await import("../lib/marketplace/verification.ts");
    const credential = deriveVerificationToken(TOKEN_KEY, token.tokenDerivationNonce);
    assert.ok(verify.textBody.includes(credential), "the customer link carries the live credential");

    for (const mail of recorder.sent) {
      const surface = [mail.subject, mail.textBody, mail.htmlBody, mail.tag, JSON.stringify(mail.metadata)].join("\n");
      for (const secret of ["101-384025-5", "101384025", "Dana", "Ruiz", "Example Aviation Group", "909 555 0123", "07632"]) {
        assert.equal(surface.includes(secret), false, `${mail.tag} must not contain ${secret}`);
      }
    }
    // The internal notice never carries the customer's address, only the reference.
    const internalSurface = `${internal.subject}\n${internal.textBody}\n${internal.htmlBody}\n${JSON.stringify(internal.metadata)}`;
    assert.equal(/example\.com/i.test(internalSurface), false);
    assert.equal(internalSurface.includes(credential), false);
  });
});

test("a provider outage retries and never removes the Buy Request", async () => {
  await withDatabase(async ({ db, schema }) => {
    const submitted = await submit(db);
    const failing = recordingProvider(() => new Error("POSTMARK_503"));
    const start = new Date();

    const attempt = await drain(db, failing.provider, start);
    assert.equal(attempt.status, "retry");
    assert.equal(attempt.code, "POSTMARK_503");
    assert.equal(failing.sent.length, 0);

    // The request, its contact, its token and both messages all survive intact.
    const [request] = await db.select().from(schema.buyRequests);
    assert.equal(request.publicReference, submitted.reference);
    assert.equal(request.status, "pending_verification");
    assert.equal((await db.select().from(schema.marketplaceContacts))[0].verificationState, "PENDING");
    assert.equal((await db.select().from(schema.emailVerificationTokens)).length, 1);

    const messages = await db.select().from(schema.notificationOutbox);
    assert.equal(messages.length, 2);
    const failed = messages.find((message) => message.state === "failed");
    assert.ok(failed, "the attempted message is retryable, not lost");
    assert.equal(failed.sanitizedFailureCode, "POSTMARK_503");
    assert.ok(failed.nextAttemptAt > start, "a retry is scheduled with backoff");
    assert.equal(failed.leaseOwner, null, "the lease is released for the next worker");
    assert.equal(messages.filter((message) => message.state === "dead_letter").length, 0);

    const { eq } = await import("drizzle-orm");
    const failures = (await db.select().from(schema.auditEvents)
      .where(eq(schema.auditEvents.aggregateId, request.id)))
      .filter((event) => event.action === "BUY_REQUEST_NOTIFICATION_FAILED");
    assert.equal(failures.length, 1);
    assert.equal(failures[0].sanitizedMetadata.code, "POSTMARK_503");
    assert.equal(failures[0].sanitizedMetadata.deadLetter, false);

    // Once the provider recovers, both messages deliver on the normal schedule.
    const recovered = recordingProvider();
    const later = new Date(start.valueOf() + 10 * 60_000);
    await drain(db, recovered.provider, later);
    await drain(db, recovered.provider, later);
    const settled = await db.select().from(schema.notificationOutbox);
    assert.ok(settled.every((message) => message.state === "succeeded"), JSON.stringify(settled));
    assert.equal(recovered.sent.length, 2);
  });
});

test("verification consumes once, activates the exact request and contact, and repeats neutrally", async () => {
  await withDatabase(async ({ db, schema }) => {
    const { eq } = await import("drizzle-orm");
    const { deriveVerificationToken } = await import("../lib/marketplace/verification.ts");
    const { verifyBuyRequestContact } = await import("../lib/marketplace/verification-service.ts");

    const target = await submit(db);
    // A second, untouched Buy Request proves activation is scoped to one aggregate.
    const bystander = await submit(db, {
      idempotencyKey: "5f1a2b4c-5d6e-4f70-8123-456789abcdef",
      businessEmail: "other.buyer@example.com",
    });

    const [request] = await db.select().from(schema.buyRequests)
      .where(eq(schema.buyRequests.publicReference, target.reference));
    const [token] = await db.select().from(schema.emailVerificationTokens)
      .where(eq(schema.emailVerificationTokens.buyRequestId, request.id));
    const credential = deriveVerificationToken(TOKEN_KEY, token.tokenDerivationNonce);

    const verified = await verifyBuyRequestContact(db, { token: credential });
    assert.deepEqual(verified, { outcome: "verified", reference: target.reference });

    const [activated] = await db.select().from(schema.buyRequests)
      .where(eq(schema.buyRequests.id, request.id));
    assert.equal(activated.status, "verified");
    assert.ok(activated.verifiedAt);
    assert.ok(activated.verifiedAt >= activated.submittedAt);

    const [contact] = await db.select().from(schema.marketplaceContacts)
      .where(eq(schema.marketplaceContacts.id, request.contactId));
    assert.equal(contact.verificationState, "VERIFIED");
    assert.ok(contact.verifiedAt >= contact.verificationRequestedAt);
    assert.equal(contact.actsAsBuyer, true);

    const [consumed] = await db.select().from(schema.emailVerificationTokens)
      .where(eq(schema.emailVerificationTokens.id, token.id));
    assert.ok(consumed.consumedAt, "the credential is spent");
    assert.equal(consumed.revokedAt, null);
    assert.equal(consumed.attemptCount, 1);

    // Nothing else moved.
    const [untouched] = await db.select().from(schema.buyRequests)
      .where(eq(schema.buyRequests.publicReference, bystander.reference));
    assert.equal(untouched.status, "pending_verification");
    assert.equal(untouched.verifiedAt, null);
    const [untouchedContact] = await db.select().from(schema.marketplaceContacts)
      .where(eq(schema.marketplaceContacts.id, untouched.contactId));
    assert.equal(untouchedContact.verificationState, "PENDING");

    // A repeat click by the legitimate holder is neutral, not an error, and does
    // not re-run activation.
    const repeat = await verifyBuyRequestContact(db, { token: credential });
    assert.deepEqual(repeat, { outcome: "already_verified", reference: target.reference });
    const [afterRepeat] = await db.select().from(schema.emailVerificationTokens)
      .where(eq(schema.emailVerificationTokens.id, token.id));
    assert.equal(afterRepeat.attemptCount, 1, "a neutral repeat must not burn an attempt");
    assert.equal(afterRepeat.consumedAt.valueOf(), consumed.consumedAt.valueOf());

    const verifications = (await db.select().from(schema.auditEvents)
      .where(eq(schema.auditEvents.aggregateId, request.id)))
      .filter((event) => event.action === "BUY_REQUEST_CONTACT_VERIFIED");
    assert.equal(verifications.length, 1, "activation is audited exactly once");
  });
});

test("unknown, foreign-key, expired and exhausted credentials are all opaque", async () => {
  await withDatabase(async ({ db, schema }) => {
    const { eq } = await import("drizzle-orm");
    const { deriveVerificationToken, newVerificationNonce } = await import("../lib/marketplace/verification.ts");
    const { verifyBuyRequestContact } = await import("../lib/marketplace/verification-service.ts");

    await submit(db);
    const [request] = await db.select().from(schema.buyRequests);
    const [token] = await db.select().from(schema.emailVerificationTokens);

    // A well-formed credential that was never issued reveals nothing.
    const unissued = deriveVerificationToken(TOKEN_KEY, newVerificationNonce());
    assert.deepEqual(await verifyBuyRequestContact(db, { token: unissued }), { outcome: "unavailable" });

    // The right nonce under the wrong key is equally useless: the stored value
    // is keyed, so an attacker who reads the database still cannot mint a link.
    const forged = deriveVerificationToken(`${TOKEN_KEY}-attacker`, token.tokenDerivationNonce);
    assert.deepEqual(await verifyBuyRequestContact(db, { token: forged }), { outcome: "unavailable" });

    const [stillPending] = await db.select().from(schema.buyRequests);
    assert.equal(stillPending.status, "pending_verification");

    // Expiry closes the window and revokes rather than lingering as a live token.
    const credential = deriveVerificationToken(TOKEN_KEY, token.tokenDerivationNonce);
    const afterExpiry = new Date(token.expiresAt.valueOf() + 1000);
    assert.deepEqual(
      await verifyBuyRequestContact(db, { token: credential, now: afterExpiry }),
      { outcome: "unavailable" },
    );
    const [expired] = await db.select().from(schema.emailVerificationTokens)
      .where(eq(schema.emailVerificationTokens.id, token.id));
    assert.ok(expired.revokedAt);
    assert.equal(expired.consumedAt, null);
    assert.equal((await db.select().from(schema.buyRequests))[0].status, "pending_verification");

    // A revoked credential stays dead even inside its original window.
    assert.deepEqual(await verifyBuyRequestContact(db, { token: credential }), { outcome: "unavailable" });
    assert.equal(request.status, "pending_verification");
  });
});

test("a closed Buy Request is never resurrected by a late verification click", async () => {
  await withDatabase(async ({ db, schema }) => {
    const { eq } = await import("drizzle-orm");
    const { deriveVerificationToken } = await import("../lib/marketplace/verification.ts");
    const { verifyBuyRequestContact } = await import("../lib/marketplace/verification-service.ts");

    await submit(db);
    const [request] = await db.select().from(schema.buyRequests);
    const [token] = await db.select().from(schema.emailVerificationTokens);
    const credential = deriveVerificationToken(TOKEN_KEY, token.tokenDerivationNonce);

    await db.update(schema.buyRequests)
      .set({ status: "spam", closedAt: new Date() })
      .where(eq(schema.buyRequests.id, request.id));

    assert.deepEqual(await verifyBuyRequestContact(db, { token: credential }), { outcome: "unavailable" });
    const [after] = await db.select().from(schema.buyRequests);
    assert.equal(after.status, "spam");
    assert.equal(after.verifiedAt, null);
    const [contact] = await db.select().from(schema.marketplaceContacts);
    assert.equal(contact.verificationState, "PENDING");
    const [revoked] = await db.select().from(schema.emailVerificationTokens);
    assert.ok(revoked.revokedAt);
  });
});

test("Price Check submission is unaffected by the marketplace intake", async () => {
  await withDatabase(async ({ db, schema }) => {
    const { validatePriceCheckSubmission } = await import("../lib/price-check/validation.ts");
    const { submitPriceCheck } = await import("../lib/price-check/submission-service.ts");
    const validation = validatePriceCheckSubmission({
      idempotencyKey: "6f1a2b4c-5d6e-4f70-8123-456789abcdef",
      partNumber: "101-384025-5",
      quantity: "1",
      quoteOrPurchased: "quote",
      transactionType: "outright",
      conditionCode: "SV",
      unitPrice: "1100.00",
      currencyCode: "USD",
      aog: false,
      documentationCodes: [],
      firstName: "Dana",
      lastName: "Ruiz",
      companyName: "Example Aviation Group",
      businessEmail: "dana.ruiz@example.com",
      serviceAcknowledged: true,
      legalAcknowledged: true,
      sourcePage: "/price-check",
    });
    assert.equal(validation.success, true, JSON.stringify(validation.fieldErrors));

    await submit(db);
    const priceCheck = await submitPriceCheck(db, validation.data);
    assert.match(priceCheck.reference, /^PC-[0-9A-HJKMNP-TV-Z]{10}$/);
    assert.equal((await db.select().from(schema.priceChecks)).length, 1);
    assert.equal((await db.select().from(schema.buyRequests)).length, 1);
    // Each workflow owns its own outbox rows; the Price Check submission adds none.
    const messages = await db.select().from(schema.notificationOutbox);
    assert.equal(messages.length, 2);
    assert.ok(messages.every((message) => message.aggregateType === "buy_request"));
  });
});
