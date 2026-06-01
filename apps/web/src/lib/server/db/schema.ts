import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  numeric,
  unique,
  primaryKey,
} from 'drizzle-orm/pg-core'
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// namespaces
// ---------------------------------------------------------------------------
export const namespaces = pgTable('namespaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').unique().notNull(),
  type: text('type').notNull(), // 'user' | 'org'
  k8sNamespace: text('k8s_namespace').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
})

export type Namespace = InferSelectModel<typeof namespaces>
export type NewNamespace = InferInsertModel<typeof namespaces>

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------
export const users = pgTable('users', {
  id: uuid('id').primaryKey(), // NOT defaultRandom() — set explicitly for dev seeds
  namespaceId: uuid('namespace_id')
    .references(() => namespaces.id)
    .notNull(),
  email: text('email').unique().notNull(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  themePreference: text('theme_preference').notNull().default('system'), // 'system'|'light'|'dark'
  idleTimeoutSeconds: integer('idle_timeout_seconds'), // null = inherit
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

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
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .references(() => users.id)
    .notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
})

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
  (t) => [primaryKey({ columns: [t.orgId, t.userId] })]
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
    status: text('status').notNull().default('stopped'), // 'stopped'|'starting'|'running'|'stopping'
    idleTimeoutSeconds: integer('idle_timeout_seconds'), // null = inherit
    k8sPodName: text('k8s_pod_name'), // null when stopped
    k8sPvcName: text('k8s_pvc_name').notNull(), // always set at creation
    k8sRouteName: text('k8s_route_name'), // null when stopped
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
  (t) => [unique().on(t.projectId, t.principalType, t.principalId, t.permission)]
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
