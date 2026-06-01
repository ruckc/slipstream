import { redirect } from '@sveltejs/kit'
import { listUserProjects } from '$lib/remote/namespace.remote'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) throw redirect(302, '/auth/login')

  const projects = await listUserProjects(locals.user.id)

  return {
    projects,
    user: locals.user,
  }
}
