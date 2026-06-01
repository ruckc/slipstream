import { db, namespaces, projects, orgMembers, organizations, users } from '$lib/server/db'
import type { Namespace, Project } from '$lib/server/db'
import { eq, inArray } from 'drizzle-orm'
import { error } from '@sveltejs/kit'

export async function checkSlugAvailable(slug: string): Promise<boolean> {
  const rows = await db
    .select({ id: namespaces.id })
    .from(namespaces)
    .where(eq(namespaces.slug, slug))
    .limit(1)

  return rows.length === 0
}

export async function getUserNamespace(userId: string): Promise<Namespace> {
  // Look up user to get their namespaceId, then fetch that namespace
  const userRows = await db
    .select({ namespaceId: users.namespaceId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (userRows.length === 0) {
    throw error(404, 'User not found')
  }

  const nsRows = await db
    .select()
    .from(namespaces)
    .where(eq(namespaces.id, userRows[0].namespaceId))
    .limit(1)

  if (nsRows.length === 0) {
    throw error(404, 'User namespace not found')
  }

  return nsRows[0]
}

export async function listUserProjects(
  userId: string,
): Promise<Array<Project & { namespaceSlug: string }>> {
  // Get user's own namespace
  const userRows = await db
    .select({ namespaceId: users.namespaceId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (userRows.length === 0) return []

  const userNamespaceId = userRows[0].namespaceId

  // Get all org IDs the user is a member of
  const memberRows = await db
    .select({ orgId: orgMembers.orgId })
    .from(orgMembers)
    .where(eq(orgMembers.userId, userId))

  const orgIds = memberRows.map((m) => m.orgId)

  // Get namespace IDs for those orgs
  let orgNamespaceIds: string[] = []
  if (orgIds.length > 0) {
    const orgNsRows = await db
      .select({ namespaceId: organizations.namespaceId })
      .from(organizations)
      .where(inArray(organizations.id, orgIds))

    orgNamespaceIds = orgNsRows.map((r) => r.namespaceId)
  }

  // Collect all accessible namespace IDs
  const allNamespaceIds = [userNamespaceId, ...orgNamespaceIds]

  // Fetch projects in those namespaces with namespace slugs
  const projectRows = await db
    .select({ project: projects, namespace: namespaces })
    .from(projects)
    .innerJoin(namespaces, eq(projects.namespaceId, namespaces.id))
    .where(inArray(projects.namespaceId, allNamespaceIds))

  return projectRows.map((r) => ({
    ...r.project,
    namespaceSlug: r.namespace.slug,
  }))
}
