CREATE TABLE "page_tags" (
	"page_id" text NOT NULL,
	"tag" text NOT NULL,
	CONSTRAINT "page_tags_page_id_tag_pk" PRIMARY KEY("page_id","tag")
);
--> statement-breakpoint
ALTER TABLE "page_tags" ADD CONSTRAINT "page_tags_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;