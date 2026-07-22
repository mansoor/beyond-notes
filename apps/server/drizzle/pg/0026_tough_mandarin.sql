ALTER TABLE "spaces" ADD COLUMN "analytics_provider" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "analytics_site_id" text;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "analytics_host" text;