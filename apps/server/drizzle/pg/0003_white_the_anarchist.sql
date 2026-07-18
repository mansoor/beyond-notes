CREATE TABLE "page_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"page_id" text NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"content" text NOT NULL,
	"html" text NOT NULL,
	"text_plain" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "live_version_id" text;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "public_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "public_host" text;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "public_title" text;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "public_footer" text;--> statement-breakpoint
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_public_host_unique" UNIQUE("public_host");