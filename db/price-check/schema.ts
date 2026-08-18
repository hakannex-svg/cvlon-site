import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

const id = (name = "id") => varchar(name, { length: 26 });
const utcTimestamp = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
const money = (name: string) => numeric(name, { precision: 18, scale: 2 });
const analysisMoney = (name: string) => numeric(name, { precision: 18, scale: 4 });

export const adminRoleEnum = pgEnum("admin_role", [
  "ANALYST",
  "REVIEWER",
  "ADMIN",
  "AUDITOR",
]);
export const priceCheckStatusEnum = pgEnum("price_check_status", [
  "submitted",
  "upload_processing",
  "extraction_review",
  "processing_failed",
  "needs_information",
  "ready_for_analysis",
  "analysis_ready",
  "human_review",
  "approved",
  "sent",
  "quote_requested",
  "converted",
  "closed",
  "spam",
  "withdrawn",
]);
export const quoteOrPurchasedEnum = pgEnum("quote_or_purchased", [
  "quote",
  "purchased",
]);
export const transactionTypeEnum = pgEnum("price_check_transaction_type", [
  "outright",
  "exchange",
  "repair",
  "not_sure",
]);
export const conditionCodeEnum = pgEnum("price_check_condition_code", [
  "NE",
  "NS",
  "OH",
  "SV",
  "AR",
  "NOT_SURE",
]);
export const coreDispositionEnum = pgEnum("core_disposition", [
  "REFUNDABLE",
  "FORFEITED",
  "UNCLEAR",
  "NOT_APPLICABLE",
]);
export const warrantyUnitEnum = pgEnum("warranty_unit", [
  "DAYS",
  "MONTHS",
  "YEARS",
  "HOURS",
  "CYCLES",
  "OTHER",
]);
export const documentationCodeEnum = pgEnum("documentation_code", [
  "FAA_8130_3",
  "EASA_FORM_1",
  "DUAL_RELEASE",
  "OEM_MANUFACTURER_COC",
  "MATERIAL_CERTIFICATION",
  "REMOVAL_RECORDS",
  "TEARDOWN_EVALUATION_REPORT",
  "TEST_REPORT",
  "OTHER",
  "NOT_SURE",
]);
export const actorTypeEnum = pgEnum("price_check_actor_type", [
  "REQUESTER",
  "ADMIN",
  "SYSTEM",
  "WORKER",
]);
export const uploadedByTypeEnum = pgEnum("attachment_uploaded_by_type", [
  "REQUESTER",
  "ADMIN",
  "SYSTEM",
]);
export const scanStateEnum = pgEnum("attachment_scan_state", [
  "PENDING",
  "QUARANTINED",
  "CLEAN",
  "REJECTED",
  "FAILED",
]);
export const retentionClassEnum = pgEnum("attachment_retention_class", [
  "PRICE_CHECK_EVIDENCE",
  "TEMPORARY_PROCESSING",
  "LEGAL_HOLD",
]);
export const extractionStatusEnum = pgEnum("extraction_status", [
  "PENDING",
  "PROCESSING",
  "SUCCEEDED",
  "FAILED",
]);
export const extractionAcceptanceEnum = pgEnum("extraction_acceptance_state", [
  "PENDING",
  "ACCEPTED",
  "PARTIALLY_ACCEPTED",
  "REJECTED",
]);
export const provenanceTypeEnum = pgEnum("observation_provenance_type", [
  "CIVILON_SUPPLIER_QUOTE",
  "CIVILON_PURCHASE",
  "CIVILON_SALE",
  "CUSTOMER_SUPPLIER_QUOTE",
  "CUSTOMER_COMPLETED_PURCHASE",
  "ANALYST_OBSERVATION",
  "LICENSED_MARKET_DATA",
  "OTHER_AUTHORIZED",
]);
export const reliabilityEnum = pgEnum("source_reliability", [
  "HIGH",
  "MEDIUM",
  "LOW",
  "UNKNOWN",
]);
export const verificationStateEnum = pgEnum("verification_state", [
  "UNVERIFIED",
  "PENDING",
  "VERIFIED",
  "REJECTED",
]);
export const permittedUseStateEnum = pgEnum("permitted_use_state", [
  "PENDING",
  "INTERNAL_ANALYSIS",
  "AGGREGATE_ONLY",
  "PROHIBITED",
]);
export const deidentificationStateEnum = pgEnum("deidentification_state", [
  "IDENTIFIED",
  "PSEUDONYMIZED",
  "DEIDENTIFIED",
]);
export const partRelationshipTypeEnum = pgEnum("part_relationship_type", [
  "EXACT",
  "SUPERSEDES",
  "SUPERSEDED_BY",
  "INTERCHANGEABLE",
  "RELATED_APPLICATION",
]);
export const analysisConfidenceEnum = pgEnum("analysis_confidence", [
  "HIGH",
  "MEDIUM",
  "LOW",
  "INSUFFICIENT_DATA",
]);
export const analysisReviewStateEnum = pgEnum("analysis_review_state", [
  "DRAFT",
  "HUMAN_REVIEW",
  "APPROVED",
  "REJECTED",
  "SUPERSEDED",
]);
export const aiValidationStateEnum = pgEnum("ai_validation_state", [
  "PENDING",
  "VALID",
  "INVALID",
  "FAILED",
]);
export const jobStateEnum = pgEnum("processing_job_state", [
  "pending",
  "running",
  "succeeded",
  "failed",
  "dead_letter",
]);
export const processingJobTypeEnum = pgEnum("processing_job_type", [
  "ATTACHMENT_LIFECYCLE",
  "EXTRACTION",
  "EXPLANATION_DRAFT",
  "ANALYSIS",
  "NOTIFICATION_DELIVERY",
  "MAINTENANCE",
]);
export const outboxStateEnum = pgEnum("notification_outbox_state", [
  "pending",
  "running",
  "succeeded",
  "failed",
  "dead_letter",
]);
export const uploadStateEnum = pgEnum("price_check_upload_state", [
  "AUTHORIZED",
  "UPLOADED",
  "BOUND",
  "REJECTED",
  "EXPIRED",
]);
export const resultStateEnum = pgEnum("price_check_result_state", [
  "DRAFT",
  "APPROVED",
  "SENT",
  "SUPERSEDED",
]);
export const sourcingOpportunityStatusEnum = pgEnum(
  "sourcing_opportunity_status",
  [
    "requested",
    "assigned",
    "contacted",
    "quoted",
    "converted",
    "closed",
    "cancelled",
  ],
);

export const requesters = pgTable(
  "requesters",
  {
    id: id().primaryKey(),
    firstName: varchar("first_name", { length: 120 }).notNull(),
    lastName: varchar("last_name", { length: 120 }).notNull(),
    companyName: varchar("company_name", { length: 200 }).notNull(),
    businessEmail: varchar("business_email", { length: 320 }).notNull(),
    normalizedEmail: varchar("normalized_email", { length: 320 }).notNull(),
    phone: varchar("phone", { length: 80 }),
    normalizedPhone: varchar("normalized_phone", { length: 32 }),
    role: varchar("role", { length: 120 }),
    country: varchar("country", { length: 2 }),
    serviceProcessingAcknowledgedAt: utcTimestamp(
      "service_processing_acknowledged_at",
    ).notNull(),
    marketingConsentAt: utcTimestamp("marketing_consent_at"),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    updatedAt: utcTimestamp("updated_at").notNull().defaultNow(),
    deletionRequestedAt: utcTimestamp("deletion_requested_at"),
    deletedAt: utcTimestamp("deleted_at"),
  },
  (table) => [
    index("requesters_normalized_email_idx").on(table.normalizedEmail),
    index("requesters_normalized_phone_idx").on(table.normalizedPhone),
    check("requesters_country_iso2_chk", sql`${table.country} ~ '^[A-Z]{2}$'`),
  ],
);

export const adminUsers = pgTable(
  "admin_users",
  {
    id: id().primaryKey(),
    identityProviderIssuer: text("identity_provider_issuer").notNull(),
    identityProviderSubject: text("identity_provider_subject").notNull(),
    displayEmail: varchar("display_email", { length: 320 }).notNull(),
    role: adminRoleEnum("role").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    updatedAt: utcTimestamp("updated_at").notNull().defaultNow(),
    lastLoginAt: utcTimestamp("last_login_at"),
    deactivatedAt: utcTimestamp("deactivated_at"),
  },
  (table) => [
    uniqueIndex("admin_users_identity_uidx").on(
      table.identityProviderIssuer,
      table.identityProviderSubject,
    ),
    uniqueIndex("admin_users_display_email_uidx").on(table.displayEmail),
    index("admin_users_active_idx").on(table.active),
  ],
);

