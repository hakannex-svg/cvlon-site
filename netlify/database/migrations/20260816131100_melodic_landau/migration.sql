CREATE TYPE "price_check_result_state" AS ENUM('DRAFT', 'APPROVED', 'SENT', 'SUPERSEDED');--> statement-breakpoint
ALTER TABLE "price_check_results" ADD COLUMN "state" "price_check_result_state" DEFAULT 'DRAFT'::"price_check_result_state" NOT NULL;--> statement-breakpoint
ALTER TABLE "price_check_results" ADD COLUMN "limited_evidence_statement" text;--> statement-breakpoint
ALTER TABLE "price_check_results" ADD COLUMN "drafted_by" varchar(26);--> statement-breakpoint
ALTER TABLE "result_access_tokens" ADD COLUMN "token_derivation_nonce" varchar(64);--> statement-breakpoint
ALTER TABLE "result_access_tokens" ADD COLUMN "first_viewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "price_check_results" ALTER COLUMN "approved_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "price_check_results" ALTER COLUMN "approved_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "price_check_results" ADD CONSTRAINT "price_check_results_drafted_by_admin_users_id_fkey" FOREIGN KEY ("drafted_by") REFERENCES "admin_users"("id") ON DELETE RESTRICT;