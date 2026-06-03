import { getCoreV1Api } from './client'

export async function createK8sNamespace(
  k8sNamespace: string,
  namespaceSlug: string,
  type: 'user' | 'org'
): Promise<void> {
  const api = getCoreV1Api()

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
}
