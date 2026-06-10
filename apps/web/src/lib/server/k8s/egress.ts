import { db, namespaces, projects, egressRules } from '$lib/server/db'
import { eq, and } from 'drizzle-orm'

export interface ResolvedEgressPolicy {
  enabled: boolean
  allowRules: Array<{ domain: string; ports: number[] }>
  denyRules: Array<{ domain: string }>
}

export async function resolveEgressPolicy(
  namespaceId: string,
  projectId: string
): Promise<ResolvedEgressPolicy> {
  const [nsRows, projectRows, nsAllowRules, nsDenyRules, projectAllowRules] = await Promise.all([
    db.select().from(namespaces).where(eq(namespaces.id, namespaceId)).limit(1),
    db.select().from(projects).where(eq(projects.id, projectId)).limit(1),
    db
      .select()
      .from(egressRules)
      .where(
        and(
          eq(egressRules.ownerType, 'namespace'),
          eq(egressRules.ownerId, namespaceId),
          eq(egressRules.ruleType, 'allow')
        )
      ),
    db
      .select()
      .from(egressRules)
      .where(
        and(
          eq(egressRules.ownerType, 'namespace'),
          eq(egressRules.ownerId, namespaceId),
          eq(egressRules.ruleType, 'deny')
        )
      ),
    db
      .select()
      .from(egressRules)
      .where(
        and(
          eq(egressRules.ownerType, 'project'),
          eq(egressRules.ownerId, projectId),
          eq(egressRules.ruleType, 'allow')
        )
      ),
  ])

  if (nsRows.length === 0 || projectRows.length === 0) {
    return { enabled: false, allowRules: [], denyRules: [] }
  }

  const ns = nsRows[0]
  const project = projectRows[0]
  const enabled = project.egressFilterEnabled || ns.egressFilterEnabled

  if (!enabled) return { enabled: false, allowRules: [], denyRules: [] }

  const allowRules =
    ns.egressListMode === 'force'
      ? nsAllowRules.map((r) => ({ domain: r.domain, ports: r.ports as number[] }))
      : [
          ...nsAllowRules.map((r) => ({ domain: r.domain, ports: r.ports as number[] })),
          ...projectAllowRules.map((r) => ({ domain: r.domain, ports: r.ports as number[] })),
        ]

  const denyRules = nsDenyRules.map((r) => ({ domain: r.domain }))

  return { enabled: true, allowRules, denyRules }
}
