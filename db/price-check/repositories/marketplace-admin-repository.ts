import "../server-boundary.ts";

import { and, asc, desc, eq, ilike, isNull, ne, or, sql } from "drizzle-orm";
import { alias, type AnyPgColumn } from "drizzle-orm/pg-core";
import type { PriceCheckDb } from "../index.ts";
import {
  adminUsers,
  auditEvents,
  buyRequests,
  buyerOffers,
  marketplaceAttachments,
  marketplaceContacts,
  marketplaceEvidenceRequests,
  marketplaceNotes,
  notificationOutbox,
  priceChecks,
  requesters,
  sellInventoryFreshnessChecks,
  sellSubmissionItems,
  sellSubmissions,
  supplierResponses,
} from "../schema.ts";
import { priceCheckStatuses, type PriceCheckStatus } from "../domain/status-policy.ts";
import {
  internalReviewStates,
  isInternalReviewState,
  type InternalReviewState,
} from "../domain/internal-review.ts";
import {
  SELL_EVIDENCE_REQUEST_AGGREGATE_TYPE,
  SELL_EVIDENCE_REQUEST_MESSAGE_TYPE,
} from "../domain/sell-evidence-request.ts";
import {
  SELL_INVENTORY_FRESHNESS_AGGREGATE_TYPE,
  SELL_INVENTORY_FRESHNESS_MESSAGE_TYPE,
} from "../domain/sell-inventory-freshness.ts";

/* ========================================================================= */
/* Unified queue                                                             */
/* ========================================================================= */

/**
 * Unified staff queue across the three Civilon workflows.
 *
 * The database is the source of truth: pending / unverified marketplace records
 * are returned by default and are never filtered out implicitly.
 *
 * The projection below is the complete set of fields a caller can obtain from
 * this module. It deliberately excludes internal staff commentary, e-mail
 * bodies, storage object identifiers, sourcing records, offer records, and every
 * monetary column, so a queue view cannot become a leak of buyer or supplier
 * economics. The unit tests assert those identifiers never appear in this file.
 */

export const unifiedQueueTypes = ["price_check", "buy_request", "sell_submission"] as const;
export type UnifiedQueueType = (typeof unifiedQueueTypes)[number];

/** The two marketplace aggregates, matching `marketplace_aggregate_type`. */
export const marketplaceAggregateTypes = ["buy_request", "sell_submission"] as const;
export type MarketplaceAggregateType = (typeof marketplaceAggregateTypes)[number];

/** Status vocabularies, read from the schema enums so they cannot drift. */
export const buyRequestStatuses = buyRequests.status.enumValues;
export const sellSubmissionStatuses = sellSubmissions.status.enumValues;

export const unifiedQueueUrgencies = ["aog", "critical"] as const;
export type UnifiedQueueUrgency = (typeof unifiedQueueUrgencies)[number];

export const unifiedQueueVerificationStates = ["verified", "pending"] as const;

/**
 * The only contact verification state that counts as verified.
 *
 * Deliberately NOT derived from the aggregate's own `verified_at`. The schema's
 * `*_pending_verification_chk` forces that timestamp to be stamped when an ADMIN
 * performs the operational `pending_verification -> verified` override, so it
 * says "this record cleared a workflow gate", not "this customer confirmed their
 * e-mail address". Reading it as the latter would report a staff action as a
 * customer action. The contact record is the authority, and every state other
 * than VERIFIED is reported as pending to the two-state staff UI.
 */
export const VERIFIED_CONTACT_STATE = "VERIFIED";

export function contactVerificationState(state: string | null | undefined): UnifiedQueueVerificationState {
  return state === VERIFIED_CONTACT_STATE ? "verified" : "pending";
}
export type UnifiedQueueVerificationState = (typeof unifiedQueueVerificationStates)[number];

export const unifiedQueueAges = ["day", "week", "older"] as const;
export type UnifiedQueueAge = (typeof unifiedQueueAges)[number];

/** Same visible cap as the Price Check queue. */
export const UNIFIED_QUEUE_LIMIT = 200;

export const UNASSIGNED_FILTER = "unassigned";
const ADMIN_ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const SEARCH_MAX_LENGTH = 120;

/**
 * The only two shapes an assignee filter may take: the `unassigned` literal, or
 * an admin user id. Anything else is malformed and must fail closed — see
 * `listUnifiedAdminQueue`.
 */
export function isAssigneeFilter(value: string) {
  return value === UNASSIGNED_FILTER || ADMIN_ID_PATTERN.test(value);
}

export type UnifiedQueueFilters = {
  type?: UnifiedQueueType;
  /** A single status string; a workflow whose enum does not contain it is skipped. */
  status?: string;
  /** An admin user id, or the literal `unassigned`. */
  assignee?: string;
  urgency?: UnifiedQueueUrgency;
  verification?: UnifiedQueueVerificationState;
  /** Internal Civilon business review of the marketplace contact. */
  review?: InternalReviewState;
  age?: UnifiedQueueAge;
  search?: string;
  /**
   * Price Check rows are included only when the caller passes true. The Price
   * Check detail page stays behind `NEXT_PUBLIC_PRICE_CHECK_ENABLED`, so listing
   * those rows while the flag is off would produce dead links. Buy and Sell rows
   * are always returned to an authorized staff user, independently of the public
   * marketplace flags.
   */
  includePriceChecks?: boolean;
};

export type UnifiedQueueRecord = {
  type: UnifiedQueueType;
  id: string;
  publicReference: string;
  status: string;
  /** `null` for Price Check, which has no email-verification concept. */
  verificationState: UnifiedQueueVerificationState | null;
  /** `null` for Price Check, which has no marketplace-contact review. */
  businessReviewState: InternalReviewState | null;
  companyName: string;
  contactName: string;
  partNumber: string | null;
  urgency: UnifiedQueueUrgency | null;
  submittedAt: Date;
  assigneeId: string | null;
  assigneeEmail: string | null;
};

export type MarketplaceReviewCounts = {
  all: number;
  not_reviewed: number;
  reviewed: number;
  concern: number;
};

function emptyMarketplaceReviewCounts(): MarketplaceReviewCounts {
  return { all: 0, not_reviewed: 0, reviewed: 0, concern: 0 };
}

function normalizeSearch(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const needle = `%${trimmed.slice(0, SEARCH_MAX_LENGTH)}%`;
  return { needle, partNeedle: needle.replaceAll("-", "") };
}

