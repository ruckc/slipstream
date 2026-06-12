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

export function podWsUrl(
  namespaceSlug: string,
  projectSlug: string,
  path: string,
  token: string
): string {
  const proto =
    typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = typeof window !== 'undefined' ? window.location.host : 'localhost'
  const base = podProxyBase(namespaceSlug, projectSlug)
  const fullPath = base + (path.startsWith('/') ? path : '/' + path)
  const sep = fullPath.includes('?') ? '&' : '?'
  return `${proto}//${host}${fullPath}${sep}token=${encodeURIComponent(token)}`
}
