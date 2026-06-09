import { getCustomObjectsApi, getCoreV1Api, isApiError } from './client'
import { db, namespaces, projects, egressRules } from '$lib/server/db'
import { eq, and, or } from 'drizzle-orm'
import { INTERNAL_EGRESS_RULES } from './policy'

const CILIUM_GROUP = 'cilium.io'
const CILIUM_VERSION = 'v2'
const CILIUM_PLURAL = 'ciliumnetworkpolicies'

const WEB_NAMESPACE = process.env.WEB_NAMESPACE ?? 'slipstream-system'

function ciliumPolicyName(projectId: string): string {
  return `egress-${projectId}`
}

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
      ? nsAllowRules.map((r) => ({ domain: r.domain, ports: r.ports }))
      : [
          ...nsAllowRules.map((r) => ({ domain: r.domain, ports: r.ports })),
          ...projectAllowRules.map((r) => ({ domain: r.domain, ports: r.ports })),
        ]

  const denyRules = nsDenyRules.map((r) => ({ domain: r.domain }))

  return { enabled: true, allowRules, denyRules }
}

/** Expands a user-facing domain pattern into Cilium toFQDNs entries. */
function expandDomain(domain: string): Array<{ matchName?: string; matchPattern?: string }> {
  if (domain.startsWith('**.')) {
    const base = domain.slice(3) // e.g. "github.com"
    return [{ matchName: base }, { matchPattern: `*.${base}` }, { matchPattern: `*.*.${base}` }]
  }
  if (domain.startsWith('*.')) {
    return [{ matchPattern: domain }]
  }
  return [{ matchName: domain }]
}

/** Groups allow rules by their port set so each unique port set becomes one Cilium egress rule. */
function groupAllowRulesByPorts(
  allowRules: Array<{ domain: string; ports: number[] }>
): Map<string, { ports: number[]; fqdns: Array<{ matchName?: string; matchPattern?: string }> }> {
  const groups = new Map<
    string,
    { ports: number[]; fqdns: Array<{ matchName?: string; matchPattern?: string }> }
  >()
  for (const rule of allowRules) {
    const key = [...rule.ports].sort((a, b) => a - b).join(',')
    if (!groups.has(key)) {
      groups.set(key, { ports: rule.ports, fqdns: [] })
    }
    groups.get(key)!.fqdns.push(...expandDomain(rule.domain))
  }
  return groups
}

function buildCiliumBody(k8sNamespace: string, projectId: string, policy: ResolvedEgressPolicy) {
  const egressAllows = []

  // Internal services — must be explicitly allowed because CNP default-deny applies.
  egressAllows.push({
    toEndpoints: [
      {
        matchLabels: {
          'k8s:io.kubernetes.pod.namespace': WEB_NAMESPACE,
          'k8s:app.kubernetes.io/component': INTERNAL_EGRESS_RULES.jwksComponent,
        },
      },
    ],
    toPorts: [{ ports: [{ port: String(INTERNAL_EGRESS_RULES.jwksPort), protocol: 'TCP' }] }],
  })

  if (process.env.METRICS_PUSH_URL) {
    egressAllows.push({
      toEndpoints: [
        {
          matchLabels: {
            'k8s:io.kubernetes.pod.namespace': INTERNAL_EGRESS_RULES.metricsNamespace,
            [`k8s:app`]: INTERNAL_EGRESS_RULES.metricsApp,
          },
        },
      ],
      toPorts: [{ ports: [{ port: String(INTERNAL_EGRESS_RULES.metricsPort), protocol: 'TCP' }] }],
    })
  }

  egressAllows.push({
    toEndpoints: [
      {
        matchLabels: {
          'k8s:io.kubernetes.pod.namespace': INTERNAL_EGRESS_RULES.dnsNamespace,
          'k8s:k8s-app': INTERNAL_EGRESS_RULES.dnsApp,
        },
      },
    ],
    toPorts: [{ ports: [{ port: String(INTERNAL_EGRESS_RULES.dnsPort), protocol: 'UDP' }] }],
  })

  // FQDN allow rules grouped by port set.
  const groups = groupAllowRulesByPorts(policy.allowRules)
  for (const { ports, fqdns } of groups.values()) {
    egressAllows.push({
      toFQDNs: fqdns,
      toPorts: [
        {
          ports: ports.map((p) => ({ port: String(p), protocol: 'TCP' })),
        },
      ],
    })
  }

  // FQDN deny rules (namespace-level, always win).
  const egressDenies =
    policy.denyRules.length > 0
      ? [{ toFQDNs: policy.denyRules.flatMap((r) => expandDomain(r.domain)) }]
      : []

  return {
    apiVersion: `${CILIUM_GROUP}/${CILIUM_VERSION}`,
    kind: 'CiliumNetworkPolicy',
    metadata: {
      name: ciliumPolicyName(projectId),
      namespace: k8sNamespace,
      labels: { 'slipstream.io/project': projectId },
    },
    spec: {
      endpointSelector: {
        matchLabels: { 'slipstream.io/project': projectId },
      },
      egress: egressAllows,
      ...(egressDenies.length > 0 ? { egressDeny: egressDenies } : {}),
    },
  }
}

