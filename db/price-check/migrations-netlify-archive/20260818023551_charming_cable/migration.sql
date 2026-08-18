CREATE TYPE "buy_request_status" AS ENUM('pending_verification', 'verified', 'sourcing', 'quoted', 'converted', 'closed', 'spam', 'withdrawn');--> statement-breakpoint
CREATE TYPE "buyer_offer_delivery_option" AS ENUM('door_delivery', 'port_of_entry', 'nj_pickup', 'not_determined');--> statement-breakpoint
CREATE TYPE "buyer_offer_status" AS ENUM('draft', 'sent', 'accepted', 'declined', 'expired', 'superseded', 'withdrawn');--> statement-breakpoint
CREATE TYPE "email_verification_purpose" AS ENUM('BUY_REQUEST_CONTACT', 'SELL_SUBMISSION_CONTACT');--> statement-breakpoint
CREATE TYPE "marketplace_aggregate_type" AS ENUM('buy_request', 'sell_submission');--> statement-breakpoint
CREATE TYPE "marketplace_condition_code" AS ENUM('NE', 'NS', 'OH', 'SV', 'AR', 'ANY', 'NOT_SURE');--> statement-breakpoint
CREATE TYPE "marketplace_fulfillment_preference" AS ENUM('door_delivery', 'port_of_entry', 'nj_pickup', 'not_sure');--> statement-breakpoint
CREATE TYPE "marketplace_retention_class" AS ENUM('MARKETPLACE_INTAKE_EVIDENCE', 'TEMPORARY_PROCESSING', 'LEGAL_HOLD');--> statement-breakpoint
CREATE TYPE "marketplace_scan_state" AS ENUM('PENDING', 'QUARANTINED', 'CLEAN', 'REJECTED', 'FAILED');--> statement-breakpoint
CREATE TYPE "marketplace_upload_purpose" AS ENUM('INVENTORY_SPREADSHEET', 'WAREHOUSE_BUSINESS_EVIDENCE', 'CUSTODY_PART_PHOTO', 'PART_NUMBER_SERIAL_PHOTO', 'RELEASE_SUPPORTING_DOCUMENT', 'OTHER');--> statement-breakpoint
CREATE TYPE "marketplace_upload_state" AS ENUM('AUTHORIZED', 'UPLOADED', 'BOUND', 'REJECTED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "marketplace_uploaded_by_type" AS ENUM('CONTACT', 'ADMIN', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "marketplace_urgency" AS ENUM('aog', 'critical', 'standard', 'planned', 'not_sure');--> statement-breakpoint
CREATE TYPE "marketplace_verification_state" AS ENUM('UNVERIFIED', 'PENDING', 'VERIFIED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "sell_submission_kind" AS ENUM('single_part', 'bulk_inventory');--> statement-breakpoint
CREATE TYPE "sell_submission_status" AS ENUM('pending_verification', 'verified', 'under_review', 'accepted', 'declined', 'closed', 'spam', 'withdrawn');--> statement-breakpoint
CREATE TYPE "supplier_availability_state" AS ENUM('subject_to_confirmation', 'claimed_available', 'claimed_lead_time', 'unavailable', 'unknown');--> statement-breakpoint
CREATE TYPE "supplier_response_status" AS ENUM('received', 'under_review', 'shortlisted', 'selected', 'declined', 'withdrawn', 'expired');--> statement-breakpoint
CREATE TYPE "supplier_source_kind" AS ENUM('registered_contact', 'nonregistered_supplier');--> statement-breakpoint
CREATE TABLE "buy_requests" (
	"id" varchar(26) PRIMARY KEY,
	"public_reference" varchar(16) NOT NULL,
	"contact_id" varchar(26) NOT NULL,
	"original_part_number" varchar(160),
	"normalized_part_number" varchar(120),
	"description" text,
	"quantity" numeric(12,3) DEFAULT '1' NOT NULL,
	"acceptable_condition" "marketplace_condition_code" DEFAULT 'NOT_SURE'::"marketplace_condition_code" NOT NULL,
	"urgency" "marketplace_urgency" DEFAULT 'not_sure'::"marketplace_urgency" NOT NULL,
	"needed_by_date" date,
	"aircraft_model" varchar(160),
	"application_notes" text,
	"delivery_country" varchar(2),
	"delivery_postal_code" varchar(24),
	"delivery_city" varchar(160),
	"fulfillment_preference" "marketplace_fulfillment_preference" DEFAULT 'not_sure'::"marketplace_fulfillment_preference" NOT NULL,
	"status" "buy_request_status" DEFAULT 'pending_verification'::"buy_request_status" NOT NULL,
	"assigned_admin_user_id" varchar(26),
	"verification_requested_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
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
	"source_price_check_id" varchar(26),
	"source_result_id" varchar(26),
	"external_source_intelligence" jsonb,
	"submitted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "buy_requests_public_reference_chk" CHECK ("public_reference" ~ '^BR-[0-9A-HJKMNP-TV-Z]{10}$'),
	CONSTRAINT "buy_requests_part_or_description_chk" CHECK (nullif(btrim("original_part_number"), '') is not null or nullif(btrim("description"), '') is not null),
	CONSTRAINT "buy_requests_normalized_part_number_chk" CHECK (("original_part_number" is null) = ("normalized_part_number" is null)),
	CONSTRAINT "buy_requests_quantity_positive_chk" CHECK ("quantity" > 0),
	CONSTRAINT "buy_requests_delivery_country_chk" CHECK ("delivery_country" is null or "delivery_country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "buy_requests_pending_verification_chk" CHECK (("status" = 'pending_verification') or ("verified_at" is not null or "status" in ('spam', 'withdrawn', 'closed'))),
	CONSTRAINT "buy_requests_verified_status_chk" CHECK ("status" <> 'pending_verification' or "verified_at" is null),
	CONSTRAINT "buy_requests_verified_order_chk" CHECK ("verified_at" is null or "verified_at" >= "submitted_at"),
	CONSTRAINT "buy_requests_closed_state_chk" CHECK ("closed_at" is null or "status" in ('converted', 'closed', 'spam', 'withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "buyer_offers" (
	"id" varchar(26) PRIMARY KEY,
	"buy_request_id" varchar(26) NOT NULL,
	"selected_supplier_response_id" varchar(26),
	"version" integer NOT NULL,
	"civilon_sale_unit_price" numeric(18,2) NOT NULL,
	"currency_code" varchar(3) NOT NULL,
	"quantity" numeric(12,3) NOT NULL,
	"stated_condition" "marketplace_condition_code",
	"documents_summary" text,
	"delivery_option" "buyer_offer_delivery_option" DEFAULT 'not_determined'::"buyer_offer_delivery_option" NOT NULL,
	"shipping_and_export_scope" text,
	"lead_time_days" integer,
	"status" "buyer_offer_status" DEFAULT 'draft'::"buyer_offer_status" NOT NULL,
	"created_by_admin_user_id" varchar(26),
	"sent_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "buyer_offers_version_positive_chk" CHECK ("version" > 0),
	CONSTRAINT "buyer_offers_sale_price_nonnegative_chk" CHECK ("civilon_sale_unit_price" >= 0),
	CONSTRAINT "buyer_offers_quantity_positive_chk" CHECK ("quantity" > 0),
	CONSTRAINT "buyer_offers_currency_chk" CHECK ("currency_code" in ('AUD', 'CAD', 'CHF', 'EUR', 'GBP', 'JPY', 'USD')),
	CONSTRAINT "buyer_offers_lead_time_chk" CHECK ("lead_time_days" is null or "lead_time_days" >= 0),
	CONSTRAINT "buyer_offers_sent_state_chk" CHECK ("status" = 'draft' or "sent_at" is not null),
	CONSTRAINT "buyer_offers_draft_not_sent_chk" CHECK ("status" <> 'draft' or "sent_at" is null),
	CONSTRAINT "buyer_offers_expiry_chk" CHECK ("expires_at" is null or "sent_at" is null or "expires_at" > "sent_at"),
	CONSTRAINT "buyer_offers_responded_chk" CHECK ("responded_at" is null or "sent_at" is not null),
	CONSTRAINT "buyer_offers_superseded_chk" CHECK ("superseded_at" is null or "status" = 'superseded')
);
--> statement-breakpoint
CREATE TABLE "email_verification_tokens" (
	"id" varchar(26) PRIMARY KEY,
	"aggregate_type" "marketplace_aggregate_type" NOT NULL,
	"aggregate_id" varchar(26) NOT NULL,
	"buy_request_id" varchar(26),
	"sell_submission_id" varchar(26),
	"contact_id" varchar(26) NOT NULL,
	"purpose" "email_verification_purpose" NOT NULL,
	"keyed_token_hash" varchar(128) NOT NULL,
	"token_derivation_nonce" varchar(64) NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempt_count" integer DEFAULT 5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_verification_tokens_aggregate_chk" CHECK (("aggregate_type" = 'buy_request' and "buy_request_id" = "aggregate_id" and "sell_submission_id" is null) or ("aggregate_type" = 'sell_submission' and "sell_submission_id" = "aggregate_id" and "buy_request_id" is null)),
	CONSTRAINT "email_verification_tokens_purpose_chk" CHECK (("aggregate_type" = 'buy_request' and "purpose" = 'BUY_REQUEST_CONTACT') or ("aggregate_type" = 'sell_submission' and "purpose" = 'SELL_SUBMISSION_CONTACT')),
	CONSTRAINT "email_verification_tokens_expiry_chk" CHECK ("expires_at" > "issued_at"),
	CONSTRAINT "email_verification_tokens_lifecycle_chk" CHECK ("consumed_at" is null or "revoked_at" is null),
	CONSTRAINT "email_verification_tokens_consumed_order_chk" CHECK ("consumed_at" is null or "consumed_at" >= "issued_at"),
	CONSTRAINT "email_verification_tokens_attempt_chk" CHECK ("attempt_count" >= 0 and "max_attempt_count" > 0 and "attempt_count" <= "max_attempt_count")
);
--> statement-breakpoint
CREATE TABLE "marketplace_attachments" (
	"id" varchar(26) PRIMARY KEY,
	"aggregate_type" "marketplace_aggregate_type" NOT NULL,
	"aggregate_id" varchar(26) NOT NULL,
	"buy_request_id" varchar(26),
	"sell_submission_id" varchar(26),
	"purpose" "marketplace_upload_purpose" NOT NULL,
	"uploaded_by_type" "marketplace_uploaded_by_type" NOT NULL,
	"display_filename" varchar(255) NOT NULL,
	"object_key" varchar(700) NOT NULL,
	"storage_provider" varchar(80) NOT NULL,
	"declared_mime" varchar(255),
	"detected_mime" varchar(255),
	"byte_size" numeric(20,0) NOT NULL,
	"content_digest" varchar(128),
	"scan_state" "marketplace_scan_state" DEFAULT 'PENDING'::"marketplace_scan_state" NOT NULL,
	"quarantine_released_at" timestamp with time zone,
	"retention_class" "marketplace_retention_class" NOT NULL,
	"source_pending_upload_id" varchar(26),
	"deletion_due_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketplace_attachments_byte_size_chk" CHECK ("byte_size" >= 0),
	CONSTRAINT "marketplace_attachments_object_key_chk" CHECK ("object_key" like 'marketplace/%'),
	CONSTRAINT "marketplace_attachments_aggregate_chk" CHECK (("aggregate_type" = 'buy_request' and "buy_request_id" = "aggregate_id" and "sell_submission_id" is null) or ("aggregate_type" = 'sell_submission' and "sell_submission_id" = "aggregate_id" and "buy_request_id" is null)),
	CONSTRAINT "marketplace_attachments_quarantine_chk" CHECK ("quarantine_released_at" is null or "scan_state" = 'CLEAN')
);
--> statement-breakpoint
CREATE TABLE "marketplace_contacts" (
	"id" varchar(26) PRIMARY KEY,
	"first_name" varchar(120) NOT NULL,
	"last_name" varchar(120) NOT NULL,
	"company_name" varchar(200) NOT NULL,
	"business_email" varchar(320) NOT NULL,
	"normalized_email" varchar(320) NOT NULL,
	"phone" varchar(80),
	"normalized_phone" varchar(32),
	"role" varchar(120),
	"country" varchar(2),
	"state_region" varchar(160),
	"city" varchar(160),
	"postal_code" varchar(24),
	"website_url" varchar(500),
	"acts_as_buyer" boolean DEFAULT false NOT NULL,
	"acts_as_seller" boolean DEFAULT false NOT NULL,
	"verification_state" "marketplace_verification_state" DEFAULT 'UNVERIFIED'::"marketplace_verification_state" NOT NULL,
	"verification_requested_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"verification_revoked_at" timestamp with time zone,
	"service_processing_acknowledged_at" timestamp with time zone,
	"marketing_consent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deletion_requested_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "marketplace_contacts_country_iso2_chk" CHECK ("country" is null or "country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "marketplace_contacts_normalized_email_chk" CHECK ("normalized_email" = lower("normalized_email")),
	CONSTRAINT "marketplace_contacts_verified_state_chk" CHECK ("verification_state" <> 'VERIFIED' or "verified_at" is not null),
	CONSTRAINT "marketplace_contacts_verified_order_chk" CHECK ("verified_at" is null or "verification_requested_at" is null or "verified_at" >= "verification_requested_at")
);
--> statement-breakpoint
CREATE TABLE "marketplace_notes" (
	"id" varchar(26) PRIMARY KEY,
	"aggregate_type" "marketplace_aggregate_type" NOT NULL,
	"aggregate_id" varchar(26) NOT NULL,
	"buy_request_id" varchar(26),
	"sell_submission_id" varchar(26),
	"admin_user_id" varchar(26) NOT NULL,
	"body" text NOT NULL,
	"redacted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketplace_notes_aggregate_chk" CHECK (("aggregate_type" = 'buy_request' and "buy_request_id" = "aggregate_id" and "sell_submission_id" is null) or ("aggregate_type" = 'sell_submission' and "sell_submission_id" = "aggregate_id" and "buy_request_id" is null)),
	CONSTRAINT "marketplace_notes_body_chk" CHECK (nullif(btrim("body"), '') is not null)
);
--> statement-breakpoint
CREATE TABLE "marketplace_pending_uploads" (
	"id" varchar(26) PRIMARY KEY,
	"upload_session_id" varchar(26) NOT NULL,
	"object_key" varchar(700) NOT NULL,
	"display_filename" varchar(255) NOT NULL,
	"declared_mime" varchar(255) NOT NULL,
	"expected_byte_size" numeric(20,0) NOT NULL,
	"purpose" "marketplace_upload_purpose" NOT NULL,
	"state" "marketplace_upload_state" DEFAULT 'AUTHORIZED'::"marketplace_upload_state" NOT NULL,
	"claimed_buy_request_id" varchar(26),
	"claimed_sell_submission_id" varchar(26),
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketplace_pending_uploads_bytes_chk" CHECK ("expected_byte_size" between 1 and 52428800),
	CONSTRAINT "marketplace_pending_uploads_object_key_chk" CHECK ("object_key" like 'marketplace/%'),
	CONSTRAINT "marketplace_pending_uploads_single_claim_chk" CHECK ("claimed_buy_request_id" is null or "claimed_sell_submission_id" is null),
	CONSTRAINT "marketplace_pending_uploads_bound_claim_chk" CHECK ("state" <> 'BOUND' or "claimed_buy_request_id" is not null or "claimed_sell_submission_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "marketplace_upload_sessions" (
	"id" varchar(26) PRIMARY KEY,
	"token_hash" varchar(128) NOT NULL,
	"intended_aggregate_type" "marketplace_aggregate_type" NOT NULL,
	"authorized_count" integer DEFAULT 0 NOT NULL,
	"expected_byte_size" numeric(20,0) DEFAULT '0' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketplace_upload_sessions_count_chk" CHECK ("authorized_count" between 0 and 12),
	CONSTRAINT "marketplace_upload_sessions_bytes_chk" CHECK ("expected_byte_size" between 0 and 209715200),
	CONSTRAINT "marketplace_upload_sessions_expiry_chk" CHECK ("expires_at" > "created_at")
);
--> statement-breakpoint
CREATE TABLE "sell_submission_items" (
	"id" varchar(26) PRIMARY KEY,
	"sell_submission_id" varchar(26) NOT NULL,
	"line_number" integer NOT NULL,
	"original_part_number" varchar(160),
	"normalized_part_number" varchar(120),
	"description" text,
	"quantity" numeric(12,3),
	"condition_code" "marketplace_condition_code",
	"asking_unit_price" numeric(18,2),
	"currency_code" varchar(3),
	"quote_on_request" boolean DEFAULT true NOT NULL,
	"location_text" varchar(240),
	"documents_summary" text,
	"source_attachment_id" varchar(26),
	"source_row_reference" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sell_submission_items_line_number_chk" CHECK ("line_number" > 0),
	CONSTRAINT "sell_submission_items_part_or_description_chk" CHECK (nullif(btrim("original_part_number"), '') is not null or nullif(btrim("description"), '') is not null),
	CONSTRAINT "sell_submission_items_part_number_chk" CHECK (("original_part_number" is null) = ("normalized_part_number" is null)),
	CONSTRAINT "sell_submission_items_quantity_chk" CHECK ("quantity" is null or "quantity" > 0),
	CONSTRAINT "sell_submission_items_price_nonnegative_chk" CHECK ("asking_unit_price" is null or "asking_unit_price" >= 0),
	CONSTRAINT "sell_submission_items_currency_chk" CHECK ("currency_code" is null or "currency_code" in ('AUD', 'CAD', 'CHF', 'EUR', 'GBP', 'JPY', 'USD')),
	CONSTRAINT "sell_submission_items_price_currency_chk" CHECK ("asking_unit_price" is null or "currency_code" is not null),
	CONSTRAINT "sell_submission_items_quote_on_request_chk" CHECK ("quote_on_request" or "asking_unit_price" is not null)
);
--> statement-breakpoint
CREATE TABLE "sell_submissions" (
	"id" varchar(26) PRIMARY KEY,
	"public_reference" varchar(16) NOT NULL,
	"contact_id" varchar(26) NOT NULL,
	"submission_kind" "sell_submission_kind" NOT NULL,
	"original_part_number" varchar(160),
	"normalized_part_number" varchar(120),
	"description" text,
	"quantity" numeric(12,3),
	"condition_code" "marketplace_condition_code",
	"asking_unit_price" numeric(18,2),
	"currency_code" varchar(3),
	"quote_on_request" boolean DEFAULT true NOT NULL,
	"estimated_line_item_count" integer,
	"location_country" varchar(2),
	"location_state_region" varchar(160),
	"location_city" varchar(160),
	"location_postal_code" varchar(24),
	"can_ship_to_new_jersey" boolean,
	"documents_summary" text,
	"status" "sell_submission_status" DEFAULT 'pending_verification'::"sell_submission_status" NOT NULL,
	"assigned_admin_user_id" varchar(26),
	"verification_requested_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
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
	"submitted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "sell_submissions_public_reference_chk" CHECK ("public_reference" ~ '^SS-[0-9A-HJKMNP-TV-Z]{10}$'),
	CONSTRAINT "sell_submissions_mode_chk" CHECK (("submission_kind" = 'single_part' and (nullif(btrim("original_part_number"), '') is not null or nullif(btrim("description"), '') is not null)) or ("submission_kind" = 'bulk_inventory' and "original_part_number" is null and "quantity" is null and "asking_unit_price" is null)),
	CONSTRAINT "sell_submissions_normalized_part_number_chk" CHECK (("original_part_number" is null) = ("normalized_part_number" is null)),
	CONSTRAINT "sell_submissions_quantity_chk" CHECK ("quantity" is null or "quantity" > 0),
	CONSTRAINT "sell_submissions_line_item_count_chk" CHECK ("estimated_line_item_count" is null or "estimated_line_item_count" >= 0),
	CONSTRAINT "sell_submissions_price_nonnegative_chk" CHECK ("asking_unit_price" is null or "asking_unit_price" >= 0),
	CONSTRAINT "sell_submissions_currency_chk" CHECK ("currency_code" is null or "currency_code" in ('AUD', 'CAD', 'CHF', 'EUR', 'GBP', 'JPY', 'USD')),
	CONSTRAINT "sell_submissions_price_currency_chk" CHECK ("asking_unit_price" is null or "currency_code" is not null),
	CONSTRAINT "sell_submissions_quote_on_request_chk" CHECK ("quote_on_request" or "asking_unit_price" is not null),
	CONSTRAINT "sell_submissions_location_country_chk" CHECK ("location_country" is null or "location_country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "sell_submissions_pending_verification_chk" CHECK (("status" = 'pending_verification') or ("verified_at" is not null or "status" in ('spam', 'withdrawn', 'closed'))),
	CONSTRAINT "sell_submissions_verified_status_chk" CHECK ("status" <> 'pending_verification' or "verified_at" is null),
	CONSTRAINT "sell_submissions_verified_order_chk" CHECK ("verified_at" is null or "verified_at" >= "submitted_at"),
	CONSTRAINT "sell_submissions_closed_state_chk" CHECK ("closed_at" is null or "status" in ('accepted', 'declined', 'closed', 'spam', 'withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "supplier_responses" (
	"id" varchar(26) PRIMARY KEY,
	"buy_request_id" varchar(26) NOT NULL,
	"supplier_kind" "supplier_source_kind" NOT NULL,
	"supplier_contact_id" varchar(26),
	"supplier_name_snapshot" varchar(200),
	"supplier_contact_snapshot" varchar(320),
	"supplier_country" varchar(2),
	"offered_part_number" varchar(160),
	"normalized_part_number" varchar(120),
	"stated_condition" "marketplace_condition_code",
	"quantity_available" numeric(12,3),
	"supplier_unit_cost" numeric(18,2),
	"currency_code" varchar(3),
	"quote_on_request" boolean DEFAULT true NOT NULL,
	"availability_state" "supplier_availability_state" DEFAULT 'subject_to_confirmation'::"supplier_availability_state" NOT NULL,
	"location_text" varchar(240),
	"lead_time_days" integer,
	"documents_summary" text,
	"shipping_notes" text,
	"status" "supplier_response_status" DEFAULT 'received'::"supplier_response_status" NOT NULL,
	"recorded_by_admin_user_id" varchar(26),
	"received_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_responses_supplier_kind_chk" CHECK (("supplier_kind" = 'registered_contact' and "supplier_contact_id" is not null) or ("supplier_kind" = 'nonregistered_supplier' and "supplier_contact_id" is null and nullif(btrim("supplier_name_snapshot"), '') is not null)),
	CONSTRAINT "supplier_responses_country_chk" CHECK ("supplier_country" is null or "supplier_country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "supplier_responses_quantity_chk" CHECK ("quantity_available" is null or "quantity_available" >= 0),
	CONSTRAINT "supplier_responses_cost_nonnegative_chk" CHECK ("supplier_unit_cost" is null or "supplier_unit_cost" >= 0),
	CONSTRAINT "supplier_responses_currency_chk" CHECK ("currency_code" is null or "currency_code" in ('AUD', 'CAD', 'CHF', 'EUR', 'GBP', 'JPY', 'USD')),
	CONSTRAINT "supplier_responses_cost_currency_chk" CHECK ("supplier_unit_cost" is null or "currency_code" is not null),
	CONSTRAINT "supplier_responses_quote_on_request_chk" CHECK ("quote_on_request" or "supplier_unit_cost" is not null),
	CONSTRAINT "supplier_responses_lead_time_chk" CHECK ("lead_time_days" is null or "lead_time_days" >= 0),
	CONSTRAINT "supplier_responses_expiry_chk" CHECK ("expires_at" is null or "expires_at" > "received_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "buy_requests_public_reference_uidx" ON "buy_requests" ("public_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "buy_requests_idempotency_hash_uidx" ON "buy_requests" ("idempotency_hash");--> statement-breakpoint
CREATE INDEX "buy_requests_status_idx" ON "buy_requests" ("status");--> statement-breakpoint
CREATE INDEX "buy_requests_contact_idx" ON "buy_requests" ("contact_id");--> statement-breakpoint
CREATE INDEX "buy_requests_assignee_idx" ON "buy_requests" ("assigned_admin_user_id");--> statement-breakpoint
CREATE INDEX "buy_requests_submitted_at_idx" ON "buy_requests" ("submitted_at");--> statement-breakpoint
CREATE INDEX "buy_requests_normalized_part_number_idx" ON "buy_requests" ("normalized_part_number");--> statement-breakpoint
CREATE UNIQUE INDEX "buyer_offers_version_uidx" ON "buyer_offers" ("buy_request_id","version");--> statement-breakpoint
CREATE INDEX "buyer_offers_status_idx" ON "buyer_offers" ("status");--> statement-breakpoint
CREATE INDEX "buyer_offers_buy_request_idx" ON "buyer_offers" ("buy_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_verification_tokens_hash_uidx" ON "email_verification_tokens" ("keyed_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "email_verification_tokens_active_uidx" ON "email_verification_tokens" ("aggregate_type","aggregate_id") WHERE "consumed_at" is null and "revoked_at" is null;--> statement-breakpoint
CREATE INDEX "email_verification_tokens_aggregate_idx" ON "email_verification_tokens" ("aggregate_type","aggregate_id");--> statement-breakpoint
CREATE INDEX "email_verification_tokens_expiry_idx" ON "email_verification_tokens" ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_attachments_object_key_uidx" ON "marketplace_attachments" ("object_key");--> statement-breakpoint
CREATE INDEX "marketplace_attachments_aggregate_idx" ON "marketplace_attachments" ("aggregate_type","aggregate_id");--> statement-breakpoint
CREATE INDEX "marketplace_attachments_live_idx" ON "marketplace_attachments" ("aggregate_type","aggregate_id") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "marketplace_contacts_normalized_email_idx" ON "marketplace_contacts" ("normalized_email");--> statement-breakpoint
CREATE INDEX "marketplace_contacts_normalized_phone_idx" ON "marketplace_contacts" ("normalized_phone");--> statement-breakpoint
CREATE INDEX "marketplace_contacts_verification_state_idx" ON "marketplace_contacts" ("verification_state");--> statement-breakpoint
CREATE INDEX "marketplace_notes_aggregate_idx" ON "marketplace_notes" ("aggregate_type","aggregate_id");--> statement-breakpoint
CREATE INDEX "marketplace_notes_admin_user_idx" ON "marketplace_notes" ("admin_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_pending_uploads_object_key_uidx" ON "marketplace_pending_uploads" ("object_key");--> statement-breakpoint
CREATE INDEX "marketplace_pending_uploads_session_idx" ON "marketplace_pending_uploads" ("upload_session_id");--> statement-breakpoint
CREATE INDEX "marketplace_pending_uploads_expiry_idx" ON "marketplace_pending_uploads" ("expires_at");--> statement-breakpoint
CREATE INDEX "marketplace_pending_uploads_buy_claim_idx" ON "marketplace_pending_uploads" ("claimed_buy_request_id");--> statement-breakpoint
CREATE INDEX "marketplace_pending_uploads_sell_claim_idx" ON "marketplace_pending_uploads" ("claimed_sell_submission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_upload_sessions_token_hash_uidx" ON "marketplace_upload_sessions" ("token_hash");--> statement-breakpoint
CREATE INDEX "marketplace_upload_sessions_expiry_idx" ON "marketplace_upload_sessions" ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sell_submission_items_line_uidx" ON "sell_submission_items" ("sell_submission_id","line_number");--> statement-breakpoint
CREATE INDEX "sell_submission_items_part_number_idx" ON "sell_submission_items" ("normalized_part_number");--> statement-breakpoint
CREATE UNIQUE INDEX "sell_submissions_public_reference_uidx" ON "sell_submissions" ("public_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "sell_submissions_idempotency_hash_uidx" ON "sell_submissions" ("idempotency_hash");--> statement-breakpoint
CREATE INDEX "sell_submissions_status_idx" ON "sell_submissions" ("status");--> statement-breakpoint
CREATE INDEX "sell_submissions_contact_idx" ON "sell_submissions" ("contact_id");--> statement-breakpoint
CREATE INDEX "sell_submissions_assignee_idx" ON "sell_submissions" ("assigned_admin_user_id");--> statement-breakpoint
CREATE INDEX "sell_submissions_submitted_at_idx" ON "sell_submissions" ("submitted_at");--> statement-breakpoint
CREATE INDEX "sell_submissions_normalized_part_number_idx" ON "sell_submissions" ("normalized_part_number");--> statement-breakpoint
CREATE INDEX "supplier_responses_buy_request_idx" ON "supplier_responses" ("buy_request_id");--> statement-breakpoint
CREATE INDEX "supplier_responses_status_idx" ON "supplier_responses" ("status");--> statement-breakpoint
CREATE INDEX "supplier_responses_contact_idx" ON "supplier_responses" ("supplier_contact_id");--> statement-breakpoint
ALTER TABLE "buy_requests" ADD CONSTRAINT "buy_requests_contact_id_marketplace_contacts_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "marketplace_contacts"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "buy_requests" ADD CONSTRAINT "buy_requests_assigned_admin_user_id_admin_users_id_fkey" FOREIGN KEY ("assigned_admin_user_id") REFERENCES "admin_users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "buy_requests" ADD CONSTRAINT "buy_requests_source_price_check_id_price_checks_id_fkey" FOREIGN KEY ("source_price_check_id") REFERENCES "price_checks"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "buy_requests" ADD CONSTRAINT "buy_requests_source_result_id_price_check_results_id_fkey" FOREIGN KEY ("source_result_id") REFERENCES "price_check_results"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "buyer_offers" ADD CONSTRAINT "buyer_offers_buy_request_id_buy_requests_id_fkey" FOREIGN KEY ("buy_request_id") REFERENCES "buy_requests"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "buyer_offers" ADD CONSTRAINT "buyer_offers_HHkdMmvy9Q6y_fkey" FOREIGN KEY ("selected_supplier_response_id") REFERENCES "supplier_responses"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "buyer_offers" ADD CONSTRAINT "buyer_offers_created_by_admin_user_id_admin_users_id_fkey" FOREIGN KEY ("created_by_admin_user_id") REFERENCES "admin_users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_buy_request_id_buy_requests_id_fkey" FOREIGN KEY ("buy_request_id") REFERENCES "buy_requests"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_MMprdzOhg93k_fkey" FOREIGN KEY ("sell_submission_id") REFERENCES "sell_submissions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_McrooYsNmQda_fkey" FOREIGN KEY ("contact_id") REFERENCES "marketplace_contacts"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "marketplace_attachments" ADD CONSTRAINT "marketplace_attachments_buy_request_id_buy_requests_id_fkey" FOREIGN KEY ("buy_request_id") REFERENCES "buy_requests"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "marketplace_attachments" ADD CONSTRAINT "marketplace_attachments_Y0iUQnSbUqwR_fkey" FOREIGN KEY ("sell_submission_id") REFERENCES "sell_submissions"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "marketplace_attachments" ADD CONSTRAINT "marketplace_attachments_7JltiFXgH7jz_fkey" FOREIGN KEY ("source_pending_upload_id") REFERENCES "marketplace_pending_uploads"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "marketplace_notes" ADD CONSTRAINT "marketplace_notes_buy_request_id_buy_requests_id_fkey" FOREIGN KEY ("buy_request_id") REFERENCES "buy_requests"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "marketplace_notes" ADD CONSTRAINT "marketplace_notes_sell_submission_id_sell_submissions_id_fkey" FOREIGN KEY ("sell_submission_id") REFERENCES "sell_submissions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "marketplace_notes" ADD CONSTRAINT "marketplace_notes_admin_user_id_admin_users_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "marketplace_pending_uploads" ADD CONSTRAINT "marketplace_pending_uploads_LljBtimNtEoz_fkey" FOREIGN KEY ("upload_session_id") REFERENCES "marketplace_upload_sessions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "marketplace_pending_uploads" ADD CONSTRAINT "marketplace_pending_uploads_80jDm7nCyNst_fkey" FOREIGN KEY ("claimed_buy_request_id") REFERENCES "buy_requests"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "marketplace_pending_uploads" ADD CONSTRAINT "marketplace_pending_uploads_PiSmIhvotWJt_fkey" FOREIGN KEY ("claimed_sell_submission_id") REFERENCES "sell_submissions"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "sell_submission_items" ADD CONSTRAINT "sell_submission_items_b6od5GFaz42B_fkey" FOREIGN KEY ("sell_submission_id") REFERENCES "sell_submissions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sell_submission_items" ADD CONSTRAINT "sell_submission_items_ZptDFMrJ1HFj_fkey" FOREIGN KEY ("source_attachment_id") REFERENCES "marketplace_attachments"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "sell_submissions" ADD CONSTRAINT "sell_submissions_contact_id_marketplace_contacts_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "marketplace_contacts"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "sell_submissions" ADD CONSTRAINT "sell_submissions_assigned_admin_user_id_admin_users_id_fkey" FOREIGN KEY ("assigned_admin_user_id") REFERENCES "admin_users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "supplier_responses" ADD CONSTRAINT "supplier_responses_buy_request_id_buy_requests_id_fkey" FOREIGN KEY ("buy_request_id") REFERENCES "buy_requests"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "supplier_responses" ADD CONSTRAINT "supplier_responses_THhRiK4GGyXZ_fkey" FOREIGN KEY ("supplier_contact_id") REFERENCES "marketplace_contacts"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "supplier_responses" ADD CONSTRAINT "supplier_responses_q9q8w6QKDNTt_fkey" FOREIGN KEY ("recorded_by_admin_user_id") REFERENCES "admin_users"("id") ON DELETE SET NULL;