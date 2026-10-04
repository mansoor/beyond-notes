CREATE TABLE "document_live_states" (
	"page_id" text PRIMARY KEY NOT NULL,
	"state" "bytea" NOT NULL,
	"content_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_live_states" ADD CONSTRAINT "document_live_states_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;