import { getCoreV1Api, getAppsV1Api } from './client'
import type { V1Container } from '@kubernetes/client-node'

const WEB_NAMESPACE = process.env.GATEWAY_NAMESPACE ?? 'slipstream-system'
const SLIPSTREAM_WEB_URL = `http://slipstream-web.${WEB_NAMESPACE}.svc.cluster.local`
const JWKS_URL = `${SLIPSTREAM_WEB_URL}/api/jwks`


export function buildDeploymentName(projectId: string): string {
  return `agent-${projectId}`.slice(0, 63)
}

export async function createDeployment(
  k8sNamespace: string,
  projectId: string,
  pvcName: string,
  idleTimeoutSeconds: number
): Promise<void> {
  const api = getAppsV1Api()
  const agentImage = process.env.AGENT_IMAGE
  if (!agentImage) throw new Error('AGENT_IMAGE environment variable is required')

  const name = buildDeploymentName(projectId)
  const appUrl = process.env.APP_URL ?? ''

  const containers: V1Container[] = [
    {
      name: 'agent',
      image: agentImage,
      ports: [{ containerPort: 8080 }],
      env: [
        { name: 'JWKS_URL', value: JWKS_URL },
        { name: 'PROJECT_ID', value: projectId },
        { name: 'IDLE_TIMEOUT_SECONDS', value: String(idleTimeoutSeconds) },
        { name: 'WORKSPACE_PATH', value: '/workspace' },
        { name: 'CORS_ORIGIN', value: appUrl },
        { name: 'SLIPSTREAM_WEB_URL', value: SLIPSTREAM_WEB_URL },
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
      spec: {
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
      },
    },
  })
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

export async function deploymentExists(k8sNamespace: string, projectId: string): Promise<boolean> {
  const api = getAppsV1Api()
  const name = buildDeploymentName(projectId)
  try {
    await api.readNamespacedDeployment({ name, namespace: k8sNamespace })
    return true
  } catch {
    return false
  }
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
