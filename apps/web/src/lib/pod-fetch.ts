import { tokenStore } from './token-store'

function podProxyBase(namespaceSlug: string, projectSlug: string): string {
  return `/env/${encodeURIComponent(namespaceSlug)}/${encodeURIComponent(projectSlug)}`
}

export function podPath(namespaceSlug: string, projectSlug: string, path: string): string {
  const base = podProxyBase(namespaceSlug, projectSlug)
  return path.startsWith('/') ? base + path : `${base}/${path}`
}

export async function podFetch(
  projectId: string,
  namespaceSlug: string,
  projectSlug: string,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const base = podProxyBase(namespaceSlug, projectSlug)
  const url = base + (path.startsWith('/') ? path : '/' + path)
  const token = await tokenStore.get(projectId)
  const response = await fetch(url, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${token}`,
    },
  })
  if (response.status === 401) {
    tokenStore.invalidate(projectId)
  }
  return response
}

// WebSocket auth is handled by the caller sending an auth message after
// connect (see TerminalPane.svelte), so no token is embedded in the URL.
export function podWsUrl(namespaceSlug: string, projectSlug: string, path: string): string {
  const proto =
    typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = typeof window !== 'undefined' ? window.location.host : 'localhost'
  const base = podProxyBase(namespaceSlug, projectSlug)
  const fullPath = base + (path.startsWith('/') ? path : '/' + path)
  return `${proto}//${host}${fullPath}`
}
