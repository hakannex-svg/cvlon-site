import assert from "node:assert/strict";
import test from "node:test";

import { NetlifyDB } from "@netlify/database-dev";

import { expectedMigrationCount, migrationsDirectory } from "./helpers/migration-archive.mjs";

const TOKEN_KEY = "civilon-marketplace-verify-token-key-for-tests";
const APPROVED_ORIGIN = "https://deploy-preview-1--cvlon.netlify.app";

/**
 * Runtime proof for the preview-only marketplace drain.
 *
 * The point of the drain is that a controlled preview can flush Buy/Sell mail
 * without ever becoming able to touch the Price Check queue. Source-shape checks
 * cannot establish that, because the containment lives in a SQL predicate, so
 * this suite seeds a real RESULT_READY row alongside real marketplace rows and
 * asserts against a real Postgres that the Price Check row is untouched.
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
    urgency: "standard",
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
function recordingProvider() {
  const sent = [];
  let calls = 0;
  return {
    sent,
    provider: {
      async send(message) {
        calls += 1;
        sent.push(message);
        return { providerMessageId: `test-message-${calls}`, submittedAt: new Date().toISOString() };
      },
    },
  };
}

/**
 * A RESULT_READY row owned by Price Check. It deliberately points at an
 * aggregate id that no Price Check result actually has: if the marketplace drain
 * ever leased it, delivery would fail and the row would be marked, which is
 * exactly the damage these tests exist to rule out.
 */
async function seedPriceCheckMessage(db, schema, id) {
  await db.insert(schema.notificationOutbox).values({
    id,
    messageType: "RESULT_READY",
    aggregateType: "price_check_result",
    aggregateId: id,
    recipientReference: id,
    templateVersion: "result-ready-v1",
    idempotencyKey: `result-ready:${id}:v1`,
    nextAttemptAt: new Date(Date.now() - 60_000),
  });
}

test("the preview drain delivers marketplace mail and never leases a Price Check message", async () => {
  await withDatabase(async ({ db, schema, applied }) => {
    const { eq } = await import("drizzle-orm");
    assert.equal(applied.length, expectedMigrationCount());

    const priceCheckMessageId = "01JJJJJJJJJJJJJJJJJJJJJJJP";
    await seedPriceCheckMessage(db, schema, priceCheckMessageId);
    await submit(db);

    const recorder = recordingProvider();
    const { drainMarketplaceNotifications } = await import(
      "../lib/marketplace/notifications/preview-drain.ts"
    );
    const summary = await drainMarketplaceNotifications(db, { provider: recorder.provider });

    // Both marketplace messages sent; the queue then reported idle.
    assert.equal(summary.processed, 2);
    assert.equal(summary.succeeded, 2);
    assert.equal(summary.retried, 0);
    assert.equal(summary.deadLettered, 0);
    assert.equal(summary.drained, true);
    assert.equal(recorder.sent.length, 2);

    // The Price Check row is exactly as it was seeded: never leased, never
    // attempted, never failed, never dead-lettered, never sent.
    const [priceCheck] = await db.select().from(schema.notificationOutbox)
      .where(eq(schema.notificationOutbox.id, priceCheckMessageId));
    assert.equal(priceCheck.state, "pending");
    assert.equal(priceCheck.leaseOwner, null);
    assert.equal(priceCheck.leaseExpiresAt, null);
    assert.equal(priceCheck.attemptCount, 0);
    assert.equal(priceCheck.sanitizedFailureCode, null);
    assert.equal(priceCheck.sentAt, null);

    // The marketplace rows really did complete.
    const marketplace = await db.select().from(schema.notificationOutbox)
      .where(eq(schema.notificationOutbox.aggregateType, "buy_request"));
    assert.equal(marketplace.length, 2);
    for (const row of marketplace) {
      assert.equal(row.state, "succeeded");
      assert.equal(row.leaseOwner, null);
    }
  });
});

