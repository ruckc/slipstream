import { getCoreV1Api, getCustomObjectsApi } from './client'

const GATEWAY_API_GROUP = 'gateway.networking.k8s.io'
const GATEWAY_API_VERSION = 'v1'
const HTTPROUTES_RESOURCE = 'httproutes'

function routeName(projectId: string): string {
  return `route-${projectId}`
}

function serviceName(projectId: string): string {
  return `svc-${projectId}`
}

export async function createRouteAndService(
  k8sNamespace: string,
  projectId: string,
  namespaceSlug: string,
  projectSlug: string,
): Promise<{ routeName: string; serviceName: string }> {
  const coreApi = getCoreV1Api()
  const customApi = getCustomObjectsApi()

  const gatewayName = process.env.GATEWAY_NAME ?? 'slipstream-gateway'
  const gatewayNamespace = process.env.GATEWAY_NAMESPACE ?? 'slipstream-system'
  const gatewayHostname = process.env.GATEWAY_HOSTNAME ?? ''

  const svcName = serviceName(projectId)
  const rtName = routeName(projectId)
  const pathPrefix = `/env/${namespaceSlug}/${projectSlug}`

  // Create ClusterIP Service for the pod
  await coreApi.createNamespacedService({
    namespace: k8sNamespace,
    body: {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        name: svcName,
        namespace: k8sNamespace,
        labels: {
          'slipstream.io/project': projectId,
        },
      },
      spec: {
        type: 'ClusterIP',
        selector: {
          'slipstream.io/project': projectId,
        },
        ports: [
          {
            port: 8080,
            targetPort: 8080 as any,
            protocol: 'TCP',
          },
        ],
      },
    },
  })

  // Create HTTPRoute (Gateway API CRD)
  const httproute = {
    apiVersion: `${GATEWAY_API_GROUP}/${GATEWAY_API_VERSION}`,
    kind: 'HTTPRoute',
    metadata: {
      name: rtName,
      namespace: k8sNamespace,
      labels: {
        'slipstream.io/project': projectId,
      },
    },
    spec: {
      parentRefs: [
        {
          name: gatewayName,
          namespace: gatewayNamespace,
        },
      ],
      ...(gatewayHostname ? { hostnames: [gatewayHostname] } : {}),
      rules: [
        {
          matches: [
            {
              path: {
                type: 'PathPrefix',
                value: pathPrefix,
              },
            },
          ],
          filters: [
            {
              type: 'URLRewrite',
              urlRewrite: {
                path: {
                  type: 'ReplacePrefixMatch',
                  replacePrefixMatch: '/',
                },
              },
            },
          ],
          backendRefs: [
            {
              name: svcName,
              namespace: k8sNamespace,
              port: 8080,
            },
          ],
        },
      ],
    },
  }

  await customApi.createNamespacedCustomObject({
    group: GATEWAY_API_GROUP,
    version: GATEWAY_API_VERSION,
    namespace: k8sNamespace,
    plural: HTTPROUTES_RESOURCE,
    body: httproute,
  })

  return { routeName: rtName, serviceName: svcName }
}

export async function deleteRouteAndService(
  k8sNamespace: string,
  rtName: string,
  svcName: string,
): Promise<void> {
  const coreApi = getCoreV1Api()
  const customApi = getCustomObjectsApi()

  await Promise.allSettled([
    customApi.deleteNamespacedCustomObject({
      group: GATEWAY_API_GROUP,
      version: GATEWAY_API_VERSION,
      namespace: k8sNamespace,
      plural: HTTPROUTES_RESOURCE,
      name: rtName,
    }),
    coreApi.deleteNamespacedService({
      name: svcName,
      namespace: k8sNamespace,
    }),
  ])
}
