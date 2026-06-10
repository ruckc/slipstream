import { query, form, command, getRequestEvent } from '$app/server'
import { redirect, error, invalid } from '@sveltejs/kit'
import { db, namespaces, organizations, orgMembers, users, egressRules } from '$lib/server/db'
import { eq, and } from 'drizzle-orm'
import {
  listOrgMembers,
  inviteMember as orgInviteMember,
  removeMember as orgRemoveMember,
  setMemberRole as orgSetMemberRole,
} from '$lib/remote/organization.remote'
import { resolveEgressPolicy } from '$lib/server/k8s/egress'
import {
  patchEgressPolicy,
  resolvedEgressToSpec,
  listProjectEnvironments,
} from '$lib/server/k8s/cr'
import * as v from 'valibot'

async function syncEgressPolicyForNamespace(namespaceId: string): Promise<void> {
  const crs = await listProjectEnvironments()
  const namespaceCrs = crs.filter((cr) => cr.spec.namespaceId === namespaceId)
  await Promise.allSettled(
    namespaceCrs.map(async (cr) => {
      const policy = await resolveEgressPolicy(namespaceId, cr.spec.projectId)
      await patchEgressPolicy(cr.spec.projectId, resolvedEgressToSpec(policy))
    })
  )
}

const DOMAIN_RE = /^(\*\*\.|\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i

function validateDomain(domain: string): boolean {
  return DOMAIN_RE.test(domain)
}

async function assertNamespaceOwner(userId: string, namespaceSlug: string) {
  const nsRows = await db
    .select()
    .from(namespaces)
    .where(eq(namespaces.slug, namespaceSlug))
    .limit(1)
  if (nsRows.length === 0) error(404, 'Namespace not found')
  const ns = nsRows[0]

  if (ns.type === 'user') {
    const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1)
    if (userRows.length === 0 || userRows[0].namespaceId !== ns.id) error(403, 'Access denied')
    return ns
  }

  const orgRows = await db
    .select({ member: orgMembers })
    .from(organizations)
    .innerJoin(
      orgMembers,
      and(eq(orgMembers.orgId, organizations.id), eq(orgMembers.userId, userId))
    )
    .where(eq(organizations.namespaceId, ns.id))
    .limit(1)

  if (orgRows.length === 0 || orgRows[0].member.role !== 'owner') error(403, 'Access denied')
  return ns
}

