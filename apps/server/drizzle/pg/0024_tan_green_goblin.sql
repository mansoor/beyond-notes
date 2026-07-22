ALTER TABLE "pages" ADD COLUMN "lock_policy" text;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "lock_policy" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "sidebar_hidden" text DEFAULT '[]' NOT NULL;