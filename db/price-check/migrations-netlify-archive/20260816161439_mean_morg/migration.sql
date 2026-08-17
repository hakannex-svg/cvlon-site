CREATE TYPE "price_check_upload_state" AS ENUM('AUTHORIZED', 'UPLOADED', 'BOUND', 'REJECTED', 'EXPIRED');--> statement-breakpoint
CREATE TABLE "price_check_pending_uploads" (
	"id" varchar(26) PRIMARY KEY,
	"upload_session_id" varchar(26) NOT NULL,
	"object_key" varchar(700) NOT NULL,
	"display_filename" varchar(255) NOT NULL,
	"declared_mime" varchar(255) NOT NULL,
	"expected_byte_size" numeric(20,0) NOT NULL,
	"state" "price_check_upload_state" DEFAULT 'AUTHORIZED'::"price_check_upload_state" NOT NULL,
	"claimed_price_check_id" varchar(26),
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_check_pending_uploads_bytes_chk" CHECK ("expected_byte_size" between 1 and 10485760)
);
--> statement-breakpoint
CREATE TABLE "price_check_upload_sessions" (
	"id" varchar(26) PRIMARY KEY,
	"token_hash" varchar(128) NOT NULL,
	"authorized_count" integer DEFAULT 0 NOT NULL,
	"expected_byte_size" numeric(20,0) DEFAULT '0' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_check_upload_sessions_count_chk" CHECK ("authorized_count" between 0 and 3),
	CONSTRAINT "price_check_upload_sessions_bytes_chk" CHECK ("expected_byte_size" between 0 and 31457280),
	CONSTRAINT "price_check_upload_sessions_expiry_chk" CHECK ("expires_at" > "created_at")
);
--> statement-breakpoint
ALTER TABLE "attachments" ALTER COLUMN "content_digest" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "price_check_pending_uploads_object_key_uidx" ON "price_check_pending_uploads" ("object_key");--> statement-breakpoint
CREATE INDEX "price_check_pending_uploads_session_idx" ON "price_check_pending_uploads" ("upload_session_id");--> statement-breakpoint
CREATE INDEX "price_check_pending_uploads_expiry_idx" ON "price_check_pending_uploads" ("expires_at");--> statement-breakpoint
CREATE INDEX "price_check_pending_uploads_claim_idx" ON "price_check_pending_uploads" ("claimed_price_check_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_check_upload_sessions_token_hash_uidx" ON "price_check_upload_sessions" ("token_hash");--> statement-breakpoint
CREATE INDEX "price_check_upload_sessions_expiry_idx" ON "price_check_upload_sessions" ("expires_at");--> statement-breakpoint
ALTER TABLE "price_check_pending_uploads" ADD CONSTRAINT "price_check_pending_uploads_91RF61iENwNH_fkey" FOREIGN KEY ("upload_session_id") REFERENCES "price_check_upload_sessions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "price_check_pending_uploads" ADD CONSTRAINT "price_check_pending_uploads_pAkeimE5kkyA_fkey" FOREIGN KEY ("claimed_price_check_id") REFERENCES "price_checks"("id") ON DELETE RESTRICT;