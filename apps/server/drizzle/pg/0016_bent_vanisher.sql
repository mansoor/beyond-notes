CREATE TABLE "page_links" (
	"from_page_id" text NOT NULL,
	"to_page_id" text NOT NULL,
	CONSTRAINT "page_links_from_page_id_to_page_id_pk" PRIMARY KEY("from_page_id","to_page_id")
);
--> statement-breakpoint
CREATE TABLE "page_slugs" (
	"page_id" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "page_slugs_page_id_slug_pk" PRIMARY KEY("page_id","slug")
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"content" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "trashed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "trashed_by" text;--> statement-breakpoint
ALTER TABLE "page_links" ADD CONSTRAINT "page_links_from_page_id_pages_id_fk" FOREIGN KEY ("from_page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_links" ADD CONSTRAINT "page_links_to_page_id_pages_id_fk" FOREIGN KEY ("to_page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_slugs" ADD CONSTRAINT "page_slugs_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;