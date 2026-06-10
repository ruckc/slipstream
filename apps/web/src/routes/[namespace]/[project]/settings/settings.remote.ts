import { query, form, command, getRequestEvent } from '$app/server'
import { redirect, error, invalid } from '@sveltejs/kit'
import { db, projects, namespaces, users, egressRules } from '$lib/server/db'
import { eq, and } from 'drizzle-orm'
import { getProject, deleteProject as deleteProjectCmd } from '$lib/remote/project.remote'
import { getProjectPermissions, setProjectPermissions } from '$lib/remote/permissions.remote'
import { resolvePermissions } from '$lib/server/permissions'
import type { Permission } from '$lib/server/permissions'
import { resolveEgressPolicy } from '$lib/server/k8s/egress'
import { patchEgressPolicy, resolvedEgressToSpec } from '$lib/server/k8s/cr'

async function syncEgressPolicy(projectId: string, namespaceId: string): Promise<void> {
  const policy = await resolveEgressPolicy(namespaceId, projectId)
  await patchEgressPolicy(projectId, resolvedEgressToSpec(policy))
}

const DOMAIN_RE = /^(\*\*\.|\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i

function validateDomain(domain: string): boolean {
  return DOMAIN_RE.test(domain)
}

const VALID_PERMISSIONS = new Set<Permission>([
  'files:read',
  'files:write',
  'shell',
  'project:manage',
])

export const getProjectSettings = query(
  'unchecked',
  async (arg: { namespace: string; project: string }) => {
    const { locals } = getRequestEvent()
    if (!locals.user) redirect(302, '/auth/login')

    const project = await getProject({ namespaceSlug: arg.namespace, projectSlug: arg.project })
    if (!project) error(404, 'Project not found')

    const permissions = await resolvePermissions(locals.user, project.id)
    if (!permissions.includes('project:manage')) error(403, 'Access denied')

    const [grants, projectEgressAllowRules, nsRows] = await Promise.all([
      getProjectPermissions({ actorUserId: locals.user.id, projectId: project.id }),
      db
        .select()
        .from(egressRules)
        .where(and(eq(egressRules.ownerType, 'project'), eq(egressRules.ownerId, project.id))),
      db.select().from(namespaces).where(eq(namespaces.id, project.namespaceId)).limit(1),
    ])

    const ns = nsRows[0]

    return {
      project,
      namespace: project.namespace,
      grants,
      projectEgressAllowRules,
      namespaceEgressFilterEnabled: ns?.egressFilterEnabled ?? false,
      namespaceEgressListMode: ns?.egressListMode ?? 'merge',
    }
  }
)

export const updateProject = form(
  'unchecked',
  async (
    data: {
      namespaceSlug: string
      projectSlug: string
      displayName: string
      idleTimeoutSeconds: string
    },
    issue
  ) => {
    const { locals } = getRequestEvent()
    if (!locals.user) redirect(302, '/auth/login')

    const project = await getProject({
      namespaceSlug: data.namespaceSlug,
      projectSlug: data.projectSlug,
    })
    if (!project) error(404)

    const perms = await resolvePermissions(locals.user, project.id)
    if (!perms.includes('project:manage')) error(403)

    const displayName = String(data.displayName ?? '').trim()
    const rawTimeout = String(data.idleTimeoutSeconds ?? '').trim()
    const idleTimeoutSeconds = rawTimeout === '' ? null : parseInt(rawTimeout, 10)

    if (!displayName) invalid(issue.displayName('Display name is required'))
    if (idleTimeoutSeconds !== null && (isNaN(idleTimeoutSeconds) || idleTimeoutSeconds < 60)) {
      invalid(issue.idleTimeoutSeconds('Idle timeout must be at least 60 seconds'))
    }

    await db
      .update(projects)
      .set({ displayName, idleTimeoutSeconds, updatedAt: new Date() })
      .where(eq(projects.id, project.id))

    return { success: true as const }
  }
)

export const addUserPermission = form(
  'unchecked',
  async (
    data: {
      namespaceSlug: string
      projectSlug: string
      email: string
      permissions: string | string[]
    },
    issue
  ) => {
    const { locals } = getRequestEvent()
    if (!locals.user) redirect(302, '/auth/login')

    const project = await getProject({
      namespaceSlug: data.namespaceSlug,
      projectSlug: data.projectSlug,
    })
    if (!project) error(404)

    const perms = await resolvePermissions(locals.user, project.id)
    if (!perms.includes('project:manage')) error(403)

    const email = String(data.email ?? '').trim()
    if (!email) invalid(issue.email('Email is required'))

    const rawPerms = Array.isArray(data.permissions)
      ? data.permissions
      : data.permissions
        ? [String(data.permissions)]
        : []

    const permissionsRaw = rawPerms
      .map(String)
      .filter((p) => VALID_PERMISSIONS.has(p as Permission)) as Permission[]

    if (permissionsRaw.length === 0) invalid(issue.email('Select at least one permission'))

    const userRows = await db.select().from(users).where(eq(users.email, email)).limit(1)
    if (userRows.length === 0) error(404, 'No user found with that email')

    const existing = await getProjectPermissions({
      actorUserId: locals.user.id,
      projectId: project.id,
    })
    const others = existing.filter(
      (g) => !(g.principalType === 'user' && g.principalId === userRows[0].id)
    )

    await setProjectPermissions({
      actorUserId: locals.user.id,
      projectId: project.id,
      grants: [
        ...others.reduce<
          Array<{ principalType: 'user' | 'org'; principalId: string; permissions: Permission[] }>
        >((acc, g) => {
          const found = acc.find(
            (x) => x.principalType === g.principalType && x.principalId === g.principalId
          )
          if (found) found.permissions.push(g.permission as Permission)
          else
            acc.push({
              principalType: g.principalType as 'user' | 'org',
              principalId: g.principalId,
              permissions: [g.permission as Permission],
            })
          return acc
        }, []),
        { principalType: 'user', principalId: userRows[0].id, permissions: permissionsRaw },
      ],
    })

    return { success: true as const }
  }
)

export const removePermission = command(
  'unchecked',
  async (arg: {
    namespaceSlug: string
    projectSlug: string
    principalType: 'user' | 'org'
    principalId: string
  }) => {
    const { locals } = getRequestEvent()
    if (!locals.user) redirect(302, '/auth/login')

    const project = await getProject({
      namespaceSlug: arg.namespaceSlug,
      projectSlug: arg.projectSlug,
    })
    if (!project) error(404)

    const perms = await resolvePermissions(locals.user, project.id)
    if (!perms.includes('project:manage')) error(403)

    const existing = await getProjectPermissions({
      actorUserId: locals.user.id,
      projectId: project.id,
    })
    const filtered = existing
      .filter((g) => !(g.principalType === arg.principalType && g.principalId === arg.principalId))
      .reduce<
        Array<{ principalType: 'user' | 'org'; principalId: string; permissions: Permission[] }>
      >((acc, g) => {
        const found = acc.find(
          (x) => x.principalType === g.principalType && x.principalId === g.principalId
        )
        if (found) found.permissions.push(g.permission as Permission)
        else
          acc.push({
            principalType: g.principalType as 'user' | 'org',
            principalId: g.principalId,
            permissions: [g.permission as Permission],
          })
        return acc
      }, [])

    await setProjectPermissions({
      actorUserId: locals.user.id,
      projectId: project.id,
      grants: filtered,
    })
  }
)

export const deleteProject = command(
  'unchecked',
  async (arg: { namespaceSlug: string; projectSlug: string }) => {
    const { locals } = getRequestEvent()
    if (!locals.user) redirect(302, '/auth/login')

    const project = await getProject({
      namespaceSlug: arg.namespaceSlug,
      projectSlug: arg.projectSlug,
    })
    if (!project) error(404)

    const perms = await resolvePermissions(locals.user, project.id)
    if (!perms.includes('project:manage')) error(403)

    await deleteProjectCmd({ actorUserId: locals.user.id, projectId: project.id })

    return { redirectTo: `/${arg.namespaceSlug}` }
  }
)

export const updateProjectEgressFilterEnabled = command(
  'unchecked',
  async (arg: { namespaceSlug: string; projectSlug: string; enabled: boolean | null }) => {
    const { locals } = getRequestEvent()
    if (!locals.user) redirect(302, '/auth/login')

    const project = await getProject({
      namespaceSlug: arg.namespaceSlug,
      projectSlug: arg.projectSlug,
    })
    if (!project) error(404)

    const perms = await resolvePermissions(locals.user, project.id)
    if (!perms.includes('project:manage')) error(403)

    await db
      .update(projects)
      .set({ egressFilterEnabled: arg.enabled, updatedAt: new Date() })
      .where(eq(projects.id, project.id))
    await syncEgressPolicy(project.id, project.namespaceId)
  }
)

export const addProjectEgressRule = command(
  'unchecked',
  async (arg: { namespaceSlug: string; projectSlug: string; domain: string; ports: number[] }) => {
    const { locals } = getRequestEvent()
    if (!locals.user) redirect(302, '/auth/login')

    const project = await getProject({
      namespaceSlug: arg.namespaceSlug,
      projectSlug: arg.projectSlug,
    })
    if (!project) error(404)

    const perms = await resolvePermissions(locals.user, project.id)
    if (!perms.includes('project:manage')) error(403)

    // Check namespace is not in force mode — project rules are ignored in force mode
    // but we still allow managing them so they're ready if the mode changes.
    if (!validateDomain(arg.domain)) error(400, 'Invalid domain pattern')
    if (arg.ports.length === 0) error(400, 'At least one port is required')

    const [rule] = await db
      .insert(egressRules)
      .values({
        ownerType: 'project',
        ownerId: project.id,
        ruleType: 'allow',
        domain: arg.domain.toLowerCase(),
        ports: arg.ports,
      })
      .returning()

    await syncEgressPolicy(project.id, project.namespaceId)
    return rule
  }
)

export const removeProjectEgressRule = command(
  'unchecked',
  async (arg: { namespaceSlug: string; projectSlug: string; ruleId: string }) => {
    const { locals } = getRequestEvent()
    if (!locals.user) redirect(302, '/auth/login')

    const project = await getProject({
      namespaceSlug: arg.namespaceSlug,
      projectSlug: arg.projectSlug,
    })
    if (!project) error(404)

    const perms = await resolvePermissions(locals.user, project.id)
    if (!perms.includes('project:manage')) error(403)

    await db
      .delete(egressRules)
      .where(and(eq(egressRules.id, arg.ruleId), eq(egressRules.ownerId, project.id)))
    await syncEgressPolicy(project.id, project.namespaceId)
  }
)

export const updateProjectEgressRulePorts = command(
  'unchecked',
  async (arg: { namespaceSlug: string; projectSlug: string; ruleId: string; ports: number[] }) => {
    const { locals } = getRequestEvent()
    if (!locals.user) redirect(302, '/auth/login')

    const project = await getProject({
      namespaceSlug: arg.namespaceSlug,
      projectSlug: arg.projectSlug,
    })
    if (!project) error(404)

    const perms = await resolvePermissions(locals.user, project.id)
    if (!perms.includes('project:manage')) error(403)

    if (arg.ports.length === 0) error(400, 'At least one port is required')

    await db
      .update(egressRules)
      .set({ ports: arg.ports })
      .where(and(eq(egressRules.id, arg.ruleId), eq(egressRules.ownerId, project.id)))

    await syncEgressPolicy(project.id, project.namespaceId)
  }
)
