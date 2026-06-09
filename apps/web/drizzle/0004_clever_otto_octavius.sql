CREATE TABLE "egress_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"rule_type" text NOT NULL,
	"domain" text NOT NULL,
	"ports" integer[] DEFAULT '{80,443}' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "egress_rules_owner_type_check" CHECK (owner_type IN ('namespace', 'project')),
	CONSTRAINT "egress_rules_rule_type_check" CHECK (rule_type IN ('allow', 'deny')),
	CONSTRAINT "egress_rules_deny_namespace_only_check" CHECK (rule_type = 'allow' OR owner_type = 'namespace')
);
--> statement-breakpoint
ALTER TABLE "namespaces" ADD COLUMN "egress_filter_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "namespaces" ADD COLUMN "egress_list_mode" text DEFAULT 'merge' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "egress_filter_enabled" boolean;--> statement-breakpoint
ALTER TABLE "namespaces" ADD CONSTRAINT "namespaces_egress_list_mode_check" CHECK (egress_list_mode IN ('force', 'merge'));