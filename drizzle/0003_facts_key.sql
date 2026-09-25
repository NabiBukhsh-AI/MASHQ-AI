ALTER TABLE "facts" ADD COLUMN "key" text;--> statement-breakpoint
CREATE INDEX "facts_content_key_idx" ON "facts" USING btree ("content_id","key");