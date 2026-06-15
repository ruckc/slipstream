CREATE TABLE "namespace_registry" (
	"namespace_id" uuid PRIMARY KEY NOT NULL,
	"harbor_project" text NOT NULL,
	"robot_name" text NOT NULL,
	"robot_secret" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "namespace_registry" ADD CONSTRAINT "namespace_registry_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "public"."namespaces"("id") ON DELETE cascade ON UPDATE no action;