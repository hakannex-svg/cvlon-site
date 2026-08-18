CREATE TYPE "sell_inventory_freshness_response" AS ENUM('all_available', 'some_changed', 'none_available');--> statement-breakpoint
CREATE TABLE "sell_inventory_freshness_checks" (
	"id" varchar(26) PRIMARY KEY,
	"sell_submission_id" varchar(26) NOT NULL,
	"contact_id" varchar(26) NOT NULL,
	"keyed_token_hash" varchar(128) NOT NULL,
	"token_derivation_nonce" varchar(64) NOT NULL,
	"requested_by_admin_user_id" varchar(26),
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"response" "sell_inventory_freshness_response",
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempt_count" integer DEFAULT 10 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sell_inventory_freshness_checks_expiry_chk" CHECK ("expires_at" > "issued_at"),
	CONSTRAINT "sell_inventory_freshness_checks_lifecycle_chk" CHECK ("responded_at" is null or "revoked_at" is null),
	CONSTRAINT "sell_inventory_freshness_checks_responded_order_chk" CHECK ("responded_at" is null or "responded_at" >= "issued_at"),
	CONSTRAINT "sell_inventory_freshness_checks_response_chk" CHECK (("responded_at" is null and "response" is null) or ("responded_at" is not null and "response" is not null)),
	CONSTRAINT "sell_inventory_freshness_checks_attempt_chk" CHECK ("attempt_count" >= 0 and "max_attempt_count" > 0 and "attempt_count" <= "max_attempt_count")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sell_inventory_freshness_checks_hash_uidx" ON "sell_inventory_freshness_checks" ("keyed_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "sell_inventory_freshness_checks_active_uidx" ON "sell_inventory_freshness_checks" ("sell_submission_id") WHERE "responded_at" is null and "revoked_at" is null;--> statement-breakpoint
CREATE INDEX "sell_inventory_freshness_checks_submission_idx" ON "sell_inventory_freshness_checks" ("sell_submission_id");--> statement-breakpoint
CREATE INDEX "sell_inventory_freshness_checks_expiry_idx" ON "sell_inventory_freshness_checks" ("expires_at");--> statement-breakpoint
ALTER TABLE "sell_inventory_freshness_checks" ADD CONSTRAINT "sell_inventory_freshness_checks_yhkbPAyKqlV4_fkey" FOREIGN KEY ("sell_submission_id") REFERENCES "sell_submissions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sell_inventory_freshness_checks" ADD CONSTRAINT "sell_inventory_freshness_checks_9rwurUo46ISM_fkey" FOREIGN KEY ("contact_id") REFERENCES "marketplace_contacts"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "sell_inventory_freshness_checks" ADD CONSTRAINT "sell_inventory_freshness_checks_wN71L8I2161H_fkey" FOREIGN KEY ("requested_by_admin_user_id") REFERENCES "admin_users"("id") ON DELETE SET NULL;