import { getCoreV1Api, isApiError } from './client'

export function projectK8sNamespace(projectId: string): string {
  return `project-${projectId}`
}

export async function ensureProjectNamespace(
  projectId: string,
  ownerNamespaceId: string,
  ownerNamespaceSlug: string,
  ownerNamespaceType: 'user' | 'org'
): Promise<void> {
  const api = getCoreV1Api()
  try {
    await api.createNamespace({
      body: {
        apiVersion: 'v1',
        kind: 'Namespace',
        metadata: {
          name: projectK8sNamespace(projectId),
          labels: {
            'slipstream.io/project': projectId,
            'slipstream.io/owner-namespace-id': ownerNamespaceId,
            'slipstream.io/owner-namespace-slug': ownerNamespaceSlug,
            'slipstream.io/owner-type': ownerNamespaceType,
          },
        },
      },
    })
  } catch (e) {
    if (!isApiError(e, 409)) throw e
  }
}

export async function deleteProjectNamespace(projectId: string): Promise<void> {
  const api = getCoreV1Api()
  try {
    await api.deleteNamespace({ name: projectK8sNamespace(projectId) })
  } catch (e) {
    if (!isApiError(e, 404)) throw e
  }
}
