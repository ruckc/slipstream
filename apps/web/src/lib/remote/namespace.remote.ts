import { query } from '$app/server'
import { db, namespaces, projects, orgMembers, organizations, users } from '$lib/server/db'
import type { Namespace, Project } from '$lib/server/db'
import { eq, inArray } from 'drizzle-orm'
import { error } from '@sveltejs/kit'

async function checkSlugAvailableImpl(slug: string): Promise<boolean> {
  const rows = await db
    .select({ id: namespaces.id })
    .from(namespaces)
    .where(eq(namespaces.slug, slug))
    .limit(1)
  return rows.length === 0
}

async function getUserNamespaceImpl(userId: string): Promise<Namespace> {
  const userRows = await db
    .select({ namespaceId: users.namespaceId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (userRows.length === 0) throw error(404, 'User not found')

  const nsRows = await db
    .select()
    .from(namespaces)
    .where(eq(namespaces.id, userRows[0].namespaceId))
    .limit(1)
  if (nsRows.length === 0) throw error(404, 'User namespace not found')

  return nsRows[0]
}

async function listUserProjectsImpl(
  userId: string
): Promise<Array<Project & { namespaceSlug: string }>> {
  const userRows = await db
    .select({ namespaceId: users.namespaceId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (userRows.length === 0) return []

  const userNamespaceId = userRows[0].namespaceId

  const memberRows = await db
    .select({ orgId: orgMembers.orgId })
    .from(orgMembers)
    .where(eq(orgMembers.userId, userId))

  const orgIds = memberRows.map((m) => m.orgId)

  let orgNamespaceIds: string[] = []
  if (orgIds.length > 0) {
    const orgNsRows = await db
      .select({ namespaceId: organizations.namespaceId })
      .from(organizations)
      .where(inArray(organizations.id, orgIds))
    orgNamespaceIds = orgNsRows.map((r) => r.namespaceId)
  }

  const allNamespaceIds = [userNamespaceId, ...orgNamespaceIds]

  const projectRows = await db
    .select({ project: projects, namespace: namespaces })
    .from(projects)
    .innerJoin(namespaces, eq(projects.namespaceId, namespaces.id))
    .where(inArray(projects.namespaceId, allNamespaceIds))

  return projectRows.map((r) => ({ ...r.project, namespaceSlug: r.namespace.slug }))
}

export const checkSlugAvailable = query('unchecked', async (slug: string) =>
  checkSlugAvailableImpl(slug)
)

export const getUserNamespace = query('unchecked', async (userId: string) =>
  getUserNamespaceImpl(userId)
)

export const listUserProjects = query('unchecked', async (userId: string) =>
  listUserProjectsImpl(userId)
)
