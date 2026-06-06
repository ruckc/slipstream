import { getNetworkingV1Api, isApiError } from './client'

function policyName(projectId: string): string {
  return `netpol-${projectId}`
}

// Namespace where the gateway and slipstream-web live.
const SLIPSTREAM_SYSTEM_NS = process.env.GATEWAY_NAMESPACE ?? 'slipstream-system'
// Namespace where the Envoy data-plane proxy pods run.
const ENVOY_NAMESPACE = process.env.ENVOY_NAMESPACE ?? 'envoy-gateway-system'
// Label on the Envoy proxy pod identifying which Gateway it serves.
const ENVOY_GATEWAY_LABEL_KEY =
  process.env.ENVOY_GATEWAY_LABEL_KEY ?? 'gateway.envoyproxy.io/owning-gateway-name'
const ENVOY_GATEWAY_LABEL_VALUE =
  process.env.ENVOY_GATEWAY_LABEL_VALUE ?? process.env.GATEWAY_NAME ?? 'slipstream'

/**
 * Creates the project's NetworkPolicy if missing, or replaces it with the
 * current desired spec if it already exists — so spec changes (e.g. selector
 * fixes) are picked up on every project start, not just on first creation.
 */
export async function ensureNetworkPolicy(k8sNamespace: string, projectId: string): Promise<void> {
  const api = getNetworkingV1Api()
  const name = policyName(projectId)

  const body = {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'NetworkPolicy',
    metadata: {
      name,
      namespace: k8sNamespace,
      labels: {
        'slipstream.io/project': projectId,
      },
    },
    spec: {
      podSelector: {
        matchLabels: {
          'slipstream.io/project': projectId,
        },
      },
      policyTypes: ['Ingress', 'Egress'],
      ingress: [
        {
          _from: [
            {
              // Only accept traffic from the Envoy proxy pod (data-plane).
              // Namespace and label key/value are configurable via env vars
              // to support different gateway controller deployments.
              namespaceSelector: {
                matchLabels: {
                  'kubernetes.io/metadata.name': ENVOY_NAMESPACE,
                },
              },
              podSelector: {
                matchLabels: {
                  [ENVOY_GATEWAY_LABEL_KEY]: ENVOY_GATEWAY_LABEL_VALUE,
                },
              },
            },
          ],
        },
      ],
      egress: [
        // JWKS endpoint — slipstream-web in slipstream-system, port 80 (HTTP).
        {
          to: [
            {
              namespaceSelector: {
                matchLabels: {
                  'kubernetes.io/metadata.name': SLIPSTREAM_SYSTEM_NS,
                },
              },
              podSelector: {
                matchLabels: {
                  'app.kubernetes.io/component': 'web',
                },
              },
            },
          ],
          ports: [{ protocol: 'TCP', port: 80 }],
        },
        // VictoriaMetrics metrics push.
        {
          to: [
            {
              namespaceSelector: {
                matchLabels: {
                  'kubernetes.io/metadata.name': 'metrics',
                },
              },
              podSelector: {
                matchLabels: {
                  app: 'victoriametrics',
                },
              },
            },
          ],
          ports: [{ protocol: 'TCP', port: 8428 }],
        },
        // Internet egress on HTTP/HTTPS, excluding RFC1918 and link-local (IMDS).
        {
          to: [
            {
              ipBlock: {
                cidr: '0.0.0.0/0',
                except: [
                  '10.0.0.0/8',
                  '172.16.0.0/12',
                  '192.168.0.0/16',
                  '169.254.0.0/16', // link-local / cloud IMDS
                ],
              },
            },
          ],
          ports: [
            { protocol: 'TCP', port: 80 },
            { protocol: 'TCP', port: 443 },
          ],
        },
        // DNS.
        {
          to: [
            {
              namespaceSelector: {
                matchLabels: {
                  'kubernetes.io/metadata.name': 'kube-system',
                },
              },
              podSelector: {
                matchLabels: {
                  'k8s-app': 'kube-dns',
                },
              },
            },
          ],
          ports: [{ protocol: 'UDP', port: 53 }],
        },
      ],
    },
  }

  try {
    await api.createNamespacedNetworkPolicy({ namespace: k8sNamespace, body })
  } catch (e) {
    if (!isApiError(e, 409)) throw e
    const current = await api.readNamespacedNetworkPolicy({ name, namespace: k8sNamespace })
    await api.replaceNamespacedNetworkPolicy({
      name,
      namespace: k8sNamespace,
      body: {
        ...body,
        metadata: { ...body.metadata, resourceVersion: current.metadata?.resourceVersion },
      },
    })
  }
}

export async function deleteNetworkPolicy(k8sNamespace: string, projectId: string): Promise<void> {
  const api = getNetworkingV1Api()
  const name = policyName(projectId)

  await api.deleteNamespacedNetworkPolicy({
    name,
    namespace: k8sNamespace,
  })
}
