import { query, form, command, getRequestEvent } from '$app/server'
import { redirect, error, invalid } from '@sveltejs/kit'
import { db, projects, users } from '$lib/server/db'
import { eq } from 'drizzle-orm'
import { getProject, deleteProject as deleteProjectFn } from '$lib/remote/project.remote'
import { getProjectPermissions, setProjectPermissions } from '$lib/remote/permissions.remote'
import { resolvePermissions } from '$lib/server/permissions'
import type { Permission } from '$lib/server/permissions'

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

    const project = await getProject(arg.namespace, arg.project)
    if (!project) error(404, 'Project not found')

    const permissions = await resolvePermissions(locals.user, project.id)
    if (!permissions.includes('project:manage')) error(403, 'Access denied')

    const grants = await getProjectPermissions(locals.user.id, project.id)

    return { project, namespace: project.namespace, grants }
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

    const project = await getProject(data.namespaceSlug, data.projectSlug)
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

    const project = await getProject(data.namespaceSlug, data.projectSlug)
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

    const existing = await getProjectPermissions(locals.user.id, project.id)
    const others = existing.filter(
      (g) => !(g.principalType === 'user' && g.principalId === userRows[0].id)
    )

    await setProjectPermissions(locals.user.id, project.id, [
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
    ])

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

    const project = await getProject(arg.namespaceSlug, arg.projectSlug)
    if (!project) error(404)

    const perms = await resolvePermissions(locals.user, project.id)
    if (!perms.includes('project:manage')) error(403)

    const existing = await getProjectPermissions(locals.user.id, project.id)
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

    await setProjectPermissions(locals.user.id, project.id, filtered)
  }
)

export const deleteProject = command(
  'unchecked',
  async (arg: { namespaceSlug: string; projectSlug: string }) => {
    const { locals } = getRequestEvent()
    if (!locals.user) redirect(302, '/auth/login')

    const project = await getProject(arg.namespaceSlug, arg.projectSlug)
    if (!project) error(404)

    const perms = await resolvePermissions(locals.user, project.id)
    if (!perms.includes('project:manage')) error(403)

    await deleteProjectFn(locals.user.id, project.id)

    return { redirectTo: `/${arg.namespaceSlug}` }
  }
)
