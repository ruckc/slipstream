import { query, getRequestEvent } from '$app/server'
import { error } from '@sveltejs/kit'
import { db, projects, namespaces } from '$lib/server/db'
import { eq, and } from 'drizzle-orm'
import { resolvePermissions } from '$lib/server/permissions'
import {
  isRegistryEnabled,
  registryHost,
  listRepositories,
  listArtifacts,
  type HarborRepository,
  type HarborArtifact,
} from '$lib/server/registry/harbor'

export interface RegistryArtifact {
  digest: string
  tags: string[]
  size: number
  pushTime: string
}

export interface RegistryRepo {
  repoName: string
  shortName: string
  pullCount: number
  artifacts: RegistryArtifact[]
  totalSize: number
  lastPush: string | null
}

export interface NamespaceRegistryData {
  enabled: boolean
  registryHost: string | null
  namespace: string
  project: string
  repos: RegistryRepo[]
  pushExample: string
}

export const getNamespaceRegistry = query(
  'unchecked',
  async (arg: { namespace: string; project: string }): Promise<NamespaceRegistryData> => {
    const { locals } = getRequestEvent()
    if (!locals.user) error(401, 'Unauthorized')

    const rows = await db
      .select({ project: projects, namespace: namespaces })
      .from(projects)
      .innerJoin(namespaces, eq(projects.namespaceId, namespaces.id))
      .where(and(eq(namespaces.slug, arg.namespace), eq(projects.slug, arg.project)))
      .limit(1)

    if (rows.length === 0) error(404, 'Project not found')
    const { project, namespace } = rows[0]

    const permissions = await resolvePermissions(locals.user, project.id)
    if (permissions.length === 0) error(403, 'Access denied')

    const host = registryHost()
    const pushExample = host
      ? `buildah bud -t ${host}/${namespace.slug}/${project.slug}/<repo>:<tag> .\nbuildah push ${host}/${namespace.slug}/${project.slug}/<repo>:<tag>`
      : ''

    if (!isRegistryEnabled()) {
      return {
        enabled: false,
        registryHost: null,
        namespace: namespace.slug,
        project: project.slug,
        repos: [],
        pushExample,
      }
    }

    const prefix = `${project.slug}/`
    const allRepos: HarborRepository[] = await listRepositories(namespace.slug)
    const projectRepos = allRepos.filter((r) => r.repoName.startsWith(prefix))

    const reposWithArtifacts: RegistryRepo[] = await Promise.all(
      projectRepos.map(async (repo) => {
        const artifacts: HarborArtifact[] = await listArtifacts(namespace.slug, repo.repoName)
        const totalSize = artifacts.reduce((sum, a) => sum + a.size, 0)
        const lastPush =
          artifacts.length > 0
            ? artifacts.reduce((latest, a) => (a.pushTime > latest.pushTime ? a : latest)).pushTime
            : null
        return {
          repoName: repo.repoName,
          shortName: repo.repoName.slice(prefix.length),
          pullCount: repo.pullCount,
          artifacts: artifacts.map((a) => ({
            digest: a.digest,
            tags: a.tags,
            size: a.size,
            pushTime: a.pushTime,
          })),
          totalSize,
          lastPush,
        }
      })
    )

    return {
      enabled: true,
      registryHost: host,
      namespace: namespace.slug,
      project: project.slug,
      repos: reposWithArtifacts,
      pushExample,
    }
  }
)