/**
 * Only ever reached with a value `listUnifiedAdminQueue` has already validated.
 * Throws rather than returning null on a malformed value, so a future caller
 * cannot reintroduce the widening bug by skipping the guard.
 */
function assigneeClause(column: AnyPgColumn, assignee: string | undefined) {
  if (!assignee) return null;
  if (assignee === UNASSIGNED_FILTER) return isNull(column);
  if (!isAssigneeFilter(assignee)) throw new Error("Malformed assignee filter.");
  return eq(column, assignee);
}

function ageClause(column: AnyPgColumn, age: UnifiedQueueAge | undefined) {
  if (age === "day") return sql`${column} >= now() - interval '1 day'`;
  if (age === "week") return sql`${column} >= now() - interval '7 days'`;
  if (age === "older") return sql`${column} < now() - interval '7 days'`;
  return null;
}

/** Deterministic total order: urgency, then recency, then id (ULIDs break ties). */
function compareQueueRecords(a: UnifiedQueueRecord, b: UnifiedQueueRecord) {
  const rank = (record: UnifiedQueueRecord) =>
    record.urgency === "aog" ? 2 : record.urgency === "critical" ? 1 : 0;
  if (rank(a) !== rank(b)) return rank(b) - rank(a);
  const time = b.submittedAt.valueOf() - a.submittedAt.valueOf();
  if (time !== 0) return time;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

function buyRequestClauses(filters: UnifiedQueueFilters) {
  type BuyRequestStatus = (typeof buyRequestStatuses)[number];
  if (filters.status && !buyRequestStatuses.includes(filters.status as BuyRequestStatus)) return null;

  const clauses = [];
  if (filters.status) clauses.push(eq(buyRequests.status, filters.status as BuyRequestStatus));
  if (filters.urgency === "aog") clauses.push(eq(buyRequests.urgency, "aog"));
  if (filters.urgency === "critical") clauses.push(sql`${buyRequests.urgency} in ('aog', 'critical')`);
  if (filters.verification === "verified") clauses.push(eq(marketplaceContacts.verificationState, VERIFIED_CONTACT_STATE));
  if (filters.verification === "pending") clauses.push(ne(marketplaceContacts.verificationState, VERIFIED_CONTACT_STATE));
  if (filters.review) clauses.push(eq(marketplaceContacts.businessReviewState, filters.review));
  const assignee = assigneeClause(buyRequests.assignedAdminUserId, filters.assignee);
  if (assignee) clauses.push(assignee);
  const age = ageClause(buyRequests.submittedAt, filters.age);
  if (age) clauses.push(age);
  const search = normalizeSearch(filters.search);
  if (search) {
    clauses.push(or(
      ilike(buyRequests.publicReference, search.needle),
      ilike(buyRequests.normalizedPartNumber, search.partNeedle),
      ilike(buyRequests.description, search.needle),
      ilike(marketplaceContacts.companyName, search.needle),
      ilike(sql`${marketplaceContacts.firstName} || ' ' || ${marketplaceContacts.lastName}`, search.needle),
    )!);
  }
  return clauses;
}

function sellSubmissionClauses(filters: UnifiedQueueFilters) {
  type SellSubmissionStatus = (typeof sellSubmissionStatuses)[number];
  if (filters.urgency) return null;
  if (filters.status && !sellSubmissionStatuses.includes(filters.status as SellSubmissionStatus)) return null;

  const clauses = [];
  if (filters.status) clauses.push(eq(sellSubmissions.status, filters.status as SellSubmissionStatus));
  if (filters.verification === "verified") clauses.push(eq(marketplaceContacts.verificationState, VERIFIED_CONTACT_STATE));
  if (filters.verification === "pending") clauses.push(ne(marketplaceContacts.verificationState, VERIFIED_CONTACT_STATE));
  if (filters.review) clauses.push(eq(marketplaceContacts.businessReviewState, filters.review));
  const assignee = assigneeClause(sellSubmissions.assignedAdminUserId, filters.assignee);
  if (assignee) clauses.push(assignee);
  const age = ageClause(sellSubmissions.submittedAt, filters.age);
  if (age) clauses.push(age);
  const search = normalizeSearch(filters.search);
  if (search) {
    clauses.push(or(
      ilike(sellSubmissions.publicReference, search.needle),
      ilike(sellSubmissions.normalizedPartNumber, search.partNeedle),
      ilike(sellSubmissions.description, search.needle),
      ilike(marketplaceContacts.companyName, search.needle),
      ilike(sql`${marketplaceContacts.firstName} || ' ' || ${marketplaceContacts.lastName}`, search.needle),
    )!);
  }
  return clauses;
}

async function listPriceCheckRows(db: PriceCheckDb, filters: UnifiedQueueFilters): Promise<UnifiedQueueRecord[]> {
  // Price Check carries no email-verification state, so a verification filter
  // excludes the workflow rather than inventing a value for it.
  if (filters.verification || filters.review) return [];
  if (filters.status && !priceCheckStatuses.includes(filters.status as PriceCheckStatus)) return [];

  const clauses = [];
  if (filters.status) clauses.push(eq(priceChecks.status, filters.status as PriceCheckStatus));
  // Price Check models urgency as a single AOG boolean; both urgency tiers map
  // onto it rather than silently dropping the workflow out of an urgency view.
  if (filters.urgency) clauses.push(eq(priceChecks.aog, true));
  const assignee = assigneeClause(priceChecks.assignedAdminUserId, filters.assignee);
  if (assignee) clauses.push(assignee);
  const age = ageClause(priceChecks.submittedAt, filters.age);
  if (age) clauses.push(age);
  const search = normalizeSearch(filters.search);
  if (search) {
    clauses.push(or(
      ilike(priceChecks.publicReference, search.needle),
      ilike(priceChecks.normalizedPartNumber, search.partNeedle),
      ilike(requesters.companyName, search.needle),
      ilike(sql`${requesters.firstName} || ' ' || ${requesters.lastName}`, search.needle),
    )!);
  }

  const rows = await db.select({
    id: priceChecks.id,
    publicReference: priceChecks.publicReference,
    status: priceChecks.status,
    aog: priceChecks.aog,
    companyName: requesters.companyName,
    firstName: requesters.firstName,
    lastName: requesters.lastName,
    partNumber: priceChecks.originalPartNumber,
    submittedAt: priceChecks.submittedAt,
    assigneeId: adminUsers.id,
    assigneeEmail: adminUsers.displayEmail,
  }).from(priceChecks)
    .innerJoin(requesters, eq(priceChecks.requesterId, requesters.id))
    .leftJoin(adminUsers, eq(priceChecks.assignedAdminUserId, adminUsers.id))
    .where(clauses.length ? and(...clauses) : undefined)
    .orderBy(desc(priceChecks.aog), desc(priceChecks.submittedAt), desc(priceChecks.id))
    .limit(UNIFIED_QUEUE_LIMIT);

  return rows.map(row => ({
    type: "price_check" as const,
    id: row.id,
    publicReference: row.publicReference,
    status: row.status,
    verificationState: null,
    businessReviewState: null,
    companyName: row.companyName,
    contactName: `${row.firstName} ${row.lastName}`.trim(),
    partNumber: row.partNumber,
    urgency: row.aog ? ("aog" as const) : null,
    submittedAt: row.submittedAt,
    assigneeId: row.assigneeId,
    assigneeEmail: row.assigneeEmail,
  }));
}

async function listBuyRequestRows(db: PriceCheckDb, filters: UnifiedQueueFilters): Promise<UnifiedQueueRecord[]> {
  const clauses = buyRequestClauses(filters);
  if (!clauses) return [];

  const urgencyRank = sql<number>`case when ${buyRequests.urgency} = 'aog' then 2 when ${buyRequests.urgency} = 'critical' then 1 else 0 end`;
  const rows = await db.select({
    id: buyRequests.id,
    publicReference: buyRequests.publicReference,
    status: buyRequests.status,
    urgency: buyRequests.urgency,
    contactVerificationState: marketplaceContacts.verificationState,
    businessReviewState: marketplaceContacts.businessReviewState,
    companyName: marketplaceContacts.companyName,
    firstName: marketplaceContacts.firstName,
    lastName: marketplaceContacts.lastName,
    partNumber: buyRequests.originalPartNumber,
    submittedAt: buyRequests.submittedAt,
    assigneeId: adminUsers.id,
    assigneeEmail: adminUsers.displayEmail,
  }).from(buyRequests)
    .innerJoin(marketplaceContacts, eq(buyRequests.contactId, marketplaceContacts.id))
    .leftJoin(adminUsers, eq(buyRequests.assignedAdminUserId, adminUsers.id))
    .where(clauses.length ? and(...clauses) : undefined)
    .orderBy(desc(urgencyRank), desc(buyRequests.submittedAt), desc(buyRequests.id))
    .limit(UNIFIED_QUEUE_LIMIT);

  return rows.map(row => ({
    type: "buy_request" as const,
    id: row.id,
    publicReference: row.publicReference,
    status: row.status,
    verificationState: contactVerificationState(row.contactVerificationState),
    businessReviewState: row.businessReviewState,
    companyName: row.companyName,
    contactName: `${row.firstName} ${row.lastName}`.trim(),
    partNumber: row.partNumber,
    urgency: row.urgency === "aog" ? ("aog" as const) : row.urgency === "critical" ? ("critical" as const) : null,
    submittedAt: row.submittedAt,
    assigneeId: row.assigneeId,
    assigneeEmail: row.assigneeEmail,
  }));
}

async function listSellSubmissionRows(db: PriceCheckDb, filters: UnifiedQueueFilters): Promise<UnifiedQueueRecord[]> {
  const clauses = sellSubmissionClauses(filters);
  if (!clauses) return [];

  const rows = await db.select({
    id: sellSubmissions.id,
    publicReference: sellSubmissions.publicReference,
    status: sellSubmissions.status,
    contactVerificationState: marketplaceContacts.verificationState,
    businessReviewState: marketplaceContacts.businessReviewState,
    companyName: marketplaceContacts.companyName,
    firstName: marketplaceContacts.firstName,
    lastName: marketplaceContacts.lastName,
    partNumber: sellSubmissions.originalPartNumber,
    submittedAt: sellSubmissions.submittedAt,
    assigneeId: adminUsers.id,
    assigneeEmail: adminUsers.displayEmail,
  }).from(sellSubmissions)
    .innerJoin(marketplaceContacts, eq(sellSubmissions.contactId, marketplaceContacts.id))
    .leftJoin(adminUsers, eq(sellSubmissions.assignedAdminUserId, adminUsers.id))
    .where(clauses.length ? and(...clauses) : undefined)
    .orderBy(desc(sellSubmissions.submittedAt), desc(sellSubmissions.id))
    .limit(UNIFIED_QUEUE_LIMIT);

  return rows.map(row => ({
    type: "sell_submission" as const,
    id: row.id,
    publicReference: row.publicReference,
    status: row.status,
    verificationState: contactVerificationState(row.contactVerificationState),
    businessReviewState: row.businessReviewState,
    companyName: row.companyName,
    contactName: `${row.firstName} ${row.lastName}`.trim(),
    partNumber: row.partNumber,
    urgency: null,
    submittedAt: row.submittedAt,
    assigneeId: row.assigneeId,
    assigneeEmail: row.assigneeEmail,
  }));
}

/**
 * Reads each workflow with the same ordering and the same cap, then merges.
 *
 * Merging in process is exact rather than approximate: the global top
 * `UNIFIED_QUEUE_LIMIT` rows can draw at most that many rows from any single
 * workflow, and every branch is already ordered by the same comparator, so each
 * row that belongs on the global page is present in the merged pool.
 */
export async function listUnifiedAdminQueue(
  db: PriceCheckDb,
  filters: UnifiedQueueFilters = {},
): Promise<UnifiedQueueRecord[]> {
  // Fail closed. A malformed assignee filter returns nothing; it must never be
  // dropped, because dropping it silently widens the view to every assignee.
  if (filters.assignee && !isAssigneeFilter(filters.assignee)) return [];
  if (filters.review && !isInternalReviewState(filters.review)) return [];

  const wanted = (type: UnifiedQueueType) => !filters.type || filters.type === type;
  const branches: Promise<UnifiedQueueRecord[]>[] = [];
  if (wanted("price_check") && filters.includePriceChecks) branches.push(listPriceCheckRows(db, filters));
  if (wanted("buy_request")) branches.push(listBuyRequestRows(db, filters));
  if (wanted("sell_submission")) branches.push(listSellSubmissionRows(db, filters));

  const results = await Promise.all(branches);
  return results.flat().sort(compareQueueRecords).slice(0, UNIFIED_QUEUE_LIMIT);
}

type MarketplaceReviewCountRow = { state: InternalReviewState; count: number };

async function countBuyRequestReviewStates(
  db: PriceCheckDb,
  filters: UnifiedQueueFilters,
): Promise<MarketplaceReviewCountRow[]> {
  const clauses = buyRequestClauses({ ...filters, review: undefined });
  if (!clauses) return [];
  return db.select({
    state: marketplaceContacts.businessReviewState,
    count: sql<number>`count(*)::int`,
  }).from(buyRequests)
    .innerJoin(marketplaceContacts, eq(buyRequests.contactId, marketplaceContacts.id))
    .where(clauses.length ? and(...clauses) : undefined)
    .groupBy(marketplaceContacts.businessReviewState);
}

async function countSellSubmissionReviewStates(
  db: PriceCheckDb,
  filters: UnifiedQueueFilters,
): Promise<MarketplaceReviewCountRow[]> {
  const clauses = sellSubmissionClauses({ ...filters, review: undefined });
  if (!clauses) return [];
  return db.select({
    state: marketplaceContacts.businessReviewState,
    count: sql<number>`count(*)::int`,
  }).from(sellSubmissions)
    .innerJoin(marketplaceContacts, eq(sellSubmissions.contactId, marketplaceContacts.id))
    .where(clauses.length ? and(...clauses) : undefined)
    .groupBy(marketplaceContacts.businessReviewState);
}

/** Exact counters for the active non-review filters; not limited to 200 rows. */
export async function countMarketplaceReviewStates(
  db: PriceCheckDb,
  filters: UnifiedQueueFilters = {},
): Promise<MarketplaceReviewCounts> {
  const counts = emptyMarketplaceReviewCounts();
  if (filters.assignee && !isAssigneeFilter(filters.assignee)) return counts;
  if (filters.review && !isInternalReviewState(filters.review)) return counts;

  const wanted = (type: UnifiedQueueType) => !filters.type || filters.type === type;
  const branches: Promise<MarketplaceReviewCountRow[]>[] = [];
  if (wanted("buy_request")) branches.push(countBuyRequestReviewStates(db, filters));
  if (wanted("sell_submission")) branches.push(countSellSubmissionReviewStates(db, filters));

  for (const rows of await Promise.all(branches)) {
    for (const row of rows) counts[row.state] += Number(row.count);
  }
  counts.all = internalReviewStates.reduce((total, state) => total + counts[state], 0);
  return counts;
}

/* ========================================================================= */
/* Record-bound detail reads                                                 */
/*                                                                           */
/* Everything below is addressed by a single aggregate id. Each read returns  */
/* `null` when the record does not exist, so a caller can distinguish "no     */
/* such record" from an infrastructure failure: a database fault throws and   */
/* propagates, and the calling page renders its generic unavailable state.    */
/* Neither path reveals anything about why.                                   */
/*                                                                           */
/* These projections never select a storage key, a storage provider, a        */
/* content digest, an upload-session token or hash, an e-mail verification    */
/* token or hash, an idempotency hash, or outbox routing/provider/lease data.  */
/* The evidence-request summary reads only delivery state and sent time.       */
/* Evidence is metadata only; authenticated download arrives separately.      */
/* ========================================================================= */

/** How many audit rows a detail page shows. Newest first. */
export const MARKETPLACE_AUDIT_LIMIT = 200;

export type MarketplaceContactSummary = {
  id: string;
  firstName: string;
  lastName: string;
  companyName: string;
  businessEmail: string;
  phone: string | null;
  role: string | null;
  country: string | null;
  stateRegion: string | null;
  city: string | null;
  postalCode: string | null;
  websiteUrl: string | null;
  actsAsBuyer: boolean;
  actsAsSeller: boolean;
  verificationState: string;
  verifiedAt: Date | null;
  businessReviewState: InternalReviewState;
  businessReviewedAt: Date | null;
  businessReviewedByEmail: string | null;
  createdAt: Date;
  deletionRequestedAt: Date | null;
  deletedAt: Date | null;
};

export type MarketplaceAssignee = { id: string; email: string } | null;

export type MarketplaceNoteRecord = {
  id: string;
  body: string;
  authorEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
  redactedAt: Date | null;
};

export type MarketplaceAuditRecord = {
  id: string;
  action: string;
  actorType: string;
  actorId: string | null;
  beforeVersionReference: string | null;
  afterVersionReference: string | null;
  createdAt: Date;
};

/**
 * Internal sourcing data. Supplier identity, supplier contact, supplier cost
 * and supplier document summaries live here and nowhere else. Nothing on this
 * type may be rendered on, merged into, or derived from a buyer-facing surface.
 */
export type SupplierResponseRecord = {
  id: string;
  supplierKind: string;
  supplierNameSnapshot: string | null;
  supplierContactSnapshot: string | null;
  supplierCountry: string | null;
  offeredPartNumber: string | null;
  statedCondition: string | null;
  quantityAvailable: string | null;
  supplierUnitCost: string | null;
  currencyCode: string | null;
  quoteOnRequest: boolean;
  availabilityState: string;
  locationText: string | null;
  leadTimeDays: number | null;
  documentsSummary: string | null;
  shippingNotes: string | null;
  status: string;
  recordedByEmail: string | null;
  receivedAt: Date;
  expiresAt: Date | null;
};

/**
 * Civilon's separate offer to the buyer: Civilon's own sale price and the
 * buyer-facing delivery option, and nothing else.
 *
 * `buyer_offers.selected_supplier_response_id` exists in the schema as an
 * internal staff pointer, and is deliberately absent from this type. Omitting
 * it makes the separation provable by key set rather than by convention: a
 * buyer offer object carries no route back to a supplier record.
 */
export type BuyerOfferRecord = {
  id: string;
  version: number;
  civilonSaleUnitPrice: string;
  currencyCode: string;
  quantity: string;
  statedCondition: string | null;
  documentsSummary: string | null;
  deliveryOption: string;
  shippingAndExportScope: string | null;
  leadTimeDays: number | null;
  status: string;
  createdByEmail: string | null;
  sentAt: Date | null;
  respondedAt: Date | null;
  expiresAt: Date | null;
  supersededAt: Date | null;
  createdAt: Date;
};

async function loadAssignee(db: PriceCheckDb, adminUserId: string | null): Promise<MarketplaceAssignee> {
  if (!adminUserId) return null;
  const [row] = await db.select({ id: adminUsers.id, email: adminUsers.displayEmail })
    .from(adminUsers)
    .where(eq(adminUsers.id, adminUserId))
    .limit(1);
  return row ?? null;
}

async function loadNotes(db: PriceCheckDb, aggregateType: MarketplaceAggregateType, aggregateId: string): Promise<MarketplaceNoteRecord[]> {
  return db.select({
    id: marketplaceNotes.id,
    body: marketplaceNotes.body,
    authorEmail: adminUsers.displayEmail,
    createdAt: marketplaceNotes.createdAt,
    updatedAt: marketplaceNotes.updatedAt,
    redactedAt: marketplaceNotes.redactedAt,
  }).from(marketplaceNotes)
    .leftJoin(adminUsers, eq(marketplaceNotes.adminUserId, adminUsers.id))
    .where(and(
      eq(marketplaceNotes.aggregateType, aggregateType),
      eq(marketplaceNotes.aggregateId, aggregateId),
    ))
    .orderBy(desc(marketplaceNotes.createdAt), desc(marketplaceNotes.id));
}

async function loadAudit(db: PriceCheckDb, aggregateType: MarketplaceAggregateType, aggregateId: string): Promise<MarketplaceAuditRecord[]> {
  return db.select({
    id: auditEvents.id,
    action: auditEvents.action,
    actorType: auditEvents.actorType,
    actorId: auditEvents.actorId,
    beforeVersionReference: auditEvents.beforeVersionReference,
    afterVersionReference: auditEvents.afterVersionReference,
    createdAt: auditEvents.createdAt,
  }).from(auditEvents)
    .where(and(
      eq(auditEvents.aggregateType, aggregateType),
      eq(auditEvents.aggregateId, aggregateId),
    ))
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
    .limit(MARKETPLACE_AUDIT_LIMIT);
}

const businessReviewer = alias(adminUsers, "marketplace_business_reviewer");
const attachmentReviewer = alias(adminUsers, "marketplace_attachment_reviewer");
const evidenceRequester = alias(adminUsers, "marketplace_evidence_requester");
const freshnessRequester = alias(adminUsers, "marketplace_freshness_requester");

const contactColumns = {
  id: marketplaceContacts.id,
  firstName: marketplaceContacts.firstName,
  lastName: marketplaceContacts.lastName,
  companyName: marketplaceContacts.companyName,
  businessEmail: marketplaceContacts.businessEmail,
  phone: marketplaceContacts.phone,
  role: marketplaceContacts.role,
  country: marketplaceContacts.country,
  stateRegion: marketplaceContacts.stateRegion,
  city: marketplaceContacts.city,
  postalCode: marketplaceContacts.postalCode,
  websiteUrl: marketplaceContacts.websiteUrl,
  actsAsBuyer: marketplaceContacts.actsAsBuyer,
  actsAsSeller: marketplaceContacts.actsAsSeller,
  verificationState: marketplaceContacts.verificationState,
  verifiedAt: marketplaceContacts.verifiedAt,
  businessReviewState: marketplaceContacts.businessReviewState,
  businessReviewedAt: marketplaceContacts.businessReviewedAt,
  businessReviewedByEmail: businessReviewer.displayEmail,
  createdAt: marketplaceContacts.createdAt,
  deletionRequestedAt: marketplaceContacts.deletionRequestedAt,
  deletedAt: marketplaceContacts.deletedAt,
};

export type BuyRequestAdminDetail = {
  buyRequest: {
    id: string;
    publicReference: string;
    status: string;
    verificationState: UnifiedQueueVerificationState;
    originalPartNumber: string | null;
    normalizedPartNumber: string | null;
    description: string | null;
    quantity: string;
    acceptableCondition: string;
    urgency: string;
    neededByDate: string | null;
    aircraftModel: string | null;
    applicationNotes: string | null;
    deliveryCountry: string | null;
    deliveryCity: string | null;
    deliveryPostalCode: string | null;
    fulfillmentPreference: string;
    customerNotes: string | null;
    sourcePage: string;
    landingPage: string | null;
    referrerOrigin: string | null;
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    utmContent: string | null;
    utmTerm: string | null;
    sourcePriceCheckId: string | null;
    sourceResultId: string | null;
    verificationRequestedAt: Date | null;
    verifiedAt: Date | null;
    submittedAt: Date;
    createdAt: Date;
    updatedAt: Date;
    closedAt: Date | null;
  };
  contact: MarketplaceContactSummary;
  assignee: MarketplaceAssignee;
  notes: MarketplaceNoteRecord[];
  audit: MarketplaceAuditRecord[];
  /** Internal sourcing side. Never buyer-facing. */
  supplierResponses: SupplierResponseRecord[];
  /** Civilon's separate resale side. Carries no supplier column. */
  buyerOffers: BuyerOfferRecord[];
};

/**
 * A Buy Request as staff need to see it.
 *
 * The two economic sides are returned as two disjoint arrays and are never
 * merged, joined or reconciled here. There is deliberately no combined
 * "economics" object, no margin, and no supplier reference reachable from a
 * buyer offer, so no caller can accidentally render one side inside the other.
 *
 * Returns `null` when no Buy Request has that id.
 */
export async function getBuyRequestAdminDetail(db: PriceCheckDb, id: string): Promise<BuyRequestAdminDetail | null> {
  const [record] = await db.select({
    buyRequest: {
      id: buyRequests.id,
      publicReference: buyRequests.publicReference,
      status: buyRequests.status,
      originalPartNumber: buyRequests.originalPartNumber,
      normalizedPartNumber: buyRequests.normalizedPartNumber,
      description: buyRequests.description,
      quantity: buyRequests.quantity,
      acceptableCondition: buyRequests.acceptableCondition,
      urgency: buyRequests.urgency,
      neededByDate: buyRequests.neededByDate,
      aircraftModel: buyRequests.aircraftModel,
      applicationNotes: buyRequests.applicationNotes,
      deliveryCountry: buyRequests.deliveryCountry,
      deliveryCity: buyRequests.deliveryCity,
      deliveryPostalCode: buyRequests.deliveryPostalCode,
      fulfillmentPreference: buyRequests.fulfillmentPreference,
      customerNotes: buyRequests.notes,
      sourcePage: buyRequests.sourcePage,
      landingPage: buyRequests.landingPage,
      referrerOrigin: buyRequests.referrerOrigin,
      utmSource: buyRequests.utmSource,
      utmMedium: buyRequests.utmMedium,
      utmCampaign: buyRequests.utmCampaign,
      utmContent: buyRequests.utmContent,
      utmTerm: buyRequests.utmTerm,
      sourcePriceCheckId: buyRequests.sourcePriceCheckId,
      sourceResultId: buyRequests.sourceResultId,
      verificationRequestedAt: buyRequests.verificationRequestedAt,
      verifiedAt: buyRequests.verifiedAt,
      submittedAt: buyRequests.submittedAt,
      createdAt: buyRequests.createdAt,
      updatedAt: buyRequests.updatedAt,
      closedAt: buyRequests.closedAt,
    },
    contact: contactColumns,
    assignedAdminUserId: buyRequests.assignedAdminUserId,
  }).from(buyRequests)
    .innerJoin(marketplaceContacts, eq(buyRequests.contactId, marketplaceContacts.id))
    .leftJoin(businessReviewer, eq(marketplaceContacts.businessReviewedByAdminUserId, businessReviewer.id))
    .where(eq(buyRequests.id, id))
    .limit(1);
  if (!record) return null;

  const [assignee, notes, audit, supplierResponseRows, buyerOfferRows] = await Promise.all([
    loadAssignee(db, record.assignedAdminUserId),
    loadNotes(db, "buy_request", id),
    loadAudit(db, "buy_request", id),
    db.select({
      id: supplierResponses.id,
      supplierKind: supplierResponses.supplierKind,
      supplierNameSnapshot: supplierResponses.supplierNameSnapshot,
      supplierContactSnapshot: supplierResponses.supplierContactSnapshot,
      supplierCountry: supplierResponses.supplierCountry,
      offeredPartNumber: supplierResponses.offeredPartNumber,
      statedCondition: supplierResponses.statedCondition,
      quantityAvailable: supplierResponses.quantityAvailable,
      supplierUnitCost: supplierResponses.supplierUnitCost,
      currencyCode: supplierResponses.currencyCode,
      quoteOnRequest: supplierResponses.quoteOnRequest,
      availabilityState: supplierResponses.availabilityState,
      locationText: supplierResponses.locationText,
      leadTimeDays: supplierResponses.leadTimeDays,
      documentsSummary: supplierResponses.documentsSummary,
      shippingNotes: supplierResponses.shippingNotes,
      status: supplierResponses.status,
      recordedByEmail: adminUsers.displayEmail,
      receivedAt: supplierResponses.receivedAt,
      expiresAt: supplierResponses.expiresAt,
    }).from(supplierResponses)
      .leftJoin(adminUsers, eq(supplierResponses.recordedByAdminUserId, adminUsers.id))
      .where(eq(supplierResponses.buyRequestId, id))
      .orderBy(desc(supplierResponses.receivedAt), desc(supplierResponses.id)),
    // No supplier column is selected here, by design: see BuyerOfferRecord.
    db.select({
      id: buyerOffers.id,
      version: buyerOffers.version,
      civilonSaleUnitPrice: buyerOffers.civilonSaleUnitPrice,
      currencyCode: buyerOffers.currencyCode,
      quantity: buyerOffers.quantity,
      statedCondition: buyerOffers.statedCondition,
      documentsSummary: buyerOffers.documentsSummary,
      deliveryOption: buyerOffers.deliveryOption,
      shippingAndExportScope: buyerOffers.shippingAndExportScope,
      leadTimeDays: buyerOffers.leadTimeDays,
      status: buyerOffers.status,
      createdByEmail: adminUsers.displayEmail,
      sentAt: buyerOffers.sentAt,
      respondedAt: buyerOffers.respondedAt,
      expiresAt: buyerOffers.expiresAt,
      supersededAt: buyerOffers.supersededAt,
      createdAt: buyerOffers.createdAt,
    }).from(buyerOffers)
      .leftJoin(adminUsers, eq(buyerOffers.createdByAdminUserId, adminUsers.id))
      .where(eq(buyerOffers.buyRequestId, id))
      .orderBy(desc(buyerOffers.version)),
  ]);

  return {
    buyRequest: {
      ...record.buyRequest,
      verificationState: contactVerificationState(record.contact.verificationState),
    },
    contact: record.contact,
    assignee,
    notes,
    audit,
    supplierResponses: supplierResponseRows,
    buyerOffers: buyerOfferRows,
  };
}

export type SellSubmissionItemRecord = {
  id: string;
  lineNumber: number;
  originalPartNumber: string | null;
  normalizedPartNumber: string | null;
  description: string | null;
  quantity: string | null;
  conditionCode: string | null;
  askingUnitPrice: string | null;
  currencyCode: string | null;
  quoteOnRequest: boolean;
  locationText: string | null;
  documentsSummary: string | null;
  sourceAttachmentId: string | null;
  sourceRowReference: string | null;
  createdAt: Date;
};

/**
 * Evidence as staff may see it before an authenticated download exists:
 * filename, purpose, size, declared and detected type, scan state and
 * retention. Deliberately absent: the storage key, the storage provider, the
 * content digest and the originating upload handle.
 */
export type SellAttachmentMetadata = {
  id: string;
  displayFilename: string;
  purpose: string;
  uploadedByType: string;
  byteSize: string;
  declaredMime: string | null;
  detectedMime: string | null;
  scanState: string;
  quarantineReleasedAt: Date | null;
  reviewState: InternalReviewState;
  reviewedAt: Date | null;
  reviewedByEmail: string | null;
  retentionClass: string;
  deletionDueAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
};

/**
 * The latest follow-up evidence request, as staff need to read it.
 *
 * Deliberately without `keyed_token_hash`, `token_derivation_nonce`, or
 * anything from which a link could be reconstructed: a staff page has no use
 * for the credential, and a projection that cannot select it cannot leak it
 * into a server-rendered payload. What staff need is what was asked for, when,
 * until when, and whether the seller has answered.
 *
 * `deliveryState` is the shared outbox's own state for this request's e-mail,
 * carried so the page can distinguish a request Civilon recorded from an e-mail
 * Civilon actually sent. The outbox row's recipient reference, idempotency key
 * and provider message id stay out: the delivery *state* is what staff need,
 * and the address is already on the contact panel under its own permission.
 */
export type SellEvidenceRequestSummary = {
  id: string;
  categories: string[];
  requestedByEmail: string | null;
  issuedAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
  revokedAt: Date | null;
  submittedAttachmentCount: number;
  /** The outbox state, or null when no message row resolves for this request. */
  deliveryState: string | null;
  /** When the provider accepted the message. Null until it has. */
  deliveredAt: Date | null;
};

/**
 * The latest bulk-inventory freshness check, as staff need to read it.
 *
 * Deliberately without `keyed_token_hash`, `token_derivation_nonce`, or anything
 * from which a link could be reconstructed: a staff page has no use for the
 * credential, and a projection that cannot select it cannot leak it into a
 * server-rendered payload. What staff need is when Civilon asked, until when the
 * link lives, whether the e-mail went out, and what the seller said.
 *
 * `response` is the seller's own statement and is carried as the raw stored
 * code. It is not a status, not a review outcome, and the page that renders it
 * says so.
 */
export type SellInventoryFreshnessSummary = {
  id: string;
  requestedByEmail: string | null;
  issuedAt: Date;
  expiresAt: Date;
  respondedAt: Date | null;
  revokedAt: Date | null;
  response: string | null;
  /** The outbox state, or null when no message row resolves for this check. */
  deliveryState: string | null;
  /** When the provider accepted the message. Null until it has. */
  deliveredAt: Date | null;
};

export type SellSubmissionAdminDetail = {
  sellSubmission: {
    id: string;
    publicReference: string;
    status: string;
    verificationState: UnifiedQueueVerificationState;
    submissionKind: string;
    originalPartNumber: string | null;
    normalizedPartNumber: string | null;
    description: string | null;
    quantity: string | null;
    conditionCode: string | null;
    askingUnitPrice: string | null;
    currencyCode: string | null;
    quoteOnRequest: boolean;
    estimatedLineItemCount: number | null;
    locationCountry: string | null;
    locationStateRegion: string | null;
    locationCity: string | null;
    locationPostalCode: string | null;
    canShipToNewJersey: boolean | null;
    documentsSummary: string | null;
    customerNotes: string | null;
    sourcePage: string;
    landingPage: string | null;
    referrerOrigin: string | null;
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    utmContent: string | null;
    utmTerm: string | null;
    verificationRequestedAt: Date | null;
    verifiedAt: Date | null;
    submittedAt: Date;
    createdAt: Date;
    updatedAt: Date;
    closedAt: Date | null;
  };
  contact: MarketplaceContactSummary;
  assignee: MarketplaceAssignee;
  items: SellSubmissionItemRecord[];
  attachments: SellAttachmentMetadata[];
  /** The most recent follow-up evidence request, or null if none was ever sent. */
  evidenceRequest: SellEvidenceRequestSummary | null;
  /**
   * The most recent bulk-inventory freshness check, or null if none was ever
   * issued. Null on every single-part record, because none is ever issued there.
   */
  inventoryFreshness: SellInventoryFreshnessSummary | null;
  notes: MarketplaceNoteRecord[];
  audit: MarketplaceAuditRecord[];
};

/**
 * A Sell Submission as staff need to see it, including its bulk-inventory line
 * items and its evidence metadata. Returns `null` when no Sell Submission has
 * that id. Every child collection is bound to this parent by its own foreign
 * key, so an id from one aggregate can never surface another aggregate's rows.
 */
export async function getSellSubmissionAdminDetail(db: PriceCheckDb, id: string): Promise<SellSubmissionAdminDetail | null> {
  const [record] = await db.select({
    sellSubmission: {
      id: sellSubmissions.id,
      publicReference: sellSubmissions.publicReference,
      status: sellSubmissions.status,
      submissionKind: sellSubmissions.submissionKind,
      originalPartNumber: sellSubmissions.originalPartNumber,
      normalizedPartNumber: sellSubmissions.normalizedPartNumber,
      description: sellSubmissions.description,
      quantity: sellSubmissions.quantity,
      conditionCode: sellSubmissions.conditionCode,
      askingUnitPrice: sellSubmissions.askingUnitPrice,
      currencyCode: sellSubmissions.currencyCode,
      quoteOnRequest: sellSubmissions.quoteOnRequest,
      estimatedLineItemCount: sellSubmissions.estimatedLineItemCount,
      locationCountry: sellSubmissions.locationCountry,
      locationStateRegion: sellSubmissions.locationStateRegion,
      locationCity: sellSubmissions.locationCity,
      locationPostalCode: sellSubmissions.locationPostalCode,
      canShipToNewJersey: sellSubmissions.canShipToNewJersey,
      documentsSummary: sellSubmissions.documentsSummary,
      customerNotes: sellSubmissions.notes,
      sourcePage: sellSubmissions.sourcePage,
      landingPage: sellSubmissions.landingPage,
      referrerOrigin: sellSubmissions.referrerOrigin,
      utmSource: sellSubmissions.utmSource,
      utmMedium: sellSubmissions.utmMedium,
      utmCampaign: sellSubmissions.utmCampaign,
      utmContent: sellSubmissions.utmContent,
      utmTerm: sellSubmissions.utmTerm,
      verificationRequestedAt: sellSubmissions.verificationRequestedAt,
      verifiedAt: sellSubmissions.verifiedAt,
      submittedAt: sellSubmissions.submittedAt,
      createdAt: sellSubmissions.createdAt,
      updatedAt: sellSubmissions.updatedAt,
      closedAt: sellSubmissions.closedAt,
    },
    contact: contactColumns,
    assignedAdminUserId: sellSubmissions.assignedAdminUserId,
  }).from(sellSubmissions)
    .innerJoin(marketplaceContacts, eq(sellSubmissions.contactId, marketplaceContacts.id))
    .leftJoin(businessReviewer, eq(marketplaceContacts.businessReviewedByAdminUserId, businessReviewer.id))
    .where(eq(sellSubmissions.id, id))
    .limit(1);
  if (!record) return null;

  const [assignee, notes, audit, items, attachments, evidenceRequests, freshnessChecks] = await Promise.all([
    loadAssignee(db, record.assignedAdminUserId),
    loadNotes(db, "sell_submission", id),
    loadAudit(db, "sell_submission", id),
    db.select({
      id: sellSubmissionItems.id,
      lineNumber: sellSubmissionItems.lineNumber,
      originalPartNumber: sellSubmissionItems.originalPartNumber,
      normalizedPartNumber: sellSubmissionItems.normalizedPartNumber,
      description: sellSubmissionItems.description,
      quantity: sellSubmissionItems.quantity,
      conditionCode: sellSubmissionItems.conditionCode,
      askingUnitPrice: sellSubmissionItems.askingUnitPrice,
      currencyCode: sellSubmissionItems.currencyCode,
      quoteOnRequest: sellSubmissionItems.quoteOnRequest,
      locationText: sellSubmissionItems.locationText,
      documentsSummary: sellSubmissionItems.documentsSummary,
      sourceAttachmentId: sellSubmissionItems.sourceAttachmentId,
      sourceRowReference: sellSubmissionItems.sourceRowReference,
      createdAt: sellSubmissionItems.createdAt,
    }).from(sellSubmissionItems)
      .where(eq(sellSubmissionItems.sellSubmissionId, id))
      .orderBy(asc(sellSubmissionItems.lineNumber)),
    // Metadata only. No storage key, provider, digest or upload handle.
    db.select({
      id: marketplaceAttachments.id,
      displayFilename: marketplaceAttachments.displayFilename,
      purpose: marketplaceAttachments.purpose,
      uploadedByType: marketplaceAttachments.uploadedByType,
      byteSize: marketplaceAttachments.byteSize,
      declaredMime: marketplaceAttachments.declaredMime,
      detectedMime: marketplaceAttachments.detectedMime,
      scanState: marketplaceAttachments.scanState,
      quarantineReleasedAt: marketplaceAttachments.quarantineReleasedAt,
      reviewState: marketplaceAttachments.reviewState,
      reviewedAt: marketplaceAttachments.reviewedAt,
      reviewedByEmail: attachmentReviewer.displayEmail,
      retentionClass: marketplaceAttachments.retentionClass,
      deletionDueAt: marketplaceAttachments.deletionDueAt,
      deletedAt: marketplaceAttachments.deletedAt,
      createdAt: marketplaceAttachments.createdAt,
    }).from(marketplaceAttachments)
      .leftJoin(attachmentReviewer, eq(marketplaceAttachments.reviewedByAdminUserId, attachmentReviewer.id))
      .where(eq(marketplaceAttachments.sellSubmissionId, id))
      .orderBy(asc(marketplaceAttachments.createdAt), asc(marketplaceAttachments.id)),
    // The latest follow-up evidence request. Credential columns are not in the
    // projection at all, so no staff surface can render or forward one.
    db.select({
      id: marketplaceEvidenceRequests.id,
      categories: marketplaceEvidenceRequests.requestedCategories,
      requestedByEmail: evidenceRequester.displayEmail,
      issuedAt: marketplaceEvidenceRequests.issuedAt,
      expiresAt: marketplaceEvidenceRequests.expiresAt,
      consumedAt: marketplaceEvidenceRequests.consumedAt,
      revokedAt: marketplaceEvidenceRequests.revokedAt,
      submittedAttachmentCount: marketplaceEvidenceRequests.submittedAttachmentCount,
      // The e-mail's real state, not an assumption that queuing is sending.
      // One outbox row exists per request — the idempotency key is derived from
      // the request id — so this join cannot multiply the row.
      deliveryState: notificationOutbox.state,
      deliveredAt: notificationOutbox.sentAt,
    }).from(marketplaceEvidenceRequests)
      .leftJoin(evidenceRequester, eq(marketplaceEvidenceRequests.requestedByAdminUserId, evidenceRequester.id))
      .leftJoin(notificationOutbox, and(
        eq(notificationOutbox.aggregateType, SELL_EVIDENCE_REQUEST_AGGREGATE_TYPE),
        eq(notificationOutbox.aggregateId, marketplaceEvidenceRequests.id),
        eq(notificationOutbox.messageType, SELL_EVIDENCE_REQUEST_MESSAGE_TYPE),
      ))
      .where(eq(marketplaceEvidenceRequests.sellSubmissionId, id))
      .orderBy(desc(marketplaceEvidenceRequests.issuedAt), desc(marketplaceEvidenceRequests.id))
      .limit(1),
    // The latest bulk-inventory freshness check. Credential columns are not in
    // the projection at all, so no staff surface can render or forward one.
    db.select({
      id: sellInventoryFreshnessChecks.id,
      requestedByEmail: freshnessRequester.displayEmail,
      issuedAt: sellInventoryFreshnessChecks.issuedAt,
      expiresAt: sellInventoryFreshnessChecks.expiresAt,
      respondedAt: sellInventoryFreshnessChecks.respondedAt,
      revokedAt: sellInventoryFreshnessChecks.revokedAt,
      response: sellInventoryFreshnessChecks.response,
      // The e-mail's real state, not an assumption that queuing is sending. One
      // outbox row exists per check — the idempotency key is derived from the
      // check id — so this join cannot multiply the row.
      deliveryState: notificationOutbox.state,
      deliveredAt: notificationOutbox.sentAt,
    }).from(sellInventoryFreshnessChecks)
      .leftJoin(freshnessRequester, eq(sellInventoryFreshnessChecks.requestedByAdminUserId, freshnessRequester.id))
      .leftJoin(notificationOutbox, and(
        eq(notificationOutbox.aggregateType, SELL_INVENTORY_FRESHNESS_AGGREGATE_TYPE),
        eq(notificationOutbox.aggregateId, sellInventoryFreshnessChecks.id),
        eq(notificationOutbox.messageType, SELL_INVENTORY_FRESHNESS_MESSAGE_TYPE),
      ))
      .where(eq(sellInventoryFreshnessChecks.sellSubmissionId, id))
      .orderBy(desc(sellInventoryFreshnessChecks.issuedAt), desc(sellInventoryFreshnessChecks.id))
      .limit(1),
  ]);

  return {
    sellSubmission: {
      ...record.sellSubmission,
      verificationState: contactVerificationState(record.contact.verificationState),
    },
    contact: record.contact,
    assignee,
    items,
    attachments,
    evidenceRequest: evidenceRequests[0] ?? null,
    inventoryFreshness: freshnessChecks[0] ?? null,
    notes,
    audit,
  };
}
