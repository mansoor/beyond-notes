CREATE TABLE "previews" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"page_id" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "previews_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "page_versions" ADD COLUMN "meta_description" text;--> statement-breakpoint
ALTER TABLE "page_versions" ADD COLUMN "tags" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "meta_description" text;--> statement-breakpoint
ALTER TABLE "previews" ADD CONSTRAINT "previews_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "previews" ADD CONSTRAINT "previews_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;