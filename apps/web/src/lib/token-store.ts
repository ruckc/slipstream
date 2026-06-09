import { issueToken } from '$lib/remote/jwt.remote'

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
      const data = (await issueToken({ projectId })) as { token: string; expiresAt: number }
      this.cache.set(projectId, { token: data.token, expiresAt: data.expiresAt })
      return data.token
    } catch (err) {
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
