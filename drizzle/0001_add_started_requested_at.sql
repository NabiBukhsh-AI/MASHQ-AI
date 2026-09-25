DROP INDEX "learning_sessions_org_user_started_idx";--> statement-breakpoint
ALTER TABLE "learning_sessions" ADD COLUMN "started_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "data_deletions" ADD COLUMN "requested_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "learning_sessions_org_user_started_idx" ON "learning_sessions" USING btree ("org_id","user_id","started_at" DESC NULLS LAST);