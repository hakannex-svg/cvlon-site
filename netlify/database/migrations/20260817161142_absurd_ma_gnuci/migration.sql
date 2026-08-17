CREATE TYPE "admin_staff_invitation_status" AS ENUM('PENDING', 'ACCEPTED', 'REVOKED');--> statement-breakpoint
CREATE TABLE "admin_staff_invitations" (
	"id" varchar(26) PRIMARY KEY,
	"normalized_email" varchar(320) NOT NULL,
	"display_email" varchar(320) NOT NULL,
	"role" "admin_role" NOT NULL,
	"status" "admin_staff_invitation_status" DEFAULT 'PENDING'::"admin_staff_invitation_status" NOT NULL,
	"invited_by_admin_user_id" varchar(26),
	"accepted_admin_user_id" varchar(26),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "admin_staff_invitations_state_chk" CHECK (("status" = 'PENDING' and "accepted_at" is null and "revoked_at" is null) or ("status" = 'ACCEPTED' and "accepted_at" is not null and "revoked_at" is null) or ("status" = 'REVOKED' and "revoked_at" is not null and "accepted_at" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "admin_staff_invitations_pending_email_uidx" ON "admin_staff_invitations" ("normalized_email") WHERE "status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "admin_staff_invitations_status_idx" ON "admin_staff_invitations" ("status","created_at");--> statement-breakpoint
CREATE INDEX "admin_staff_invitations_accepted_user_idx" ON "admin_staff_invitations" ("accepted_admin_user_id");--> statement-breakpoint
ALTER TABLE "admin_staff_invitations" ADD CONSTRAINT "admin_staff_invitations_nEaENghOyEso_fkey" FOREIGN KEY ("invited_by_admin_user_id") REFERENCES "admin_users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "admin_staff_invitations" ADD CONSTRAINT "admin_staff_invitations_6Us8pBF8MWKw_fkey" FOREIGN KEY ("accepted_admin_user_id") REFERENCES "admin_users"("id") ON DELETE SET NULL;
