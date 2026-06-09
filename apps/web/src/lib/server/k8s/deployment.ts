import { getCoreV1Api, getAppsV1Api, isApiError } from './client'
import type { V1Container } from '@kubernetes/client-node'

const WEB_NAMESPACE = process.env.WEB_NAMESPACE ?? 'slipstream-system'
const JWKS_URL = `http://slipstream-web.${WEB_NAMESPACE}.svc.cluster.local/api/jwks`

export function buildDeploymentName(projectId: string): string {
  return `agent-${projectId}`.slice(0, 63)
}

function buildContainers(projectId: string, idleTimeoutSeconds: number): V1Container[] {
  const agentImage = process.env.AGENT_IMAGE
  if (!agentImage) throw new Error('AGENT_IMAGE environment variable is required')
  const appUrl = process.env.APP_URL ?? ''

  const containers: V1Container[] = [
    {
      name: 'agent',
      image: agentImage,
      imagePullPolicy: 'Always',
      ports: [{ containerPort: 8080 }],
      env: [
        { name: 'JWKS_URL', value: JWKS_URL },
        { name: 'PROJECT_ID', value: projectId },
        { name: 'IDLE_TIMEOUT_SECONDS', value: String(idleTimeoutSeconds) },
        { name: 'WORKSPACE_PATH', value: '/workspace' },
        { name: 'CORS_ORIGIN', value: appUrl },
      ],
      volumeMounts: [
        { name: 'workspace', mountPath: '/workspace' },
        { name: 'tmp', mountPath: '/tmp' },
        { name: 'home', mountPath: '/home/agent' },
      ],
      readinessProbe: {
        httpGet: { path: '/health', port: 8080 },
        initialDelaySeconds: 2,
        periodSeconds: 5,
      },
      securityContext: {
        allowPrivilegeEscalation: false,
        readOnlyRootFilesystem: true,
        capabilities: { drop: ['ALL'] },
      },
    },
  ]

  const metricsSidecarImage = process.env.METRICS_SIDECAR_IMAGE
  const metricsPushUrl = process.env.METRICS_PUSH_URL
  if (metricsSidecarImage) {
    containers.push({
      name: 'metrics-sidecar',
      image: metricsSidecarImage,
      env: [
        { name: 'PROJECT_ID', value: projectId },
        { name: 'PUSH_URL', value: metricsPushUrl ?? '' },
      ],
      securityContext: {
        allowPrivilegeEscalation: false,
        capabilities: { drop: ['ALL'] },
      },
    })
  }

  return containers
}

/**
 * Creates the project's Deployment if missing, or replaces its container spec
 * (image, env, security context) if it already exists — so image/config
 * changes take effect on every project start. Existing replica count and
 * resourceVersion are preserved on replace.
 */
export async function ensureDeployment(
  k8sNamespace: string,
  projectId: string,
  projectSlug: string,
  pvcName: string,
  idleTimeoutSeconds: number
): Promise<void> {
  const api = getAppsV1Api()
  const name = buildDeploymentName(projectId)
  const containers = buildContainers(projectId, idleTimeoutSeconds)

  const desiredSpec = {
    replicas: 0,
    selector: {
      matchLabels: {
        'slipstream.io/project': projectId,
      },
    },
    template: {
      metadata: {
        labels: {
          'slipstream.io/project': projectId,
          app: `agent-${projectId}`,
        },
      },
      spec: {
        hostname: projectSlug,
        automountServiceAccountToken: false,
        securityContext: {
          runAsNonRoot: true,
          runAsUser: 1000,
          fsGroup: 1000,
        },
        containers,
        volumes: [
          {
            name: 'workspace',
            persistentVolumeClaim: { claimName: pvcName },
          },
          { name: 'tmp', emptyDir: {} },
          { name: 'home', emptyDir: {} },
        ],
      },
    },
  }

  try {
    await api.createNamespacedDeployment({
      namespace: k8sNamespace,
      body: {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: {
          name,
          namespace: k8sNamespace,
          labels: {
            'slipstream.io/project': projectId,
            app: `agent-${projectId}`,
          },
        },
        spec: desiredSpec,
      },
    })
  } catch (e) {
    if (!isApiError(e, 409)) throw e

    const current = await api.readNamespacedDeployment({ name, namespace: k8sNamespace })
    await api.replaceNamespacedDeployment({
      name,
      namespace: k8sNamespace,
      body: {
        ...current,
        spec: {
          ...desiredSpec,
          // Preserve the existing replica count — only the container template changes here.
          replicas: current.spec?.replicas ?? 0,
        },
      },
    })
  }
}

export async function scaleDeployment(
  k8sNamespace: string,
  projectId: string,
  replicas: number
): Promise<void> {
  const api = getAppsV1Api()
  const name = buildDeploymentName(projectId)
  // replaceNamespacedDeploymentScale uses PUT (application/json), which Kubernetes
  // accepts for scale subresource. patchNamespacedDeployment would send
  // application/json for a PATCH which Kubernetes rejects.
  await api.replaceNamespacedDeploymentScale({
    name,
    namespace: k8sNamespace,
    body: {
      apiVersion: 'autoscaling/v1',
      kind: 'Scale',
      metadata: { name, namespace: k8sNamespace },
      spec: { replicas },
    },
  })
}

export async function deleteDeployment(k8sNamespace: string, projectId: string): Promise<void> {
  const api = getAppsV1Api()
  const name = buildDeploymentName(projectId)
  await api.deleteNamespacedDeployment({ name, namespace: k8sNamespace })
}

export async function getPodIP(k8sNamespace: string, projectId: string): Promise<string | null> {
  const api = getCoreV1Api()
  const pods = await api.listNamespacedPod({
    namespace: k8sNamespace,
    labelSelector: `slipstream.io/project=${projectId}`,
  })
  const pod = pods.items.find((p) => p.status?.phase === 'Running')
  return pod?.status?.podIP ?? null
}

export type ProjectPodStatus = 'stopped' | 'starting' | 'running'

function depToStatus(dep: {
  spec?: { replicas?: number }
  status?: { readyReplicas?: number }
}): ProjectPodStatus {
  if ((dep.spec?.replicas ?? 0) === 0) return 'stopped'
  if ((dep.status?.readyReplicas ?? 0) > 0) return 'running'
  return 'starting'
}

/** Returns the live pod status for a single project derived from its Deployment. */
export async function getDeploymentStatus(
  k8sNamespace: string,
  projectId: string
): Promise<ProjectPodStatus> {
  const api = getAppsV1Api()
  const name = buildDeploymentName(projectId)
  try {
    const dep = await api.readNamespacedDeployment({ name, namespace: k8sNamespace })
    return depToStatus(dep)
  } catch {
    return 'stopped'
  }
}

/**
 * Bulk status check across all project deployments in a single API call.
 * Returns a map of projectId → status; projects absent from k8s default to 'stopped'.
 */
export async function listDeploymentStatuses(): Promise<Map<string, ProjectPodStatus>> {
  const api = getAppsV1Api()
  try {
    const deps = await api.listDeploymentForAllNamespaces({
      labelSelector: 'slipstream.io/project',
    })
    const map = new Map<string, ProjectPodStatus>()
    for (const dep of deps.items) {
      const projectId = dep.metadata?.labels?.['slipstream.io/project']
      if (projectId) map.set(projectId, depToStatus(dep))
    }
    return map
  } catch {
    return new Map()
  }
}
