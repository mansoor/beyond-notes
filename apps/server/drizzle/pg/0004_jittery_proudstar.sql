ALTER TABLE "pages" ADD COLUMN "page_type" text DEFAULT 'doc' NOT NULL;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "public_theme" text DEFAULT 'paper' NOT NULL;