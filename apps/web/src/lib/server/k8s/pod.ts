import { getCoreV1Api } from './client'

const JWKS_URL =
  'http://slipstream-web.slipstream-system.svc.cluster.local/api/jwks'

function buildPodName(projectId: string): string {
  return `agent-${projectId}`.slice(0, 63)
}

export async function createPod(
  k8sNamespace: string,
  projectId: string,
  pvcName: string,
  idleTimeoutSeconds: number,
): Promise<string> {
  const api = getCoreV1Api()
  const agentImage = process.env.AGENT_IMAGE
  if (!agentImage) throw new Error('AGENT_IMAGE environment variable is required')

  const podName = buildPodName(projectId)

  const containers: object[] = [
    {
      name: 'agent',
      image: agentImage,
      ports: [{ containerPort: 8080 }],
      env: [
        { name: 'JWKS_URL', value: JWKS_URL },
        { name: 'PROJECT_ID', value: projectId },
        { name: 'IDLE_TIMEOUT_SECONDS', value: String(idleTimeoutSeconds) },
        { name: 'WORKSPACE_PATH', value: '/workspace' },
      ],
      volumeMounts: [{ name: 'workspace', mountPath: '/workspace' }],
      readinessProbe: {
        httpGet: { path: '/health', port: 8080 },
        initialDelaySeconds: 2,
        periodSeconds: 5,
      },
      securityContext: {
        allowPrivilegeEscalation: false,
        readOnlyRootFilesystem: false,
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
    })
  }

  await api.createNamespacedPod({
    namespace: k8sNamespace,
    body: {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: {
        name: podName,
        namespace: k8sNamespace,
        labels: {
          'slipstream.io/project': projectId,
          'app': `agent-${projectId}`,
        },
      },
      spec: {
        automountServiceAccountToken: false,
        restartPolicy: 'Never',
        securityContext: {
          runAsNonRoot: true,
          runAsUser: 1000,
          fsGroup: 1000,
        },
        containers: containers as any,
        volumes: [
          {
            name: 'workspace',
            persistentVolumeClaim: { claimName: pvcName },
          },
        ],
      },
    },
  })

  return podName
}

export async function deletePod(k8sNamespace: string, podName: string): Promise<void> {
  const api = getCoreV1Api()
  await api.deleteNamespacedPod({
    name: podName,
    namespace: k8sNamespace,
  })
}

export async function getPodStatus(
  k8sNamespace: string,
  podName: string,
): Promise<'pending' | 'running' | 'succeeded' | 'failed' | 'unknown'> {
  const api = getCoreV1Api()
  try {
    const pod = await api.readNamespacedPod({ name: podName, namespace: k8sNamespace })
    const phase = pod.status?.phase?.toLowerCase()
    switch (phase) {
      case 'pending':
        return 'pending'
      case 'running':
        return 'running'
      case 'succeeded':
        return 'succeeded'
      case 'failed':
        return 'failed'
      default:
        return 'unknown'
    }
  } catch {
    return 'unknown'
  }
}
