import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  numeric,
  unique,
  index,
  primaryKey,
  check,
  boolean,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// namespaces
// ---------------------------------------------------------------------------
export const namespaces = pgTable(
  'namespaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').unique().notNull(),
    type: text('type').notNull(), // 'user'|'org'
    egressFilterEnabled: boolean('egress_filter_enabled').notNull().default(false),
    egressListMode: text('egress_list_mode').notNull().default('merge'), // 'force'|'merge'
    createdAt: timestamp('created_at').defaultNow(),
  },
  () => [
    check('namespaces_type_check', sql`type IN ('user', 'org')`),
    check('namespaces_egress_list_mode_check', sql`egress_list_mode IN ('force', 'merge')`),
  ]
)

export type Namespace = InferSelectModel<typeof namespaces>
export type NewNamespace = InferInsertModel<typeof namespaces>

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(), // NOT defaultRandom() — set explicitly for dev seeds
    namespaceId: uuid('namespace_id')
      .references(() => namespaces.id)
      .notNull(),
    email: text('email').unique().notNull(),
    displayName: text('display_name').notNull(),
    avatarUrl: text('avatar_url'),
    role: text('role').notNull().default('user'), // 'admin'|'user'
    themePreference: text('theme_preference').notNull().default('system'), // 'system'|'light'|'dark'
    idleTimeoutSeconds: integer('idle_timeout_seconds'), // null = inherit
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  () => [
    check('users_role_check', sql`role IN ('admin', 'user')`),
    check('users_theme_preference_check', sql`theme_preference IN ('system', 'light', 'dark')`),
  ]
)

export type User = InferSelectModel<typeof users>
export type NewUser = InferInsertModel<typeof users>

// ---------------------------------------------------------------------------
// oidc_connections
// ---------------------------------------------------------------------------
export const oidcConnections = pgTable(
  'oidc_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id)
      .notNull(),
    provider: text('provider').notNull(), // 'google'|'microsoft'|'github'
    subject: text('subject').notNull(), // provider's sub claim
    email: text('email'),
    linkedAt: timestamp('linked_at').defaultNow(),
  },
  (t) => [unique().on(t.provider, t.subject)]
)

export type OidcConnection = InferSelectModel<typeof oidcConnections>
export type NewOidcConnection = InferInsertModel<typeof oidcConnections>

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id)
      .notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    lastActiveAt: timestamp('last_active_at').defaultNow(),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (t) => [index('sessions_user_id_expires_at_idx').on(t.userId, t.expiresAt)]
)

export type Session = InferSelectModel<typeof sessions>
export type NewSession = InferInsertModel<typeof sessions>

// ---------------------------------------------------------------------------
// organizations
// ---------------------------------------------------------------------------
export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  namespaceId: uuid('namespace_id')
    .references(() => namespaces.id)
    .unique()
    .notNull(),
  displayName: text('display_name').notNull(),
  idleTimeoutSeconds: integer('idle_timeout_seconds'),
  createdAt: timestamp('created_at').defaultNow(),
})

export type Organization = InferSelectModel<typeof organizations>
export type NewOrganization = InferInsertModel<typeof organizations>

// ---------------------------------------------------------------------------
// org_members
// ---------------------------------------------------------------------------
export const orgMembers = pgTable(
  'org_members',
  {
    orgId: uuid('org_id')
      .references(() => organizations.id)
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id)
      .notNull(),
    role: text('role').notNull(), // 'owner'|'member'
    joinedAt: timestamp('joined_at').defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.userId] }),
    check('org_members_role_check', sql`role IN ('owner', 'member')`),
  ]
)

export type OrgMember = InferSelectModel<typeof orgMembers>
export type NewOrgMember = InferInsertModel<typeof orgMembers>

// ---------------------------------------------------------------------------
// projects
// ---------------------------------------------------------------------------
export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    namespaceId: uuid('namespace_id')
      .references(() => namespaces.id)
      .notNull(),
    slug: text('slug').notNull(),
    displayName: text('display_name').notNull(),
    idleTimeoutSeconds: integer('idle_timeout_seconds'), // null = inherit
    egressFilterEnabled: boolean('egress_filter_enabled'), // null = inherit from namespace
    kubeDeployAccess: boolean('kube_deploy_access').notNull().default(false),
    k8sPvcName: text('k8s_pvc_name').notNull(), // always set at creation
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => [unique().on(t.namespaceId, t.slug)]
)

export type Project = InferSelectModel<typeof projects>
export type NewProject = InferInsertModel<typeof projects>