export const getNamespaceSettings = query(v.string(), async (namespaceSlug: string) => {
  const { locals } = getRequestEvent()
  if (!locals.user) redirect(302, '/auth/login')

  const nsRows = await db
    .select()
    .from(namespaces)
    .where(eq(namespaces.slug, namespaceSlug))
    .limit(1)

  if (nsRows.length === 0) error(404, 'Namespace not found')

  const namespace = nsRows[0]

  const [nsEgressAllowRules, nsEgressDenyRules] = await Promise.all([
    db
      .select()
      .from(egressRules)
      .where(
        and(
          eq(egressRules.ownerType, 'namespace'),
          eq(egressRules.ownerId, namespace.id),
          eq(egressRules.ruleType, 'allow')
        )
      ),
    db
      .select()
      .from(egressRules)
      .where(
        and(
          eq(egressRules.ownerType, 'namespace'),
          eq(egressRules.ownerId, namespace.id),
          eq(egressRules.ruleType, 'deny')
        )
      ),
  ])

  if (namespace.type === 'user') {
    if (namespace.id !== locals.user.namespaceId) error(403, 'Access denied')
    return {
      namespace,
      type: 'user' as const,
      org: null as null,
      members: null as null,
      isOwner: true,
      user: locals.user,
      egressAllowRules: nsEgressAllowRules,
      egressDenyRules: nsEgressDenyRules,
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
    egressAllowRules: nsEgressAllowRules,
    egressDenyRules: nsEgressDenyRules,
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
  v.object({
    namespaceSlug: v.string(),
    userId: v.string(),
    role: v.union([v.literal('owner'), v.literal('member')]),
  }),
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
  v.object({ namespaceSlug: v.string(), userId: v.string() }),
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

export const updateEgressFilterEnabled = command(
  v.object({ namespaceSlug: v.string(), enabled: v.boolean() }),
  async (arg: { namespaceSlug: string; enabled: boolean }) => {
    const { locals } = getRequestEvent()
    if (!locals.user) redirect(302, '/auth/login')
    const ns = await assertNamespaceOwner(locals.user.id, arg.namespaceSlug)
    await db
      .update(namespaces)
      .set({ egressFilterEnabled: arg.enabled })
      .where(eq(namespaces.id, ns.id))
    await syncEgressPolicyForNamespace(ns.id)
  }
)

export const updateEgressListMode = command(
  v.object({
    namespaceSlug: v.string(),
    mode: v.union([v.literal('force'), v.literal('merge')]),
  }),
  async (arg: { namespaceSlug: string; mode: 'force' | 'merge' }) => {
    const { locals } = getRequestEvent()
    if (!locals.user) redirect(302, '/auth/login')
    const ns = await assertNamespaceOwner(locals.user.id, arg.namespaceSlug)
    await db.update(namespaces).set({ egressListMode: arg.mode }).where(eq(namespaces.id, ns.id))
    await syncEgressPolicyForNamespace(ns.id)
  }
)

export const addNamespaceEgressRule = command(
  v.object({
    namespaceSlug: v.string(),
    ruleType: v.union([v.literal('allow'), v.literal('deny')]),
    domain: v.string(),
    ports: v.array(v.number()),
  }),
  async (arg: {
    namespaceSlug: string
    ruleType: 'allow' | 'deny'
    domain: string
    ports: number[]
  }) => {
    const { locals } = getRequestEvent()
    if (!locals.user) redirect(302, '/auth/login')
    const ns = await assertNamespaceOwner(locals.user.id, arg.namespaceSlug)

    if (!validateDomain(arg.domain)) error(400, 'Invalid domain pattern')
    if (arg.ruleType === 'deny' && arg.ports.length > 0)
      error(400, 'Deny rules cannot specify ports')
    if (arg.ruleType === 'allow' && arg.ports.length === 0)
      error(400, 'Allow rules require at least one port')

    const [rule] = await db
      .insert(egressRules)
      .values({
        ownerType: 'namespace',
        ownerId: ns.id,
        ruleType: arg.ruleType,
        domain: arg.domain.toLowerCase(),
        ports: arg.ports,
      })
      .returning()

    await syncEgressPolicyForNamespace(ns.id)
    return rule
  }
)

export const removeNamespaceEgressRule = command(
  v.object({ namespaceSlug: v.string(), ruleId: v.string() }),
  async (arg: { namespaceSlug: string; ruleId: string }) => {
    const { locals } = getRequestEvent()
    if (!locals.user) redirect(302, '/auth/login')
    const ns = await assertNamespaceOwner(locals.user.id, arg.namespaceSlug)

    await db
      .delete(egressRules)
      .where(and(eq(egressRules.id, arg.ruleId), eq(egressRules.ownerId, ns.id)))
    await syncEgressPolicyForNamespace(ns.id)
  }
)

export const updateNamespaceEgressRulePorts = command(
  v.object({ namespaceSlug: v.string(), ruleId: v.string(), ports: v.array(v.number()) }),
  async (arg: { namespaceSlug: string; ruleId: string; ports: number[] }) => {
    const { locals } = getRequestEvent()
    if (!locals.user) redirect(302, '/auth/login')
    const ns = await assertNamespaceOwner(locals.user.id, arg.namespaceSlug)

    if (arg.ports.length === 0) error(400, 'Allow rules require at least one port')

    await db
      .update(egressRules)
      .set({ ports: arg.ports })
      .where(
        and(
          eq(egressRules.id, arg.ruleId),
          eq(egressRules.ownerId, ns.id),
          eq(egressRules.ruleType, 'allow')
        )
      )

    await syncEgressPolicyForNamespace(ns.id)
  }
)
