import { json, error } from '@sveltejs/kit'
import { issueToken } from '$lib/remote/jwt.remote'

export const POST = async ({ request, locals }) => {
  if (!locals.user) throw error(401, 'Unauthorized')

  const body = await request.json()
  const { projectId } = body

  if (!projectId || typeof projectId !== 'string') {
    throw error(400, 'projectId required')
  }

  const result = await issueToken({ userId: locals.user.id, projectId })
  return json(result)
}
