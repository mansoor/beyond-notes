CREATE TABLE "attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"hash" text NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"width" integer,
	"height" integer,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gallery_items" (
	"id" text PRIMARY KEY NOT NULL,
	"page_id" text NOT NULL,
	"attachment_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"caption" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "page_versions" ADD COLUMN "attachment_ids" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "gallery_items" ADD CONSTRAINT "gallery_items_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_items" ADD CONSTRAINT "gallery_items_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;