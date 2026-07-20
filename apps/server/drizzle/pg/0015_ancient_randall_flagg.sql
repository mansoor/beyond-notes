CREATE TABLE "pins" (
	"user_id" text NOT NULL,
	"page_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pins_user_id_page_id_pk" PRIMARY KEY("user_id","page_id")
);
--> statement-breakpoint
ALTER TABLE "page_tags" ADD COLUMN "source" text DEFAULT 'inline' NOT NULL;--> statement-breakpoint
ALTER TABLE "pins" ADD CONSTRAINT "pins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pins" ADD CONSTRAINT "pins_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;