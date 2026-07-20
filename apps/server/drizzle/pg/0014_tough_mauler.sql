ALTER TABLE "pages" ADD COLUMN "gallery_autoplay_secs" integer;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "public_logo_attachment_id" text;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "public_tagline" text;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "public_header_layout" text DEFAULT 'classic' NOT NULL;