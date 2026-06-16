import { db, namespaceRegistry } from '$lib/server/db'
import { eq, isNull } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// Harbor integration
// ---------------------------------------------------------------------------
// Each Slipstream namespace maps to one private Harbor project (named after the
// slug) and a single project-scoped robot account with push+pull. The robot
// credentials are provisioned once, persisted in the namespace_registry table,
// and reused for every project in the namespace. Pods receive them as a
// dockerconfigjson Secret (materialized by the project-controller from the CR
// spec) so `buildah push`/`pull` works without an interactive login.
//
// Harbor only returns a robot's secret at creation time, which is why we store
// it. Isolation is enforced by Harbor itself: projects are private and a robot
// can only access the single project it was scoped to.

export interface RegistryAuth {
  server: string // REGISTRY_HOST (host[:port]) used in image references
  username: string // full Harbor robot login, e.g. robot$alpha+slipstream
  password: string
}

// Slugs are already validated at registration (lowercase, no reserved names),
// but guard again before interpolating into Harbor API paths / project names.
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

/** Create a private Harbor project named after the slug. Idempotent. */
async function ensureProject(slug: string): Promise<void> {
  const res = await harborFetch('/projects', {
    method: 'POST',
    body: JSON.stringify({
      project_name: slug,
      metadata: { public: 'false' },
    }),
  })
  // 201 created, 409 already exists — both fine.
  if (!res.ok && res.status !== 409) {
    throw new Error(`Harbor: create project '${slug}' failed (HTTP ${res.status})`)
  }
}

/** Create a project-scoped robot with push+pull. Returns its login + secret. */
async function createRobot(slug: string): Promise<{ name: string; secret: string }> {
  const res = await harborFetch('/robots', {
    method: 'POST',
    body: JSON.stringify({
      name: `slipstream-${slug}`,
      description: 'Slipstream namespace push/pull robot',
      duration: -1, // never expires
      level: 'project',
      permissions: [
        {
          kind: 'project',
          namespace: slug,
          access: [
            { resource: 'repository', action: 'push' },
            { resource: 'repository', action: 'pull' },
          ],
        },
      ],
    }),
  })
  if (!res.ok) {
    throw new Error(`Harbor: create robot for '${slug}' failed (HTTP ${res.status})`)
  }
  const body = (await res.json()) as { name: string; secret: string }
  if (!body.name || !body.secret) {
    throw new Error(`Harbor: robot response for '${slug}' missing name/secret`)
  }
  return { name: body.name, secret: body.secret }
}

/** Create a project-scoped pull-only robot. Returns its login + secret. */
async function createPullOnlyRobot(slug: string): Promise<{ name: string; secret: string }> {
  const res = await harborFetch('/robots', {
    method: 'POST',
    body: JSON.stringify({
      name: `slipstream-${slug}-pull`,
      description: 'Slipstream namespace pull-only robot (workspace pods)',
      duration: -1,
      level: 'project',
      permissions: [
        {
          kind: 'project',
          namespace: slug,
          access: [{ resource: 'repository', action: 'pull' }],
        },
      ],
    }),
  })
  if (!res.ok) {
    throw new Error(`Harbor: create pull robot for '${slug}' failed (HTTP ${res.status})`)
  }
  const body = (await res.json()) as { name: string; secret: string }
  if (!body.name || !body.secret) {
    throw new Error(`Harbor: pull robot response for '${slug}' missing name/secret`)
  }
  return { name: body.name, secret: body.secret }
}

export interface NamespaceRegistryAuth {
  pushPull: RegistryAuth
  pullOnly: RegistryAuth
}

/**
 * Ensure the namespace's Harbor project + both robots exist and return credentials.
 * Creates push+pull and pull-only robots atomically on first call; reuses on repeat.
 * Backfills pull-only robot for existing rows that have none.
 * Returns null if the registry is not configured for this cluster.
 */
export async function provisionNamespaceRegistry(
  namespaceId: string,
  slug: string
): Promise<NamespaceRegistryAuth | null> {
  if (!isRegistryEnabled()) return null
  if (!SLUG_RE.test(slug)) throw new Error(`Invalid namespace slug: ${slug}`)

  const host = registryHost()!

  const existing = await db
    .select()
    .from(namespaceRegistry)
    .where(eq(namespaceRegistry.namespaceId, namespaceId))
    .limit(1)

  if (existing.length > 0) {
    const row = existing[0]

    // Backfill pull-only robot if missing (existing namespaces pre-dating this feature).
    if (!row.pullRobotName || !row.pullRobotSecret) {
      const pullRobot = await createPullOnlyRobot(slug)
      await db
        .update(namespaceRegistry)
        .set({ pullRobotName: pullRobot.name, pullRobotSecret: pullRobot.secret })
        .where(
          eq(namespaceRegistry.namespaceId, namespaceId) && isNull(namespaceRegistry.pullRobotName)
        )
      const refreshed = (
        await db
          .select()
          .from(namespaceRegistry)
          .where(eq(namespaceRegistry.namespaceId, namespaceId))
          .limit(1)
      )[0]
      return {
        pushPull: { server: host, username: refreshed.robotName, password: refreshed.robotSecret },
        pullOnly: {
          server: host,
          username: refreshed.pullRobotName!,
          password: refreshed.pullRobotSecret!,
        },
      }
    }

    return {
      pushPull: { server: host, username: row.robotName, password: row.robotSecret },
      pullOnly: { server: host, username: row.pullRobotName, password: row.pullRobotSecret },
    }
  }

  await ensureProject(slug)
  const [robot, pullRobot] = await Promise.all([createRobot(slug), createPullOnlyRobot(slug)])

  await db
    .insert(namespaceRegistry)
    .values({
      namespaceId,
      harborProject: slug,
      robotName: robot.name,
      robotSecret: robot.secret,
      pullRobotName: pullRobot.name,
      pullRobotSecret: pullRobot.secret,
    })
    .onConflictDoNothing()

  // Re-read in case of a concurrent insert winning the race.
  const row = (
    await db
      .select()
      .from(namespaceRegistry)
      .where(eq(namespaceRegistry.namespaceId, namespaceId))
      .limit(1)
  )[0]

  return {
    pushPull: { server: host, username: row.robotName, password: row.robotSecret },
    pullOnly: {
      server: host,
      username: row.pullRobotName!,
      password: row.pullRobotSecret!,
    },
  }
}

// ---------------------------------------------------------------------------
// Harbor read API — listing repositories, artifacts, and storage usage
// ---------------------------------------------------------------------------

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

/** Build the dockerconfigjson payload (as a string) for a RegistryAuth. */
export function buildDockerConfigJson(auth: RegistryAuth): string {
  const token = Buffer.from(`${auth.username}:${auth.password}`).toString('base64')
  return JSON.stringify({
    auths: {
      [auth.server]: {
        username: auth.username,
        password: auth.password,
        auth: token,
      },
    },
  })
}
