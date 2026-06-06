import { query, command } from '$app/server'
import { db, namespaces, organizations, orgMembers, users } from '$lib/server/db'
import type { Organization, Namespace, OrgMember, User } from '$lib/server/db'
import { eq, and } from 'drizzle-orm'
import { error } from '@sveltejs/kit'
import { ensureK8sNamespace } from '$lib/server/k8s/namespace'

async function assertOrgOwner(userId: string, orgId: string): Promise<void> {
  const rows = await db
    .select({ role: orgMembers.role })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
    .limit(1)
  if (rows.length === 0 || rows[0].role !== 'owner') {
    throw error(403, 'You must be an organization owner to perform this action')
  }
}

export const createOrganization = command(
  'unchecked',
  async (arg: {
    actorUserId: string
    slug: string
    displayName: string
  }): Promise<Organization> => {
    const existing = await db
      .select({ id: namespaces.id })
      .from(namespaces)
      .where(eq(namespaces.slug, arg.slug))
      .limit(1)
    if (existing.length > 0) throw error(409, 'Slug is already taken')

    const k8sNs = `ss-org-${arg.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`

    const [namespace] = await db
      .insert(namespaces)
      .values({ slug: arg.slug, type: 'org', k8sNamespace: k8sNs })
      .returning()

    try {
      await ensureK8sNamespace(k8sNs, arg.slug, 'org')
    } catch (k8sErr) {
      await db.delete(namespaces).where(eq(namespaces.id, namespace.id))
      console.error('[createOrganization] k8s namespace creation failed:', k8sErr)
      throw error(500, 'Failed to provision Kubernetes namespace for organization')
    }

    const [org] = await db
      .insert(organizations)
      .values({ namespaceId: namespace.id, displayName: arg.displayName })
      .returning()

    await db.insert(orgMembers).values({ orgId: org.id, userId: arg.actorUserId, role: 'owner' })

    return org
  }
)

export const getOrganization = query(
  'unchecked',
  async (slug: string): Promise<(Organization & { namespace: Namespace }) | null> => {
    const rows = await db
      .select({ org: organizations, namespace: namespaces })
      .from(organizations)
      .innerJoin(namespaces, eq(organizations.namespaceId, namespaces.id))
      .where(eq(namespaces.slug, slug))
      .limit(1)
    if (rows.length === 0) return null
    return { ...rows[0].org, namespace: rows[0].namespace }
  }
)

export const listOrgMembers = query(
  'unchecked',
  async (orgId: string): Promise<Array<OrgMember & { user: User }>> => {
    const rows = await db
      .select({ member: orgMembers, user: users })
      .from(orgMembers)
      .innerJoin(users, eq(orgMembers.userId, users.id))
      .where(eq(orgMembers.orgId, orgId))
    return rows.map((r) => ({ ...r.member, user: r.user }))
  }
)

export const inviteMember = command(
  'unchecked',
  async (arg: { actorUserId: string; orgId: string; email: string }): Promise<OrgMember> => {
    await assertOrgOwner(arg.actorUserId, arg.orgId)

    const targetRows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, arg.email))
      .limit(1)
    if (targetRows.length === 0) throw error(404, 'No user found with that email address')

    const targetUserId = targetRows[0].id

    const existingMember = await db
      .select({ userId: orgMembers.userId })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, arg.orgId), eq(orgMembers.userId, targetUserId)))
      .limit(1)
    if (existingMember.length > 0) throw error(409, 'User is already a member of this organization')

    const [member] = await db
      .insert(orgMembers)
      .values({ orgId: arg.orgId, userId: targetUserId, role: 'member' })
      .returning()
    return member
  }
)

export const removeMember = command(
  'unchecked',
  async (arg: { actorUserId: string; orgId: string; targetUserId: string }): Promise<void> => {
    await assertOrgOwner(arg.actorUserId, arg.orgId)

    if (arg.actorUserId === arg.targetUserId) {
      const ownerCount = await db
        .select({ userId: orgMembers.userId })
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, arg.orgId), eq(orgMembers.role, 'owner')))
      if (ownerCount.length <= 1)
        throw error(400, 'Cannot remove the last owner of an organization')
    }

    await db
      .delete(orgMembers)
      .where(and(eq(orgMembers.orgId, arg.orgId), eq(orgMembers.userId, arg.targetUserId)))
  }
)

export const setMemberRole = command(
  'unchecked',
  async (arg: {
    actorUserId: string
    orgId: string
    targetUserId: string
    role: 'owner' | 'member'
  }): Promise<void> => {
    await assertOrgOwner(arg.actorUserId, arg.orgId)

    if (arg.actorUserId === arg.targetUserId && arg.role === 'member') {
      const ownerCount = await db
        .select({ userId: orgMembers.userId })
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, arg.orgId), eq(orgMembers.role, 'owner')))
      if (ownerCount.length <= 1)
        throw error(400, 'Cannot demote the last owner of an organization')
    }

    const result = await db
      .update(orgMembers)
      .set({ role: arg.role })
      .where(and(eq(orgMembers.orgId, arg.orgId), eq(orgMembers.userId, arg.targetUserId)))
      .returning({ userId: orgMembers.userId })
    if (result.length === 0) throw error(404, 'Member not found in organization')
  }
)
