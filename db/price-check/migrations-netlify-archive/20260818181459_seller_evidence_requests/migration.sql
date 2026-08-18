CREATE TABLE "marketplace_evidence_requests" (
	"id" varchar(26) PRIMARY KEY,
	"sell_submission_id" varchar(26) NOT NULL,
	"contact_id" varchar(26) NOT NULL,
	"requested_categories" varchar(40)[] NOT NULL,
	"keyed_token_hash" varchar(128) NOT NULL,
	"token_derivation_nonce" varchar(64) NOT NULL,
	"requested_by_admin_user_id" varchar(26),
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempt_count" integer DEFAULT 10 NOT NULL,
	"submitted_attachment_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketplace_evidence_requests_expiry_chk" CHECK ("expires_at" > "issued_at"),
	CONSTRAINT "marketplace_evidence_requests_lifecycle_chk" CHECK ("consumed_at" is null or "revoked_at" is null),
	CONSTRAINT "marketplace_evidence_requests_consumed_order_chk" CHECK ("consumed_at" is null or "consumed_at" >= "issued_at"),
	CONSTRAINT "marketplace_evidence_requests_attempt_chk" CHECK ("attempt_count" >= 0 and "max_attempt_count" > 0 and "attempt_count" <= "max_attempt_count"),
	CONSTRAINT "marketplace_evidence_requests_categories_chk" CHECK (array_length("requested_categories", 1) between 1 and 5 and "requested_categories" <@ array['INVENTORY_SPREADSHEET', 'WAREHOUSE_BUSINESS_EVIDENCE', 'CUSTODY_PART_PHOTO', 'PART_NUMBER_SERIAL_PHOTO', 'RELEASE_SUPPORTING_DOCUMENT']::varchar(40)[]),
	CONSTRAINT "marketplace_evidence_requests_submitted_chk" CHECK (("consumed_at" is null and "submitted_attachment_count" = 0) or ("consumed_at" is not null and "submitted_attachment_count" >= 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_evidence_requests_hash_uidx" ON "marketplace_evidence_requests" ("keyed_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_evidence_requests_active_uidx" ON "marketplace_evidence_requests" ("sell_submission_id") WHERE "consumed_at" is null and "revoked_at" is null;--> statement-breakpoint
CREATE INDEX "marketplace_evidence_requests_submission_idx" ON "marketplace_evidence_requests" ("sell_submission_id");--> statement-breakpoint
CREATE INDEX "marketplace_evidence_requests_expiry_idx" ON "marketplace_evidence_requests" ("expires_at");--> statement-breakpoint
ALTER TABLE "marketplace_evidence_requests" ADD CONSTRAINT "marketplace_evidence_requests_XcSkqv8vYtvt_fkey" FOREIGN KEY ("sell_submission_id") REFERENCES "sell_submissions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "marketplace_evidence_requests" ADD CONSTRAINT "marketplace_evidence_requests_nHQv7fjLEvZf_fkey" FOREIGN KEY ("contact_id") REFERENCES "marketplace_contacts"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "marketplace_evidence_requests" ADD CONSTRAINT "marketplace_evidence_requests_G0Ou1yGdOCCi_fkey" FOREIGN KEY ("requested_by_admin_user_id") REFERENCES "admin_users"("id") ON DELETE SET NULL;