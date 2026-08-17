ALTER TYPE "processing_job_type" ADD VALUE 'EXPLANATION_DRAFT' BEFORE 'ANALYSIS';--> statement-breakpoint
ALTER TABLE "ai_artifacts" ADD COLUMN "related_price_check_id" varchar(26);--> statement-breakpoint
ALTER TABLE "price_check_results" ADD COLUMN "source_ai_artifact_id" varchar(26);--> statement-breakpoint
CREATE INDEX "ai_artifacts_price_check_idx" ON "ai_artifacts" ("related_price_check_id");--> statement-breakpoint
CREATE INDEX "ai_artifacts_analysis_idx" ON "ai_artifacts" ("related_analysis_id");--> statement-breakpoint
ALTER TABLE "ai_artifacts" ADD CONSTRAINT "ai_artifacts_related_price_check_id_price_checks_id_fkey" FOREIGN KEY ("related_price_check_id") REFERENCES "price_checks"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "price_check_results" ADD CONSTRAINT "price_check_results_source_ai_artifact_id_ai_artifacts_id_fkey" FOREIGN KEY ("source_ai_artifact_id") REFERENCES "ai_artifacts"("id") ON DELETE SET NULL;