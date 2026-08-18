CREATE TYPE "internal_review_state" AS ENUM('not_reviewed', 'reviewed', 'concern');--> statement-breakpoint
ALTER TABLE "marketplace_contacts" ADD COLUMN "business_review_state" "internal_review_state" DEFAULT 'not_reviewed'::"internal_review_state" NOT NULL;--> statement-breakpoint
ALTER TABLE "marketplace_contacts" ADD COLUMN "business_reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "marketplace_contacts" ADD COLUMN "business_reviewed_by_admin_user_id" varchar(26);--> statement-breakpoint
ALTER TABLE "marketplace_attachments" ADD COLUMN "review_state" "internal_review_state" DEFAULT 'not_reviewed'::"internal_review_state" NOT NULL;--> statement-breakpoint
ALTER TABLE "marketplace_attachments" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "marketplace_attachments" ADD COLUMN "reviewed_by_admin_user_id" varchar(26);--> statement-breakpoint
ALTER TABLE "marketplace_contacts" ADD CONSTRAINT "marketplace_contacts_business_reviewer_fkey" FOREIGN KEY ("business_reviewed_by_admin_user_id") REFERENCES "admin_users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "marketplace_attachments" ADD CONSTRAINT "marketplace_attachments_reviewer_fkey" FOREIGN KEY ("reviewed_by_admin_user_id") REFERENCES "admin_users"("id") ON DELETE SET NULL;