// ---------------------------------------------------------------------------
// project_permissions
// ---------------------------------------------------------------------------
export const projectPermissions = pgTable(
  'project_permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .references(() => projects.id)
      .notNull(),
    principalType: text('principal_type').notNull(), // 'user'|'org'
    principalId: uuid('principal_id').notNull(), // user.id or organization.id
    permission: text('permission').notNull(), // 'files:read'|'files:write'|'shell'|'project:manage'
    grantedBy: uuid('granted_by')
      .references(() => users.id)
      .notNull(),
    grantedAt: timestamp('granted_at').defaultNow(),
  },
  (t) => [
    unique().on(t.projectId, t.principalType, t.principalId, t.permission),
    check('project_permissions_principal_type_check', sql`principal_type IN ('user', 'org')`),
    check(
      'project_permissions_permission_check',
      sql`permission IN ('files:read', 'files:write', 'shell', 'project:manage')`
    ),
  ]
)

export type ProjectPermission = InferSelectModel<typeof projectPermissions>
export type NewProjectPermission = InferInsertModel<typeof projectPermissions>

// ---------------------------------------------------------------------------
// usage_samples
// ---------------------------------------------------------------------------
export const usageSamples = pgTable('usage_samples', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .references(() => projects.id)
    .notNull(),
  metric: text('metric').notNull(), // 'cpu_seconds'|'memory_byte_seconds'|'disk_bytes'|'ingress_bytes'|'egress_bytes'
  value: numeric('value').notNull(),
  sampledAt: timestamp('sampled_at').notNull(),
})

export type UsageSample = InferSelectModel<typeof usageSamples>
export type NewUsageSample = InferInsertModel<typeof usageSamples>

// ---------------------------------------------------------------------------
// egress_rules
// ---------------------------------------------------------------------------
export const egressRules = pgTable(
  'egress_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerType: text('owner_type').notNull(), // 'namespace'|'project'
    ownerId: uuid('owner_id').notNull(),
    ruleType: text('rule_type').notNull(), // 'allow'|'deny'  (deny only valid for namespace)
    domain: text('domain').notNull(), // e.g. 'api.github.com', '*.github.com', '**.github.com'
    ports: integer('ports').array().notNull().default([80, 443]),
    createdAt: timestamp('created_at').defaultNow(),
  },
  () => [
    check('egress_rules_owner_type_check', sql`owner_type IN ('namespace', 'project')`),
    check('egress_rules_rule_type_check', sql`rule_type IN ('allow', 'deny')`),
    check(
      'egress_rules_deny_namespace_only_check',
      sql`rule_type = 'allow' OR owner_type = 'namespace'`
    ),
  ]
)

export type EgressRule = InferSelectModel<typeof egressRules>
export type NewEgressRule = InferInsertModel<typeof egressRules>

// ---------------------------------------------------------------------------
// server_errors — admin-visible exception log
// ---------------------------------------------------------------------------
export const projectCommands = pgTable('project_commands', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .references(() => projects.id, { onDelete: 'cascade' })
    .notNull(),
  label: text('label'),
  command: text('command').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export type ProjectCommand = InferSelectModel<typeof projectCommands>
export type NewProjectCommand = InferInsertModel<typeof projectCommands>

export const serverErrors = pgTable('server_errors', {
  id: uuid('id').primaryKey().defaultRandom(),
  occurredAt: timestamp('occurred_at').defaultNow().notNull(),
  route: text('route'),
  message: text('message').notNull(),
  stack: text('stack'),
  context: text('context'), // JSON-serialised key/value bag
  userId: uuid('user_id').references(() => users.id),
})

export type ServerError = InferSelectModel<typeof serverErrors>
export type NewServerError = InferInsertModel<typeof serverErrors>

// ---------------------------------------------------------------------------
// network_flows — egress flow log from Hubble collector
// ---------------------------------------------------------------------------
export const networkFlows = pgTable(
  'network_flows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    flowType: text('flow_type').notNull(), // 'dns'|'http'|'l4'
    verdict: text('verdict').notNull(), // 'forwarded'|'dropped'|'redirected'|'audited'|'unknown'
    sourceIp: text('source_ip'),
    destIp: text('dest_ip'),
    destPort: integer('dest_port'),
    protocol: text('protocol'), // 'TCP'|'UDP'|'ICMP'
    // DNS fields
    dnsQuery: text('dns_query'),
    dnsRcode: text('dns_rcode'),
    dnsResponseIps: text('dns_response_ips').array(),
    // HTTP fields
    httpMethod: text('http_method'),
    httpUrl: text('http_url'),
    httpStatus: integer('http_status'),
    httpProtocol: text('http_protocol'),
  },
  () => [
    check('network_flows_flow_type_check', sql`flow_type IN ('dns', 'http', 'l4')`),
    check(
      'network_flows_verdict_check',
      sql`verdict IN ('forwarded', 'dropped', 'redirected', 'audited', 'unknown')`
    ),
  ]
)

export type NetworkFlow = InferSelectModel<typeof networkFlows>
export type NewNetworkFlow = InferInsertModel<typeof networkFlows>
