import { query, form, getRequestEvent } from '$app/server'
import { redirect, invalid } from '@sveltejs/kit'
import { createProject } from '$lib/remote/project.remote'
import { createOrganization } from '$lib/remote/organization.remote'
import { getUserNamespace } from '$lib/remote/namespace.remote'
import { db, organizations, orgMembers, namespaces } from '$lib/server/db'
import { eq } from 'drizzle-orm'

export const getNewPageData = query(async () => {
  const { locals } = getRequestEvent()
  if (!locals.user) redirect(302, '/auth/login')

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

  return { user: locals.user, userNamespace, orgNamespaces }
})

export const createProjectForm = form(
  'unchecked',
  async (
    data: { namespaceId: string; slug: string; displayName: string; storageSizeGb: string },
    issue
  ) => {
    const { locals } = getRequestEvent()
    if (!locals.user) redirect(302, '/auth/login')

    const namespaceId = String(data.namespaceId ?? '').trim()
    const slug = String(data.slug ?? '').trim()
    const displayName = String(data.displayName ?? '').trim()
    const storageSizeGb = parseInt(String(data.storageSizeGb ?? '10'), 10) || 10

    if (!namespaceId) invalid(issue.namespaceId('Namespace is required'))
    if (!slug) invalid(issue.slug('Project slug is required'))
    if (!/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(slug) && !/^[a-z0-9]$/.test(slug)) {
      invalid(issue.slug('Slug must be lowercase letters, numbers, and hyphens only'))
    }
    if (!displayName) invalid(issue.displayName('Display name is required'))
    if (storageSizeGb < 1 || storageSizeGb > 500) {
      invalid(issue.storageSizeGb('Storage size must be between 1 and 500 GB'))
    }

    try {
      await createProject({
        actorUserId: locals.user.id,
        namespaceId,
        slug,
        displayName,
        storageSizeGb,
      })
      const ns = await db
        .select({ slug: namespaces.slug })
        .from(namespaces)
        .where(eq(namespaces.id, namespaceId))
        .limit(1)
      const nsSlug = ns[0]?.slug ?? namespaceId
      redirect(303, `/${nsSlug}/${slug}`)
    } catch (e) {
      if (e && typeof e === 'object' && 'status' in e) throw e
      invalid(issue.slug(e instanceof Error ? e.message : 'Failed to create project'))
    }
  }
)

export const createOrgForm = form(
  'unchecked',
  async (data: { slug: string; displayName: string }, issue) => {
    const { locals } = getRequestEvent()
    if (!locals.user) redirect(302, '/auth/login')

    const slug = String(data.slug ?? '').trim()
    const displayName = String(data.displayName ?? '').trim()

    if (!slug) invalid(issue.slug('Slug is required'))
    if (!/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(slug) && !/^[a-z0-9]$/.test(slug)) {
      invalid(issue.slug('Slug must be lowercase letters, numbers, and hyphens only'))
    }
    if (!displayName) invalid(issue.displayName('Display name is required'))

    try {
      await createOrganization({ actorUserId: locals.user.id, slug, displayName })
      redirect(303, `/${slug}`)
    } catch (e) {
      if (e && typeof e === 'object' && 'status' in e) throw e
      invalid(issue.slug(e instanceof Error ? e.message : 'Failed to create organization'))
    }
  }
)
