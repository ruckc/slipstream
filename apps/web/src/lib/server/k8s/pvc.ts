import { getCoreV1Api, isApiError } from './client'

function pvcName(projectId: string): string {
  return `pvc-${projectId}`
}

/** Creates the project's PVC if it doesn't already exist. Returns its name either way. */
export async function ensurePvc(k8sNamespace: string, projectId: string): Promise<string> {
  const api = getCoreV1Api()
  const name = pvcName(projectId)
  const storageClass = process.env.AGENT_STORAGE_CLASS ?? 'standard'
  const storage = process.env.AGENT_PVC_SIZE ?? '10Gi'

  try {
    await api.createNamespacedPersistentVolumeClaim({
      namespace: k8sNamespace,
      body: {
        apiVersion: 'v1',
        kind: 'PersistentVolumeClaim',
        metadata: {
          name,
          namespace: k8sNamespace,
          labels: {
            'slipstream.io/project': projectId,
          },
        },
        spec: {
          accessModes: ['ReadWriteOnce'],
          storageClassName: storageClass,
          resources: {
            requests: {
              storage,
            },
          },
        },
      },
    })
  } catch (e) {
    if (!isApiError(e, 409)) throw e
  }

  return name
}

export async function deletePvc(k8sNamespace: string, pvcName: string): Promise<void> {
  const api = getCoreV1Api()
  await api.deleteNamespacedPersistentVolumeClaim({
    name: pvcName,
    namespace: k8sNamespace,
  })
}
