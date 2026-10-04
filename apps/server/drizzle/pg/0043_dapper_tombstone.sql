CREATE TABLE "newsletter_issues" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"page_id" text,
	"subject" text NOT NULL,
	"status" text NOT NULL,
	"send_after" timestamp with time zone NOT NULL,
	"cursor" text,
	"recipients" integer DEFAULT 0 NOT NULL,
	"sent" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_by" text,
	"created_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "newsletter_subscribers" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"email" text NOT NULL,
	"status" text NOT NULL,
	"token" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "newsletter_issues" ADD CONSTRAINT "newsletter_issues_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_issues" ADD CONSTRAINT "newsletter_issues_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_issues" ADD CONSTRAINT "newsletter_issues_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_subscribers" ADD CONSTRAINT "newsletter_subscribers_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "newsletter_issues_space_idx" ON "newsletter_issues" USING btree ("space_id");--> statement-breakpoint
CREATE UNIQUE INDEX "newsletter_subscribers_space_email" ON "newsletter_subscribers" USING btree ("space_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "newsletter_subscribers_token" ON "newsletter_subscribers" USING btree ("token");