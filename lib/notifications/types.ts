import type { PriceCheckDb } from "../../db/price-check/index.ts";
import type { notificationOutbox } from "../../db/price-check/schema.ts";
import type { TransactionalEmailProvider } from "../price-check/email/provider.ts";

/** A row leased from the shared Civilon notification outbox. */
export type LeasedNotification = typeof notificationOutbox.$inferSelect;

export type NotificationDeliveryContext = {
  now: Date;
  leaseOwner: string;
  provider?: TransactionalEmailProvider;
};

/**
 * One Civilon workflow's claim on a single outbox message type.
 *
 * The registry of handlers is what makes the shared outbox safe: a drain leases
 * only message types that some handler owns, so one workflow can never consume
 * and dead-letter another workflow's message just because it does not recognise
 * the type.
 */
export type NotificationHandler = {
  /** Owning workflow, for diagnostics only. Never emitted to customers. */
  workflow: string;
  messageType: string;
  aggregateType: string;
  /**
   * Delivers the message and records workflow-specific success, including
   * completing the outbox row under the caller's lease.
   */
  deliver(
    db: PriceCheckDb,
    message: LeasedNotification,
    context: NotificationDeliveryContext,
  ): Promise<{ providerMessageId: string | null }>;
  /** Optional workflow-specific failure bookkeeping. Outbox fencing is handled by the dispatcher. */
  recordFailure?(
    db: PriceCheckDb,
    message: LeasedNotification,
    failure: { code: string; deadLetter: boolean; now: Date },
  ): Promise<void>;
};

export type NotificationDrainResult =
  | { status: "idle" }
  | { status: "succeeded"; notificationId: string; providerMessageId: string | null }
  | { status: "retry"; notificationId: string; code: string }
  | { status: "dead_letter"; notificationId: string; code?: string };
