import { json } from '@sveltejs/kit'
import { getJwks } from '$lib/server/jwt/keys'

export const GET = async () =>
  json(await getJwks(), {
    headers: { 'Cache-Control': 'public, max-age=300' },
  })
