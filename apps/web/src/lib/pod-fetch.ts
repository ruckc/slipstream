/**
 * Utilities for making authenticated requests to pod sidecar HTTP endpoints.
 *
 * Pod sidecars are accessed via the SvelteKit backend proxy at:
 *   /api/pod/[namespaceSlug]/[projectSlug]/[...path]
 *
 * The proxy attaches the JWT from the session cookie server-side,
 * so client-side code just calls these helpers with relative paths.
 *
 * WebSocket connections go through a separate ws-proxy route.
 */

function podProxyBase(namespaceSlug: string, projectSlug: string): string {
  return `/env/${encodeURIComponent(namespaceSlug)}/${encodeURIComponent(projectSlug)}`
}

/**
 * Build a canonical pod path without constructing a full URL.
 * Useful for constructing paths before passing to podFetch/podWsUrl.
 */
export function podPath(namespaceSlug: string, projectSlug: string, path: string): string {
  const base = podProxyBase(namespaceSlug, projectSlug)
  return path.startsWith('/') ? base + path : `${base}/${path}`
}

/**
 * Fetch a resource from the pod sidecar.
 *
 * @param projectId      - The project UUID (used for token lookup if needed)
 * @param namespaceSlug  - Namespace slug
 * @param projectSlug    - Project slug
 * @param podPath        - Path on the pod, e.g. '/fs?path=/'
 * @param init           - Optional fetch init options
 */
export async function podFetch(
  _projectId: string,
  namespaceSlug: string,
  projectSlug: string,
  podPath: string,
  init?: RequestInit,
): Promise<Response> {
  const base = podProxyBase(namespaceSlug, projectSlug)
  const url = base + (podPath.startsWith('/') ? podPath : '/' + podPath)
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...init,
  })
  return response
}

/**
 * Build a WebSocket URL for a pod endpoint.
 *
 * @param namespaceSlug  - Namespace slug
 * @param projectSlug    - Project slug
 * @param podPath        - Path on the pod, e.g. '/sessions/abc/attach'
 */
export function podWsUrl(
  namespaceSlug: string,
  projectSlug: string,
  podPath: string,
): string {
  const proto = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = typeof window !== 'undefined' ? window.location.host : 'localhost'
  const base = podProxyBase(namespaceSlug, projectSlug)
  const path = base + (podPath.startsWith('/') ? podPath : '/' + podPath)
  return `${proto}//${host}${path}`
}