export async function ensureCiliumEgressPolicy(
  k8sNamespace: string,
  projectId: string,
  policy: ResolvedEgressPolicy
): Promise<void> {
  if (!policy.enabled) return

  const api = getCustomObjectsApi()
  const name = ciliumPolicyName(projectId)
  const body = buildCiliumBody(k8sNamespace, projectId, policy)

  try {
    await api.createNamespacedCustomObject({
      group: CILIUM_GROUP,
      version: CILIUM_VERSION,
      namespace: k8sNamespace,
      plural: CILIUM_PLURAL,
      body,
    })
  } catch (e) {
    if (!isApiError(e, 409)) throw e
    const current = (await api.getNamespacedCustomObject({
      group: CILIUM_GROUP,
      version: CILIUM_VERSION,
      namespace: k8sNamespace,
      plural: CILIUM_PLURAL,
      name,
    })) as { metadata?: { resourceVersion?: string } }
    await api.replaceNamespacedCustomObject({
      group: CILIUM_GROUP,
      version: CILIUM_VERSION,
      namespace: k8sNamespace,
      plural: CILIUM_PLURAL,
      name,
      body: {
        ...body,
        metadata: {
          ...body.metadata,
          resourceVersion: current.metadata?.resourceVersion,
        },
      },
    })
  }
}

export async function deleteCiliumEgressPolicy(
  k8sNamespace: string,
  projectId: string
): Promise<void> {
  const api = getCustomObjectsApi()
  try {
    await api.deleteNamespacedCustomObject({
      group: CILIUM_GROUP,
      version: CILIUM_VERSION,
      namespace: k8sNamespace,
      plural: CILIUM_PLURAL,
      name: ciliumPolicyName(projectId),
    })
  } catch (e) {
    if (!isApiError(e, 404)) throw e
  }
}

/**
 * Finds all running pods for a namespace (by slug label) and patches their
 * CiliumNetworkPolicy to reflect the current egress settings. Called when
 * namespace or project egress settings change.
 */
export async function patchRunningPodsForNamespace(namespaceId: string): Promise<void> {
  const coreApi = getCoreV1Api()

  const nsRows = await db.select().from(namespaces).where(eq(namespaces.id, namespaceId)).limit(1)
  if (nsRows.length === 0) return
  const ns = nsRows[0]

  const pods = await coreApi.listPodForAllNamespaces({
    labelSelector: `slipstream.io/namespace=${ns.slug}`,
  })

  const projectIds = [
    ...new Set(
      pods.items
        .map((p) => p.metadata?.labels?.['slipstream.io/project'])
        .filter((id): id is string => Boolean(id))
    ),
  ]

  const projectRows = await db
    .select()
    .from(projects)
    .where(
      projectIds.length > 0
        ? or(...projectIds.map((id) => eq(projects.id, id)))
        : eq(projects.id, '00000000-0000-0000-0000-000000000000') // no-op if empty
    )

  await Promise.all(
    projectRows.map(async (project) => {
      const pod = pods.items.find(
        (p) => p.metadata?.labels?.['slipstream.io/project'] === project.id
      )
      if (!pod?.metadata?.namespace) return

      const policy = await resolveEgressPolicy(namespaceId, project.id)
      const k8sNs = pod.metadata.namespace

      if (policy.enabled) {
        await ensureCiliumEgressPolicy(k8sNs, project.id, policy)
      } else {
        await deleteCiliumEgressPolicy(k8sNs, project.id)
      }
    })
  )
}

/**
 * Patches the CiliumNetworkPolicy for a single running project pod.
 * Called when project-level egress settings change.
 */
export async function patchRunningPodForProject(
  projectId: string,
  namespaceId: string
): Promise<void> {
  const coreApi = getCoreV1Api()

  const pods = await coreApi.listPodForAllNamespaces({
    labelSelector: `slipstream.io/project=${projectId}`,
  })

  const pod = pods.items.find((p) => p.status?.phase === 'Running')
  if (!pod?.metadata?.namespace) return

  const policy = await resolveEgressPolicy(namespaceId, projectId)
  const k8sNs = pod.metadata.namespace

  if (policy.enabled) {
    await ensureCiliumEgressPolicy(k8sNs, projectId, policy)
  } else {
    await deleteCiliumEgressPolicy(k8sNs, projectId)
  }
}
