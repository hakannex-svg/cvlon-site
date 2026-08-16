CREATE TYPE "price_check_actor_type" AS ENUM('REQUESTER', 'ADMIN', 'SYSTEM', 'WORKER');--> statement-breakpoint
CREATE TYPE "admin_role" AS ENUM('ANALYST', 'REVIEWER', 'ADMIN', 'AUDITOR');--> statement-breakpoint
CREATE TYPE "ai_validation_state" AS ENUM('PENDING', 'VALID', 'INVALID', 'FAILED');--> statement-breakpoint
CREATE TYPE "analysis_confidence" AS ENUM('HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT_DATA');--> statement-breakpoint
CREATE TYPE "analysis_review_state" AS ENUM('DRAFT', 'HUMAN_REVIEW', 'APPROVED', 'REJECTED', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "price_check_condition_code" AS ENUM('NE', 'NS', 'OH', 'SV', 'AR', 'NOT_SURE');--> statement-breakpoint
CREATE TYPE "core_disposition" AS ENUM('REFUNDABLE', 'FORFEITED', 'UNCLEAR', 'NOT_APPLICABLE');--> statement-breakpoint
CREATE TYPE "deidentification_state" AS ENUM('IDENTIFIED', 'PSEUDONYMIZED', 'DEIDENTIFIED');--> statement-breakpoint
CREATE TYPE "documentation_code" AS ENUM('FAA_8130_3', 'EASA_FORM_1', 'DUAL_RELEASE', 'OEM_MANUFACTURER_COC', 'MATERIAL_CERTIFICATION', 'REMOVAL_RECORDS', 'TEARDOWN_EVALUATION_REPORT', 'TEST_REPORT', 'OTHER', 'NOT_SURE');--> statement-breakpoint
CREATE TYPE "extraction_acceptance_state" AS ENUM('PENDING', 'ACCEPTED', 'PARTIALLY_ACCEPTED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "extraction_status" AS ENUM('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "processing_job_state" AS ENUM('pending', 'running', 'succeeded', 'failed', 'dead_letter');--> statement-breakpoint
CREATE TYPE "notification_outbox_state" AS ENUM('pending', 'running', 'succeeded', 'failed', 'dead_letter');--> statement-breakpoint
CREATE TYPE "part_relationship_type" AS ENUM('EXACT', 'SUPERSEDES', 'SUPERSEDED_BY', 'INTERCHANGEABLE', 'RELATED_APPLICATION');--> statement-breakpoint
CREATE TYPE "permitted_use_state" AS ENUM('PENDING', 'INTERNAL_ANALYSIS', 'AGGREGATE_ONLY', 'PROHIBITED');--> statement-breakpoint
CREATE TYPE "price_check_status" AS ENUM('submitted', 'upload_processing', 'extraction_review', 'processing_failed', 'needs_information', 'ready_for_analysis', 'analysis_ready', 'human_review', 'approved', 'sent', 'quote_requested', 'converted', 'closed', 'spam', 'withdrawn');--> statement-breakpoint
CREATE TYPE "processing_job_type" AS ENUM('ATTACHMENT_LIFECYCLE', 'EXTRACTION', 'ANALYSIS', 'NOTIFICATION_DELIVERY', 'MAINTENANCE');--> statement-breakpoint
CREATE TYPE "observation_provenance_type" AS ENUM('CIVILON_SUPPLIER_QUOTE', 'CIVILON_PURCHASE', 'CIVILON_SALE', 'CUSTOMER_SUPPLIER_QUOTE', 'CUSTOMER_COMPLETED_PURCHASE', 'ANALYST_OBSERVATION', 'LICENSED_MARKET_DATA', 'OTHER_AUTHORIZED');--> statement-breakpoint
CREATE TYPE "quote_or_purchased" AS ENUM('quote', 'purchased');--> statement-breakpoint
CREATE TYPE "source_reliability" AS ENUM('HIGH', 'MEDIUM', 'LOW', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "attachment_retention_class" AS ENUM('PRICE_CHECK_EVIDENCE', 'TEMPORARY_PROCESSING', 'LEGAL_HOLD');--> statement-breakpoint
CREATE TYPE "attachment_scan_state" AS ENUM('PENDING', 'QUARANTINED', 'CLEAN', 'REJECTED', 'FAILED');--> statement-breakpoint
CREATE TYPE "sourcing_opportunity_status" AS ENUM('requested', 'assigned', 'contacted', 'quoted', 'converted', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "price_check_transaction_type" AS ENUM('outright', 'exchange', 'repair', 'not_sure');--> statement-breakpoint
CREATE TYPE "attachment_uploaded_by_type" AS ENUM('REQUESTER', 'ADMIN', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "verification_state" AS ENUM('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "warranty_unit" AS ENUM('DAYS', 'MONTHS', 'YEARS', 'HOURS', 'CYCLES', 'OTHER');--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" varchar(26) PRIMARY KEY,
	"identity_provider_issuer" text NOT NULL,
	"identity_provider_subject" text NOT NULL,
	"display_email" varchar(320) NOT NULL,
	"role" "admin_role" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	"deactivated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_artifacts" (
	"id" varchar(26) PRIMARY KEY,
	"artifact_type" varchar(80) NOT NULL,
	"related_extraction_id" varchar(26),
	"related_analysis_id" varchar(26),
	"provider" varchar(120),
	"configured_model_id" varchar(200),
	"prompt_version" varchar(80),
	"schema_version" varchar(80) NOT NULL,
	"redaction_policy_version" varchar(80) NOT NULL,
	"request_digest" varchar(128) NOT NULL,
	"structured_response" jsonb,
	"validation_state" "ai_validation_state" NOT NULL,
	"token_metadata" jsonb,
	"latency_metadata" jsonb,
	"sanitized_error_category" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachment_extractions" (
	"id" varchar(26) PRIMARY KEY,
	"attachment_id" varchar(26) NOT NULL,
	"version" integer NOT NULL,
	"provider" varchar(120),
	"configured_model_id" varchar(200),
	"schema_version" varchar(80) NOT NULL,
	"prompt_version" varchar(80),
	"structured_proposal" jsonb NOT NULL,
	"source_locations" jsonb,
	"uncertainty_warnings" jsonb,
	"processing_status" "extraction_status" NOT NULL,
	"validation_errors" jsonb,
	"reviewed_by" varchar(26),
	"reviewed_at" timestamp with time zone,
	"acceptance_state" "extraction_acceptance_state" DEFAULT 'PENDING'::"extraction_acceptance_state" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachment_extractions_version_positive_chk" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" varchar(26) PRIMARY KEY,
	"price_check_id" varchar(26) NOT NULL,
	"uploaded_by_type" "attachment_uploaded_by_type" NOT NULL,
	"display_filename" varchar(255) NOT NULL,
	"object_key" varchar(700) NOT NULL,
	"storage_provider" varchar(80) NOT NULL,
	"declared_mime" varchar(255),
	"detected_mime" varchar(255),
	"byte_size" numeric(20,0) NOT NULL,
	"content_digest" varchar(128) NOT NULL,
	"scan_state" "attachment_scan_state" DEFAULT 'PENDING'::"attachment_scan_state" NOT NULL,
	"retention_class" "attachment_retention_class" NOT NULL,
	"deletion_due_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachments_byte_size_nonnegative_chk" CHECK ("byte_size" >= 0)
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" varchar(26) PRIMARY KEY,
	"aggregate_type" varchar(80) NOT NULL,
	"aggregate_id" varchar(26) NOT NULL,
	"actor_type" "price_check_actor_type" NOT NULL,
	"actor_id" varchar(26),
	"action" varchar(140) NOT NULL,
	"before_version_reference" varchar(160),
	"after_version_reference" varchar(160),
	"correlation_id" varchar(128) NOT NULL,
	"sanitized_metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_outbox" (
	"id" varchar(26) PRIMARY KEY,
	"message_type" varchar(100) NOT NULL,
	"aggregate_type" varchar(80) NOT NULL,
	"aggregate_id" varchar(26) NOT NULL,
	"recipient_reference" varchar(160) NOT NULL,
	"template_version" varchar(80) NOT NULL,
	"idempotency_key" varchar(200) NOT NULL,
	"state" "notification_outbox_state" DEFAULT 'pending'::"notification_outbox_state" NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"lease_owner" varchar(160),
	"lease_expires_at" timestamp with time zone,
	"provider_message_id" varchar(240),
	"next_attempt_at" timestamp with time zone NOT NULL,
	"sanitized_failure_code" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "notification_outbox_attempt_count_chk" CHECK ("attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "observation_documentation" (
	"observation_id" varchar(26),
	"documentation_code" "documentation_code",
	"other_text" varchar(240),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "observation_documentation_pk" PRIMARY KEY("observation_id","documentation_code"),
	CONSTRAINT "observation_documentation_other_chk" CHECK (("documentation_code" = 'OTHER' and nullif(btrim("other_text"), '') is not null) or ("documentation_code" <> 'OTHER' and "other_text" is null))
);
--> statement-breakpoint
CREATE TABLE "part_relationships" (
	"id" varchar(26) PRIMARY KEY,
	"from_normalized_part_number" varchar(120) NOT NULL,
	"to_normalized_part_number" varchar(120) NOT NULL,
	"relationship_type" "part_relationship_type" NOT NULL,
	"source_provenance" varchar(240) NOT NULL,
	"verification_state" "verification_state" NOT NULL,
	"reviewed_by" varchar(26),
	"effective_from" date,
	"effective_to" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "part_relationships_distinct_parts_chk" CHECK ("from_normalized_part_number" <> "to_normalized_part_number" or "relationship_type" = 'EXACT')
);
--> statement-breakpoint
CREATE TABLE "price_check_analyses" (
	"id" varchar(26) PRIMARY KEY,
	"price_check_id" varchar(26) NOT NULL,
	"version" integer NOT NULL,
	"input_revision_id" varchar(26) NOT NULL,
	"engine_version" varchar(80) NOT NULL,
	"policy_version" varchar(80) NOT NULL,
	"source_transaction_components" jsonb NOT NULL,
	"normalized_transaction_components" jsonb NOT NULL,
	"market_low" numeric(18,2),
	"market_median" numeric(18,2),
	"market_high" numeric(18,2),
	"currency_code" varchar(3),
	"evidence_count" integer DEFAULT 0 NOT NULL,
	"confidence" "analysis_confidence" NOT NULL,
	"classification" varchar(120),
	"insufficiency_reasons" jsonb,
	"factor_codes" jsonb NOT NULL,
	"deterministic_calculation" jsonb NOT NULL,
	"deterministic_calculation_digest" varchar(128) NOT NULL,
	"ai_draft_id" varchar(26),
	"analyst_id" varchar(26),
	"reviewer_id" varchar(26),
	"review_state" "analysis_review_state" DEFAULT 'DRAFT'::"analysis_review_state" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "price_check_analyses_version_positive_chk" CHECK ("version" > 0),
	CONSTRAINT "price_check_analyses_evidence_nonnegative_chk" CHECK ("evidence_count" >= 0),
	CONSTRAINT "price_check_analyses_currency_iso4217_chk" CHECK ("currency_code" is null or "currency_code" in ('AUD', 'CAD', 'CHF', 'EUR', 'GBP', 'JPY', 'USD')),
	CONSTRAINT "price_check_analyses_range_order_chk" CHECK ("market_low" is null or "market_median" is null or "market_high" is null or ("market_low" <= "market_median" and "market_median" <= "market_high"))
);
--> statement-breakpoint
CREATE TABLE "price_check_comparables" (
	"analysis_id" varchar(26),
	"observation_id" varchar(26),
	"included" boolean NOT NULL,
	"reason_code" varchar(120) NOT NULL,
	"analyst_note" text,
	"comparable_snapshot" jsonb NOT NULL,
	"normalization_reference" jsonb,
	"sequence" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_check_comparables_pk" PRIMARY KEY("analysis_id","observation_id"),
	CONSTRAINT "price_check_comparables_sequence_positive_chk" CHECK ("sequence" > 0)
);
--> statement-breakpoint
CREATE TABLE "price_check_document_requirements" (
	"price_check_id" varchar(26),
	"requirement_code" "documentation_code",
	"other_text" varchar(240),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_check_document_requirements_pk" PRIMARY KEY("price_check_id","requirement_code"),
	CONSTRAINT "price_check_document_requirements_other_chk" CHECK (("requirement_code" = 'OTHER' and nullif(btrim("other_text"), '') is not null) or ("requirement_code" <> 'OTHER' and "other_text" is null))
);
--> statement-breakpoint
CREATE TABLE "price_check_results" (
	"id" varchar(26) PRIMARY KEY,
	"price_check_id" varchar(26) NOT NULL,
	"analysis_id" varchar(26) NOT NULL,
	"version" integer NOT NULL,
	"approved_classification" varchar(120) NOT NULL,
	"display_range" boolean DEFAULT false NOT NULL,
	"display_evidence_count" boolean DEFAULT false NOT NULL,
	"approved_factor_list" jsonb NOT NULL,
	"approved_explanation" text NOT NULL,
	"disclaimer_version" varchar(80) NOT NULL,
	"approved_by" varchar(26) NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"rendered_content_digest" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_check_results_version_positive_chk" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "price_check_revisions" (
	"id" varchar(26) PRIMARY KEY,
	"price_check_id" varchar(26) NOT NULL,
	"version" integer NOT NULL,
	"normalized_snapshot" jsonb NOT NULL,
	"change_reason" text NOT NULL,
	"actor_type" "price_check_actor_type" NOT NULL,
	"actor_id" varchar(26),
	"source_extraction_id" varchar(26),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_check_revisions_version_positive_chk" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "price_checks" (
	"id" varchar(26) PRIMARY KEY,
	"public_reference" varchar(16) NOT NULL,
	"requester_id" varchar(26) NOT NULL,
	"status" "price_check_status" DEFAULT 'submitted'::"price_check_status" NOT NULL,
	"assigned_admin_user_id" varchar(26),
	"original_part_number" varchar(160) NOT NULL,
	"normalized_part_number" varchar(120) NOT NULL,
	"description" text,
	"quantity" numeric(12,3) NOT NULL,
	"quote_or_purchased" "quote_or_purchased" NOT NULL,
	"transaction_type" "price_check_transaction_type" NOT NULL,
	"condition_code" "price_check_condition_code" NOT NULL,
	"unit_price" numeric(18,2) NOT NULL,
	"currency_code" varchar(3) NOT NULL,
	"core_charge" numeric(18,2),
	"core_disposition" "core_disposition",
	"exchange_fee" numeric(18,2),
	"freight" numeric(18,2),
	"transaction_date" date,
	"transaction_date_uncertain" boolean DEFAULT false NOT NULL,
	"aircraft_model" varchar(160),
	"aog" boolean DEFAULT false NOT NULL,
	"warranty_value" numeric(12,2),
	"warranty_unit" "warranty_unit",
	"warranty_text" text,
	"notes" text,
	"source_page" varchar(240) NOT NULL,
	"landing_page" varchar(500),
	"referrer_origin" varchar(255),
	"utm_source" varchar(160),
	"utm_medium" varchar(160),
	"utm_campaign" varchar(160),
	"utm_content" varchar(160),
	"utm_term" varchar(160),
	"idempotency_hash" varchar(128) NOT NULL,
	"current_analysis_id" varchar(26),
	"current_result_id" varchar(26),
	"submitted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "price_checks_quantity_positive_chk" CHECK ("quantity" > 0),
	CONSTRAINT "price_checks_unit_price_positive_chk" CHECK ("unit_price" > 0),
	CONSTRAINT "price_checks_currency_iso4217_chk" CHECK ("currency_code" in ('AUD', 'CAD', 'CHF', 'EUR', 'GBP', 'JPY', 'USD')),
	CONSTRAINT "price_checks_public_reference_chk" CHECK ("public_reference" ~ '^PC-[0-9A-HJKMNP-TV-Z]{10}$'),
	CONSTRAINT "price_checks_money_nonnegative_chk" CHECK (coalesce("core_charge", 0) >= 0 and coalesce("exchange_fee", 0) >= 0 and coalesce("freight", 0) >= 0)
);
--> statement-breakpoint
CREATE TABLE "price_observations" (
	"id" varchar(26) PRIMARY KEY,
	"provenance_type" "observation_provenance_type" NOT NULL,
	"internal_source_reference" varchar(240),
	"original_part_number" varchar(160) NOT NULL,
	"normalized_part_number" varchar(120) NOT NULL,
	"condition_code" "price_check_condition_code" NOT NULL,
	"transaction_type" "price_check_transaction_type" NOT NULL,
	"quantity" numeric(12,3) NOT NULL,
	"unit_price" numeric(18,2) NOT NULL,
	"currency_code" varchar(3) NOT NULL,
	"core_charge" numeric(18,2),
	"core_disposition" "core_disposition",
	"exchange_fee" numeric(18,2),
	"freight" numeric(18,2),
	"observation_date" date NOT NULL,
	"warranty_value" numeric(12,2),
	"warranty_unit" "warranty_unit",
	"warranty_text" text,
	"aog" boolean DEFAULT false NOT NULL,
	"aircraft_application" varchar(240),
	"region_context" varchar(160),
	"availability_evidence" text,
	"availability_observed_at" timestamp with time zone,
	"source_reliability" "source_reliability" NOT NULL,
	"verification_state" "verification_state" NOT NULL,
	"permitted_use_state" "permitted_use_state" NOT NULL,
	"deidentification_state" "deidentification_state" NOT NULL,
	"created_by" varchar(26),
	"reviewed_by" varchar(26),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "price_observations_quantity_positive_chk" CHECK ("quantity" > 0),
	CONSTRAINT "price_observations_unit_price_positive_chk" CHECK ("unit_price" > 0),
	CONSTRAINT "price_observations_currency_iso4217_chk" CHECK ("currency_code" in ('AUD', 'CAD', 'CHF', 'EUR', 'GBP', 'JPY', 'USD'))
);
--> statement-breakpoint
CREATE TABLE "processing_jobs" (
	"id" varchar(26) PRIMARY KEY,
	"job_type" "processing_job_type" NOT NULL,
	"aggregate_type" varchar(80) NOT NULL,
	"aggregate_id" varchar(26) NOT NULL,
	"idempotency_key" varchar(200) NOT NULL,
	"state" "processing_job_state" DEFAULT 'pending'::"processing_job_state" NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"lease_owner" varchar(160),
	"lease_expires_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"sanitized_error_code" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "processing_jobs_attempt_count_chk" CHECK ("attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "requesters" (
	"id" varchar(26) PRIMARY KEY,
	"first_name" varchar(120) NOT NULL,
	"last_name" varchar(120) NOT NULL,
	"company_name" varchar(200) NOT NULL,
	"business_email" varchar(320) NOT NULL,
	"normalized_email" varchar(320) NOT NULL,
	"phone" varchar(80) NOT NULL,
	"normalized_phone" varchar(32) NOT NULL,
	"role" varchar(120),
	"country" varchar(2) NOT NULL,
	"service_processing_acknowledged_at" timestamp with time zone NOT NULL,
	"marketing_consent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deletion_requested_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "requesters_country_iso2_chk" CHECK ("country" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "result_access_tokens" (
	"id" varchar(26) PRIMARY KEY,
	"result_id" varchar(26) NOT NULL,
	"keyed_token_hash" varchar(128) NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"max_use_count" integer,
	CONSTRAINT "result_access_tokens_view_count_chk" CHECK ("view_count" >= 0),
	CONSTRAINT "result_access_tokens_max_use_count_chk" CHECK ("max_use_count" is null or "max_use_count" > 0),
	CONSTRAINT "result_access_tokens_expiry_chk" CHECK ("expires_at" > "issued_at")
);
--> statement-breakpoint
CREATE TABLE "sourcing_opportunities" (
	"id" varchar(26) PRIMARY KEY,
	"price_check_id" varchar(26) NOT NULL,
	"requester_id" varchar(26) NOT NULL,
	"source_result_id" varchar(26) NOT NULL,
	"status" "sourcing_opportunity_status" DEFAULT 'requested'::"sourcing_opportunity_status" NOT NULL,
	"assigned_owner" varchar(160),
	"crm_reference" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "admin_users_identity_uidx" ON "admin_users" ("identity_provider_issuer","identity_provider_subject");--> statement-breakpoint
CREATE INDEX "admin_users_active_idx" ON "admin_users" ("active");--> statement-breakpoint
CREATE INDEX "ai_artifacts_request_digest_idx" ON "ai_artifacts" ("request_digest");--> statement-breakpoint
CREATE UNIQUE INDEX "attachment_extractions_version_uidx" ON "attachment_extractions" ("attachment_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_object_key_uidx" ON "attachments" ("object_key");--> statement-breakpoint
CREATE INDEX "attachments_price_check_idx" ON "attachments" ("price_check_id");--> statement-breakpoint
CREATE INDEX "attachments_not_deleted_idx" ON "attachments" ("price_check_id") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "audit_events_aggregate_idx" ON "audit_events" ("aggregate_type","aggregate_id");--> statement-breakpoint
CREATE INDEX "audit_events_correlation_idx" ON "audit_events" ("correlation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_outbox_idempotency_uidx" ON "notification_outbox" ("idempotency_key");--> statement-breakpoint
CREATE INDEX "notification_outbox_runnable_idx" ON "notification_outbox" ("next_attempt_at","created_at") WHERE "state" in ('pending', 'failed');--> statement-breakpoint
CREATE UNIQUE INDEX "part_relationships_definition_uidx" ON "part_relationships" ("from_normalized_part_number","to_normalized_part_number","relationship_type");--> statement-breakpoint
CREATE INDEX "part_relationships_from_idx" ON "part_relationships" ("from_normalized_part_number");--> statement-breakpoint
CREATE INDEX "part_relationships_to_idx" ON "part_relationships" ("to_normalized_part_number");--> statement-breakpoint
CREATE UNIQUE INDEX "price_check_analyses_version_uidx" ON "price_check_analyses" ("price_check_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "price_check_comparables_sequence_uidx" ON "price_check_comparables" ("analysis_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "price_check_results_version_uidx" ON "price_check_results" ("price_check_id","version");--> statement-breakpoint
CREATE INDEX "price_check_results_digest_idx" ON "price_check_results" ("rendered_content_digest");--> statement-breakpoint
CREATE UNIQUE INDEX "price_check_revisions_version_uidx" ON "price_check_revisions" ("price_check_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "price_checks_public_reference_uidx" ON "price_checks" ("public_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "price_checks_idempotency_hash_uidx" ON "price_checks" ("idempotency_hash");--> statement-breakpoint
CREATE INDEX "price_checks_status_idx" ON "price_checks" ("status");--> statement-breakpoint
CREATE INDEX "price_checks_assignee_idx" ON "price_checks" ("assigned_admin_user_id");--> statement-breakpoint
CREATE INDEX "price_checks_submitted_at_idx" ON "price_checks" ("submitted_at");--> statement-breakpoint
CREATE INDEX "price_checks_normalized_part_number_idx" ON "price_checks" ("normalized_part_number");--> statement-breakpoint
CREATE INDEX "price_observations_part_idx" ON "price_observations" ("normalized_part_number");--> statement-breakpoint
CREATE INDEX "price_observations_condition_idx" ON "price_observations" ("condition_code");--> statement-breakpoint
CREATE INDEX "price_observations_transaction_type_idx" ON "price_observations" ("transaction_type");--> statement-breakpoint
CREATE INDEX "price_observations_date_idx" ON "price_observations" ("observation_date");--> statement-breakpoint
CREATE INDEX "price_observations_permitted_use_idx" ON "price_observations" ("permitted_use_state");--> statement-breakpoint
CREATE INDEX "price_observations_verification_idx" ON "price_observations" ("verification_state");--> statement-breakpoint
CREATE UNIQUE INDEX "processing_jobs_idempotency_uidx" ON "processing_jobs" ("idempotency_key");--> statement-breakpoint
CREATE INDEX "processing_jobs_runnable_idx" ON "processing_jobs" ("next_attempt_at","created_at") WHERE "state" in ('pending', 'failed');--> statement-breakpoint
CREATE INDEX "requesters_normalized_email_idx" ON "requesters" ("normalized_email");--> statement-breakpoint
CREATE INDEX "requesters_normalized_phone_idx" ON "requesters" ("normalized_phone");--> statement-breakpoint
CREATE UNIQUE INDEX "result_access_tokens_hash_uidx" ON "result_access_tokens" ("keyed_token_hash");--> statement-breakpoint
CREATE INDEX "result_access_tokens_expiry_idx" ON "result_access_tokens" ("expires_at");--> statement-breakpoint
CREATE INDEX "sourcing_opportunities_price_check_idx" ON "sourcing_opportunities" ("price_check_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sourcing_opportunities_result_uidx" ON "sourcing_opportunities" ("source_result_id");--> statement-breakpoint
ALTER TABLE "ai_artifacts" ADD CONSTRAINT "ai_artifacts_8dUEvOA4xsOT_fkey" FOREIGN KEY ("related_extraction_id") REFERENCES "attachment_extractions"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "ai_artifacts" ADD CONSTRAINT "ai_artifacts_related_analysis_id_price_check_analyses_id_fkey" FOREIGN KEY ("related_analysis_id") REFERENCES "price_check_analyses"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "attachment_extractions" ADD CONSTRAINT "attachment_extractions_attachment_id_attachments_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "attachments"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "attachment_extractions" ADD CONSTRAINT "attachment_extractions_reviewed_by_admin_users_id_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "admin_users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_price_check_id_price_checks_id_fkey" FOREIGN KEY ("price_check_id") REFERENCES "price_checks"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "observation_documentation" ADD CONSTRAINT "observation_documentation_LyGg8Pnk16Qa_fkey" FOREIGN KEY ("observation_id") REFERENCES "price_observations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "part_relationships" ADD CONSTRAINT "part_relationships_reviewed_by_admin_users_id_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "admin_users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "price_check_analyses" ADD CONSTRAINT "price_check_analyses_price_check_id_price_checks_id_fkey" FOREIGN KEY ("price_check_id") REFERENCES "price_checks"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "price_check_analyses" ADD CONSTRAINT "price_check_analyses_UiR773iOkFUu_fkey" FOREIGN KEY ("input_revision_id") REFERENCES "price_check_revisions"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "price_check_analyses" ADD CONSTRAINT "price_check_analyses_ai_draft_id_ai_artifacts_id_fkey" FOREIGN KEY ("ai_draft_id") REFERENCES "ai_artifacts"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "price_check_analyses" ADD CONSTRAINT "price_check_analyses_analyst_id_admin_users_id_fkey" FOREIGN KEY ("analyst_id") REFERENCES "admin_users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "price_check_analyses" ADD CONSTRAINT "price_check_analyses_reviewer_id_admin_users_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "admin_users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "price_check_comparables" ADD CONSTRAINT "price_check_comparables_xufUuyMYmVOX_fkey" FOREIGN KEY ("analysis_id") REFERENCES "price_check_analyses"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "price_check_comparables" ADD CONSTRAINT "price_check_comparables_S30kLHte4V7P_fkey" FOREIGN KEY ("observation_id") REFERENCES "price_observations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "price_check_document_requirements" ADD CONSTRAINT "price_check_document_requirements_ZsLnKIVXF0oI_fkey" FOREIGN KEY ("price_check_id") REFERENCES "price_checks"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "price_check_results" ADD CONSTRAINT "price_check_results_price_check_id_price_checks_id_fkey" FOREIGN KEY ("price_check_id") REFERENCES "price_checks"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "price_check_results" ADD CONSTRAINT "price_check_results_analysis_id_price_check_analyses_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "price_check_analyses"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "price_check_results" ADD CONSTRAINT "price_check_results_approved_by_admin_users_id_fkey" FOREIGN KEY ("approved_by") REFERENCES "admin_users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "price_check_revisions" ADD CONSTRAINT "price_check_revisions_price_check_id_price_checks_id_fkey" FOREIGN KEY ("price_check_id") REFERENCES "price_checks"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "price_check_revisions" ADD CONSTRAINT "price_check_revisions_5CgSavwMfEiS_fkey" FOREIGN KEY ("source_extraction_id") REFERENCES "attachment_extractions"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "price_checks" ADD CONSTRAINT "price_checks_requester_id_requesters_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "requesters"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "price_checks" ADD CONSTRAINT "price_checks_assigned_admin_user_id_admin_users_id_fkey" FOREIGN KEY ("assigned_admin_user_id") REFERENCES "admin_users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "price_checks" ADD CONSTRAINT "price_checks_current_analysis_id_price_check_analyses_id_fkey" FOREIGN KEY ("current_analysis_id") REFERENCES "price_check_analyses"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "price_checks" ADD CONSTRAINT "price_checks_current_result_id_price_check_results_id_fkey" FOREIGN KEY ("current_result_id") REFERENCES "price_check_results"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_created_by_admin_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "admin_users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_reviewed_by_admin_users_id_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "admin_users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "result_access_tokens" ADD CONSTRAINT "result_access_tokens_result_id_price_check_results_id_fkey" FOREIGN KEY ("result_id") REFERENCES "price_check_results"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "sourcing_opportunities" ADD CONSTRAINT "sourcing_opportunities_price_check_id_price_checks_id_fkey" FOREIGN KEY ("price_check_id") REFERENCES "price_checks"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "sourcing_opportunities" ADD CONSTRAINT "sourcing_opportunities_requester_id_requesters_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "requesters"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "sourcing_opportunities" ADD CONSTRAINT "sourcing_opportunities_sXXrpGfrfwQW_fkey" FOREIGN KEY ("source_result_id") REFERENCES "price_check_results"("id") ON DELETE RESTRICT;