test("the preview drain reaps an unowned type without touching the Price Check row", async () => {
  await withDatabase(async ({ db, schema }) => {
    const { eq } = await import("drizzle-orm");
    const priceCheckMessageId = "01JJJJJJJJJJJJJJJJJJJJJJJQ";
    const orphanId = "01JJJJJJJJJJJJJJJJJJJJJJJR";
    await seedPriceCheckMessage(db, schema, priceCheckMessageId);
    // A message type no Civilon handler owns. The shared drain dead-letters
    // these; the marketplace drain reserves the whole registry and so must not
    // touch the Price Check row while doing it.
    await db.insert(schema.notificationOutbox).values({
      id: orphanId,
      messageType: "SOME_FUTURE_WORKFLOW",
      aggregateType: "future_thing",
      aggregateId: orphanId,
      recipientReference: orphanId,
      templateVersion: "future-v1",
      idempotencyKey: `future:${orphanId}:v1`,
      nextAttemptAt: new Date(Date.now() - 60_000),
    });

    const recorder = recordingProvider();
    const { drainMarketplaceNotifications } = await import(
      "../lib/marketplace/notifications/preview-drain.ts"
    );
    const summary = await drainMarketplaceNotifications(db, { provider: recorder.provider });

    // The orphan is reaped exactly once, and nothing was e-mailed.
    assert.equal(summary.processed, 1);
    assert.equal(summary.deadLettered, 1);
    assert.equal(summary.succeeded, 0);
    assert.equal(recorder.sent.length, 0);

    const [orphan] = await db.select().from(schema.notificationOutbox)
      .where(eq(schema.notificationOutbox.id, orphanId));
    assert.equal(orphan.state, "dead_letter");

    const [priceCheck] = await db.select().from(schema.notificationOutbox)
      .where(eq(schema.notificationOutbox.id, priceCheckMessageId));
    assert.equal(priceCheck.state, "pending");
    assert.equal(priceCheck.attemptCount, 0);
    assert.equal(priceCheck.sanitizedFailureCode, null);
  });
});

test("one preview drain call processes at most ten marketplace notifications", async () => {
  await withDatabase(async ({ db, schema }) => {
    const { eq } = await import("drizzle-orm");
    // Six Buy Requests produce twelve marketplace messages.
    for (let index = 0; index < 6; index += 1) {
      await submit(db, {
        idempotencyKey: `3f1a2b4c-5d6e-4f70-8123-456789abcde${index}`,
        businessEmail: `dana.ruiz+${index}@example.com`,
      });
    }
    const seeded = await db.select().from(schema.notificationOutbox)
      .where(eq(schema.notificationOutbox.aggregateType, "buy_request"));
    assert.equal(seeded.length, 12);

    const recorder = recordingProvider();
    const { drainMarketplaceNotifications, MARKETPLACE_PREVIEW_DRAIN_LIMIT } = await import(
      "../lib/marketplace/notifications/preview-drain.ts"
    );
    assert.equal(MARKETPLACE_PREVIEW_DRAIN_LIMIT, 10);

    // A caller asking for more than the ceiling still gets the ceiling.
    const first = await drainMarketplaceNotifications(db, {
      provider: recorder.provider,
      limit: 500,
    });
    assert.equal(first.processed, 10);
    assert.equal(first.succeeded, 10);
    assert.equal(first.drained, false);

    const second = await drainMarketplaceNotifications(db, { provider: recorder.provider });
    assert.equal(second.processed, 2);
    assert.equal(second.succeeded, 2);
    assert.equal(second.drained, true);

    assert.equal(recorder.sent.length, 12);
  });
});

test("the drain summary carries counts only, never a recipient, token or identifier", async () => {
  await withDatabase(async ({ db }) => {
    await submit(db);
    const recorder = recordingProvider();
    const { drainMarketplaceNotifications } = await import(
      "../lib/marketplace/notifications/preview-drain.ts"
    );
    const summary = await drainMarketplaceNotifications(db, { provider: recorder.provider });

    assert.deepEqual(
      Object.keys(summary).sort(),
      ["deadLettered", "drained", "processed", "retried", "succeeded"],
    );
    for (const value of Object.values(summary)) {
      assert.ok(
        typeof value === "number" || typeof value === "boolean",
        "a drain summary field must be a count or a flag, never text",
      );
    }

    // The provider really did see a recipient, proving the assertion above is
    // about what the summary omits and not about the drain doing nothing.
    assert.ok(recorder.sent.some((message) => /dana\.ruiz@example\.com/i.test(message.to)));
    assert.equal(JSON.stringify(summary).includes("example.com"), false);
  });
});
