CREATE TABLE "network_flows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"flow_type" text NOT NULL,
	"verdict" text NOT NULL,
	"source_ip" text,
	"dest_ip" text,
	"dest_port" integer,
	"protocol" text,
	"dns_query" text,
	"dns_rcode" text,
	"dns_response_ips" text[],
	"http_method" text,
	"http_url" text,
	"http_status" integer,
	"http_protocol" text,
	CONSTRAINT "network_flows_flow_type_check" CHECK (flow_type IN ('dns', 'http', 'l4')),
	CONSTRAINT "network_flows_verdict_check" CHECK (verdict IN ('forwarded', 'dropped', 'redirected', 'audited', 'unknown'))
);
--> statement-breakpoint
ALTER TABLE "network_flows" ADD CONSTRAINT "network_flows_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "network_flows_project_observed_idx" ON "network_flows" ("project_id","observed_at" DESC);
