import { query, getRequestEvent } from '$app/server'
import { redirect, error } from '@sveltejs/kit'
import { db, namespaces, projects, organizations, orgMembers } from '$lib/server/db'
import { eq, and } from 'drizzle-orm'
import { listProjectEnvironments, phaseToProjectStatus } from '$lib/server/k8s/cr'

export const getNamespacePage = query(async () => {
  const { locals, params } = getRequestEvent()
  if (!locals.user) redirect(302, '/auth/login')

  const nsRows = await db
    .select()
    .from(namespaces)
    .where(eq(namespaces.slug, params.namespace!))
    .limit(1)

  if (nsRows.length === 0) error(404, 'Namespace not found')

  const namespace = nsRows[0]

  let isOwner = false
  let orgData: { id: string; displayName: string; memberCount: number } | undefined

  if (namespace.type === 'user') {
    if (namespace.id !== locals.user.namespaceId) error(403, 'Access denied')
    isOwner = true
  } else if (namespace.type === 'org') {
    const orgRows = await db
      .select({ org: organizations, member: orgMembers })
      .from(organizations)
      .innerJoin(
        orgMembers,
        and(eq(orgMembers.orgId, organizations.id), eq(orgMembers.userId, locals.user.id))
      )
      .where(eq(organizations.namespaceId, namespace.id))
      .limit(1)

    if (orgRows.length === 0) error(403, 'Access denied')

    isOwner = orgRows[0].member.role === 'owner'

    const memberCountRows = await db
      .select({ userId: orgMembers.userId })
      .from(orgMembers)
      .where(eq(orgMembers.orgId, orgRows[0].org.id))

    orgData = {
      id: orgRows[0].org.id,
      displayName: orgRows[0].org.displayName,
      memberCount: memberCountRows.length,
    }
  }

  const [projectRows, statuses] = await Promise.all([
    db.select().from(projects).where(eq(projects.namespaceId, namespace.id)),
    listProjectEnvironments(),
  ])

  const statusMap = new Map(
    statuses.map((cr) => [cr.spec.projectId, phaseToProjectStatus(cr.status?.phase)])
  )

  return {
    namespace,
    projects: projectRows.map((p) => ({ ...p, status: statusMap.get(p.id) ?? 'stopped' })),
    isOwner,
    orgData,
    user: locals.user,
  }
})
