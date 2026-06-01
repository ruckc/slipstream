import { redirect, error, fail } from '@sveltejs/kit'
import type { PageServerLoad, Actions } from './$types'
import { getProject, deleteProject } from '$lib/remote/project.remote'
import { getProjectPermissions, setProjectPermissions } from '$lib/remote/permissions.remote'
import { resolvePermissions } from '$lib/server/permissions'
import type { Permission } from '$lib/server/permissions'
import { db, projects, users } from '$lib/server/db'
import { eq } from 'drizzle-orm'

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) throw redirect(302, '/auth/login')

  const project = await getProject(params.namespace, params.project)
  if (!project) throw error(404, 'Project not found')

  const permissions = await resolvePermissions(locals.user, project.id)
  if (!permissions.includes('project:manage')) throw error(403, 'Access denied')

  const grants = await getProjectPermissions(locals.user.id, project.id)

  return {
    project,
    namespace: project.namespace,
    grants,
    user: locals.user,
  }
}

export const actions: Actions = {
  updateProject: async ({ request, locals, params }) => {
    if (!locals.user) throw redirect(302, '/auth/login')

    const project = await getProject(params.namespace, params.project)
    if (!project) throw error(404)

    const perms = await resolvePermissions(locals.user, project.id)
    if (!perms.includes('project:manage')) throw error(403)

    const data = await request.formData()
    const displayName = String(data.get('displayName') ?? '').trim()
    const rawTimeout = String(data.get('idleTimeoutSeconds') ?? '').trim()
    const idleTimeoutSeconds = rawTimeout === '' ? null : parseInt(rawTimeout, 10)

    if (!displayName) return fail(400, { error: 'Display name is required' })
    if (idleTimeoutSeconds !== null && (isNaN(idleTimeoutSeconds) || idleTimeoutSeconds < 60)) {
      return fail(400, { error: 'Idle timeout must be at least 60 seconds' })
    }

    await db
      .update(projects)
      .set({ displayName, idleTimeoutSeconds, updatedAt: new Date() })
      .where(eq(projects.id, project.id))

    return { success: true }
  },

  setPermissions: async ({ request, locals, params }) => {
    if (!locals.user) throw redirect(302, '/auth/login')

    const project = await getProject(params.namespace, params.project)
    if (!project) throw error(404)

    const perms = await resolvePermissions(locals.user, project.id)
    if (!perms.includes('project:manage')) throw error(403)

    const data = await request.formData()

    // Parse grants: format is "grant[0][principalType]", "grant[0][principalId]", "grant[0][permissions][]"
    const rawGrants: Record<string, { principalType: string; principalId: string; permissions: string[] }> = {}

    for (const [key, value] of data.entries()) {
      const match = key.match(/^grant\[(\d+)]\[(\w+)]/)
      if (!match) continue
      const idx = match[1]
      const field = match[2]
      if (!rawGrants[idx]) rawGrants[idx] = { principalType: '', principalId: '', permissions: [] }
      if (field === 'principalType') rawGrants[idx].principalType = String(value)
      else if (field === 'principalId') rawGrants[idx].principalId = String(value)
      else if (field === 'permissions') rawGrants[idx].permissions.push(String(value))
    }

    const grants = Object.values(rawGrants)
      .filter((g) => g.principalType && g.principalId && g.permissions.length > 0)
      .map((g) => ({
        principalType: g.principalType as 'user' | 'org',
        principalId: g.principalId,
        permissions: g.permissions as Permission[],
      }))

    try {
      await setProjectPermissions(locals.user.id, project.id, grants)
      return { success: true }
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'status' in e) throw e
      return fail(500, { error: (e as Error).message })
    }
  },

  deleteProject: async ({ locals, params }) => {
    if (!locals.user) throw redirect(302, '/auth/login')

    const project = await getProject(params.namespace, params.project)
    if (!project) throw error(404)

    const perms = await resolvePermissions(locals.user, project.id)
    if (!perms.includes('project:manage')) throw error(403)

    await deleteProject(locals.user.id, project.id)

    throw redirect(303, `/${params.namespace}`)
  },

  addUserPermission: async ({ request, locals, params }) => {
    if (!locals.user) throw redirect(302, '/auth/login')

    const project = await getProject(params.namespace, params.project)
    if (!project) throw error(404)

    const perms = await resolvePermissions(locals.user, project.id)
    if (!perms.includes('project:manage')) throw error(403)

    const data = await request.formData()
    const email = String(data.get('email') ?? '').trim()
    const permissionsRaw = data.getAll('permissions').map(String) as Permission[]

    if (!email) return fail(400, { addUser: true, error: 'Email is required' })
    if (permissionsRaw.length === 0) return fail(400, { addUser: true, error: 'Select at least one permission' })

    // Look up user by email
    const userRows = await db.select().from(users).where(eq(users.email, email)).limit(1)
    if (userRows.length === 0) return fail(404, { addUser: true, error: 'No user found with that email' })

    const existing = await getProjectPermissions(locals.user.id, project.id)
    const others = existing.filter(
      (g) => !(g.principalType === 'user' && g.principalId === userRows[0].id),
    )

    await setProjectPermissions(locals.user.id, project.id, [
      ...others.reduce<Array<{ principalType: 'user' | 'org'; principalId: string; permissions: Permission[] }>>((acc, g) => {
        const found = acc.find((x) => x.principalType === g.principalType && x.principalId === g.principalId)
        if (found) found.permissions.push(g.permission as Permission)
        else acc.push({ principalType: g.principalType as 'user' | 'org', principalId: g.principalId, permissions: [g.permission as Permission] })
        return acc
      }, []),
      { principalType: 'user', principalId: userRows[0].id, permissions: permissionsRaw },
    ])

    return { addUser: true, success: true }
  },
}
