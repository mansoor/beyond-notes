CREATE TABLE "db_databases" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "db_rows" (
	"id" text PRIMARY KEY NOT NULL,
	"table_id" text NOT NULL,
	"cells" text DEFAULT '{}' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "db_tables" (
	"id" text PRIMARY KEY NOT NULL,
	"database_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"columns" text DEFAULT '[]' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "db_databases" ADD CONSTRAINT "db_databases_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "db_rows" ADD CONSTRAINT "db_rows_table_id_db_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."db_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "db_tables" ADD CONSTRAINT "db_tables_database_id_db_databases_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."db_databases"("id") ON DELETE cascade ON UPDATE no action;