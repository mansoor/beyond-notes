CREATE TABLE "ai_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"page_id" text NOT NULL,
	"space_id" text NOT NULL,
	"seq" integer NOT NULL,
	"text" text NOT NULL,
	"model" text NOT NULL,
	"vector" "bytea" NOT NULL,
	"source_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_chunks" ADD CONSTRAINT "ai_chunks_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_chunks_page_idx" ON "ai_chunks" USING btree ("page_id");