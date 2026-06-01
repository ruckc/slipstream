import {
  db,
  projectPermissions,
  orgMembers,
  projects,
  namespaces,
  organizations,
  users,
} from '$lib/server/db'
import type { User } from '$lib/server/db'
import { eq, and, inArray } from 'drizzle-orm'

export type Permission = 'files:read' | 'files:write' | 'shell' | 'project:manage'

const ALL_PERMISSIONS: Permission[] = ['files:read', 'files:write', 'shell', 'project:manage']

/**
 * Resolves all permissions a user has on a project.
 *
 * Rules (first matching rule grants all permissions early-returns):
 * 1. If the project's namespace type='user' and namespace matches user.namespaceId → all permissions
 * 2. If the project's namespace type='org' and user is an org owner → all permissions
 * 3. Check project_permissions for explicit user grants
 * 4. Check project_permissions for org grants (if user is org member in that org)
 */
export async function resolvePermissions(user: User, projectId: string): Promise<Permission[]> {
  // Load project + namespace in one query
  const rows = await db
    .select({ project: projects, namespace: namespaces })
    .from(projects)
    .innerJoin(namespaces, eq(projects.namespaceId, namespaces.id))
    .where(eq(projects.id, projectId))
    .limit(1)

  if (rows.length === 0) return []

  const { namespace } = rows[0]

  // Rule 1: user-type namespace — user owns it
  if (namespace.type === 'user' && namespace.id === user.namespaceId) {
    return [...ALL_PERMISSIONS]
  }

  // Rule 2: org-type namespace — check if user is org owner
  if (namespace.type === 'org') {
    const orgRows = await db
      .select({ org: organizations, member: orgMembers })
      .from(organizations)
      .innerJoin(
        orgMembers,
        and(eq(orgMembers.orgId, organizations.id), eq(orgMembers.userId, user.id))
      )
      .where(eq(organizations.namespaceId, namespace.id))
      .limit(1)

    if (orgRows.length > 0 && orgRows[0].member.role === 'owner') {
      return [...ALL_PERMISSIONS]
    }
  }

  // Rule 3 + 4: explicit project_permissions grants
  const granted = new Set<Permission>()

  // Direct user grants
  const userGrants = await db
    .select({ permission: projectPermissions.permission })
    .from(projectPermissions)
    .where(
      and(
        eq(projectPermissions.projectId, projectId),
        eq(projectPermissions.principalType, 'user'),
        eq(projectPermissions.principalId, user.id)
      )
    )

  for (const g of userGrants) {
    granted.add(g.permission as Permission)
  }

  // Org grants — find all orgs the user belongs to, then check permissions granted to those orgs
  const memberOrgs = await db
    .select({ orgId: orgMembers.orgId })
    .from(orgMembers)
    .where(eq(orgMembers.userId, user.id))

  if (memberOrgs.length > 0) {
    const orgIds = memberOrgs.map((m) => m.orgId)
    const orgGrants = await db
      .select({ permission: projectPermissions.permission })
      .from(projectPermissions)
      .where(
        and(
          eq(projectPermissions.projectId, projectId),
          eq(projectPermissions.principalType, 'org'),
          inArray(projectPermissions.principalId, orgIds)
        )
      )

    for (const g of orgGrants) {
      granted.add(g.permission as Permission)
    }
  }

  return Array.from(granted)
}

/**
 * Check whether a user has a specific permission on a project.
 */
export async function hasPermission(
  user: User,
  projectId: string,
  permission: Permission
): Promise<boolean> {
  const perms = await resolvePermissions(user, projectId)
  return perms.includes(permission)
}

/**
 * Resolves the effective idle timeout for a project.
 * Priority: project.idleTimeoutSeconds → org/user idleTimeoutSeconds → system default
 */
export async function resolveIdleTimeout(projectId: string): Promise<number> {
  const systemDefault = parseInt(process.env.DEFAULT_IDLE_TIMEOUT_SECONDS ?? '1800', 10)

  const rows = await db
    .select({ project: projects, namespace: namespaces })
    .from(projects)
    .innerJoin(namespaces, eq(projects.namespaceId, namespaces.id))
    .where(eq(projects.id, projectId))
    .limit(1)

  if (rows.length === 0) return systemDefault

  const { project, namespace } = rows[0]

  // Project-level override
  if (project.idleTimeoutSeconds != null) {
    return project.idleTimeoutSeconds
  }

  // Namespace-owner level override
  if (namespace.type === 'user') {
    const userRows = await db
      .select({ idleTimeoutSeconds: users.idleTimeoutSeconds })
      .from(users)
      .where(eq(users.namespaceId, namespace.id))
      .limit(1)

    if (userRows.length > 0 && userRows[0].idleTimeoutSeconds != null) {
      return userRows[0].idleTimeoutSeconds
    }
  } else if (namespace.type === 'org') {
    const orgRows = await db
      .select({ idleTimeoutSeconds: organizations.idleTimeoutSeconds })
      .from(organizations)
      .where(eq(organizations.namespaceId, namespace.id))
      .limit(1)

    if (orgRows.length > 0 && orgRows[0].idleTimeoutSeconds != null) {
      return orgRows[0].idleTimeoutSeconds
    }
  }

  return systemDefault
}
