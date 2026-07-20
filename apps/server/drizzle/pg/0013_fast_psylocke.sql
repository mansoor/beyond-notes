ALTER TABLE "page_versions" ADD COLUMN "cover_attachment_id" text;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "gallery_layout" text DEFAULT 'grid' NOT NULL;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "share_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "cover_attachment_id" text;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "public_social" text DEFAULT '[]' NOT NULL;