export const adminSessions = pgTable(
  "admin_sessions",
  {
    id: id().primaryKey(),
    adminUserId: id("admin_user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 128 }).notNull(),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    expiresAt: utcTimestamp("expires_at").notNull(),
    lastSeenAt: utcTimestamp("last_seen_at").notNull().defaultNow(),
    revokedAt: utcTimestamp("revoked_at"),
  },
  (table) => [
    uniqueIndex("admin_sessions_token_hash_uidx").on(table.tokenHash),
    index("admin_sessions_admin_user_idx").on(table.adminUserId),
    index("admin_sessions_expiry_idx").on(table.expiresAt),
    check("admin_sessions_expiry_chk", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export const priceChecks = pgTable(
  "price_checks",
  {
    id: id().primaryKey(),
    publicReference: varchar("public_reference", { length: 16 }).notNull(),
    requesterId: id("requester_id")
      .notNull()
      .references(() => requesters.id, { onDelete: "restrict" }),
    status: priceCheckStatusEnum("status").notNull().default("submitted"),
    assignedAdminUserId: id("assigned_admin_user_id").references(
      () => adminUsers.id,
      { onDelete: "set null" },
    ),
    originalPartNumber: varchar("original_part_number", { length: 160 }).notNull(),
    normalizedPartNumber: varchar("normalized_part_number", { length: 120 }).notNull(),
    description: text("description"),
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
    quoteOrPurchased: quoteOrPurchasedEnum("quote_or_purchased").notNull(),
    transactionType: transactionTypeEnum("transaction_type").notNull(),
    conditionCode: conditionCodeEnum("condition_code").notNull(),
    unitPrice: money("unit_price").notNull(),
    currencyCode: varchar("currency_code", { length: 3 }).notNull(),
    coreCharge: money("core_charge"),
    coreDisposition: coreDispositionEnum("core_disposition"),
    exchangeFee: money("exchange_fee"),
    freight: money("freight"),
    transactionDate: date("transaction_date", { mode: "string" }),
    transactionDateUncertain: boolean("transaction_date_uncertain")
      .notNull()
      .default(false),
    aircraftModel: varchar("aircraft_model", { length: 160 }),
    aog: boolean("aog").notNull().default(false),
    warrantyValue: numeric("warranty_value", { precision: 12, scale: 2 }),
    warrantyUnit: warrantyUnitEnum("warranty_unit"),
    warrantyText: text("warranty_text"),
    notes: text("notes"),
    sourcePage: varchar("source_page", { length: 240 }).notNull(),
    landingPage: varchar("landing_page", { length: 500 }),
    referrerOrigin: varchar("referrer_origin", { length: 255 }),
    utmSource: varchar("utm_source", { length: 160 }),
    utmMedium: varchar("utm_medium", { length: 160 }),
    utmCampaign: varchar("utm_campaign", { length: 160 }),
    utmContent: varchar("utm_content", { length: 160 }),
    utmTerm: varchar("utm_term", { length: 160 }),
    idempotencyHash: varchar("idempotency_hash", { length: 128 }).notNull(),
    currentAnalysisId: id("current_analysis_id").references(
      (): AnyPgColumn => priceCheckAnalyses.id,
      { onDelete: "set null" },
    ),
    currentResultId: id("current_result_id").references(
      (): AnyPgColumn => priceCheckResults.id,
      { onDelete: "set null" },
    ),
    submittedAt: utcTimestamp("submitted_at").notNull(),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    updatedAt: utcTimestamp("updated_at").notNull().defaultNow(),
    closedAt: utcTimestamp("closed_at"),
  },
  (table) => [
    uniqueIndex("price_checks_public_reference_uidx").on(table.publicReference),
    uniqueIndex("price_checks_idempotency_hash_uidx").on(table.idempotencyHash),
    index("price_checks_status_idx").on(table.status),
    index("price_checks_assignee_idx").on(table.assignedAdminUserId),
    index("price_checks_submitted_at_idx").on(table.submittedAt),
    index("price_checks_normalized_part_number_idx").on(
      table.normalizedPartNumber,
    ),
    check("price_checks_quantity_positive_chk", sql`${table.quantity} > 0`),
    check("price_checks_unit_price_positive_chk", sql`${table.unitPrice} > 0`),
    check(
      "price_checks_currency_iso4217_chk",
      sql`${table.currencyCode} in ('AUD', 'CAD', 'CHF', 'EUR', 'GBP', 'JPY', 'USD')`,
    ),
    check(
      "price_checks_public_reference_chk",
      sql`${table.publicReference} ~ '^PC-[0-9A-HJKMNP-TV-Z]{10}$'`,
    ),
    check(
      "price_checks_money_nonnegative_chk",
      sql`coalesce(${table.coreCharge}, 0) >= 0 and coalesce(${table.exchangeFee}, 0) >= 0 and coalesce(${table.freight}, 0) >= 0`,
    ),
  ],
);

export const priceCheckDocumentRequirements = pgTable(
  "price_check_document_requirements",
  {
    priceCheckId: id("price_check_id")
      .notNull()
      .references(() => priceChecks.id, { onDelete: "cascade" }),
    requirementCode: documentationCodeEnum("requirement_code").notNull(),
    otherText: varchar("other_text", { length: 240 }),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "price_check_document_requirements_pk",
      columns: [table.priceCheckId, table.requirementCode],
    }),
    check(
      "price_check_document_requirements_other_chk",
      sql`(${table.requirementCode} = 'OTHER' and nullif(btrim(${table.otherText}), '') is not null) or (${table.requirementCode} <> 'OTHER' and ${table.otherText} is null)`,
    ),
  ],
);

export const uploadSessions = pgTable(
  "price_check_upload_sessions",
  {
    id: id().primaryKey(),
    tokenHash: varchar("token_hash", { length: 128 }).notNull(),
    authorizedCount: integer("authorized_count").notNull().default(0),
    expectedByteSize: numeric("expected_byte_size", { precision: 20, scale: 0 })
      .notNull()
      .default("0"),
    expiresAt: utcTimestamp("expires_at").notNull(),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    updatedAt: utcTimestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("price_check_upload_sessions_token_hash_uidx").on(table.tokenHash),
    index("price_check_upload_sessions_expiry_idx").on(table.expiresAt),
    check("price_check_upload_sessions_count_chk", sql`${table.authorizedCount} between 0 and 3`),
    check("price_check_upload_sessions_bytes_chk", sql`${table.expectedByteSize} between 0 and 31457280`),
    check("price_check_upload_sessions_expiry_chk", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export const pendingUploads = pgTable(
  "price_check_pending_uploads",
  {
    id: id().primaryKey(),
    uploadSessionId: id("upload_session_id")
      .notNull()
      .references(() => uploadSessions.id, { onDelete: "cascade" }),
    objectKey: varchar("object_key", { length: 700 }).notNull(),
    displayFilename: varchar("display_filename", { length: 255 }).notNull(),
    declaredMime: varchar("declared_mime", { length: 255 }).notNull(),
    expectedByteSize: numeric("expected_byte_size", { precision: 20, scale: 0 }).notNull(),
    state: uploadStateEnum("state").notNull().default("AUTHORIZED"),
    claimedPriceCheckId: id("claimed_price_check_id").references(() => priceChecks.id, {
      onDelete: "restrict",
    }),
    expiresAt: utcTimestamp("expires_at").notNull(),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    updatedAt: utcTimestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("price_check_pending_uploads_object_key_uidx").on(table.objectKey),
    index("price_check_pending_uploads_session_idx").on(table.uploadSessionId),
    index("price_check_pending_uploads_expiry_idx").on(table.expiresAt),
    index("price_check_pending_uploads_claim_idx").on(table.claimedPriceCheckId),
    check("price_check_pending_uploads_bytes_chk", sql`${table.expectedByteSize} between 1 and 10485760`),
  ],
);

export const attachments = pgTable(
  "attachments",
  {
    id: id().primaryKey(),
    priceCheckId: id("price_check_id")
      .notNull()
      .references(() => priceChecks.id, { onDelete: "restrict" }),
    uploadedByType: uploadedByTypeEnum("uploaded_by_type").notNull(),
    displayFilename: varchar("display_filename", { length: 255 }).notNull(),
    objectKey: varchar("object_key", { length: 700 }).notNull(),
    storageProvider: varchar("storage_provider", { length: 80 }).notNull(),
    declaredMime: varchar("declared_mime", { length: 255 }),
    detectedMime: varchar("detected_mime", { length: 255 }),
    byteSize: numeric("byte_size", { precision: 20, scale: 0 }).notNull(),
    contentDigest: varchar("content_digest", { length: 128 }),
    scanState: scanStateEnum("scan_state").notNull().default("PENDING"),
    retentionClass: retentionClassEnum("retention_class").notNull(),
    deletionDueAt: utcTimestamp("deletion_due_at"),
    deletedAt: utcTimestamp("deleted_at"),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    updatedAt: utcTimestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("attachments_object_key_uidx").on(table.objectKey),
    index("attachments_price_check_idx").on(table.priceCheckId),
    index("attachments_not_deleted_idx")
      .on(table.priceCheckId)
      .where(sql`${table.deletedAt} is null`),
    check("attachments_byte_size_nonnegative_chk", sql`${table.byteSize} >= 0`),
  ],
);

export const attachmentExtractions = pgTable(
  "attachment_extractions",
  {
    id: id().primaryKey(),
    attachmentId: id("attachment_id")
      .notNull()
      .references(() => attachments.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    provider: varchar("provider", { length: 120 }),
    configuredModelId: varchar("configured_model_id", { length: 200 }),
    schemaVersion: varchar("schema_version", { length: 80 }).notNull(),
    promptVersion: varchar("prompt_version", { length: 80 }),
    structuredProposal: jsonb("structured_proposal")
      .$type<Record<string, unknown>>()
      .notNull(),
    sourceLocations: jsonb("source_locations").$type<unknown[]>(),
    uncertaintyWarnings: jsonb("uncertainty_warnings").$type<unknown[]>(),
    processingStatus: extractionStatusEnum("processing_status").notNull(),
    validationErrors: jsonb("validation_errors").$type<unknown[]>(),
    reviewedBy: id("reviewed_by").references(() => adminUsers.id, {
      onDelete: "set null",
    }),
    reviewedAt: utcTimestamp("reviewed_at"),
    acceptanceState: extractionAcceptanceEnum("acceptance_state")
      .notNull()
      .default("PENDING"),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("attachment_extractions_version_uidx").on(
      table.attachmentId,
      table.version,
    ),
    check("attachment_extractions_version_positive_chk", sql`${table.version} > 0`),
  ],
);

export const priceCheckRevisions = pgTable(
  "price_check_revisions",
  {
    id: id().primaryKey(),
    priceCheckId: id("price_check_id")
      .notNull()
      .references(() => priceChecks.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    normalizedSnapshot: jsonb("normalized_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    changeReason: text("change_reason").notNull(),
    actorType: actorTypeEnum("actor_type").notNull(),
    actorId: id("actor_id"),
    sourceExtractionId: id("source_extraction_id").references(
      () => attachmentExtractions.id,
      { onDelete: "set null" },
    ),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("price_check_revisions_version_uidx").on(
      table.priceCheckId,
      table.version,
    ),
    check("price_check_revisions_version_positive_chk", sql`${table.version} > 0`),
  ],
);

export const priceObservations = pgTable(
  "price_observations",
  {
    id: id().primaryKey(),
    provenanceType: provenanceTypeEnum("provenance_type").notNull(),
    internalSourceReference: varchar("internal_source_reference", { length: 240 }),
    originalPartNumber: varchar("original_part_number", { length: 160 }).notNull(),
    normalizedPartNumber: varchar("normalized_part_number", { length: 120 }).notNull(),
    conditionCode: conditionCodeEnum("condition_code").notNull(),
    transactionType: transactionTypeEnum("transaction_type").notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
    unitPrice: money("unit_price").notNull(),
    currencyCode: varchar("currency_code", { length: 3 }).notNull(),
    coreCharge: money("core_charge"),
    coreDisposition: coreDispositionEnum("core_disposition"),
    exchangeFee: money("exchange_fee"),
    freight: money("freight"),
    observationDate: date("observation_date", { mode: "string" }).notNull(),
    warrantyValue: numeric("warranty_value", { precision: 12, scale: 2 }),
    warrantyUnit: warrantyUnitEnum("warranty_unit"),
    warrantyText: text("warranty_text"),
    aog: boolean("aog").notNull().default(false),
    aircraftApplication: varchar("aircraft_application", { length: 240 }),
    regionContext: varchar("region_context", { length: 160 }),
    availabilityEvidence: text("availability_evidence"),
    availabilityObservedAt: utcTimestamp("availability_observed_at"),
    sourceReliability: reliabilityEnum("source_reliability").notNull(),
    verificationState: verificationStateEnum("verification_state").notNull(),
    permittedUseState: permittedUseStateEnum("permitted_use_state").notNull(),
    deidentificationState: deidentificationStateEnum(
      "deidentification_state",
    ).notNull(),
    createdBy: id("created_by").references(() => adminUsers.id, {
      onDelete: "set null",
    }),
    reviewedBy: id("reviewed_by").references(() => adminUsers.id, {
      onDelete: "set null",
    }),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    reviewedAt: utcTimestamp("reviewed_at"),
  },
  (table) => [
    index("price_observations_part_idx").on(table.normalizedPartNumber),
    index("price_observations_condition_idx").on(table.conditionCode),
    index("price_observations_transaction_type_idx").on(table.transactionType),
    index("price_observations_date_idx").on(table.observationDate),
    index("price_observations_permitted_use_idx").on(table.permittedUseState),
    index("price_observations_verification_idx").on(table.verificationState),
    check("price_observations_quantity_positive_chk", sql`${table.quantity} > 0`),
    check("price_observations_unit_price_positive_chk", sql`${table.unitPrice} > 0`),
    check(
      "price_observations_currency_iso4217_chk",
      sql`${table.currencyCode} in ('AUD', 'CAD', 'CHF', 'EUR', 'GBP', 'JPY', 'USD')`,
    ),
  ],
);

export const observationDocumentation = pgTable(
  "observation_documentation",
  {
    observationId: id("observation_id")
      .notNull()
      .references(() => priceObservations.id, { onDelete: "restrict" }),
    documentationCode: documentationCodeEnum("documentation_code").notNull(),
    otherText: varchar("other_text", { length: 240 }),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "observation_documentation_pk",
      columns: [table.observationId, table.documentationCode],
    }),
    check(
      "observation_documentation_other_chk",
      sql`(${table.documentationCode} = 'OTHER' and nullif(btrim(${table.otherText}), '') is not null) or (${table.documentationCode} <> 'OTHER' and ${table.otherText} is null)`,
    ),
  ],
);

export const partRelationships = pgTable(
  "part_relationships",
  {
    id: id().primaryKey(),
    fromNormalizedPartNumber: varchar("from_normalized_part_number", {
      length: 120,
    }).notNull(),
    toNormalizedPartNumber: varchar("to_normalized_part_number", {
      length: 120,
    }).notNull(),
    relationshipType: partRelationshipTypeEnum("relationship_type").notNull(),
    sourceProvenance: varchar("source_provenance", { length: 240 }).notNull(),
    verificationState: verificationStateEnum("verification_state").notNull(),
    reviewedBy: id("reviewed_by").references(() => adminUsers.id, {
      onDelete: "set null",
    }),
    effectiveFrom: date("effective_from", { mode: "string" }),
    effectiveTo: date("effective_to", { mode: "string" }),
    notes: text("notes"),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("part_relationships_definition_uidx").on(
      table.fromNormalizedPartNumber,
      table.toNormalizedPartNumber,
      table.relationshipType,
    ),
    index("part_relationships_from_idx").on(table.fromNormalizedPartNumber),
    index("part_relationships_to_idx").on(table.toNormalizedPartNumber),
    check(
      "part_relationships_distinct_parts_chk",
      sql`${table.fromNormalizedPartNumber} <> ${table.toNormalizedPartNumber} or ${table.relationshipType} = 'EXACT'`,
    ),
  ],
);

export const aiArtifacts = pgTable(
  "ai_artifacts",
  {
    id: id().primaryKey(),
    artifactType: varchar("artifact_type", { length: 80 }).notNull(),
    relatedPriceCheckId: id("related_price_check_id").references(
      () => priceChecks.id,
      { onDelete: "set null" },
    ),
    relatedExtractionId: id("related_extraction_id").references(
      () => attachmentExtractions.id,
      { onDelete: "set null" },
    ),
    relatedAnalysisId: id("related_analysis_id").references(
      (): AnyPgColumn => priceCheckAnalyses.id,
      { onDelete: "set null" },
    ),
    provider: varchar("provider", { length: 120 }),
    configuredModelId: varchar("configured_model_id", { length: 200 }),
    promptVersion: varchar("prompt_version", { length: 80 }),
    schemaVersion: varchar("schema_version", { length: 80 }).notNull(),
    redactionPolicyVersion: varchar("redaction_policy_version", {
      length: 80,
    }).notNull(),
    requestDigest: varchar("request_digest", { length: 128 }).notNull(),
    structuredResponse: jsonb("structured_response").$type<Record<
      string,
      unknown
    >>(),
    validationState: aiValidationStateEnum("validation_state").notNull(),
    tokenMetadata: jsonb("token_metadata").$type<Record<string, unknown>>(),
    latencyMetadata: jsonb("latency_metadata").$type<Record<string, unknown>>(),
    sanitizedErrorCategory: varchar("sanitized_error_category", { length: 120 }),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("ai_artifacts_request_digest_idx").on(table.requestDigest),
    index("ai_artifacts_price_check_idx").on(table.relatedPriceCheckId),
    index("ai_artifacts_analysis_idx").on(table.relatedAnalysisId),
  ],
);

export const priceCheckAnalyses = pgTable(
  "price_check_analyses",
  {
    id: id().primaryKey(),
    priceCheckId: id("price_check_id")
      .notNull()
      .references(() => priceChecks.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    inputRevisionId: id("input_revision_id")
      .notNull()
      .references(() => priceCheckRevisions.id, { onDelete: "restrict" }),
    engineVersion: varchar("engine_version", { length: 80 }).notNull(),
    policyVersion: varchar("policy_version", { length: 80 }).notNull(),
    sourceTransactionComponents: jsonb("source_transaction_components")
      .$type<Record<string, unknown>>()
      .notNull(),
    normalizedTransactionComponents: jsonb("normalized_transaction_components")
      .$type<Record<string, unknown>>()
      .notNull(),
    marketLow: analysisMoney("market_low"),
    marketMedian: analysisMoney("market_median"),
    marketHigh: analysisMoney("market_high"),
    currencyCode: varchar("currency_code", { length: 3 }),
    evidenceCount: integer("evidence_count").notNull().default(0),
    confidence: analysisConfidenceEnum("confidence").notNull(),
    classification: varchar("classification", { length: 120 }),
    insufficiencyReasons: jsonb("insufficiency_reasons").$type<string[]>(),
    factorCodes: jsonb("factor_codes").$type<string[]>().notNull(),
    deterministicCalculation: jsonb("deterministic_calculation")
      .$type<Record<string, unknown>>()
      .notNull(),
    deterministicCalculationDigest: varchar("deterministic_calculation_digest", {
      length: 128,
    }).notNull(),
    aiDraftId: id("ai_draft_id").references(() => aiArtifacts.id, {
      onDelete: "set null",
    }),
    analystId: id("analyst_id").references(() => adminUsers.id, {
      onDelete: "set null",
    }),
    reviewerId: id("reviewer_id").references(() => adminUsers.id, {
      onDelete: "set null",
    }),
    reviewState: analysisReviewStateEnum("review_state")
      .notNull()
      .default("DRAFT"),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    reviewedAt: utcTimestamp("reviewed_at"),
  },
  (table) => [
    uniqueIndex("price_check_analyses_version_uidx").on(
      table.priceCheckId,
      table.version,
    ),
    check("price_check_analyses_version_positive_chk", sql`${table.version} > 0`),
    check("price_check_analyses_evidence_nonnegative_chk", sql`${table.evidenceCount} >= 0`),
    check(
      "price_check_analyses_currency_iso4217_chk",
      sql`${table.currencyCode} is null or ${table.currencyCode} in ('AUD', 'CAD', 'CHF', 'EUR', 'GBP', 'JPY', 'USD')`,
    ),
    check(
      "price_check_analyses_range_order_chk",
      sql`${table.marketLow} is null or ${table.marketMedian} is null or ${table.marketHigh} is null or (${table.marketLow} <= ${table.marketMedian} and ${table.marketMedian} <= ${table.marketHigh})`,
    ),
  ],
);

export const priceCheckComparables = pgTable(
  "price_check_comparables",
  {
    analysisId: id("analysis_id")
      .notNull()
      .references(() => priceCheckAnalyses.id, { onDelete: "restrict" }),
    observationId: id("observation_id")
      .notNull()
      .references(() => priceObservations.id, { onDelete: "restrict" }),
    included: boolean("included").notNull(),
    reasonCode: varchar("reason_code", { length: 120 }).notNull(),
    analystNote: text("analyst_note"),
    comparableSnapshot: jsonb("comparable_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    normalizationReference: jsonb("normalization_reference").$type<Record<
      string,
      unknown
    >>(),
    sequence: integer("sequence").notNull(),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "price_check_comparables_pk",
      columns: [table.analysisId, table.observationId],
    }),
    uniqueIndex("price_check_comparables_sequence_uidx").on(
      table.analysisId,
      table.sequence,
    ),
    check("price_check_comparables_sequence_positive_chk", sql`${table.sequence} > 0`),
  ],
);

export const priceCheckResults = pgTable(
  "price_check_results",
  {
    id: id().primaryKey(),
    priceCheckId: id("price_check_id")
      .notNull()
      .references(() => priceChecks.id, { onDelete: "restrict" }),
    analysisId: id("analysis_id")
      .notNull()
      .references(() => priceCheckAnalyses.id, { onDelete: "restrict" }),
    state: resultStateEnum("state").notNull().default("DRAFT"),
    version: integer("version").notNull(),
    approvedClassification: varchar("approved_classification", {
      length: 120,
    }).notNull(),
    displayRange: boolean("display_range").notNull().default(false),
    displayEvidenceCount: boolean("display_evidence_count")
      .notNull()
      .default(false),
    approvedFactorList: jsonb("approved_factor_list").$type<string[]>().notNull(),
    approvedExplanation: text("approved_explanation").notNull(),
    sourceAiArtifactId: id("source_ai_artifact_id").references(
      () => aiArtifacts.id,
      { onDelete: "set null" },
    ),
    limitedEvidenceStatement: text("limited_evidence_statement"),
    disclaimerVersion: varchar("disclaimer_version", { length: 80 }).notNull(),
    draftedBy: id("drafted_by")
      .references(() => adminUsers.id, { onDelete: "restrict" }),
    approvedBy: id("approved_by")
      .references(() => adminUsers.id, { onDelete: "restrict" }),
    approvedAt: utcTimestamp("approved_at"),
    sentAt: utcTimestamp("sent_at"),
    supersededAt: utcTimestamp("superseded_at"),
    renderedContentDigest: varchar("rendered_content_digest", {
      length: 128,
    }).notNull(),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("price_check_results_version_uidx").on(
      table.priceCheckId,
      table.version,
    ),
    index("price_check_results_digest_idx").on(table.renderedContentDigest),
    check("price_check_results_version_positive_chk", sql`${table.version} > 0`),
  ],
);

export const resultAccessTokens = pgTable(
  "result_access_tokens",
  {
    id: id().primaryKey(),
    resultId: id("result_id")
      .notNull()
      .references(() => priceCheckResults.id, { onDelete: "restrict" }),
    keyedTokenHash: varchar("keyed_token_hash", { length: 128 }).notNull(),
    tokenDerivationNonce: varchar("token_derivation_nonce", { length: 64 }),
    issuedAt: utcTimestamp("issued_at").notNull(),
    expiresAt: utcTimestamp("expires_at").notNull(),
    revokedAt: utcTimestamp("revoked_at"),
    firstViewedAt: utcTimestamp("first_viewed_at"),
    lastViewedAt: utcTimestamp("last_viewed_at"),
    viewCount: integer("view_count").notNull().default(0),
    maxUseCount: integer("max_use_count"),
  },
  (table) => [
    uniqueIndex("result_access_tokens_hash_uidx").on(table.keyedTokenHash),
    index("result_access_tokens_expiry_idx").on(table.expiresAt),
    check("result_access_tokens_view_count_chk", sql`${table.viewCount} >= 0`),
    check(
      "result_access_tokens_max_use_count_chk",
      sql`${table.maxUseCount} is null or ${table.maxUseCount} > 0`,
    ),
    check("result_access_tokens_expiry_chk", sql`${table.expiresAt} > ${table.issuedAt}`),
  ],
);

export const processingJobs = pgTable(
  "processing_jobs",
  {
    id: id().primaryKey(),
    jobType: processingJobTypeEnum("job_type").notNull(),
    aggregateType: varchar("aggregate_type", { length: 80 }).notNull(),
    aggregateId: id("aggregate_id").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 200 }).notNull(),
    state: jobStateEnum("state").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    leaseOwner: varchar("lease_owner", { length: 160 }),
    leaseExpiresAt: utcTimestamp("lease_expires_at"),
    nextAttemptAt: utcTimestamp("next_attempt_at").notNull(),
    sanitizedErrorCode: varchar("sanitized_error_code", { length: 120 }),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    startedAt: utcTimestamp("started_at"),
    completedAt: utcTimestamp("completed_at"),
  },
  (table) => [
    uniqueIndex("processing_jobs_idempotency_uidx").on(table.idempotencyKey),
    index("processing_jobs_runnable_idx")
      .on(table.nextAttemptAt, table.createdAt)
      .where(sql`${table.state} in ('pending', 'failed')`),
    check("processing_jobs_attempt_count_chk", sql`${table.attemptCount} >= 0`),
  ],
);

export const notificationOutbox = pgTable(
  "notification_outbox",
  {
    id: id().primaryKey(),
    messageType: varchar("message_type", { length: 100 }).notNull(),
    aggregateType: varchar("aggregate_type", { length: 80 }).notNull(),
    aggregateId: id("aggregate_id").notNull(),
    recipientReference: varchar("recipient_reference", { length: 160 }).notNull(),
    templateVersion: varchar("template_version", { length: 80 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 200 }).notNull(),
    state: outboxStateEnum("state").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    leaseOwner: varchar("lease_owner", { length: 160 }),
    leaseExpiresAt: utcTimestamp("lease_expires_at"),
    providerMessageId: varchar("provider_message_id", { length: 240 }),
    nextAttemptAt: utcTimestamp("next_attempt_at").notNull(),
    sanitizedFailureCode: varchar("sanitized_failure_code", { length: 120 }),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    sentAt: utcTimestamp("sent_at"),
  },
  (table) => [
    uniqueIndex("notification_outbox_idempotency_uidx").on(table.idempotencyKey),
    index("notification_outbox_runnable_idx")
      .on(table.nextAttemptAt, table.createdAt)
      .where(sql`${table.state} in ('pending', 'failed')`),
    check("notification_outbox_attempt_count_chk", sql`${table.attemptCount} >= 0`),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: id().primaryKey(),
    aggregateType: varchar("aggregate_type", { length: 80 }).notNull(),
    aggregateId: id("aggregate_id").notNull(),
    actorType: actorTypeEnum("actor_type").notNull(),
    actorId: id("actor_id"),
    action: varchar("action", { length: 140 }).notNull(),
    beforeVersionReference: varchar("before_version_reference", { length: 160 }),
    afterVersionReference: varchar("after_version_reference", { length: 160 }),
    correlationId: varchar("correlation_id", { length: 128 }).notNull(),
    sanitizedMetadata: jsonb("sanitized_metadata")
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("audit_events_aggregate_idx").on(table.aggregateType, table.aggregateId),
    index("audit_events_correlation_idx").on(table.correlationId),
  ],
);

export const sourcingOpportunities = pgTable(
  "sourcing_opportunities",
  {
    id: id().primaryKey(),
    priceCheckId: id("price_check_id")
      .notNull()
      .references(() => priceChecks.id, { onDelete: "restrict" }),
    requesterId: id("requester_id")
      .notNull()
      .references(() => requesters.id, { onDelete: "restrict" }),
    sourceResultId: id("source_result_id")
      .notNull()
      .references(() => priceCheckResults.id, { onDelete: "restrict" }),
    status: sourcingOpportunityStatusEnum("status")
      .notNull()
      .default("requested"),
    assignedOwner: varchar("assigned_owner", { length: 160 }),
    crmReference: varchar("crm_reference", { length: 200 }),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    updatedAt: utcTimestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("sourcing_opportunities_price_check_idx").on(table.priceCheckId),
    uniqueIndex("sourcing_opportunities_result_uidx").on(table.sourceResultId),
  ],
);

export type PriceCheck = typeof priceChecks.$inferSelect;
export type NewPriceCheck = typeof priceChecks.$inferInsert;
export type PriceObservation = typeof priceObservations.$inferSelect;

/* -------------------------------------------------------------------------
 * Civilon marketplace (Buy a Part from Civilon / Sell Parts to Civilon)
 *
 * Additive-only package. Nothing above this banner is modified.
 *
 * Commercial model encoded here:
 *   - A buyer submits a Buy Request to Civilon. A supplier separately offers
 *     parts to Civilon. Civilon buys and resells under separate transactions,
 *     so `supplier_responses` (private supplier cost) and `buyer_offers`
 *     (Civilon sale price) are deliberately different tables.
 *   - Nothing here records a certification, an airworthiness approval, an
 *     authenticity or fitness guarantee, or confirmed availability. Supplier
 *     availability is explicitly "subject to confirmation".
 *   - There is no public listing, publication, or inventory-search state on any
 *     table: marketplace records are staff-facing only.
 *   - Marketplace uploads are physically separate from Price Check uploads. No
 *     marketplace table carries a Price Check upload/attachment reference, so a
 *     marketplace handle cannot claim a Price Check upload.
 * ---------------------------------------------------------------------- */

export const marketplaceAggregateTypeEnum = pgEnum("marketplace_aggregate_type", [
  "buy_request",
  "sell_submission",
]);
export const marketplaceVerificationStateEnum = pgEnum(
  "marketplace_verification_state",
  ["UNVERIFIED", "PENDING", "VERIFIED", "EXPIRED"],
);
export const buyRequestStatusEnum = pgEnum("buy_request_status", [
  "pending_verification",
  "verified",
  "sourcing",
  "quoted",
  "converted",
  "closed",
  "spam",
  "withdrawn",
]);
export const sellSubmissionStatusEnum = pgEnum("sell_submission_status", [
  "pending_verification",
  "verified",
  "under_review",
  "accepted",
  "declined",
  "closed",
  "spam",
  "withdrawn",
]);
export const sellSubmissionKindEnum = pgEnum("sell_submission_kind", [
  "single_part",
  "bulk_inventory",
]);
export const marketplaceUrgencyEnum = pgEnum("marketplace_urgency", [
  "aog",
  "critical",
  "standard",
  "planned",
  "not_sure",
]);
export const marketplaceConditionCodeEnum = pgEnum("marketplace_condition_code", [
  "NE",
  "NS",
  "OH",
  "SV",
  "AR",
  "ANY",
  "NOT_SURE",
]);
export const marketplaceFulfillmentPreferenceEnum = pgEnum(
  "marketplace_fulfillment_preference",
  ["door_delivery", "port_of_entry", "nj_pickup", "not_sure"],
);
export const emailVerificationPurposeEnum = pgEnum("email_verification_purpose", [
  "BUY_REQUEST_CONTACT",
  "SELL_SUBMISSION_CONTACT",
]);
export const marketplaceUploadStateEnum = pgEnum("marketplace_upload_state", [
  "AUTHORIZED",
  "UPLOADED",
  "BOUND",
  "REJECTED",
  "EXPIRED",
]);
export const marketplaceUploadPurposeEnum = pgEnum("marketplace_upload_purpose", [
  "INVENTORY_SPREADSHEET",
  "WAREHOUSE_BUSINESS_EVIDENCE",
  "CUSTODY_PART_PHOTO",
  "PART_NUMBER_SERIAL_PHOTO",
  "RELEASE_SUPPORTING_DOCUMENT",
  "OTHER",
]);
export const marketplaceScanStateEnum = pgEnum("marketplace_scan_state", [
  "PENDING",
  "QUARANTINED",
  "CLEAN",
  "REJECTED",
  "FAILED",
]);
export const marketplaceRetentionClassEnum = pgEnum(
  "marketplace_retention_class",
  ["MARKETPLACE_INTAKE_EVIDENCE", "TEMPORARY_PROCESSING", "LEGAL_HOLD"],
);
export const marketplaceUploadedByTypeEnum = pgEnum(
  "marketplace_uploaded_by_type",
  ["CONTACT", "ADMIN", "SYSTEM"],
);
/**
 * Internal-only staff review state. This is not customer verification,
 * certification, airworthiness approval, authenticity proof, fitness guarantee,
 * supplier approval, or a public reputation score, and it is never exposed on
 * any customer-facing surface.
 */
export const internalReviewStateEnum = pgEnum("internal_review_state", [
  "not_reviewed",
  "reviewed",
  "concern",
]);
export const supplierSourceKindEnum = pgEnum("supplier_source_kind", [
  "registered_contact",
  "nonregistered_supplier",
]);
export const supplierResponseStatusEnum = pgEnum("supplier_response_status", [
  "received",
  "under_review",
  "shortlisted",
  "selected",
  "declined",
  "withdrawn",
  "expired",
]);
export const supplierAvailabilityStateEnum = pgEnum(
  "supplier_availability_state",
  [
    "subject_to_confirmation",
    "claimed_available",
    "claimed_lead_time",
    "unavailable",
    "unknown",
  ],
);
export const buyerOfferStatusEnum = pgEnum("buyer_offer_status", [
  "draft",
  "sent",
  "accepted",
  "declined",
  "expired",
  "superseded",
  "withdrawn",
]);
/**
 * Buyer-facing delivery labels only. Direct supplier-to-buyer shipment is an
 * internal Civilon fulfillment decision and deliberately has no value here: a
 * buyer-facing label for it would reveal the supplier relationship.
 */
export const buyerOfferDeliveryOptionEnum = pgEnum(
  "buyer_offer_delivery_option",
  ["door_delivery", "port_of_entry", "nj_pickup", "not_determined"],
);

/**
 * Marketplace contacts are deliberately separate from Price Check `requesters`:
 * they carry their own lightweight verification lifecycle and none of the Price
 * Check retention/consent semantics. `normalizedEmail` is intentionally NOT
 * unique — the same company may act as buyer and as supplier, and identity is
 * not proven at first touch. Deduplication is an admin decision, not a database
 * constraint.
 */
export const marketplaceContacts = pgTable(
  "marketplace_contacts",
  {
    id: id().primaryKey(),
    firstName: varchar("first_name", { length: 120 }).notNull(),
    lastName: varchar("last_name", { length: 120 }).notNull(),
    companyName: varchar("company_name", { length: 200 }).notNull(),
    businessEmail: varchar("business_email", { length: 320 }).notNull(),
    normalizedEmail: varchar("normalized_email", { length: 320 }).notNull(),
    phone: varchar("phone", { length: 80 }),
    normalizedPhone: varchar("normalized_phone", { length: 32 }),
    role: varchar("role", { length: 120 }),
    country: varchar("country", { length: 2 }),
    stateRegion: varchar("state_region", { length: 160 }),
    city: varchar("city", { length: 160 }),
    postalCode: varchar("postal_code", { length: 24 }),
    websiteUrl: varchar("website_url", { length: 500 }),
    actsAsBuyer: boolean("acts_as_buyer").notNull().default(false),
    actsAsSeller: boolean("acts_as_seller").notNull().default(false),
    verificationState: marketplaceVerificationStateEnum("verification_state")
      .notNull()
      .default("UNVERIFIED"),
    verificationRequestedAt: utcTimestamp("verification_requested_at"),
    verifiedAt: utcTimestamp("verified_at"),
    verificationRevokedAt: utcTimestamp("verification_revoked_at"),
    /**
     * Internal business review, distinct from email verification: setting it
     * never touches `verification_state`. Staff-facing only.
     */
    businessReviewState: internalReviewStateEnum("business_review_state")
      .notNull()
      .default("not_reviewed"),
    businessReviewedAt: utcTimestamp("business_reviewed_at"),
    businessReviewedByAdminUserId: id("business_reviewed_by_admin_user_id").references(
      () => adminUsers.id,
      { onDelete: "set null" },
    ),
    serviceProcessingAcknowledgedAt: utcTimestamp(
      "service_processing_acknowledged_at",
    ),
    marketingConsentAt: utcTimestamp("marketing_consent_at"),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    updatedAt: utcTimestamp("updated_at").notNull().defaultNow(),
    deletionRequestedAt: utcTimestamp("deletion_requested_at"),
    deletedAt: utcTimestamp("deleted_at"),
  },
  (table) => [
    index("marketplace_contacts_normalized_email_idx").on(table.normalizedEmail),
    index("marketplace_contacts_normalized_phone_idx").on(table.normalizedPhone),
    index("marketplace_contacts_verification_state_idx").on(
      table.verificationState,
    ),
    check(
      "marketplace_contacts_country_iso2_chk",
      sql`${table.country} is null or ${table.country} ~ '^[A-Z]{2}$'`,
    ),
    check(
      "marketplace_contacts_normalized_email_chk",
      sql`${table.normalizedEmail} = lower(${table.normalizedEmail})`,
    ),
    check(
      "marketplace_contacts_verified_state_chk",
      sql`${table.verificationState} <> 'VERIFIED' or ${table.verifiedAt} is not null`,
    ),
    check(
      "marketplace_contacts_verified_order_chk",
      sql`${table.verifiedAt} is null or ${table.verificationRequestedAt} is null or ${table.verifiedAt} >= ${table.verificationRequestedAt}`,
    ),
  ],
);

/**
 * A buyer's request to buy from Civilon. This is never a public listing and it
 * never asserts that a part is available: availability is only ever recorded
 * privately, later, on `supplier_responses`, and only as a supplier claim.
 */
export const buyRequests = pgTable(
  "buy_requests",
  {
    id: id().primaryKey(),
    publicReference: varchar("public_reference", { length: 16 }).notNull(),
    contactId: id("contact_id")
      .notNull()
      .references(() => marketplaceContacts.id, { onDelete: "restrict" }),
    originalPartNumber: varchar("original_part_number", { length: 160 }),
    normalizedPartNumber: varchar("normalized_part_number", { length: 120 }),
    description: text("description"),
    quantity: numeric("quantity", { precision: 12, scale: 3 })
      .notNull()
      .default("1"),
    acceptableCondition: marketplaceConditionCodeEnum("acceptable_condition")
      .notNull()
      .default("NOT_SURE"),
    urgency: marketplaceUrgencyEnum("urgency").notNull().default("not_sure"),
    neededByDate: date("needed_by_date", { mode: "string" }),
    aircraftModel: varchar("aircraft_model", { length: 160 }),
    applicationNotes: text("application_notes"),
    deliveryCountry: varchar("delivery_country", { length: 2 }),
    deliveryPostalCode: varchar("delivery_postal_code", { length: 24 }),
    deliveryCity: varchar("delivery_city", { length: 160 }),
    fulfillmentPreference: marketplaceFulfillmentPreferenceEnum(
      "fulfillment_preference",
    )
      .notNull()
      .default("not_sure"),
    status: buyRequestStatusEnum("status")
      .notNull()
      .default("pending_verification"),
    assignedAdminUserId: id("assigned_admin_user_id").references(
      () => adminUsers.id,
      { onDelete: "set null" },
    ),
    verificationRequestedAt: utcTimestamp("verification_requested_at"),
    verifiedAt: utcTimestamp("verified_at"),
    notes: text("notes"),
    sourcePage: varchar("source_page", { length: 240 }).notNull(),
    landingPage: varchar("landing_page", { length: 500 }),
    referrerOrigin: varchar("referrer_origin", { length: 255 }),
    utmSource: varchar("utm_source", { length: 160 }),
    utmMedium: varchar("utm_medium", { length: 160 }),
    utmCampaign: varchar("utm_campaign", { length: 160 }),
    utmContent: varchar("utm_content", { length: 160 }),
    utmTerm: varchar("utm_term", { length: 160 }),
    idempotencyHash: varchar("idempotency_hash", { length: 128 }).notNull(),
    /**
     * Optional immutable provenance links to an approved Price Check. RESTRICT,
     * not SET NULL: once a Buy Request cites a Price Check result, neither the
     * link nor the cited Price Check/result may be silently erased.
     */
    sourcePriceCheckId: id("source_price_check_id").references(
      () => priceChecks.id,
      { onDelete: "restrict" },
    ),
    sourceResultId: id("source_result_id").references(
      () => priceCheckResults.id,
      { onDelete: "restrict" },
    ),
    /**
     * Reserved for future admin-only potential-source intelligence (for example
     * PartsBase / ILS counts). Never rendered publicly, never an availability
     * claim, and no external API is called in this slice.
     */
    externalSourceIntelligence: jsonb(
      "external_source_intelligence",
    ).$type<Record<string, unknown>>(),
    submittedAt: utcTimestamp("submitted_at").notNull(),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    updatedAt: utcTimestamp("updated_at").notNull().defaultNow(),
    closedAt: utcTimestamp("closed_at"),
  },
  (table) => [
    uniqueIndex("buy_requests_public_reference_uidx").on(table.publicReference),
    uniqueIndex("buy_requests_idempotency_hash_uidx").on(table.idempotencyHash),
    uniqueIndex("buy_requests_source_result_uidx").on(table.sourceResultId),
    index("buy_requests_status_idx").on(table.status),
    index("buy_requests_contact_idx").on(table.contactId),
    index("buy_requests_assignee_idx").on(table.assignedAdminUserId),
    index("buy_requests_submitted_at_idx").on(table.submittedAt),
    index("buy_requests_normalized_part_number_idx").on(
      table.normalizedPartNumber,
    ),
    check(
      "buy_requests_public_reference_chk",
      sql`${table.publicReference} ~ '^BR-[0-9A-HJKMNP-TV-Z]{10}$'`,
    ),
    check(
      "buy_requests_part_or_description_chk",
      sql`nullif(btrim(${table.originalPartNumber}), '') is not null or nullif(btrim(${table.description}), '') is not null`,
    ),
    check(
      "buy_requests_normalized_part_number_chk",
      sql`(${table.originalPartNumber} is null) = (${table.normalizedPartNumber} is null)`,
    ),
    check("buy_requests_quantity_positive_chk", sql`${table.quantity} > 0`),
    check(
      "buy_requests_delivery_country_chk",
      sql`${table.deliveryCountry} is null or ${table.deliveryCountry} ~ '^[A-Z]{2}$'`,
    ),
    check(
      "buy_requests_pending_verification_chk",
      sql`(${table.status} = 'pending_verification') or (${table.verifiedAt} is not null or ${table.status} in ('spam', 'withdrawn', 'closed'))`,
    ),
    check(
      "buy_requests_verified_status_chk",
      sql`${table.status} <> 'pending_verification' or ${table.verifiedAt} is null`,
    ),
    check(
      "buy_requests_verified_order_chk",
      sql`${table.verifiedAt} is null or ${table.verifiedAt} >= ${table.submittedAt}`,
    ),
    check(
      "buy_requests_closed_state_chk",
      sql`${table.closedAt} is null or ${table.status} in ('converted', 'closed', 'spam', 'withdrawn')`,
    ),
  ],
);

/**
 * A supplier's submission offering parts to Civilon. Seller price is optional
 * and normally quote-on-request; shipping to the Civilon New Jersey facility is
 * optional and may be left unstated (`can_ship_to_new_jersey` null).
 */
export const sellSubmissions = pgTable(
  "sell_submissions",
  {
    id: id().primaryKey(),
    publicReference: varchar("public_reference", { length: 16 }).notNull(),
    contactId: id("contact_id")
      .notNull()
      .references(() => marketplaceContacts.id, { onDelete: "restrict" }),
    submissionKind: sellSubmissionKindEnum("submission_kind").notNull(),
    originalPartNumber: varchar("original_part_number", { length: 160 }),
    normalizedPartNumber: varchar("normalized_part_number", { length: 120 }),
    description: text("description"),
    quantity: numeric("quantity", { precision: 12, scale: 3 }),
    conditionCode: marketplaceConditionCodeEnum("condition_code"),
    askingUnitPrice: money("asking_unit_price"),
    currencyCode: varchar("currency_code", { length: 3 }),
    quoteOnRequest: boolean("quote_on_request").notNull().default(true),
    estimatedLineItemCount: integer("estimated_line_item_count"),
    locationCountry: varchar("location_country", { length: 2 }),
    locationStateRegion: varchar("location_state_region", { length: 160 }),
    locationCity: varchar("location_city", { length: 160 }),
    locationPostalCode: varchar("location_postal_code", { length: 24 }),
    canShipToNewJersey: boolean("can_ship_to_new_jersey"),
    documentsSummary: text("documents_summary"),
    status: sellSubmissionStatusEnum("status")
      .notNull()
      .default("pending_verification"),
    assignedAdminUserId: id("assigned_admin_user_id").references(
      () => adminUsers.id,
      { onDelete: "set null" },
    ),
    verificationRequestedAt: utcTimestamp("verification_requested_at"),
    verifiedAt: utcTimestamp("verified_at"),
    notes: text("notes"),
    sourcePage: varchar("source_page", { length: 240 }).notNull(),
    landingPage: varchar("landing_page", { length: 500 }),
    referrerOrigin: varchar("referrer_origin", { length: 255 }),
    utmSource: varchar("utm_source", { length: 160 }),
    utmMedium: varchar("utm_medium", { length: 160 }),
    utmCampaign: varchar("utm_campaign", { length: 160 }),
    utmContent: varchar("utm_content", { length: 160 }),
    utmTerm: varchar("utm_term", { length: 160 }),
    idempotencyHash: varchar("idempotency_hash", { length: 128 }).notNull(),
    submittedAt: utcTimestamp("submitted_at").notNull(),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    updatedAt: utcTimestamp("updated_at").notNull().defaultNow(),
    closedAt: utcTimestamp("closed_at"),
  },
  (table) => [
    uniqueIndex("sell_submissions_public_reference_uidx").on(
      table.publicReference,
    ),
    uniqueIndex("sell_submissions_idempotency_hash_uidx").on(
      table.idempotencyHash,
    ),
    index("sell_submissions_status_idx").on(table.status),
    index("sell_submissions_contact_idx").on(table.contactId),
    index("sell_submissions_assignee_idx").on(table.assignedAdminUserId),
    index("sell_submissions_submitted_at_idx").on(table.submittedAt),
    index("sell_submissions_normalized_part_number_idx").on(
      table.normalizedPartNumber,
    ),
    check(
      "sell_submissions_public_reference_chk",
      sql`${table.publicReference} ~ '^SS-[0-9A-HJKMNP-TV-Z]{10}$'`,
    ),
    check(
      "sell_submissions_mode_chk",
      sql`(${table.submissionKind} = 'single_part' and (nullif(btrim(${table.originalPartNumber}), '') is not null or nullif(btrim(${table.description}), '') is not null)) or (${table.submissionKind} = 'bulk_inventory' and ${table.originalPartNumber} is null and ${table.quantity} is null and ${table.askingUnitPrice} is null)`,
    ),
    check(
      "sell_submissions_normalized_part_number_chk",
      sql`(${table.originalPartNumber} is null) = (${table.normalizedPartNumber} is null)`,
    ),
    check(
      "sell_submissions_quantity_chk",
      sql`${table.quantity} is null or ${table.quantity} > 0`,
    ),
    check(
      "sell_submissions_line_item_count_chk",
      sql`${table.estimatedLineItemCount} is null or ${table.estimatedLineItemCount} >= 0`,
    ),
    check(
      "sell_submissions_price_nonnegative_chk",
      sql`${table.askingUnitPrice} is null or ${table.askingUnitPrice} >= 0`,
    ),
    check(
      "sell_submissions_currency_chk",
      sql`${table.currencyCode} is null or ${table.currencyCode} in ('AUD', 'CAD', 'CHF', 'EUR', 'GBP', 'JPY', 'USD')`,
    ),
    check(
      "sell_submissions_price_currency_chk",
      sql`${table.askingUnitPrice} is null or ${table.currencyCode} is not null`,
    ),
    check(
      "sell_submissions_quote_on_request_chk",
      sql`${table.quoteOnRequest} or ${table.askingUnitPrice} is not null`,
    ),
    check(
      "sell_submissions_location_country_chk",
      sql`${table.locationCountry} is null or ${table.locationCountry} ~ '^[A-Z]{2}$'`,
    ),
    check(
      "sell_submissions_pending_verification_chk",
      sql`(${table.status} = 'pending_verification') or (${table.verifiedAt} is not null or ${table.status} in ('spam', 'withdrawn', 'closed'))`,
    ),
    check(
      "sell_submissions_verified_status_chk",
      sql`${table.status} <> 'pending_verification' or ${table.verifiedAt} is null`,
    ),
    check(
      "sell_submissions_verified_order_chk",
      sql`${table.verifiedAt} is null or ${table.verifiedAt} >= ${table.submittedAt}`,
    ),
    check(
      "sell_submissions_closed_state_chk",
      sql`${table.closedAt} is null or ${table.status} in ('accepted', 'declined', 'closed', 'spam', 'withdrawn')`,
    ),
  ],
);

/**
 * Optional normalized rows for a multi-item or bulk Sell Submission. These are
 * internal working rows for staff (manual entry today, spreadsheet extraction
 * later). There is deliberately no publication, listing, or search state and no
 * required price.
 */
export const sellSubmissionItems = pgTable(
  "sell_submission_items",
  {
    id: id().primaryKey(),
    sellSubmissionId: id("sell_submission_id")
      .notNull()
      .references(() => sellSubmissions.id, { onDelete: "cascade" }),
    lineNumber: integer("line_number").notNull(),
    originalPartNumber: varchar("original_part_number", { length: 160 }),
    normalizedPartNumber: varchar("normalized_part_number", { length: 120 }),
    description: text("description"),
    quantity: numeric("quantity", { precision: 12, scale: 3 }),
    conditionCode: marketplaceConditionCodeEnum("condition_code"),
    askingUnitPrice: money("asking_unit_price"),
    currencyCode: varchar("currency_code", { length: 3 }),
    quoteOnRequest: boolean("quote_on_request").notNull().default(true),
    locationText: varchar("location_text", { length: 240 }),
    documentsSummary: text("documents_summary"),
    sourceAttachmentId: id("source_attachment_id").references(
      (): AnyPgColumn => marketplaceAttachments.id,
      { onDelete: "set null" },
    ),
    sourceRowReference: varchar("source_row_reference", { length: 120 }),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    updatedAt: utcTimestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sell_submission_items_line_uidx").on(
      table.sellSubmissionId,
      table.lineNumber,
    ),
    index("sell_submission_items_part_number_idx").on(table.normalizedPartNumber),
    check("sell_submission_items_line_number_chk", sql`${table.lineNumber} > 0`),
    check(
      "sell_submission_items_part_or_description_chk",
      sql`nullif(btrim(${table.originalPartNumber}), '') is not null or nullif(btrim(${table.description}), '') is not null`,
    ),
    check(
      "sell_submission_items_part_number_chk",
      sql`(${table.originalPartNumber} is null) = (${table.normalizedPartNumber} is null)`,
    ),
    check(
      "sell_submission_items_quantity_chk",
      sql`${table.quantity} is null or ${table.quantity} > 0`,
    ),
    check(
      "sell_submission_items_price_nonnegative_chk",
      sql`${table.askingUnitPrice} is null or ${table.askingUnitPrice} >= 0`,
    ),
    check(
      "sell_submission_items_currency_chk",
      sql`${table.currencyCode} is null or ${table.currencyCode} in ('AUD', 'CAD', 'CHF', 'EUR', 'GBP', 'JPY', 'USD')`,
    ),
    check(
      "sell_submission_items_price_currency_chk",
      sql`${table.askingUnitPrice} is null or ${table.currencyCode} is not null`,
    ),
    check(
      "sell_submission_items_quote_on_request_chk",
      sql`${table.quoteOnRequest} or ${table.askingUnitPrice} is not null`,
    ),
  ],
);

/**
 * Generic lightweight Buy/Sell email verification. Only the keyed hash and the
 * derivation nonce are stored — never a plaintext token. The partial unique
 * index allows exactly one live (unconsumed, unrevoked) token per aggregate
 * while preserving the consumed/revoked history.
 */
export const emailVerificationTokens = pgTable(
  "email_verification_tokens",
  {
    id: id().primaryKey(),
    aggregateType: marketplaceAggregateTypeEnum("aggregate_type").notNull(),
    aggregateId: id("aggregate_id").notNull(),
    buyRequestId: id("buy_request_id").references(() => buyRequests.id, {
      onDelete: "cascade",
    }),
    sellSubmissionId: id("sell_submission_id").references(
      () => sellSubmissions.id,
      { onDelete: "cascade" },
    ),
    contactId: id("contact_id")
      .notNull()
      .references(() => marketplaceContacts.id, { onDelete: "restrict" }),
    purpose: emailVerificationPurposeEnum("purpose").notNull(),
    keyedTokenHash: varchar("keyed_token_hash", { length: 128 }).notNull(),
    tokenDerivationNonce: varchar("token_derivation_nonce", {
      length: 64,
    }).notNull(),
    issuedAt: utcTimestamp("issued_at").notNull(),
    expiresAt: utcTimestamp("expires_at").notNull(),
    consumedAt: utcTimestamp("consumed_at"),
    revokedAt: utcTimestamp("revoked_at"),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttemptCount: integer("max_attempt_count").notNull().default(5),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("email_verification_tokens_hash_uidx").on(table.keyedTokenHash),
    uniqueIndex("email_verification_tokens_active_uidx")
      .on(table.aggregateType, table.aggregateId)
      .where(sql`${table.consumedAt} is null and ${table.revokedAt} is null`),
    index("email_verification_tokens_aggregate_idx").on(
      table.aggregateType,
      table.aggregateId,
    ),
    index("email_verification_tokens_expiry_idx").on(table.expiresAt),
    check(
      "email_verification_tokens_aggregate_chk",
      sql`(${table.aggregateType} = 'buy_request' and ${table.buyRequestId} = ${table.aggregateId} and ${table.sellSubmissionId} is null) or (${table.aggregateType} = 'sell_submission' and ${table.sellSubmissionId} = ${table.aggregateId} and ${table.buyRequestId} is null)`,
    ),
    check(
      "email_verification_tokens_purpose_chk",
      sql`(${table.aggregateType} = 'buy_request' and ${table.purpose} = 'BUY_REQUEST_CONTACT') or (${table.aggregateType} = 'sell_submission' and ${table.purpose} = 'SELL_SUBMISSION_CONTACT')`,
    ),
    check(
      "email_verification_tokens_expiry_chk",
      sql`${table.expiresAt} > ${table.issuedAt}`,
    ),
    check(
      "email_verification_tokens_lifecycle_chk",
      sql`${table.consumedAt} is null or ${table.revokedAt} is null`,
    ),
    check(
      "email_verification_tokens_consumed_order_chk",
      sql`${table.consumedAt} is null or ${table.consumedAt} >= ${table.issuedAt}`,
    ),
    check(
      "email_verification_tokens_attempt_chk",
      sql`${table.attemptCount} >= 0 and ${table.maxAttemptCount} > 0 and ${table.attemptCount} <= ${table.maxAttemptCount}`,
    ),
  ],
);

/**
 * Marketplace-private upload session. Physically separate from
 * `price_check_upload_sessions`: a Price Check session token hash lives in a
 * different table and can never resolve a marketplace pending upload.
 */
export const marketplaceUploadSessions = pgTable(
  "marketplace_upload_sessions",
  {
    id: id().primaryKey(),
    tokenHash: varchar("token_hash", { length: 128 }).notNull(),
    intendedAggregateType: marketplaceAggregateTypeEnum(
      "intended_aggregate_type",
    ).notNull(),
    authorizedCount: integer("authorized_count").notNull().default(0),
    expectedByteSize: numeric("expected_byte_size", { precision: 20, scale: 0 })
      .notNull()
      .default("0"),
    expiresAt: utcTimestamp("expires_at").notNull(),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    updatedAt: utcTimestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("marketplace_upload_sessions_token_hash_uidx").on(
      table.tokenHash,
    ),
    index("marketplace_upload_sessions_expiry_idx").on(table.expiresAt),
    check(
      "marketplace_upload_sessions_count_chk",
      sql`${table.authorizedCount} between 0 and 12`,
    ),
    check(
      "marketplace_upload_sessions_bytes_chk",
      sql`${table.expectedByteSize} between 0 and 209715200`,
    ),
    check(
      "marketplace_upload_sessions_expiry_chk",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
  ],
);

/**
 * Marketplace-private pending upload. There is deliberately no
 * `claimed_price_check_id` column and no foreign key to any Price Check table,
 * so a marketplace handle cannot claim a Price Check upload. The object-key
 * prefix check keeps marketplace objects in their own storage namespace.
 */
export const marketplacePendingUploads = pgTable(
  "marketplace_pending_uploads",
  {
    id: id().primaryKey(),
    uploadSessionId: id("upload_session_id")
      .notNull()
      .references(() => marketplaceUploadSessions.id, { onDelete: "cascade" }),
    objectKey: varchar("object_key", { length: 700 }).notNull(),
    displayFilename: varchar("display_filename", { length: 255 }).notNull(),
    declaredMime: varchar("declared_mime", { length: 255 }).notNull(),
    expectedByteSize: numeric("expected_byte_size", {
      precision: 20,
      scale: 0,
    }).notNull(),
    purpose: marketplaceUploadPurposeEnum("purpose").notNull(),
    state: marketplaceUploadStateEnum("state").notNull().default("AUTHORIZED"),
    claimedBuyRequestId: id("claimed_buy_request_id").references(
      () => buyRequests.id,
      { onDelete: "restrict" },
    ),
    claimedSellSubmissionId: id("claimed_sell_submission_id").references(
      () => sellSubmissions.id,
      { onDelete: "restrict" },
    ),
    expiresAt: utcTimestamp("expires_at").notNull(),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    updatedAt: utcTimestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("marketplace_pending_uploads_object_key_uidx").on(
      table.objectKey,
    ),
    index("marketplace_pending_uploads_session_idx").on(table.uploadSessionId),
    index("marketplace_pending_uploads_expiry_idx").on(table.expiresAt),
    index("marketplace_pending_uploads_buy_claim_idx").on(
      table.claimedBuyRequestId,
    ),
    index("marketplace_pending_uploads_sell_claim_idx").on(
      table.claimedSellSubmissionId,
    ),
    check(
      "marketplace_pending_uploads_bytes_chk",
      sql`${table.expectedByteSize} between 1 and 52428800`,
    ),
    check(
      "marketplace_pending_uploads_object_key_chk",
      sql`${table.objectKey} like 'marketplace/%'`,
    ),
    check(
      "marketplace_pending_uploads_single_claim_chk",
      sql`${table.claimedBuyRequestId} is null or ${table.claimedSellSubmissionId} is null`,
    ),
    check(
      "marketplace_pending_uploads_bound_claim_chk",
      sql`${table.state} <> 'BOUND' or ${table.claimedBuyRequestId} is not null or ${table.claimedSellSubmissionId} is not null`,
    ),
  ],
);

/**
 * Marketplace-private bound attachment. Isolated from `attachments`: there is
 * no `price_check_id` column, and the aggregate check forces exactly one of the
 * two marketplace parents, matching `aggregate_type`.
 */
export const marketplaceAttachments = pgTable(
  "marketplace_attachments",
  {
    id: id().primaryKey(),
    aggregateType: marketplaceAggregateTypeEnum("aggregate_type").notNull(),
    aggregateId: id("aggregate_id").notNull(),
    buyRequestId: id("buy_request_id").references(() => buyRequests.id, {
      onDelete: "restrict",
    }),
    sellSubmissionId: id("sell_submission_id").references(
      () => sellSubmissions.id,
      { onDelete: "restrict" },
    ),
    purpose: marketplaceUploadPurposeEnum("purpose").notNull(),
    uploadedByType: marketplaceUploadedByTypeEnum("uploaded_by_type").notNull(),
    displayFilename: varchar("display_filename", { length: 255 }).notNull(),
    objectKey: varchar("object_key", { length: 700 }).notNull(),
    storageProvider: varchar("storage_provider", { length: 80 }).notNull(),
    declaredMime: varchar("declared_mime", { length: 255 }),
    detectedMime: varchar("detected_mime", { length: 255 }),
    byteSize: numeric("byte_size", { precision: 20, scale: 0 }).notNull(),
    contentDigest: varchar("content_digest", { length: 128 }),
    scanState: marketplaceScanStateEnum("scan_state").notNull().default("PENDING"),
    quarantineReleasedAt: utcTimestamp("quarantine_released_at"),
    /** Internal staff review of this piece of evidence. Never customer-facing. */
    reviewState: internalReviewStateEnum("review_state")
      .notNull()
      .default("not_reviewed"),
    reviewedAt: utcTimestamp("reviewed_at"),
    reviewedByAdminUserId: id("reviewed_by_admin_user_id").references(
      () => adminUsers.id,
      { onDelete: "set null" },
    ),
    retentionClass: marketplaceRetentionClassEnum("retention_class").notNull(),
    sourcePendingUploadId: id("source_pending_upload_id").references(
      () => marketplacePendingUploads.id,
      { onDelete: "set null" },
    ),
    deletionDueAt: utcTimestamp("deletion_due_at"),
    deletedAt: utcTimestamp("deleted_at"),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    updatedAt: utcTimestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("marketplace_attachments_object_key_uidx").on(table.objectKey),
    index("marketplace_attachments_aggregate_idx").on(
      table.aggregateType,
      table.aggregateId,
    ),
    index("marketplace_attachments_live_idx")
      .on(table.aggregateType, table.aggregateId)
      .where(sql`${table.deletedAt} is null`),
    check("marketplace_attachments_byte_size_chk", sql`${table.byteSize} >= 0`),
    check(
      "marketplace_attachments_object_key_chk",
      sql`${table.objectKey} like 'marketplace/%'`,
    ),
    check(
      "marketplace_attachments_aggregate_chk",
      sql`(${table.aggregateType} = 'buy_request' and ${table.buyRequestId} = ${table.aggregateId} and ${table.sellSubmissionId} is null) or (${table.aggregateType} = 'sell_submission' and ${table.sellSubmissionId} = ${table.aggregateId} and ${table.buyRequestId} is null)`,
    ),
    check(
      "marketplace_attachments_quarantine_chk",
      sql`${table.quarantineReleasedAt} is null or ${table.scanState} = 'CLEAN'`,
    ),
  ],
);

/** Internal staff notes on a Buy Request or Sell Submission. Never customer-visible. */
export const marketplaceNotes = pgTable(
  "marketplace_notes",
  {
    id: id().primaryKey(),
    aggregateType: marketplaceAggregateTypeEnum("aggregate_type").notNull(),
    aggregateId: id("aggregate_id").notNull(),
    buyRequestId: id("buy_request_id").references(() => buyRequests.id, {
      onDelete: "cascade",
    }),
    sellSubmissionId: id("sell_submission_id").references(
      () => sellSubmissions.id,
      { onDelete: "cascade" },
    ),
    adminUserId: id("admin_user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "restrict" }),
    body: text("body").notNull(),
    redactedAt: utcTimestamp("redacted_at"),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    updatedAt: utcTimestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("marketplace_notes_aggregate_idx").on(
      table.aggregateType,
      table.aggregateId,
    ),
    index("marketplace_notes_admin_user_idx").on(table.adminUserId),
    check(
      "marketplace_notes_aggregate_chk",
      sql`(${table.aggregateType} = 'buy_request' and ${table.buyRequestId} = ${table.aggregateId} and ${table.sellSubmissionId} is null) or (${table.aggregateType} = 'sell_submission' and ${table.sellSubmissionId} = ${table.aggregateId} and ${table.buyRequestId} is null)`,
    ),
    check(
      "marketplace_notes_body_chk",
      sql`nullif(btrim(${table.body}), '') is not null`,
    ),
  ],
);

/**
 * Internal sourcing response against a Buy Request. PRIVATE: supplier identity,
 * supplier cost and supplier location live here and only here. Nothing on this
 * table is ever shown to the buyer, and the buyer-facing `buyer_offers` table
 * carries no column that could reveal a supplier or a supplier cost.
 *
 * The supplier may be a registered `marketplace_contacts` row or an internal
 * nonregistered supplier captured only as a name/contact snapshot.
 *
 * `availability_state` defaults to `subject_to_confirmation`: a supplier claim
 * is never recorded as a Civilon confirmation of availability.
 */
export const supplierResponses = pgTable(
  "supplier_responses",
  {
    id: id().primaryKey(),
    buyRequestId: id("buy_request_id")
      .notNull()
      .references(() => buyRequests.id, { onDelete: "restrict" }),
    supplierKind: supplierSourceKindEnum("supplier_kind").notNull(),
    supplierContactId: id("supplier_contact_id").references(
      () => marketplaceContacts.id,
      { onDelete: "set null" },
    ),
    supplierNameSnapshot: varchar("supplier_name_snapshot", { length: 200 }),
    supplierContactSnapshot: varchar("supplier_contact_snapshot", {
      length: 320,
    }),
    supplierCountry: varchar("supplier_country", { length: 2 }),
    offeredPartNumber: varchar("offered_part_number", { length: 160 }),
    normalizedPartNumber: varchar("normalized_part_number", { length: 120 }),
    statedCondition: marketplaceConditionCodeEnum("stated_condition"),
    quantityAvailable: numeric("quantity_available", {
      precision: 12,
      scale: 3,
    }),
    supplierUnitCost: money("supplier_unit_cost"),
    currencyCode: varchar("currency_code", { length: 3 }),
    quoteOnRequest: boolean("quote_on_request").notNull().default(true),
    availabilityState: supplierAvailabilityStateEnum("availability_state")
      .notNull()
      .default("subject_to_confirmation"),
    locationText: varchar("location_text", { length: 240 }),
    leadTimeDays: integer("lead_time_days"),
    documentsSummary: text("documents_summary"),
    shippingNotes: text("shipping_notes"),
    status: supplierResponseStatusEnum("status").notNull().default("received"),
    recordedByAdminUserId: id("recorded_by_admin_user_id").references(
      () => adminUsers.id,
      { onDelete: "set null" },
    ),
    receivedAt: utcTimestamp("received_at").notNull(),
    expiresAt: utcTimestamp("expires_at"),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    updatedAt: utcTimestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("supplier_responses_buy_request_idx").on(table.buyRequestId),
    index("supplier_responses_status_idx").on(table.status),
    index("supplier_responses_contact_idx").on(table.supplierContactId),
    check(
      "supplier_responses_supplier_kind_chk",
      sql`(${table.supplierKind} = 'registered_contact' and ${table.supplierContactId} is not null) or (${table.supplierKind} = 'nonregistered_supplier' and ${table.supplierContactId} is null and nullif(btrim(${table.supplierNameSnapshot}), '') is not null)`,
    ),
    check(
      "supplier_responses_country_chk",
      sql`${table.supplierCountry} is null or ${table.supplierCountry} ~ '^[A-Z]{2}$'`,
    ),
    check(
      "supplier_responses_quantity_chk",
      sql`${table.quantityAvailable} is null or ${table.quantityAvailable} >= 0`,
    ),
    check(
      "supplier_responses_cost_nonnegative_chk",
      sql`${table.supplierUnitCost} is null or ${table.supplierUnitCost} >= 0`,
    ),
    check(
      "supplier_responses_currency_chk",
      sql`${table.currencyCode} is null or ${table.currencyCode} in ('AUD', 'CAD', 'CHF', 'EUR', 'GBP', 'JPY', 'USD')`,
    ),
    check(
      "supplier_responses_cost_currency_chk",
      sql`${table.supplierUnitCost} is null or ${table.currencyCode} is not null`,
    ),
    check(
      "supplier_responses_quote_on_request_chk",
      sql`${table.quoteOnRequest} or ${table.supplierUnitCost} is not null`,
    ),
    check(
      "supplier_responses_lead_time_chk",
      sql`${table.leadTimeDays} is null or ${table.leadTimeDays} >= 0`,
    ),
    check(
      "supplier_responses_expiry_chk",
      sql`${table.expiresAt} is null or ${table.expiresAt} > ${table.receivedAt}`,
    ),
  ],
);

/**
 * Civilon's separate offer to the buyer. This is the resale side of the
 * transaction: only Civilon's own sale price appears here.
 *
 * Deliberately absent, and asserted absent by test: any supplier identity,
 * supplier name/contact snapshot, or supplier cost column. The optional
 * `selected_supplier_response_id` is an internal staff pointer only; it is never
 * rendered to the buyer and carries no supplier data of its own.
 *
 * Nothing here states or implies that Civilon certifies a part, approves
 * airworthiness, or guarantees authenticity, fitness, or availability.
 */
export const buyerOffers = pgTable(
  "buyer_offers",
  {
    id: id().primaryKey(),
    buyRequestId: id("buy_request_id")
      .notNull()
      .references(() => buyRequests.id, { onDelete: "restrict" }),
    /** Internal-only linkage for staff traceability. Never buyer-visible. */
    selectedSupplierResponseId: id("selected_supplier_response_id").references(
      () => supplierResponses.id,
      { onDelete: "set null" },
    ),
    version: integer("version").notNull(),
    civilonSaleUnitPrice: money("civilon_sale_unit_price").notNull(),
    currencyCode: varchar("currency_code", { length: 3 }).notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
    statedCondition: marketplaceConditionCodeEnum("stated_condition"),
    documentsSummary: text("documents_summary"),
    deliveryOption: buyerOfferDeliveryOptionEnum("delivery_option")
      .notNull()
      .default("not_determined"),
    shippingAndExportScope: text("shipping_and_export_scope"),
    leadTimeDays: integer("lead_time_days"),
    status: buyerOfferStatusEnum("status").notNull().default("draft"),
    createdByAdminUserId: id("created_by_admin_user_id").references(
      () => adminUsers.id,
      { onDelete: "set null" },
    ),
    sentAt: utcTimestamp("sent_at"),
    respondedAt: utcTimestamp("responded_at"),
    expiresAt: utcTimestamp("expires_at"),
    supersededAt: utcTimestamp("superseded_at"),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    updatedAt: utcTimestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("buyer_offers_version_uidx").on(
      table.buyRequestId,
      table.version,
    ),
    index("buyer_offers_status_idx").on(table.status),
    index("buyer_offers_buy_request_idx").on(table.buyRequestId),
    check("buyer_offers_version_positive_chk", sql`${table.version} > 0`),
    check(
      "buyer_offers_sale_price_nonnegative_chk",
      sql`${table.civilonSaleUnitPrice} >= 0`,
    ),
    check("buyer_offers_quantity_positive_chk", sql`${table.quantity} > 0`),
    check(
      "buyer_offers_currency_chk",
      sql`${table.currencyCode} in ('AUD', 'CAD', 'CHF', 'EUR', 'GBP', 'JPY', 'USD')`,
    ),
    check(
      "buyer_offers_lead_time_chk",
      sql`${table.leadTimeDays} is null or ${table.leadTimeDays} >= 0`,
    ),
    check(
      "buyer_offers_sent_state_chk",
      sql`${table.status} = 'draft' or ${table.sentAt} is not null`,
    ),
    check(
      "buyer_offers_draft_not_sent_chk",
      sql`${table.status} <> 'draft' or ${table.sentAt} is null`,
    ),
    check(
      "buyer_offers_expiry_chk",
      sql`${table.expiresAt} is null or ${table.sentAt} is null or ${table.expiresAt} > ${table.sentAt}`,
    ),
    check(
      "buyer_offers_responded_chk",
      sql`${table.respondedAt} is null or ${table.sentAt} is not null`,
    ),
    check(
      "buyer_offers_superseded_chk",
      sql`${table.supersededAt} is null or ${table.status} = 'superseded'`,
    ),
  ],
);

/**
 * One staff-issued request for follow-up seller evidence on an existing Sell
 * Submission.
 *
 * Deliberately its own table rather than a widened `email_verification_tokens`:
 *
 *  - That table's partial unique index allows exactly one live token per
 *    aggregate, and its purpose check constraint forces
 *    `sell_submission -> SELL_SUBMISSION_CONTACT`. Adding a second purpose would
 *    mean altering an approved constraint on the path that proves a supplier's
 *    e-mail address, to serve a workflow that has nothing to do with it.
 *  - Business-email verification and evidence follow-up are different concepts
 *    and must stay distinguishable in the record. Neither is company
 *    verification, certification, airworthiness or regulatory approval, an
 *    authenticity or fitness guarantee, or supplier approval.
 *
 * Only the keyed hash and the derivation nonce are stored, exactly as for
 * `email_verification_tokens`: the plaintext credential exists only inside the
 * outgoing e-mail. The partial unique index gives one live request per
 * submission, so issuing a new one requires revoking the previous one in the
 * same transaction. Nothing here publishes, lists, or exposes any evidence.
 */
export const marketplaceEvidenceRequests = pgTable(
  "marketplace_evidence_requests",
  {
    id: id().primaryKey(),
    sellSubmissionId: id("sell_submission_id")
      .notNull()
      .references(() => sellSubmissions.id, { onDelete: "cascade" }),
    contactId: id("contact_id")
      .notNull()
      .references(() => marketplaceContacts.id, { onDelete: "restrict" }),
    /**
     * The evidence categories staff asked for, drawn from
     * `marketplace_upload_purpose`. `OTHER` is deliberately not requestable:
     * "send us something else" is not an evidence category a seller can act on.
     */
    requestedCategories: varchar("requested_categories", { length: 40 })
      .array()
      .notNull(),
    keyedTokenHash: varchar("keyed_token_hash", { length: 128 }).notNull(),
    tokenDerivationNonce: varchar("token_derivation_nonce", { length: 64 }).notNull(),
    requestedByAdminUserId: id("requested_by_admin_user_id").references(
      () => adminUsers.id,
      { onDelete: "set null" },
    ),
    issuedAt: utcTimestamp("issued_at").notNull(),
    expiresAt: utcTimestamp("expires_at").notNull(),
    consumedAt: utcTimestamp("consumed_at"),
    revokedAt: utcTimestamp("revoked_at"),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttemptCount: integer("max_attempt_count").notNull().default(10),
    /** How many files the seller actually bound when they used the link. */
    submittedAttachmentCount: integer("submitted_attachment_count")
      .notNull()
      .default(0),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    updatedAt: utcTimestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("marketplace_evidence_requests_hash_uidx").on(table.keyedTokenHash),
    uniqueIndex("marketplace_evidence_requests_active_uidx")
      .on(table.sellSubmissionId)
      .where(sql`${table.consumedAt} is null and ${table.revokedAt} is null`),
    index("marketplace_evidence_requests_submission_idx").on(table.sellSubmissionId),
    index("marketplace_evidence_requests_expiry_idx").on(table.expiresAt),
    check(
      "marketplace_evidence_requests_expiry_chk",
      sql`${table.expiresAt} > ${table.issuedAt}`,
    ),
    check(
      "marketplace_evidence_requests_lifecycle_chk",
      sql`${table.consumedAt} is null or ${table.revokedAt} is null`,
    ),
    check(
      "marketplace_evidence_requests_consumed_order_chk",
      sql`${table.consumedAt} is null or ${table.consumedAt} >= ${table.issuedAt}`,
    ),
    check(
      "marketplace_evidence_requests_attempt_chk",
      sql`${table.attemptCount} >= 0 and ${table.maxAttemptCount} > 0 and ${table.attemptCount} <= ${table.maxAttemptCount}`,
    ),
    check(
      "marketplace_evidence_requests_categories_chk",
      sql`cardinality(${table.requestedCategories}) between 1 and 5 and ${table.requestedCategories} <@ array['INVENTORY_SPREADSHEET', 'WAREHOUSE_BUSINESS_EVIDENCE', 'CUSTODY_PART_PHOTO', 'PART_NUMBER_SERIAL_PHOTO', 'RELEASE_SUPPORTING_DOCUMENT']::varchar(40)[]`,
    ),
    // A consumed request carries at least one bound file, and an unconsumed one
    // carries none: the counter cannot drift away from what actually happened.
    check(
      "marketplace_evidence_requests_submitted_chk",
      sql`(${table.consumedAt} is null and ${table.submittedAttachmentCount} = 0) or (${table.consumedAt} is not null and ${table.submittedAttachmentCount} >= 1)`,
    ),
  ],
);

export type MarketplaceContact = typeof marketplaceContacts.$inferSelect;
export type NewMarketplaceContact = typeof marketplaceContacts.$inferInsert;
export type BuyRequest = typeof buyRequests.$inferSelect;
export type NewBuyRequest = typeof buyRequests.$inferInsert;
export type SellSubmission = typeof sellSubmissions.$inferSelect;
export type NewSellSubmission = typeof sellSubmissions.$inferInsert;
export type SellSubmissionItem = typeof sellSubmissionItems.$inferSelect;
export type NewSellSubmissionItem = typeof sellSubmissionItems.$inferInsert;
export type EmailVerificationToken = typeof emailVerificationTokens.$inferSelect;
export type NewEmailVerificationToken =
  typeof emailVerificationTokens.$inferInsert;
export type MarketplaceAttachment = typeof marketplaceAttachments.$inferSelect;
export type NewMarketplaceAttachment =
  typeof marketplaceAttachments.$inferInsert;
export type MarketplaceNote = typeof marketplaceNotes.$inferSelect;
export type NewMarketplaceNote = typeof marketplaceNotes.$inferInsert;
export type SupplierResponse = typeof supplierResponses.$inferSelect;
export type NewSupplierResponse = typeof supplierResponses.$inferInsert;
export type BuyerOffer = typeof buyerOffers.$inferSelect;
export type NewBuyerOffer = typeof buyerOffers.$inferInsert;
export type MarketplaceEvidenceRequest =
  typeof marketplaceEvidenceRequests.$inferSelect;
export type NewMarketplaceEvidenceRequest =
  typeof marketplaceEvidenceRequests.$inferInsert;
