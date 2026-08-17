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
