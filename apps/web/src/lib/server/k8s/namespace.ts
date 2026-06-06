import { getCoreV1Api, isApiError } from './client'

/** Creates the Kubernetes namespace if it doesn't already exist. */
export async function ensureK8sNamespace(
  k8sNamespace: string,
  namespaceSlug: string,
  type: 'user' | 'org'
): Promise<void> {
  const api = getCoreV1Api()

  try {
    await api.createNamespace({
      body: {
        apiVersion: 'v1',
        kind: 'Namespace',
        metadata: {
          name: k8sNamespace,
          labels: {
            'slipstream.io/type': type,
            'slipstream.io/namespace-slug': namespaceSlug,
          },
        },
      },
    })
  } catch (e) {
    if (!isApiError(e, 409)) throw e
  }
}
