import "../../db/price-check/server-boundary.ts";

import type { PriceCheckDb } from "../../db/price-check/index.ts";
import { failNotification, leaseNextNotification } from "../../db/price-check/repositories/outbox-repository.ts";
import { registeredNotificationTypes } from "./registry.ts";
import type {
  NotificationDrainResult,
  NotificationHandler,
} from "./types.ts";
import type { TransactionalEmailProvider } from "../price-check/email/provider.ts";

export const NOTIFICATION_LEASE_MS = 60_000;
export const NOTIFICATION_MAX_ATTEMPTS = 5;
const NOTIFICATION_MAX_BACKOFF_MS = 60 * 60_000;

export type OutboxOperations = {
  lease: typeof leaseNextNotification;
  fail: typeof failNotification;
};

const defaultOutbox: OutboxOperations = { lease: leaseNextNotification, fail: failNotification };

/** A persisted failure code must already be machine-safe: uppercase, digits, underscores. */
const SAFE_FAILURE_CODE = /^[A-Z0-9_]{1,64}$/;
export const GENERIC_FAILURE_CODE = "DELIVERY_FAILED";

/**
 * Failure codes are persisted and shown to staff, so only an already-safe code
 * survives. Arbitrary provider, database or runtime text collapses to a generic
 * code instead of being transliterated: transliteration preserved customer
 * identity, turning an address into POSTMARK_503_casey_example_com.
 */
export function sanitizeFailureCode(error: unknown) {
  const candidate = error instanceof Error ? error.message : "";
  return SAFE_FAILURE_CODE.test(candidate) ? candidate : GENERIC_FAILURE_CODE;
}

export function retryDelayMs(attemptCount: number) {
  return Math.min(NOTIFICATION_MAX_BACKOFF_MS, 2 ** attemptCount * 60_000);
}

/**
 * Drains one message from the shared outbox.
 *
 * Pass one leases only message types this drain has a handler for. Pass two
 * reaps genuinely unregistered types while excluding every type reserved by the
 * Civilon registry, so a message owned by another workflow is left in place for
 * its own handler rather than being dead-lettered here.
 */
export async function processNextNotification(
  db: PriceCheckDb,
  options: {
    handlers: readonly NotificationHandler[];
    provider?: TransactionalEmailProvider;
    now?: Date;
    leaseOwner?: string;
    /** Types owned somewhere in Civilon that this drain must never reap. */
    reservedMessageTypes?: readonly string[];
    outbox?: OutboxOperations;
  },
): Promise<NotificationDrainResult> {
  const now = options.now ?? new Date();
  const leaseOwner = options.leaseOwner ?? `civilon-notification-worker:${crypto.randomUUID()}`;
  const leaseUntil = new Date(now.valueOf() + NOTIFICATION_LEASE_MS);
  const outbox = options.outbox ?? defaultOutbox;
  const handledTypes = [...new Set(options.handlers.map((handler) => handler.messageType))];
  const reservedTypes = [
    ...new Set([
      ...handledTypes,
      ...(options.reservedMessageTypes ?? registeredNotificationTypes()),
    ]),
  ];

  const message = await outbox.lease(db, {
    leaseOwner,
    now,
    leaseUntil,
    messageTypes: handledTypes,
  });

  if (!message) {
    const orphan = await outbox.lease(db, {
      leaseOwner,
      now,
      leaseUntil,
      excludeMessageTypes: reservedTypes,
    });
    if (!orphan) return { status: "idle" };
    await outbox.fail(db, {
      id: orphan.id,
      leaseOwner,
      nextAttemptAt: now,
      sanitizedFailureCode: "UNSUPPORTED_MESSAGE",
      deadLetter: true,
    });
    return { status: "dead_letter", notificationId: orphan.id, code: "UNSUPPORTED_MESSAGE" };
  }

  const handler = options.handlers.find((candidate) => candidate.messageType === message.messageType);
  if (!handler || handler.aggregateType !== message.aggregateType) {
    // A handled type carrying the wrong aggregate is malformed, not another
    // workflow's message, so it is dead-lettered exactly as before.
    await outbox.fail(db, {
      id: message.id,
      leaseOwner,
      nextAttemptAt: now,
      sanitizedFailureCode: "UNSUPPORTED_MESSAGE",
      deadLetter: true,
    });
    return { status: "dead_letter", notificationId: message.id, code: "UNSUPPORTED_MESSAGE" };
  }

  try {
    const delivered = await handler.deliver(db, message, {
      now,
      leaseOwner,
      provider: options.provider,
    });
    return {
      status: "succeeded",
      notificationId: message.id,
      providerMessageId: delivered.providerMessageId,
    };
  } catch (error) {
    const code = sanitizeFailureCode(error);
    const deadLetter = message.attemptCount >= NOTIFICATION_MAX_ATTEMPTS;
    await outbox.fail(db, {
      id: message.id,
      leaseOwner,
      nextAttemptAt: new Date(now.valueOf() + retryDelayMs(message.attemptCount)),
      sanitizedFailureCode: code,
      deadLetter,
    });
    await handler.recordFailure?.(db, message, { code, deadLetter, now });
    return deadLetter
      ? { status: "dead_letter", notificationId: message.id, code }
      : { status: "retry", notificationId: message.id, code };
  }
}
