import { redirect, error, fail } from '@sveltejs/kit'
import type { PageServerLoad, Actions } from './$types'
import { db, namespaces, organizations, orgMembers, users } from '$lib/server/db'
import { eq, and } from 'drizzle-orm'
import {
  listOrgMembers,
  inviteMember,
  removeMember,
  setMemberRole,
} from '$lib/remote/organization.remote'

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) throw redirect(302, '/auth/login')

  const nsRows = await db
    .select()
    .from(namespaces)
    .where(eq(namespaces.slug, params.namespace))
    .limit(1)

  if (nsRows.length === 0) throw error(404, 'Namespace not found')

  const namespace = nsRows[0]

  if (namespace.type === 'user') {
    // Must be this user's namespace
    if (namespace.id !== locals.user.namespaceId) throw error(403, 'Access denied')

    return {
      namespace,
      type: 'user' as const,
      org: null,
      members: null,
      isOwner: true,
      user: locals.user,
    }
  }

  // Org namespace
  const orgRows = await db
    .select({ org: organizations, member: orgMembers })
    .from(organizations)
    .innerJoin(
      orgMembers,
      and(eq(orgMembers.orgId, organizations.id), eq(orgMembers.userId, locals.user.id))
    )
    .where(eq(organizations.namespaceId, namespace.id))
    .limit(1)

  if (orgRows.length === 0) throw error(403, 'Access denied')

  const isOwner = orgRows[0].member.role === 'owner'
  if (!isOwner) throw error(403, 'Only org owners can access settings')

  const members = await listOrgMembers(orgRows[0].org.id)

  return {
    namespace,
    type: 'org' as const,
    org: orgRows[0].org,
    members,
    isOwner,
    user: locals.user,
  }
}

export const actions: Actions = {
  updateOrgName: async ({ request, locals, params }) => {
    if (!locals.user) throw redirect(302, '/auth/login')

    const data = await request.formData()
    const displayName = String(data.get('displayName') ?? '').trim()
    if (!displayName) return fail(400, { error: 'Display name is required' })

    const nsRows = await db
      .select()
      .from(namespaces)
      .where(eq(namespaces.slug, params.namespace))
      .limit(1)
    if (nsRows.length === 0) throw error(404)

    const orgRows = await db
      .select({ org: organizations })
      .from(organizations)
      .where(eq(organizations.namespaceId, nsRows[0].id))
      .limit(1)
    if (orgRows.length === 0) throw error(404)

    await db
      .update(organizations)
      .set({ displayName })
      .where(eq(organizations.id, orgRows[0].org.id))

    return { success: true }
  },

  updateIdleTimeout: async ({ request, locals, params }) => {
    if (!locals.user) throw redirect(302, '/auth/login')

    const data = await request.formData()
    const raw = String(data.get('idleTimeoutSeconds') ?? '').trim()
    const idleTimeoutSeconds = raw === '' ? null : parseInt(raw, 10)

    if (idleTimeoutSeconds !== null && (isNaN(idleTimeoutSeconds) || idleTimeoutSeconds < 60)) {
      return fail(400, { error: 'Idle timeout must be at least 60 seconds' })
    }

    const nsRows = await db
      .select()
      .from(namespaces)
      .where(eq(namespaces.slug, params.namespace))
      .limit(1)
    if (nsRows.length === 0) throw error(404)

    if (nsRows[0].type === 'user') {
      const userRows = await db
        .select()
        .from(users)
        .where(eq(users.namespaceId, nsRows[0].id))
        .limit(1)
      if (userRows.length === 0) throw error(404)
      await db.update(users).set({ idleTimeoutSeconds }).where(eq(users.id, userRows[0].id))
    } else {
      const orgRows = await db
        .select({ org: organizations })
        .from(organizations)
        .where(eq(organizations.namespaceId, nsRows[0].id))
        .limit(1)
      if (orgRows.length === 0) throw error(404)
      await db
        .update(organizations)
        .set({ idleTimeoutSeconds })
        .where(eq(organizations.id, orgRows[0].org.id))
    }

    return { success: true }
  },

  inviteMember: async ({ request, locals, params }) => {
    if (!locals.user) throw redirect(302, '/auth/login')

    const data = await request.formData()
    const email = String(data.get('email') ?? '').trim()
    if (!email) return fail(400, { invite: true, error: 'Email is required' })

    const nsRows = await db
      .select()
      .from(namespaces)
      .where(eq(namespaces.slug, params.namespace))
      .limit(1)
    if (nsRows.length === 0) throw error(404)

    const orgRows = await db
      .select({ org: organizations })
      .from(organizations)
      .where(eq(organizations.namespaceId, nsRows[0].id))
      .limit(1)
    if (orgRows.length === 0) throw error(404)

    try {
      await inviteMember(locals.user.id, orgRows[0].org.id, email)
      return { invite: true, success: true }
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'status' in e) throw e
      return fail(400, { invite: true, error: (e as Error).message })
    }
  },

  removeMember: async ({ request, locals, params }) => {
    if (!locals.user) throw redirect(302, '/auth/login')

    const data = await request.formData()
    const targetUserId = String(data.get('userId') ?? '').trim()
    if (!targetUserId) return fail(400, { error: 'User ID is required' })

    const nsRows = await db
      .select()
      .from(namespaces)
      .where(eq(namespaces.slug, params.namespace))
      .limit(1)
    if (nsRows.length === 0) throw error(404)

    const orgRows = await db
      .select({ org: organizations })
      .from(organizations)
      .where(eq(organizations.namespaceId, nsRows[0].id))
      .limit(1)
    if (orgRows.length === 0) throw error(404)

    try {
      await removeMember(locals.user.id, orgRows[0].org.id, targetUserId)
      return { success: true }
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'status' in e) throw e
      return fail(400, { error: (e as Error).message })
    }
  },

  setMemberRole: async ({ request, locals, params }) => {
    if (!locals.user) throw redirect(302, '/auth/login')

    const data = await request.formData()
    const targetUserId = String(data.get('userId') ?? '').trim()
    const role = String(data.get('role') ?? '').trim() as 'owner' | 'member'

    if (!targetUserId) return fail(400, { error: 'User ID is required' })
    if (role !== 'owner' && role !== 'member') return fail(400, { error: 'Invalid role' })

    const nsRows = await db
      .select()
      .from(namespaces)
      .where(eq(namespaces.slug, params.namespace))
      .limit(1)
    if (nsRows.length === 0) throw error(404)

    const orgRows = await db
      .select({ org: organizations })
      .from(organizations)
      .where(eq(organizations.namespaceId, nsRows[0].id))
      .limit(1)
    if (orgRows.length === 0) throw error(404)

    try {
      await setMemberRole(locals.user.id, orgRows[0].org.id, targetUserId, role)
      return { success: true }
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'status' in e) throw e
      return fail(400, { error: (e as Error).message })
    }
  },
}
