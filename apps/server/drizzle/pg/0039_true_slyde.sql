CREATE TABLE "space_shares" (
	"space_id" text NOT NULL,
	"principal_type" text NOT NULL,
	"principal_id" text NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "space_shares_space_id_principal_type_principal_id_pk" PRIMARY KEY("space_id","principal_type","principal_id")
);
--> statement-breakpoint
CREATE TABLE "user_group_members" (
	"group_id" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "user_group_members_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "user_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_groups_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "space_shares" ADD CONSTRAINT "space_shares_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_group_members" ADD CONSTRAINT "user_group_members_group_id_user_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_group_members" ADD CONSTRAINT "user_group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "space_shares_principal_idx" ON "space_shares" USING btree ("principal_type","principal_id");