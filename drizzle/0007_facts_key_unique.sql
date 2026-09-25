DROP INDEX "facts_content_key_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "facts_content_key_uq" ON "facts" USING btree ("content_id","key");