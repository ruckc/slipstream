import { redirect, error } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { db, namespaces, projects, organizations, orgMembers, users } from '$lib/server/db'
import { eq, and } from 'drizzle-orm'

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) throw redirect(302, '/auth/login')

  // Look up namespace by slug
  const nsRows = await db
    .select()
    .from(namespaces)
    .where(eq(namespaces.slug, params.namespace))
    .limit(1)

  if (nsRows.length === 0) throw error(404, 'Namespace not found')

  const namespace = nsRows[0]

  // Check access
  let isOwner = false
  let orgData: { id: string; displayName: string; memberCount: number } | undefined

  if (namespace.type === 'user') {
    // Must be the namespace owner
    if (namespace.id !== locals.user.namespaceId) {
      throw error(403, 'Access denied')
    }
    isOwner = true
  } else if (namespace.type === 'org') {
    // Must be a member
    const orgRows = await db
      .select({ org: organizations, member: orgMembers })
      .from(organizations)
      .innerJoin(
        orgMembers,
        and(eq(orgMembers.orgId, organizations.id), eq(orgMembers.userId, locals.user.id)),
      )
      .where(eq(organizations.namespaceId, namespace.id))
      .limit(1)

    if (orgRows.length === 0) throw error(403, 'Access denied')

    isOwner = orgRows[0].member.role === 'owner'

    // Count members
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

  // Load projects in this namespace
  const projectRows = await db
    .select()
    .from(projects)
    .where(eq(projects.namespaceId, namespace.id))

  return {
    namespace,
    projects: projectRows,
    isOwner,
    orgData,
    user: locals.user,
  }
}
