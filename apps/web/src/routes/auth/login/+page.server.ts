import { getActiveProviders, PROVIDER_LABELS } from '$lib/server/auth/providers'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ url }) => ({
  providers: getActiveProviders(),
  providerLabels: PROVIDER_LABELS,
  devMode: process.env.DEV_MODE === 'true',
  error: url.searchParams.get('error'),
})
