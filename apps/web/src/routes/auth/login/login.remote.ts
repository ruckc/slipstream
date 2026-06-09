import { query, getRequestEvent } from '$app/server'
import { getActiveProviders, PROVIDER_LABELS } from '$lib/server/auth/providers'

export const getLoginData = query('unchecked', async (_: Record<string, never>) => {
  const { url } = getRequestEvent()
  return {
    providers: getActiveProviders(),
    providerLabels: PROVIDER_LABELS,
    devMode: process.env.DEV_MODE === 'true',
    error: url.searchParams.get('error'),
  }
})
