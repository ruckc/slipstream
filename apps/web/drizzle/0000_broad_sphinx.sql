CREATE TABLE "namespaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"type" text NOT NULL,
	"k8s_namespace" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "namespaces_slug_unique" UNIQUE("slug"),
	CONSTRAINT "namespaces_type_check" CHECK (type IN ('user', 'org'))
);
--> statement-breakpoint
CREATE TABLE "oidc_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"subject" text NOT NULL,
	"email" text,
	"linked_at" timestamp DEFAULT now(),
	CONSTRAINT "oidc_connections_provider_subject_unique" UNIQUE("provider","subject")
);
--> statement-breakpoint
CREATE TABLE "org_members" (
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"joined_at" timestamp DEFAULT now(),
	CONSTRAINT "org_members_org_id_user_id_pk" PRIMARY KEY("org_id","user_id"),
	CONSTRAINT "org_members_role_check" CHECK (role IN ('owner', 'member'))
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"namespace_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"idle_timeout_seconds" integer,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "organizations_namespace_id_unique" UNIQUE("namespace_id")
);
--> statement-breakpoint
CREATE TABLE "project_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"principal_type" text NOT NULL,
	"principal_id" uuid NOT NULL,
	"permission" text NOT NULL,
	"granted_by" uuid NOT NULL,
	"granted_at" timestamp DEFAULT now(),
	CONSTRAINT "project_permissions_project_id_principal_type_principal_id_permission_unique" UNIQUE("project_id","principal_type","principal_id","permission"),
	CONSTRAINT "project_permissions_principal_type_check" CHECK (principal_type IN ('user', 'org')),
	CONSTRAINT "project_permissions_permission_check" CHECK (permission IN ('files:read', 'files:write', 'shell', 'project:manage'))
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"namespace_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'stopped' NOT NULL,
	"idle_timeout_seconds" integer,
	"k8s_pod_name" text,
	"k8s_pvc_name" text NOT NULL,
	"k8s_route_name" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "projects_namespace_id_slug_unique" UNIQUE("namespace_id","slug"),
	CONSTRAINT "projects_status_check" CHECK (status IN ('stopped', 'starting', 'running', 'stopping'))
);
--> statement-breakpoint
CREATE TABLE "server_errors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"route" text,
	"message" text NOT NULL,
	"stack" text,
	"context" text,
	"user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "usage_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"value" numeric NOT NULL,
	"sampled_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"namespace_id" uuid NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"theme_preference" text DEFAULT 'system' NOT NULL,
	"idle_timeout_seconds" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_theme_preference_check" CHECK (theme_preference IN ('system', 'light', 'dark'))
);
--> statement-breakpoint
ALTER TABLE "oidc_connections" ADD CONSTRAINT "oidc_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "public"."namespaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_permissions" ADD CONSTRAINT "project_permissions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_permissions" ADD CONSTRAINT "project_permissions_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "public"."namespaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_errors" ADD CONSTRAINT "server_errors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_samples" ADD CONSTRAINT "usage_samples_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "public"."namespaces"("id") ON DELETE no action ON UPDATE no action;