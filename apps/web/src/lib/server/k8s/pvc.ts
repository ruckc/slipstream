import { getCoreV1Api } from './client'

function pvcName(projectId: string): string {
  return `pvc-${projectId}`
}

export async function createPvc(k8sNamespace: string, projectId: string): Promise<string> {
  const api = getCoreV1Api()
  const name = pvcName(projectId)
  const storageClass = process.env.AGENT_STORAGE_CLASS ?? 'standard'
  const storage = process.env.AGENT_PVC_SIZE ?? '10Gi'

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

  return name
}

export async function deletePvc(k8sNamespace: string, pvcName: string): Promise<void> {
  const api = getCoreV1Api()
  await api.deleteNamespacedPersistentVolumeClaim({
    name: pvcName,
    namespace: k8sNamespace,
  })
}
