import assert from "node:assert/strict";
import test from "node:test";

import { NetlifyDB } from "@netlify/database-dev";

import { expectedMigrationCount, migrationsDirectory } from "./helpers/migration-archive.mjs";

const TOKEN_KEY = "civilon-marketplace-verify-token-key-for-tests";
const APPROVED_ORIGIN = "https://deploy-preview-1--cvlon.netlify.app";
const SOURCE_PAGE = "/buy-sell-aircraft-parts/sell";

/**
 * A real disposable Postgres from `@netlify/database-dev`, migrated from empty,
 * exactly as every Price Check and Buy Request integration suite does. Nothing
 * here reaches a preview or production database, and no mail leaves the
 * process: every drain is handed an in-memory provider.
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

function singlePartPayload(overrides = {}) {
  return {
    idempotencyKey: "3f1a2b4c-5d6e-4f70-8123-456789abcdef",
    submissionKind: "single_part",
    partNumber: "101-384025-5",
    description: "Bleed air valve, removed serviceable.",
    quantity: "3",
    conditionCode: "SV",
    phone: "+1 909 555 0123",
    locationCountry: "de",
    locationStateRegion: "Hessen",
    locationCity: "Frankfurt",
    locationPostalCode: "60311",
    firstName: "Sam",
    lastName: "Okafor",
    companyName: "Example Component Supply",
    businessEmail: "Sam.Okafor@Example.com",
    serviceAcknowledged: true,
    legalAcknowledged: true,
    sourcePage: SOURCE_PAGE,
    ...overrides,
  };
}

function bulkPayload(overrides = {}) {
  return {
    idempotencyKey: "7c1a2b4c-5d6e-4f70-8123-456789abcdef",
    submissionKind: "bulk_inventory",
    description: "Mixed rotable inventory across two warehouses.",
    estimatedLineItemCount: 1400,
    firstName: "Sam",
    lastName: "Okafor",
    companyName: "Example Component Supply",
    businessEmail: "sam.okafor@example.com",
    serviceAcknowledged: true,
    legalAcknowledged: true,
    sourcePage: SOURCE_PAGE,
    ...overrides,
  };
}

async function submit(db, payload) {
  const { validateSellSubmission } = await import("../lib/marketplace/sell-validation.ts");
  const { submitSellSubmission } = await import("../lib/marketplace/sell-submission-service.ts");
  const validation = validateSellSubmission(payload);
  assert.equal(validation.success, true, JSON.stringify(validation.fieldErrors));
  return submitSellSubmission(db, validation.data);
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
    leaseOwner: `sell-test-worker-${now.valueOf()}`,
  });
}

async function liveCredential(db, schema) {
  const { deriveSellVerificationToken } = await import("../lib/marketplace/verification.ts");
  const [token] = await db.select().from(schema.emailVerificationTokens);
  return { token, credential: deriveSellVerificationToken(TOKEN_KEY, token.tokenDerivationNonce) };
}

test("a Sell Submission persists seller contact, submission, token, audit and both notifications atomically", async () => {
  await withDatabase(async ({ db, schema, applied }) => {
    const { eq } = await import("drizzle-orm");
    assert.equal(applied.length, expectedMigrationCount());

    const result = await submit(db, singlePartPayload({
      quoteOnRequest: false,
      askingUnitPrice: "1200.5",
      currencyCode: "eur",
      canShipToNewJersey: true,
    }));
    assert.equal(result.created, true);
    assert.match(result.reference, /^SS-[0-9A-HJKMNP-TV-Z]{10}$/);

    const [submission] = await db.select().from(schema.sellSubmissions);
    assert.equal(submission.publicReference, result.reference);
    assert.equal(submission.status, "pending_verification");
    assert.equal(submission.verifiedAt, null);
    assert.ok(submission.verificationRequestedAt);
    assert.equal(submission.submissionKind, "single_part");
    assert.equal(submission.originalPartNumber, "101-384025-5");
    assert.equal(submission.normalizedPartNumber, "1013840255");
    assert.equal(submission.quantity, "3.000");
    assert.equal(submission.conditionCode, "SV");
    assert.equal(submission.quoteOnRequest, false);
    assert.equal(submission.askingUnitPrice, "1200.50");
    assert.equal(submission.currencyCode, "EUR");
    assert.equal(submission.canShipToNewJersey, true);
    assert.equal(submission.locationCountry, "DE");
    assert.equal(submission.estimatedLineItemCount, null);
    assert.equal(submission.documentsSummary, null, "no upload slice, so nothing to summarize");
    assert.equal(submission.assignedAdminUserId, null);
    assert.equal(submission.closedAt, null);
    assert.equal(submission.sourcePage, SOURCE_PAGE);
    assert.equal(submission.idempotencyHash.length, 64);

    // The seller contact is its own row with the seller role — never a shared
    // buyer record, and never flagged as acting for the buy side.
    const [contact] = await db.select().from(schema.marketplaceContacts);
    assert.equal(contact.id, submission.contactId);
    assert.equal(contact.businessEmail, "Sam.Okafor@Example.com");
    assert.equal(contact.normalizedEmail, "sam.okafor@example.com");
    assert.equal(contact.role, "seller");
    assert.equal(contact.actsAsSeller, true);
    assert.equal(contact.actsAsBuyer, false);
    assert.equal(contact.verificationState, "PENDING");
    assert.equal(contact.verifiedAt, null);
    assert.ok(contact.serviceProcessingAcknowledgedAt);

    const tokens = await db.select().from(schema.emailVerificationTokens);
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].aggregateType, "sell_submission");
    assert.equal(tokens[0].aggregateId, submission.id);
    assert.equal(tokens[0].sellSubmissionId, submission.id);
    assert.equal(tokens[0].buyRequestId, null);
    assert.equal(tokens[0].contactId, contact.id);
    assert.equal(tokens[0].purpose, "SELL_SUBMISSION_CONTACT");
    assert.equal(tokens[0].consumedAt, null);
    assert.equal(tokens[0].revokedAt, null);
    assert.equal(tokens[0].attemptCount, 0);
    assert.match(tokens[0].keyedTokenHash, /^[a-f0-9]{64}$/);

    // No column may hold anything replayable: the credential derived from the
    // stored nonce must appear nowhere in the persisted row.
    const { credential } = await liveCredential(db, schema);
    assert.equal(JSON.stringify(tokens[0]).includes(credential), false);

    const audits = await db.select().from(schema.auditEvents)
      .where(eq(schema.auditEvents.aggregateId, submission.id));
    assert.deepEqual(audits.map((event) => event.action).sort(), [
      "SELL_SUBMISSION_LEGAL_ACKNOWLEDGED",
      "SELL_SUBMISSION_SUBMITTED",
      "SELL_SUBMISSION_VERIFICATION_TOKEN_ISSUED",
    ]);
    assert.ok(audits.every((event) => event.aggregateType === "sell_submission"));
    const auditText = JSON.stringify(audits);
    for (const secret of ["101-384025-5", "1013840255", "Sam", "Okafor", "sam.okafor@example.com", "909 555", "1200.50", "Frankfurt", "60311"]) {
      assert.equal(auditText.includes(secret), false, `audit metadata must not contain ${secret}`);
    }

    const messages = await db.select().from(schema.notificationOutbox);
    assert.equal(messages.length, 2);
    assert.deepEqual(messages.map((message) => message.messageType).sort(), [
      "SELL_SUBMISSION_INTERNAL_RECEIVED",
      "SELL_SUBMISSION_VERIFY_EMAIL",
    ]);
    assert.ok(messages.every((message) => message.aggregateType === "sell_submission"));
    assert.ok(messages.every((message) => message.aggregateId === submission.id));
    assert.ok(messages.every((message) => message.state === "pending"));
    const verify = messages.find((message) => message.messageType === "SELL_SUBMISSION_VERIFY_EMAIL");
    const internal = messages.find((message) => message.messageType === "SELL_SUBMISSION_INTERNAL_RECEIVED");
    assert.equal(verify.recipientReference, contact.id, "the supplier message routes by contact id, not address");
    assert.equal(internal.recipientReference, "civilon-marketplace-internal");
  });
});

test("a bulk inventory submission stores no part number, quantity or price", async () => {
  await withDatabase(async ({ db, schema }) => {
    const result = await submit(db, bulkPayload());
    assert.equal(result.created, true);

    const [submission] = await db.select().from(schema.sellSubmissions);
    assert.equal(submission.submissionKind, "bulk_inventory");
    assert.equal(submission.originalPartNumber, null);
    assert.equal(submission.normalizedPartNumber, null);
    assert.equal(submission.quantity, null);
    assert.equal(submission.askingUnitPrice, null);
    assert.equal(submission.currencyCode, null);
    assert.equal(submission.conditionCode, null);
    assert.equal(submission.quoteOnRequest, true);
    assert.equal(submission.estimatedLineItemCount, 1400);
    assert.ok(submission.description.includes("Mixed rotable inventory"));
    // A bulk list is not itemized in this slice: no working item rows are written.
    assert.equal((await db.select().from(schema.sellSubmissionItems)).length, 0);
  });
});

test("an optional-price, unknown-shipping submission is accepted as stated", async () => {
  await withDatabase(async ({ db, schema }) => {
    await submit(db, singlePartPayload({
      quantity: undefined,
      conditionCode: undefined,
      phone: undefined,
      locationCountry: undefined,
      locationStateRegion: undefined,
      locationCity: undefined,
      locationPostalCode: undefined,
    }));

    const [submission] = await db.select().from(schema.sellSubmissions);
    assert.equal(submission.quantity, null);
    assert.equal(submission.conditionCode, "NOT_SURE");
    assert.equal(submission.quoteOnRequest, true);
    assert.equal(submission.askingUnitPrice, null);
    assert.equal(
      submission.canShipToNewJersey,
      null,
      "unanswered New Jersey shipping stays unknown; Civilon routes it later",
    );
    assert.equal(submission.locationCountry, null);

    const [contact] = await db.select().from(schema.marketplaceContacts);
    assert.equal(contact.phone, null);
    assert.equal(contact.normalizedPhone, null);
  });
});

test("a rolled-back Sell Submission leaves no partial contact, token or notification", async () => {
  await withDatabase(async ({ db, schema }) => {
    const { createSellSubmission } = await import("../db/price-check/repositories/sell-submission-repository.ts");
    await assert.rejects(createSellSubmission(db, {
      contact: {
        firstName: "Sam",
        lastName: "Okafor",
        companyName: "Example Component Supply",
        businessEmail: "sam.okafor@example.com",
        serviceProcessingAcknowledgedAt: new Date(),
      },
      submission: {
        submissionKind: "single_part",
        originalPartNumber: "101-384025-5",
        quoteOnRequest: true,
      },
      attribution: { sourcePage: SOURCE_PAGE },
      legalAcknowledgment: { acknowledgedAt: new Date(), privacyVersion: "p", termsVersion: "t" },
      verificationToken: {
        keyedTokenHash: "a".repeat(64),
        tokenDerivationNonce: "b".repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
      },
      idempotencyHash: "c".repeat(64),
      correlationId: "correlation",
      // Refused by sell_submissions_public_reference_chk, so the whole write aborts.
      publicReference: "NOT-A-REFERENCE",
    }));

    assert.equal((await db.select().from(schema.marketplaceContacts)).length, 0);
    assert.equal((await db.select().from(schema.sellSubmissions)).length, 0);
    assert.equal((await db.select().from(schema.emailVerificationTokens)).length, 0);
    assert.equal((await db.select().from(schema.notificationOutbox)).length, 0);
    assert.equal((await db.select().from(schema.auditEvents)).length, 0);
  });
});

test("a repeated submission returns the same SS- reference and enqueues no second email", async () => {
  await withDatabase(async ({ db, schema }) => {
    const first = await submit(db, singlePartPayload());
    const repeat = await submit(db, singlePartPayload());

    assert.equal(first.created, true);
    assert.equal(repeat.created, false);
    assert.equal(repeat.reference, first.reference);
    assert.equal((await db.select().from(schema.sellSubmissions)).length, 1);
    assert.equal((await db.select().from(schema.marketplaceContacts)).length, 1, "no duplicate contact");
    assert.equal((await db.select().from(schema.emailVerificationTokens)).length, 1, "no duplicate token");
    assert.equal((await db.select().from(schema.notificationOutbox)).length, 2, "no duplicate email");

    // A genuinely different submission still gets its own reference and pair.
    const other = await submit(db, bulkPayload());
    assert.equal(other.created, true);
    assert.notEqual(other.reference, first.reference);
    assert.equal((await db.select().from(schema.notificationOutbox)).length, 4);
  });
});

test("a Sell and a Buy submission sharing an idempotency key stay separate records", async () => {
  await withDatabase(async ({ db, schema }) => {
    const { validateBuyRequestSubmission } = await import("../lib/marketplace/validation.ts");
    const { submitBuyRequest } = await import("../lib/marketplace/submission-service.ts");
    const sharedKey = "3f1a2b4c-5d6e-4f70-8123-456789abcdef";

    const sell = await submit(db, singlePartPayload({ idempotencyKey: sharedKey }));
    const buyValidation = validateBuyRequestSubmission({
      idempotencyKey: sharedKey,
      partNumber: "101-384025-5",
      quantity: "2",
      acceptableCondition: "ANY",
      urgency: "standard",
      fulfillmentPreference: "door_delivery",
      firstName: "Dana",
      lastName: "Ruiz",
      companyName: "Example Aviation Group",
      businessEmail: "dana.ruiz@example.com",
      serviceAcknowledged: true,
      legalAcknowledged: true,
      sourcePage: "/buy-sell-aircraft-parts/buy",
    });
    assert.equal(buyValidation.success, true, JSON.stringify(buyValidation.fieldErrors));
    const buy = await submitBuyRequest(db, buyValidation.data);

    assert.equal(sell.created, true);
    assert.equal(buy.created, true);
    assert.match(sell.reference, /^SS-/);
    assert.match(buy.reference, /^BR-/);
    assert.equal((await db.select().from(schema.sellSubmissions)).length, 1);
    assert.equal((await db.select().from(schema.buyRequests)).length, 1);
    assert.equal((await db.select().from(schema.marketplaceContacts)).length, 2);
    assert.equal((await db.select().from(schema.notificationOutbox)).length, 4);
  });
});

test("both Sell message types drain through the shared registry, privacy-minimized", async () => {
  await withDatabase(async ({ db, schema }) => {
    const submitted = await submit(db, singlePartPayload({
      quoteOnRequest: false,
      askingUnitPrice: "1200.5",
      currencyCode: "EUR",
    }));
    const recorder = recordingProvider();
    const now = new Date();

    assert.equal((await drain(db, recorder.provider, now)).status, "succeeded");
    assert.equal((await drain(db, recorder.provider, now)).status, "succeeded");
    assert.equal((await drain(db, recorder.provider, now)).status, "idle");

    const messages = await db.select().from(schema.notificationOutbox);
    assert.ok(messages.every((message) => message.state === "succeeded"), JSON.stringify(messages));
    assert.ok(messages.every((message) => message.sentAt));
    assert.ok(messages.every((message) => message.sanitizedFailureCode === null));

    assert.equal(recorder.sent.length, 2);
    const verify = recorder.sent.find((mail) => mail.tag === "civilon-sell-submission-verify");
    const internal = recorder.sent.find((mail) => mail.tag === "civilon-sell-submission-internal");
    assert.ok(verify && internal);

    assert.equal(verify.from, "Civilon Parts <parts@cvlon.com>");
    assert.equal(verify.to, "Sam.Okafor@Example.com");
    assert.ok(verify.textBody.includes(submitted.reference));
    // The credential travels in the fragment, so it never reaches the server,
    // an access log, or a Referer header.
    assert.ok(verify.textBody.includes(`${APPROVED_ORIGIN}/buy-sell-aircraft-parts/sell/verify#token=`));
    assert.equal(/verify\?token=/.test(verify.textBody), false);
    assert.equal(/verify\?token=/.test(verify.htmlBody), false);

    assert.equal(internal.to, "sales@cvlon.com, hakan@shipnex.com, david@cvlon.com");
    assert.ok(internal.textBody.includes(submitted.reference));
    assert.ok(internal.textBody.includes("pending_verification"));
    // The console link is bound to the stored record, so the notice opens the
    // exact Sell Submission rather than a shared queue.
    const [storedSubmission] = await db.select().from(schema.sellSubmissions);
    assert.ok(internal.textBody.includes(`${APPROVED_ORIGIN}/admin/sell-submissions/${storedSubmission.id}`));
    assert.equal(internal.textBody.includes("/admin/price-checks"), false);

    const { credential } = await liveCredential(db, schema);
    assert.ok(verify.textBody.includes(credential), "the supplier link carries the live credential");

    for (const mail of recorder.sent) {
      const surface = [mail.subject, mail.textBody, mail.htmlBody, mail.tag, JSON.stringify(mail.metadata)].join("\n");
      for (const secret of [
        "101-384025-5", "1013840255", "Bleed air valve", "Sam", "Okafor",
        "Example Component Supply", "909 555 0123", "Frankfurt", "Hessen",
        "60311", "1200.50", "EUR", "SV",
      ]) {
        assert.equal(surface.includes(secret), false, `${mail.tag} must not contain ${secret}`);
      }
    }
    // The internal notice never carries the supplier's address, only the reference.
    const internalSurface = `${internal.subject}\n${internal.textBody}\n${internal.htmlBody}\n${JSON.stringify(internal.metadata)}`;
    assert.equal(/example\.com/i.test(internalSurface), false);
    assert.equal(internalSurface.includes(credential), false);
  });
});

test("a provider outage retries and never removes the Sell Submission", async () => {
  await withDatabase(async ({ db, schema }) => {
    const { eq } = await import("drizzle-orm");
    const submitted = await submit(db, singlePartPayload());
    const recorder = recordingProvider((call) => (
      call === 1 ? new Error("POSTMARK_503") : undefined
    ));
    const now = new Date();

    const failed = await drain(db, recorder.provider, now);
    assert.equal(failed.status, "retry");
    assert.equal(failed.code, "POSTMARK_503");

    // The submission, its contact and its credential all survive the outage.
    const [submission] = await db.select().from(schema.sellSubmissions);
    assert.equal(submission.publicReference, submitted.reference);
    assert.equal(submission.status, "pending_verification");
    assert.equal((await db.select().from(schema.marketplaceContacts)).length, 1);
    assert.equal((await db.select().from(schema.emailVerificationTokens)).length, 1);
    assert.equal((await db.select().from(schema.notificationOutbox)).length, 2);

    const failures = await db.select().from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, "SELL_SUBMISSION_NOTIFICATION_FAILED"));
    assert.equal(failures.length, 1);
    assert.equal(failures[0].sanitizedMetadata.code, "POSTMARK_503");
    assert.equal(failures[0].sanitizedMetadata.deadLetter, false);

    // A later drain, past the backoff, delivers everything with no data loss.
    const later = new Date(now.valueOf() + 24 * 60 * 60_000);
    assert.equal((await drain(db, recorder.provider, later)).status, "succeeded");
    assert.equal((await drain(db, recorder.provider, later)).status, "succeeded");
    assert.equal(recorder.sent.length, 2);
  });
});

test("a verification consumes the credential once and activates exactly this contact", async () => {
  await withDatabase(async ({ db, schema }) => {
    const submitted = await submit(db, singlePartPayload());
    // A second, unrelated seller must be untouched by the first one's redeem.
    await submit(db, bulkPayload());

    const { verifySellSubmissionContact } = await import("../lib/marketplace/sell-verification-service.ts");
    const { deriveSellVerificationToken } = await import("../lib/marketplace/verification.ts");
    const { eq } = await import("drizzle-orm");

    const [target] = await db.select().from(schema.sellSubmissions)
      .where(eq(schema.sellSubmissions.publicReference, submitted.reference));
    const [token] = await db.select().from(schema.emailVerificationTokens)
      .where(eq(schema.emailVerificationTokens.sellSubmissionId, target.id));
    const credential = deriveSellVerificationToken(TOKEN_KEY, token.tokenDerivationNonce);

    const first = await verifySellSubmissionContact(db, { token: credential });
    assert.deepEqual(first, { outcome: "verified", reference: submitted.reference });

    const [verified] = await db.select().from(schema.sellSubmissions)
      .where(eq(schema.sellSubmissions.id, target.id));
    assert.equal(verified.status, "verified");
    assert.ok(verified.verifiedAt);

    const [contact] = await db.select().from(schema.marketplaceContacts)
      .where(eq(schema.marketplaceContacts.id, target.contactId));
    assert.equal(contact.verificationState, "VERIFIED");
    assert.ok(contact.verifiedAt);
    assert.equal(contact.actsAsSeller, true);
    assert.equal(contact.actsAsBuyer, false, "verifying a seller must not grant a buyer role");

    // The other submission and its contact are untouched.
    const others = await db.select().from(schema.sellSubmissions)
      .where(eq(schema.sellSubmissions.submissionKind, "bulk_inventory"));
    assert.equal(others[0].status, "pending_verification");
    assert.equal(others[0].verifiedAt, null);
    const untouched = await db.select().from(schema.marketplaceContacts)
      .where(eq(schema.marketplaceContacts.id, others[0].contactId));
    assert.equal(untouched[0].verificationState, "PENDING");

    // A repeat click by the legitimate holder is idempotent and non-enumerating.
    const repeat = await verifySellSubmissionContact(db, { token: credential });
    assert.deepEqual(repeat, { outcome: "already_verified", reference: submitted.reference });
    const [afterRepeat] = await db.select().from(schema.emailVerificationTokens)
      .where(eq(schema.emailVerificationTokens.id, token.id));
    assert.equal(afterRepeat.attemptCount, 1, "a repeat must not re-consume the credential");

    const audits = await db.select().from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, "SELL_SUBMISSION_CONTACT_VERIFIED"));
    assert.equal(audits.length, 1);
    assert.equal(audits[0].aggregateId, target.id);
    assert.equal(audits[0].beforeVersionReference, "status:pending_verification");
    assert.equal(audits[0].afterVersionReference, "status:verified");
  });
});

test("an expired credential is revoked and reports the same opaque outcome", async () => {
  await withDatabase(async ({ db, schema }) => {
    await submit(db, singlePartPayload());
    const { verifySellSubmissionContact } = await import("../lib/marketplace/sell-verification-service.ts");
    const { credential, token } = await liveCredential(db, schema);

    const afterExpiry = new Date(token.expiresAt.valueOf() + 1000);
    const result = await verifySellSubmissionContact(db, { token: credential, now: afterExpiry });
    assert.deepEqual(result, { outcome: "unavailable" }, "an expired link must not name a reference");

    const [after] = await db.select().from(schema.emailVerificationTokens);
    assert.ok(after.revokedAt, "an expired credential is revoked so it cannot be retried");
    assert.equal(after.consumedAt, null);

    const [submission] = await db.select().from(schema.sellSubmissions);
    assert.equal(submission.status, "pending_verification", "the submission itself survives");
    assert.equal(submission.verifiedAt, null);
  });
});

test("a closed submission is never resurrected by a still-live credential", async () => {
  await withDatabase(async ({ db, schema }) => {
    const { eq } = await import("drizzle-orm");
    await submit(db, singlePartPayload());
    const { verifySellSubmissionContact } = await import("../lib/marketplace/sell-verification-service.ts");
    const { credential } = await liveCredential(db, schema);

    // Staff mark it spam before the supplier clicks.
    const [submission] = await db.select().from(schema.sellSubmissions);
    await db.update(schema.sellSubmissions)
      .set({ status: "spam", closedAt: new Date() })
      .where(eq(schema.sellSubmissions.id, submission.id));

    const result = await verifySellSubmissionContact(db, { token: credential });
    assert.deepEqual(result, { outcome: "unavailable" });

    const [after] = await db.select().from(schema.sellSubmissions);
    assert.equal(after.status, "spam", "verification must not reopen a closed submission");
    assert.equal(after.verifiedAt, null);
    const [token] = await db.select().from(schema.emailVerificationTokens);
    assert.ok(token.revokedAt);
    assert.equal(token.consumedAt, null);
  });
});

test("a Buy credential can never verify a Sell Submission, and the reverse holds", async () => {
  await withDatabase(async ({ db, schema }) => {
    const { validateBuyRequestSubmission } = await import("../lib/marketplace/validation.ts");
    const { submitBuyRequest } = await import("../lib/marketplace/submission-service.ts");
    const { verifySellSubmissionContact } = await import("../lib/marketplace/sell-verification-service.ts");
    const { verifyBuyRequestContact } = await import("../lib/marketplace/verification-service.ts");
    const { deriveSellVerificationToken, deriveVerificationToken } = await import("../lib/marketplace/verification.ts");
    const { eq } = await import("drizzle-orm");

    await submit(db, singlePartPayload());
    const buyValidation = validateBuyRequestSubmission({
      idempotencyKey: "9a1a2b4c-5d6e-4f70-8123-456789abcdef",
      partNumber: "101-384025-5",
      quantity: "2",
      acceptableCondition: "ANY",
      urgency: "standard",
      fulfillmentPreference: "door_delivery",
      firstName: "Dana",
      lastName: "Ruiz",
      companyName: "Example Aviation Group",
      businessEmail: "dana.ruiz@example.com",
      serviceAcknowledged: true,
      legalAcknowledged: true,
      sourcePage: "/buy-sell-aircraft-parts/buy",
    });
    assert.equal(buyValidation.success, true);
    await submitBuyRequest(db, buyValidation.data);

    const [sellToken] = await db.select().from(schema.emailVerificationTokens)
      .where(eq(schema.emailVerificationTokens.aggregateType, "sell_submission"));
    const [buyToken] = await db.select().from(schema.emailVerificationTokens)
      .where(eq(schema.emailVerificationTokens.aggregateType, "buy_request"));
    const buyCredential = deriveVerificationToken(TOKEN_KEY, buyToken.tokenDerivationNonce);
    const sellCredential = deriveSellVerificationToken(TOKEN_KEY, sellToken.tokenDerivationNonce);

    assert.deepEqual(
      await verifySellSubmissionContact(db, { token: buyCredential }),
      { outcome: "unavailable" },
    );
    assert.deepEqual(
      await verifyBuyRequestContact(db, { token: sellCredential }),
      { outcome: "unavailable" },
    );

    // Neither aggregate moved, and neither credential was spent.
    const [sell] = await db.select().from(schema.sellSubmissions);
    const [buy] = await db.select().from(schema.buyRequests);
    assert.equal(sell.status, "pending_verification");
    assert.equal(buy.status, "pending_verification");
    const tokens = await db.select().from(schema.emailVerificationTokens);
    assert.ok(tokens.every((token) => token.consumedAt === null && token.revokedAt === null));

    // And a credential derived under the wrong label for the right nonce fails.
    assert.deepEqual(
      await verifySellSubmissionContact(db, {
        token: deriveVerificationToken(TOKEN_KEY, sellToken.tokenDerivationNonce),
      }),
      { outcome: "unavailable" },
    );
  });
});

test("an unknown credential is opaque and writes nothing", async () => {
  await withDatabase(async ({ db, schema }) => {
    await submit(db, singlePartPayload());
    const { verifySellSubmissionContact } = await import("../lib/marketplace/sell-verification-service.ts");
    const { deriveSellVerificationToken } = await import("../lib/marketplace/verification.ts");

    const before = await db.select().from(schema.auditEvents);
    const stranger = deriveSellVerificationToken(TOKEN_KEY, "f".repeat(64));
    assert.deepEqual(
      await verifySellSubmissionContact(db, { token: stranger }),
      { outcome: "unavailable" },
    );
    const after = await db.select().from(schema.auditEvents);
    assert.equal(after.length, before.length, "a guess must leave no trace to correlate");

    const [token] = await db.select().from(schema.emailVerificationTokens);
    assert.equal(token.attemptCount, 0);
    assert.equal(token.consumedAt, null);
    assert.equal(token.revokedAt, null);
  });
});

test("verified Sell Submissions carry no listing, publication or expiry state", async () => {
  await withDatabase(async ({ db, schema }) => {
    await submit(db, singlePartPayload());
    const { verifySellSubmissionContact } = await import("../lib/marketplace/sell-verification-service.ts");
    const { credential } = await liveCredential(db, schema);
    await verifySellSubmissionContact(db, { token: credential });

    const [submission] = await db.select().from(schema.sellSubmissions);
    assert.equal(submission.status, "verified");
    assert.equal(submission.closedAt, null, "verification never schedules a close");
    assert.equal(submission.assignedAdminUserId, null);
    // The row has no publication, listing, visibility or search column at all:
    // slow-moving inventory cannot age out of a surface that does not exist.
    const columns = Object.keys(submission);
    for (const forbidden of ["publishedAt", "listedAt", "visibility", "isPublic", "expiresAt", "searchable"]) {
      assert.equal(columns.includes(forbidden), false, `sell_submissions must not carry ${forbidden}`);
    }
  });
});
