ALTER TABLE "requesters" ALTER COLUMN "phone" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "requesters" ALTER COLUMN "normalized_phone" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "requesters" ALTER COLUMN "country" DROP NOT NULL;