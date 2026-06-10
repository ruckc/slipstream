import { getCustomObjectsApi, getKubeConfig, isApiError } from './client'
import type { ResolvedEgressPolicy } from '$lib/server/k8s/egress'

const GROUP = 'slipstream.io'
const VERSION = 'v1alpha1'
const PLURAL = 'projectenvironments'

export type ProjectEnvironmentPhase =
  | 'Pending'
  | 'Provisioning'
  | 'Running'
  | 'Stopping'
  | 'Stopped'
  | 'Error'

export interface EgressPolicySpec {
  enabled: boolean
  rules: Array<{
    domain: string
    ports: number[]
    ruleType: 'allow' | 'deny'
  }>
}

export interface ProjectEnvironmentSpec {
  projectId: string
  namespaceId: string
  namespaceSlug: string
  projectSlug: string
  desiredState: 'running' | 'stopped'
  idleTimeoutSeconds: number
  retainStorage: boolean
  egressPolicy: EgressPolicySpec
}

export interface ProjectEnvironmentStatus {
  phase?: ProjectEnvironmentPhase
  podIP?: string
  observedGeneration?: number
}

export interface ProjectEnvironment {
  apiVersion: string
  kind: string
  metadata: {
    name: string
    resourceVersion?: string
  }
  spec: ProjectEnvironmentSpec
  status?: ProjectEnvironmentStatus
}

function crName(projectId: string): string {
  return `project-${projectId}`
}

export async function createProjectEnvironment(spec: ProjectEnvironmentSpec): Promise<void> {
  const api = getCustomObjectsApi()
  await api.createClusterCustomObject({
    group: GROUP,
    version: VERSION,
    plural: PLURAL,
    body: {
      apiVersion: `${GROUP}/${VERSION}`,
      kind: 'ProjectEnvironment',
      metadata: { name: crName(spec.projectId) },
      spec,
    },
  })
}

export async function getProjectEnvironment(projectId: string): Promise<ProjectEnvironment | null> {
  const api = getCustomObjectsApi()
  try {
    const result = await api.getClusterCustomObject({
      group: GROUP,
      version: VERSION,
      plural: PLURAL,
      name: crName(projectId),
    })
    return result as ProjectEnvironment
  } catch (e) {
    if (isApiError(e, 404)) return null
    throw e
  }
}

export async function patchProjectEnvironmentSpec(
  projectId: string,
  patch: Partial<ProjectEnvironmentSpec>
): Promise<void> {
  const kc = getKubeConfig()
  const cluster = kc.getCurrentCluster()!
  const url = `${cluster.server}/apis/${GROUP}/${VERSION}/${PLURAL}/${crName(projectId)}`
  const opts = await kc.applyToFetchOptions({ headers: {} })
  const res = await fetch(url, {
    ...opts,
    method: 'PATCH',
    headers: {
      ...(opts.headers as Record<string, string>),
      'Content-Type': 'application/merge-patch+json',
    },
    body: JSON.stringify({ spec: patch }),
  })
  if (!res.ok) {
    throw new Error(`PATCH ${url} failed: ${res.status} ${await res.text()}`)
  }
}

export async function deleteProjectEnvironment(projectId: string): Promise<void> {
  const api = getCustomObjectsApi()
  try {
    await api.deleteClusterCustomObject({
      group: GROUP,
      version: VERSION,
      plural: PLURAL,
      name: crName(projectId),
    })
  } catch (e) {
    if (!isApiError(e, 404)) throw e
  }
}

export function phaseToProjectStatus(
  phase: ProjectEnvironmentPhase | undefined
): 'stopped' | 'starting' | 'running' {
  switch (phase) {
    case 'Running':
      return 'running'
    case 'Provisioning':
      return 'starting'
    default:
      return 'stopped'
  }
}

export async function listProjectEnvironments(): Promise<ProjectEnvironment[]> {
  const api = getCustomObjectsApi()
  const result = await api.listClusterCustomObject({
    group: GROUP,
    version: VERSION,
    plural: PLURAL,
  })
  const list = result as { items?: ProjectEnvironment[] }
  return list.items ?? []
}

export async function patchEgressPolicy(
  projectId: string,
  egressPolicy: EgressPolicySpec
): Promise<void> {
  await patchProjectEnvironmentSpec(projectId, { egressPolicy })
}

export function resolvedEgressToSpec(policy: ResolvedEgressPolicy): EgressPolicySpec {
  if (!policy.enabled) return { enabled: false, rules: [] }
  const rules: EgressPolicySpec['rules'] = [
    ...policy.allowRules.map((r) => ({
      domain: r.domain,
      ports: r.ports,
      ruleType: 'allow' as const,
    })),
    ...policy.denyRules.map((r) => ({
      domain: r.domain,
      ports: [80, 443],
      ruleType: 'deny' as const,
    })),
  ]
  return { enabled: true, rules }
}
