import { json, error, redirect } from '@sveltejs/kit'
import { db, projects } from '$lib/server/db'
import { eq } from 'drizzle-orm'
import { resolvePermissions } from '$lib/server/permissions'

export const GET = async ({ params, locals }) => {
  if (!locals.user) throw redirect(302, '/auth/login')

  const { projectId } = params
  const rows = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1)
  if (rows.length === 0) throw error(404, 'Project not found')

  const perms = await resolvePermissions(locals.user, projectId)
  if (perms.length === 0) throw error(403, 'Access denied')

  return json({ status: rows[0].status })
}
