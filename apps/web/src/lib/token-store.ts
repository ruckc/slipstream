/**
 * Client-side token store for pod JWT access tokens.
 *
 * Tokens are fetched from /api/token (POST) and cached in memory.
 * Concurrent refresh requests for the same project are deduplicated via
 * an inflight promise so only one network call is made.
 */

interface CacheEntry {
  token: string
  expiresAt: number // ms since epoch
  inflight?: Promise<string>
}

// Refresh 30 seconds before actual expiry
const REFRESH_BUFFER_MS = 30_000

class ProjectTokenStore {
  private cache = new Map<string, CacheEntry>()

  async get(projectId: string): Promise<string> {
    const entry = this.cache.get(projectId)
    const now = Date.now()

    // Return the existing inflight promise to deduplicate concurrent refreshes
    if (entry?.inflight) return entry.inflight

    // Return cached token if it has enough lifetime remaining
    if (entry && entry.expiresAt - now > REFRESH_BUFFER_MS) return entry.token

    // Start a new refresh and store the inflight promise
    const inflight = this.refresh(projectId)
    this.cache.set(projectId, { ...(entry ?? { token: '', expiresAt: 0 }), inflight })
    return inflight
  }

  private async refresh(projectId: string): Promise<string> {
    try {
      const res = await fetch('/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ projectId }),
      })
      if (!res.ok) throw new Error(`Token refresh failed: ${res.status} ${res.statusText}`)
      const data = (await res.json()) as { token: string; expiresAt?: number; expiresIn?: number }
      const expiresAt =
        data.expiresAt ??
        (data.expiresIn != null ? Date.now() + data.expiresIn * 1000 : Date.now() + 3600_000)
      this.cache.set(projectId, { token: data.token, expiresAt })
      return data.token
    } catch (err) {
      // Clear inflight on failure so the next call retries
      const entry = this.cache.get(projectId)
      if (entry) {
        this.cache.set(projectId, { token: entry.token, expiresAt: entry.expiresAt })
      }
      throw err
    }
  }

  /** Force-invalidate the cached token for a project (e.g. on 401). */
  invalidate(projectId: string): void {
    this.cache.delete(projectId)
  }

  /** Invalidate all cached tokens (e.g. on sign-out). */
  invalidateAll(): void {
    this.cache.clear()
  }
}

export const tokenStore = new ProjectTokenStore()
