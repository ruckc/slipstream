import { db, namespaceRegistry } from '$lib/server/db'
import { eq } from 'drizzle-orm'

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

/** Public host (host[:port]) used in image references, e.g. registry.example.com. */
export function registryHost(): string | null {
  return process.env.REGISTRY_HOST?.trim() || null
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

/**
 * Ensure the namespace's Harbor project + robot exist and return credentials
 * suitable for a pod's registry auth. Reuses the stored robot on repeat calls.
 * Returns null if the registry is not configured for this cluster.
 */
export async function provisionNamespaceRegistry(
  namespaceId: string,
  slug: string
): Promise<RegistryAuth | null> {
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
    return { server: host, username: row.robotName, password: row.robotSecret }
  }

  await ensureProject(slug)
  const robot = await createRobot(slug)

  await db
    .insert(namespaceRegistry)
    .values({
      namespaceId,
      harborProject: slug,
      robotName: robot.name,
      robotSecret: robot.secret,
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

  return { server: host, username: row.robotName, password: row.robotSecret }
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
