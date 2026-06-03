import { query, form, command, getRequestEvent } from '$app/server'
import { redirect, error, invalid } from '@sveltejs/kit'
import { db, namespaces, organizations, orgMembers, users } from '$lib/server/db'
import { eq, and } from 'drizzle-orm'
import {
  listOrgMembers,
  inviteMember as orgInviteMember,
  removeMember as orgRemoveMember,
  setMemberRole as orgSetMemberRole,
} from '$lib/remote/organization.remote'

export const getNamespaceSettings = query('unchecked', async (namespaceSlug: string) => {
  const { locals } = getRequestEvent()
  if (!locals.user) redirect(302, '/auth/login')

  const nsRows = await db
    .select()
    .from(namespaces)
    .where(eq(namespaces.slug, namespaceSlug))
    .limit(1)

  if (nsRows.length === 0) error(404, 'Namespace not found')

  const namespace = nsRows[0]

  if (namespace.type === 'user') {
    if (namespace.id !== locals.user.namespaceId) error(403, 'Access denied')
    return {
      namespace,
      type: 'user' as const,
      org: null as null,
      members: null as null,
      isOwner: true,
      user: locals.user,
    }
  }

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

  const isOwner = orgRows[0].member.role === 'owner'
  if (!isOwner) error(403, 'Only org owners can access settings')

  const members = await listOrgMembers(orgRows[0].org.id)

  return {
    namespace,
    type: 'org' as const,
    org: orgRows[0].org,
    members,
    isOwner,
    user: locals.user,
  }
})

export const updateOrgName = form(
  'unchecked',
  async (data: { namespaceSlug: string; displayName: string }, issue) => {
    const { locals } = getRequestEvent()
    if (!locals.user) redirect(302, '/auth/login')

    const displayName = String(data.displayName ?? '').trim()
    if (!displayName) invalid(issue.displayName('Display name is required'))

    const nsRows = await db
      .select()
      .from(namespaces)
      .where(eq(namespaces.slug, data.namespaceSlug))
      .limit(1)
    if (nsRows.length === 0) error(404)

    const orgRows = await db
      .select({ org: organizations })
      .from(organizations)
      .where(eq(organizations.namespaceId, nsRows[0].id))
      .limit(1)
    if (orgRows.length === 0) error(404)

    await db
      .update(organizations)
      .set({ displayName })
      .where(eq(organizations.id, orgRows[0].org.id))

    return { success: true as const }
  }
)

export const updateNamespaceIdleTimeout = form(
  'unchecked',
  async (data: { namespaceSlug: string; idleTimeoutSeconds: string }, issue) => {
    const { locals } = getRequestEvent()
    if (!locals.user) redirect(302, '/auth/login')

    const raw = String(data.idleTimeoutSeconds ?? '').trim()
    const idleTimeoutSeconds = raw === '' ? null : parseInt(raw, 10)

    if (idleTimeoutSeconds !== null && (isNaN(idleTimeoutSeconds) || idleTimeoutSeconds < 60)) {
      invalid(issue.idleTimeoutSeconds('Idle timeout must be at least 60 seconds'))
    }

    const nsRows = await db
      .select()
      .from(namespaces)
      .where(eq(namespaces.slug, data.namespaceSlug))
      .limit(1)
    if (nsRows.length === 0) error(404)

    if (nsRows[0].type === 'user') {
      const userRows = await db
        .select()
        .from(users)
        .where(eq(users.namespaceId, nsRows[0].id))
        .limit(1)
      if (userRows.length === 0) error(404)
      await db.update(users).set({ idleTimeoutSeconds }).where(eq(users.id, userRows[0].id))
    } else {
      const orgRows = await db
        .select({ org: organizations })
        .from(organizations)
        .where(eq(organizations.namespaceId, nsRows[0].id))
        .limit(1)
      if (orgRows.length === 0) error(404)
      await db
        .update(organizations)
        .set({ idleTimeoutSeconds })
        .where(eq(organizations.id, orgRows[0].org.id))
    }

    return { success: true as const }
  }
)

export const inviteMember = form(
  'unchecked',
  async (data: { namespaceSlug: string; email: string }, issue) => {
    const { locals } = getRequestEvent()
    if (!locals.user) redirect(302, '/auth/login')

    const email = String(data.email ?? '').trim()
    if (!email) invalid(issue.email('Email is required'))

    const nsRows = await db
      .select()
      .from(namespaces)
      .where(eq(namespaces.slug, data.namespaceSlug))
      .limit(1)
    if (nsRows.length === 0) error(404)

    const orgRows = await db
      .select({ org: organizations })
      .from(organizations)
      .where(eq(organizations.namespaceId, nsRows[0].id))
      .limit(1)
    if (orgRows.length === 0) error(404)

    await orgInviteMember({ actorUserId: locals.user.id, orgId: orgRows[0].org.id, email })

    return { success: true as const }
  }
)

export const setMemberRole = command(
  'unchecked',
  async (arg: { namespaceSlug: string; userId: string; role: 'owner' | 'member' }) => {
    const { locals } = getRequestEvent()
    if (!locals.user) redirect(302, '/auth/login')

    const nsRows = await db
      .select()
      .from(namespaces)
      .where(eq(namespaces.slug, arg.namespaceSlug))
      .limit(1)
    if (nsRows.length === 0) error(404)

    const orgRows = await db
      .select({ org: organizations })
      .from(organizations)
      .where(eq(organizations.namespaceId, nsRows[0].id))
      .limit(1)
    if (orgRows.length === 0) error(404)

    await orgSetMemberRole({
      actorUserId: locals.user.id,
      orgId: orgRows[0].org.id,
      targetUserId: arg.userId,
      role: arg.role,
    })
  }
)

export const removeMember = command(
  'unchecked',
  async (arg: { namespaceSlug: string; userId: string }) => {
    const { locals } = getRequestEvent()
    if (!locals.user) redirect(302, '/auth/login')

    const nsRows = await db
      .select()
      .from(namespaces)
      .where(eq(namespaces.slug, arg.namespaceSlug))
      .limit(1)
    if (nsRows.length === 0) error(404)

    const orgRows = await db
      .select({ org: organizations })
      .from(organizations)
      .where(eq(organizations.namespaceId, nsRows[0].id))
      .limit(1)
    if (orgRows.length === 0) error(404)

    await orgRemoveMember({
      actorUserId: locals.user.id,
      orgId: orgRows[0].org.id,
      targetUserId: arg.userId,
    })
  }
)
