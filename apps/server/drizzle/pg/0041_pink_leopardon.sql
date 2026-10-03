CREATE TABLE "site_referrers_daily" (
	"space_id" text NOT NULL,
	"day" text NOT NULL,
	"host" text NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "site_referrers_daily_space_id_day_host_pk" PRIMARY KEY("space_id","day","host")
);
--> statement-breakpoint
CREATE TABLE "site_visits_daily" (
	"space_id" text NOT NULL,
	"day" text NOT NULL,
	"path" text NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"visitors" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "site_visits_daily_space_id_day_path_pk" PRIMARY KEY("space_id","day","path")
);
--> statement-breakpoint
ALTER TABLE "site_referrers_daily" ADD CONSTRAINT "site_referrers_daily_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_visits_daily" ADD CONSTRAINT "site_visits_daily_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;