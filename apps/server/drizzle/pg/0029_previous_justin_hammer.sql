ALTER TABLE "spaces" ADD COLUMN "public_title_size" text DEFAULT 'md' NOT NULL;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "public_logo_size" text DEFAULT 'md' NOT NULL;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "public_favicon_attachment_id" text;