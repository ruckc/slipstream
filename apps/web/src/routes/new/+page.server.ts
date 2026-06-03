import { redirect, fail } from '@sveltejs/kit'
import type { PageServerLoad, Actions } from './$types'
import { createProject } from '$lib/remote/project.remote'
import { createOrganization } from '$lib/remote/organization.remote'
import { getUserNamespace } from '$lib/remote/namespace.remote'
import { db, organizations, orgMembers, namespaces } from '$lib/server/db'
import { eq } from 'drizzle-orm'

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) throw redirect(302, '/auth/login')

  // Load user namespace + all org namespaces the user owns
  const userNamespace = await getUserNamespace(locals.user.id)

  const orgRows = await db
    .select({ org: organizations, ns: namespaces })
    .from(orgMembers)
    .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
    .innerJoin(namespaces, eq(namespaces.id, organizations.namespaceId))
    .where(eq(orgMembers.userId, locals.user.id))

  const orgNamespaces = orgRows
    .filter((r) => r.org !== null)
    .map((r) => ({ id: r.ns.id, slug: r.ns.slug, displayName: r.org.displayName }))

  return {
    user: locals.user,
    userNamespace,
    orgNamespaces,
  }
}

export const actions: Actions = {
  createProject: async ({ request, locals }) => {
    if (!locals.user) throw redirect(302, '/auth/login')

    const data = await request.formData()
    const namespaceId = String(data.get('namespaceId') ?? '').trim()
    const slug = String(data.get('slug') ?? '').trim()
    const displayName = String(data.get('displayName') ?? '').trim()

    if (!namespaceId) return fail(400, { createProject: true, error: 'Namespace is required' })
    if (!slug) return fail(400, { createProject: true, error: 'Project slug is required' })
    if (!/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(slug) && !/^[a-z0-9]$/.test(slug)) {
      return fail(400, {
        createProject: true,
        error: 'Slug must be lowercase letters, numbers, and hyphens only',
      })
    }
    if (!displayName) return fail(400, { createProject: true, error: 'Display name is required' })

    try {
      await createProject({ actorUserId: locals.user.id, namespaceId, slug, displayName })

      // Look up namespace slug for redirect
      const ns = await db
        .select({ slug: namespaces.slug })
        .from(namespaces)
        .where(eq(namespaces.id, namespaceId))
        .limit(1)

      const nsSlug = ns[0]?.slug ?? namespaceId
      throw redirect(303, `/${nsSlug}/${slug}`)
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'status' in e) throw e // re-throw redirect/error
      const msg = e instanceof Error ? e.message : 'Failed to create project'
      return fail(500, { createProject: true, error: msg })
    }
  },

  createOrg: async ({ request, locals }) => {
    if (!locals.user) throw redirect(302, '/auth/login')

    const data = await request.formData()
    const slug = String(data.get('slug') ?? '').trim()
    const displayName = String(data.get('displayName') ?? '').trim()

    if (!slug) return fail(400, { createOrg: true, error: 'Slug is required' })
    if (!/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(slug) && !/^[a-z0-9]$/.test(slug)) {
      return fail(400, {
        createOrg: true,
        error: 'Slug must be lowercase letters, numbers, and hyphens only',
      })
    }
    if (!displayName) return fail(400, { createOrg: true, error: 'Display name is required' })

    try {
      await createOrganization({ actorUserId: locals.user.id, slug, displayName })
      throw redirect(303, `/${slug}`)
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'status' in e) throw e
      const msg = e instanceof Error ? e.message : 'Failed to create organization'
      return fail(500, { createOrg: true, error: msg })
    }
  },
}
