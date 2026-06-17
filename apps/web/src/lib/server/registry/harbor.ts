// ---------------------------------------------------------------------------
// Harbor read API (registry-browse UI)
// ---------------------------------------------------------------------------
// Provisioning (Harbor project + push/pull robots) and credential delivery are
// owned by the project-controller's reconcile loop (ensureHarborRegistry). This
// module is the web app's READ-ONLY view into Harbor — listing a namespace's
// repositories, artifacts, and storage usage for the registry pane — using the
// Harbor admin API. Isolation is enforced by Harbor: projects are private.

// Slugs are already validated at registration (lowercase, no reserved names),
// but guard again before interpolating into Harbor API paths.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/

function harborUrl(): string | null {
  const url = process.env.HARBOR_URL?.trim()
  return url ? url.replace(/\/+$/, '') : null
}

/** In-cluster host (host[:port]) used in image references injected into pods. */
export function registryHost(): string | null {
  return process.env.REGISTRY_HOST?.trim() || null
}

/** Public-facing hostname shown to users in push commands (falls back to REGISTRY_HOST). */
export function registryPublicHost(): string | null {
  return process.env.REGISTRY_HOSTNAME?.trim() || registryHost()
}

/** True when Harbor + registry host are configured. When false, registry
 * features are silently skipped so clusters without Harbor still work. */
export function isRegistryEnabled(): boolean {
  return harborUrl() !== null && registryHost() !== null
}

function adminAuthHeader(): string {
  const user = process.env.HARBOR_ADMIN_USERNAME ?? 'admin'
  const pass = process.env.HARBOR_ADMIN_PASSWORD ?? ''
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64')
}

async function harborFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = harborUrl()
  if (!base) throw new Error('HARBOR_URL is not configured')
  return fetch(`${base}/api/v2.0${path}`, {
    ...init,
    headers: {
      Authorization: adminAuthHeader(),
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
}

export interface HarborRepository {
  name: string // e.g. "alpha/myapp" (project/repo)
  repoName: string // just the repo portion, e.g. "myapp"
  artifactCount: number
  pullCount: number
  updateTime: string // ISO-8601
}

export interface HarborArtifact {
  digest: string // sha256:...
  tags: string[] // empty if untagged
  size: number // bytes
  pushTime: string // ISO-8601
}

export interface RegistryStorageUsage {
  storageBytes: number
  repoCount: number
  artifactCount: number
}

/** List repositories in the namespace's Harbor project. Returns [] if registry disabled or project has no repos. */
export async function listRepositories(slug: string): Promise<HarborRepository[]> {
  if (!isRegistryEnabled()) return []
  if (!SLUG_RE.test(slug)) throw new Error(`Invalid namespace slug: ${slug}`)

  const res = await harborFetch(`/projects/${encodeURIComponent(slug)}/repositories?page_size=100`)
  if (res.status === 404) return []
  if (!res.ok) throw new Error(`Harbor: list repositories failed (HTTP ${res.status})`)

  const body = (await res.json()) as Array<{
    name: string
    artifact_count: number
    pull_count: number
    update_time: string
  }>

  return body.map((r) => ({
    name: r.name,
    repoName: r.name.replace(`${slug}/`, ''),
    artifactCount: r.artifact_count ?? 0,
    pullCount: r.pull_count ?? 0,
    updateTime: r.update_time,
  }))
}

/** List artifacts in a repository. repoName is the short name (without project prefix). */
export async function listArtifacts(slug: string, repoName: string): Promise<HarborArtifact[]> {
  if (!isRegistryEnabled()) return []
  if (!SLUG_RE.test(slug)) throw new Error(`Invalid namespace slug: ${slug}`)

  // Harbor uses double-slash encoding for slashes in repo names in the URL
  const encodedRepo = encodeURIComponent(repoName).replace(/%2F/g, '%252F')
  const res = await harborFetch(
    `/projects/${encodeURIComponent(slug)}/repositories/${encodedRepo}/artifacts?page_size=20&with_tag=true&with_scan_overview=false&with_label=false`
  )
  if (res.status === 404) return []
  if (!res.ok) throw new Error(`Harbor: list artifacts failed (HTTP ${res.status})`)

  const body = (await res.json()) as Array<{
    digest: string
    size: number
    push_time: string
    tags: Array<{ name: string }> | null
  }>

  return body.map((a) => ({
    digest: a.digest,
    size: a.size ?? 0,
    pushTime: a.push_time,
    tags: a.tags?.map((t) => t.name) ?? [],
  }))
}

/** Get aggregate storage usage for a namespace's Harbor project. Returns null if registry disabled. */
export async function getStorageUsage(slug: string): Promise<RegistryStorageUsage | null> {
  if (!isRegistryEnabled()) return null
  if (!SLUG_RE.test(slug)) throw new Error(`Invalid namespace slug: ${slug}`)

  const res = await harborFetch(`/projects/${encodeURIComponent(slug)}/summary`)
  if (res.status === 404) return { storageBytes: 0, repoCount: 0, artifactCount: 0 }
  if (!res.ok) throw new Error(`Harbor: get project summary failed (HTTP ${res.status})`)

  const body = (await res.json()) as {
    repo_count: number
    chart_count?: number
    quota?: { used?: { storage?: number } }
  }

  return {
    storageBytes: body.quota?.used?.storage ?? 0,
    repoCount: body.repo_count ?? 0,
    artifactCount: 0,
  }
}
